---
title: GraphRAG 技术详解
tags:
  - GraphRAG
  - 知识图谱
  - RAG
  - LLM
  - 社区检测
excerpt: GraphRAG 将知识图谱与 RAG 结合，通过 LLM 从文本中抽取实体与关系构建图谱，再用社区检测生成层级摘要，解决传统向量 RAG 在多跳推理和全局理解上的瓶颈。本文系统梳理 GraphRAG 的核心概念、索引构建与查询检索机制、Microsoft GraphRAG 实战、生态变体与选型建议。
createTime: 2026/08/02 18:00:00
permalink: /ai-study/graphrag-introduction/
---

# GraphRAG 技术详解

> 当你问 RAG 系统"这部小说的主要主题是什么"时，它大概率会沉默——向量检索能找到包含特定关键词的段落，却无法回答需要跨文档综合推理的全局性问题。GraphRAG 用知识图谱 + 社区摘要给出了另一种解法。

---

## 背景与动机：传统 RAG 的天花板

### 向量检索的"局部性陷阱"

传统 RAG（Retrieval-Augmented Generation）的核心流程是：文档切块 → embedding 向量化 → 查询时用向量相似度召回 top-k 文本块 → 拼入 prompt 让 LLM 生成答案。这套范式在**事实型问答**（"公司差旅报销上限是多少？"）上表现良好，但在两类问题上力不从心：

**1. 多跳推理问题**

> 问题："A 的导师的导师是谁？"

文档 1 提到"A 的导师是 B"，文档 2 提到"B 的导师是 C"。向量检索可能只召回包含"A 的导师"的片段，由于"B 的导师"与查询的语义距离较远，不一定被召回。LLM 拿不到完整链路，就无法回答。

**2. 全局理解问题**

> 问题："这篇报告的核心论点是什么？"

传统 RAG 擅长"局部搜索"——找到包含特定关键词的段落，但不擅长"全局总结"——把整篇文档的主旨提炼出来。因为不可能把所有文本块都塞进一个 prompt，而 top-k 召回又天然只能覆盖局部。

![GraphRAG vs 传统 RAG 对比](/ai-study/ai-ecosystem/graphrag-introduction/graphrag-vs-traditional-rag.svg)

### 问题的本质

这两类问题的共同根源在于：**向量相似度只能度量"文本表面语义的接近程度"，无法表达实体之间的结构化关系**。

- 文档之间的引用、继承、因果关系，是确定性的拓扑结构，不是"语义相近"能覆盖的
- 全局性总结需要"鸟瞰"整个文档集，而向量检索天然是"管中窥豹"

GraphRAG 的核心思路是：**如果文档之间有结构化的关系网络，那就先把这张网络建出来，然后在图上做检索和推理**。

为了建立直觉，先看一个具体例子。假设有以下三段输入文档：

```text
[文档 1] 张三自 2020 年起在蓝星科技担任 AI 平台负责人。他主导了公司内部 RAG 系统的架构设计，
         采用微服务 + 向量数据库 Milvus 的方案。张三毕业于清华大学计算机系。

[文档 2] 蓝星科技是一家专注于企业 AI 解决方案的科技公司，成立于 2018 年，总部位于北京。
         公司目前拥有员工 500 余人，其中 AI 研发团队 120 人。CEO 为王建国。

[文档 3] 2024 年，蓝星科技的 RAG 系统完成了重大升级，引入了 GraphRAG 技术。
         张三带领团队在 3 个月内完成了技术迁移，检索精度提升了 15%。
         该项目获得了公司年度最佳技术创新奖。
```

经过 GraphRAG 索引构建后，生成的知识图谱大致如下（概念简化版）：

```text
┌─────────────────────────────────────────────────────────────────┐
│                      知识图谱（可视化）                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐  担任   ┌──────────┐  任职   ┌──────────┐       │
│   │  张三    │────────▶│ 蓝星科技 │◀────────│ 王建国   │       │
│   │ person   │         │ org      │  CEO    │ person   │       │
│   └────┬─────┘         └────┬─────┘         └──────────┘       │
│        │ 毕业               │ 拥有                              │
│        ▼                    ▼                                   │
│   ┌──────────┐         ┌──────────┐                            │
│   │ 清华大学 │         │ AI研发团队│                            │
│   │ org      │         │ concept  │                            │
│   └──────────┘         └──────────┘                            │
│                                                                 │
│   ┌──────────┐  主导   ┌──────────┐                            │
│   │ 张三     │────────▶│ RAG系统  │                            │
│   └──────────┘         └────┬─────┘                            │
│                             │ 升级                              │
│                             ▼                                   │
│                        ┌──────────┐                             │
│                        │ GraphRAG │                             │
│                        │ concept  │                             │
│                        └──────────┘                             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  社区检测结果：                                                  │
│  · 社区 #1（AI 团队）：张三、蓝星科技、王建国、AI研发团队          │
│  · 社区 #2（技术方向）：RAG系统、GraphRAG、Milvus                │
│  · 社区 #3（教育背景）：张三、清华大学                           │
└─────────────────────────────────────────────────────────────────┘
```

查询"蓝星科技的 AI 技术方向有哪些"时，Global Search 会：

1. 匹配到社区 #1（AI 团队）和社区 #2（技术方向）的报告
2. 社区 #2 的报告摘要已包含"RAG 系统采用微服务 + Milvus 方案，2024 年引入 GraphRAG"
3. 综合两个社区的信息，生成全局回答

这就是 GraphRAG 的"从局部到全局"——从三段文档中抽取实体关系建图，再通过社区摘要获得鸟瞰视角。

---

## GraphRAG 核心概念

### 什么是 GraphRAG

**GraphRAG**（Graph-based Retrieval-Augmented Generation）是一种将**知识图谱**（Knowledge Graph）与 RAG 相结合的技术方案。它通过 LLM 从文本中抽取实体和关系，构建知识图谱，再利用图算法（如社区检测）对图谱进行层次化组织，最终在查询时利用图结构和社区摘要来增强 LLM 的回答能力。

| 属性 | 说明 |
|------|------|
| **提出者** | Microsoft Research（2024 年 4 月论文发表） |
| **论文** | *From Local to Global: A Graph RAG Approach to Query-Focused Summarization* |
| **开源实现** | `microsoft/graphrag`（Python，MIT 许可证） |
| **核心依赖** | LLM API（OpenAI / Azure OpenAI / Ollama / 本地模型） |
| **图算法** | Leiden 社区检测算法 |
| **存储格式** | Parquet 文件 / Neo4j / LanceDB 等 |

### 核心思想：From Local to Global

GraphRAG 论文的副标题是"From Local to Global"，这概括了它的核心策略：

- **Local**：从文本块中**局部**抽取实体和关系
- **Global**：通过社区检测将局部信息**全局**组织成层次化的摘要

![GraphRAG 架构总览](/ai-study/ai-ecosystem/graphrag-introduction/graphrag-overview.svg)

### 关键术语

| 术语 | 含义 |
|------|------|
| **Entity（实体）** | 文本中出现的命名对象，如人、组织、地点、概念 |
| **Relationship（关系）** | 两个实体之间的有向连接，带有描述和权重 |
| **Claim（声明）** | 实体与文本块之间的关联，表示"这个实体出现在这段文本中" |
| **Community（社区）** | 通过图算法检测出的实体群组，内部连接紧密 |
| **Community Report（社区报告）** | LLM 为每个社区生成的摘要报告 |

---

## 工作原理：索引构建

GraphRAG 的工作流程分为两大阶段：**索引构建**（Indexing）和**查询检索**（Query）。索引构建是一次性的离线过程，查询检索是实时在线过程。

![GraphRAG 索引构建流程](/ai-study/ai-ecosystem/graphrag-introduction/graphrag-indexing-mechanism.svg)

### 第 1 步：文本切分

与传统 RAG 一样，首先将原始文档切分为文本块（chunk）。GraphRAG 默认按 token 数切分（如 1200 tokens/chunk），并设置一定的重叠度。

切分粒度的选择直接影响图谱质量：

| 切分粒度 | 实体抽取效果 | 关系抽取效果 | 索引成本 |
|---------|------------|------------|---------|
| **小 chunk（300-600 tokens）** | 实体召回率高，但跨 chunk 关系丢失多 | 单 chunk 内关系完整 | chunk 数多，LLM 调用次数多 |
| **大 chunk（1200-2400 tokens）** | 实体去重压力大，可能遗漏细节 | 跨实体关系更完整 | chunk 数少，但单次 prompt 更长 |

GraphRAG 默认使用 1200 tokens 的 chunk size，这是一个平衡点。

### 第 2 步：实体与关系抽取

对每个文本块，GraphRAG 使用 LLM 进行**实体抽取**和**关系抽取**。核心是一个精心设计的 prompt：

```text
-Goal-
Given a text document that is potentially relevant to this activity and a list of entity types,
identify all entities of those types from the text and all relationships among the identified entities.

-Steps-
1. Identify all entities. For each identified entity, extract the following information:
   - entity_name: Name of the entity, capitalized first letter
   - entity_type: One of the following types: [organization, person, geo, event]
   - entity_description: Comprehensive description of the entity
   Format each entity as ("entity"{tuple_delimiter}<entity_name>{tuple_delimiter}<entity_type>{tuple_delimiter}<entity_description>)

2. From the entities identified in step 1, identify all pairs of (source_entity, target_entity)
   that are *clearly related* to each other.
   Format each relationship as ("relationship"{tuple_delimiter}<source>{tuple_delimiter}<target>{tuple_delimiter}<relationship_description>{tuple_delimiter}<relationship_strength>)
```

LLM 返回的结果类似：

```text
("entity"<|>张三<|>person<|>蓝星科技AI平台负责人，负责RAG系统架构设计)
("entity"<|>蓝星科技<|>organization<|>专注于企业AI解决方案的科技公司，成立于2018年)
("relationship"<|>张三<|>蓝星科技<|>张三在蓝星科技担任AI平台负责人<|>8)
```

**抽取策略的关键设计**：

- **Gleaning（迭代清洗）**：默认进行多轮抽取（`max_gleanings=1`），第一轮抽取后让 LLM 判断"是否遗漏了实体"，如有则继续抽取，直到无遗漏或达到上限。这显著提高了实体召回率
- **实体去重**：不同 chunk 可能抽取到同一个实体（如"张三"和"张三工程师"），GraphRAG 用 LLM 做实体规范化合并

### 第 3 步：图构建

将所有抽取到的实体作为**节点**，关系作为**边**，构建知识图谱。每条边带有：

- `description`：关系描述
- `weight`：关系强度（LLM 给出的 1-10 分值，表示关系的明确程度）
- `source_id`：来源文本块 ID

同名实体会被合并，关系描述也会被 LLM 汇总成一段综合描述。

```text
# 图谱数据结构（概念示意）
nodes: [
  { id: "张三", type: "person", description: "...", source_ids: ["chunk_0", "chunk_3"] },
  { id: "蓝星科技", type: "organization", description: "...", source_ids: ["chunk_0", "chunk_5"] },
]

edges: [
  { source: "张三", target: "蓝星科技", description: "张三在蓝星科技担任AI平台负责人", weight: 8 },
]
```

### 第 4 步：社区检测

这是 GraphRAG 的**核心创新**。使用 **Leiden 算法**对知识图谱进行社区检测，将紧密相连的实体划分为社区。

**为什么选 Leiden 而不是 Louvain？**

| 维度 | Louvain | Leiden |
|------|---------|--------|
| 算法基础 | 模块度优化 | 模块度优化 + 细化阶段 |
| 是否保证连通性 | ❌ 社区内可能存在不连通的节点 | ✅ 保证社区内部连通 |
| 分辨率参数 | 支持 | 支持（`resolution` 控制社区粒度） |
| 速度 | 快 | 略慢于 Louvain，但质量更高 |

Leiden 的 `resolution` 参数控制社区粒度：

- **高 resolution（如 1.0）**：社区数量多，每个社区小而精
- **低 resolution（如 0.3）**：社区数量少，每个社区大而广

GraphRAG 默认 `resolution=1.0`，并支持**多层级社区**（`max_levels=3`），即对每个社区递归再检测子社区，形成层次化结构。

### 第 5 步：社区报告生成

对每个社区，GraphRAG 使用 LLM 生成一份**社区报告**（Community Report）。这份报告包含：

- **标题**：社区主题概括
- **摘要**：社区内关键实体的综合描述
- **发现**（Findings）：按重要性排序的关键发现列表

```text
# 社区报告示例（概念示意）
Title: 蓝星科技的AI团队与技术方向
Summary: 该社区围绕蓝星科技的AI平台团队展开，核心成员包括张三（AI平台负责人）、
         王建国（CEO）等，主要技术方向为RAG系统建设和向量数据库选型。

Findings:
1. [重要性: 8] 张三负责的AI平台架构采用了微服务+向量数据库Milvus的方案
2. [重要性: 7] 2024年RAG系统引入GraphRAG技术，检索精度提升15%
3. [重要性: 6] 该项目获得公司年度最佳技术创新奖
```

层级社区会从最底层开始生成报告，然后逐层向上汇总，上层的报告基于下层报告的内容综合生成。

### 索引产物一览

索引完成后，GraphRAG 的输出目录结构如下：

```text
output/
├── create_final_nodes.parquet          # 所有实体节点
├── create_final_entities.parquet       # 实体详细描述
├── create_final_relationships.parquet  # 所有关系边
├── create_final_text_units.parquet     # 原始文本块（含实体引用）
├── create_final_communities.parquet    # 社区层级结构
├── create_final_community_reports.parquet  # 社区报告
└── create_final_documents.parquet      # 原始文档元数据
```

这些 Parquet 文件构成了 GraphRAG 的知识库，后续查询全部基于它们。

---

## 工作原理：查询检索

GraphRAG 提供两种核心查询模式：**Local Search**（局部搜索）和**Global Search**（全局搜索），分别对应不同类型的问题。

### Local Search：实体为中心的精确检索

适用于**具体性问题**——"张三负责什么技术方向？"、"蓝星科技的RAG方案是什么？"

工作流程：

1. **实体定位**：将用户查询与知识图谱中的实体做匹配（embedding 相似度 + 关键词匹配）
2. **邻居扩展**：找到匹配实体的一跳邻居（相关实体、关系、关联文本块）
3. **上下文组装**：将实体信息、关系信息、关联文本块、社区报告按 token 预算组装成上下文
4. **LLM 生成**：将组装好的上下文送入 LLM 生成最终回答

```text
用户查询: "张三负责什么技术方向？"
         ↓
实体匹配: 找到节点 "张三"
         ↓
邻居扩展: 
  - 关系: 张三 --[担任]--> 蓝星科技
  - 关系: 张三 --[负责]--> RAG系统架构
  - 关联文本: chunk_0, chunk_3
  - 所属社区报告: 社区 #1 的报告
         ↓
上下文组装 → LLM 生成回答
```

Local Search 的上下文组装策略是 GraphRAG 的一个精细设计——它同时注入了**结构化信息**（图谱关系）和**非结构化信息**（原始文本块），让 LLM 既能看到关系网络，又能回溯原文。

### Global Search：社区摘要驱动的全局推理

适用于**抽象性/全局性问题**——"这篇报告的核心论点是什么？"、"文档中涉及的主要技术趋势有哪些？"

工作流程：

1. **社区报告排序**：将所有社区报告的 embedding 与查询做相似度匹配，选取最相关的 top-k 社区
2. **Map 阶段**：对每个选中的社区报告，让 LLM 生成多个"中间回答"（含相关性评分 0-100）
3. **Reduce 阶段**：将所有中间回答按相关性排序，汇总成最终回答

```text
用户查询: "文档中涉及的主要技术趋势有哪些？"
         ↓
社区报告匹配: 选取 top-5 相关社区报告
         ↓
Map 阶段 (并行):
  社区 #1 → "AI平台架构采用微服务方案..." (score: 85)
  社区 #3 → "RAG系统建设取得进展..." (score: 92)
  社区 #7 → "大模型推理优化是重点方向..." (score: 78)
  社区 #2 → "团队在探索GraphRAG..." (score: 88)
  社区 #5 → "向量数据库选型偏向Milvus..." (score: 65)
         ↓
Reduce 阶段: 汇总中间回答 → 最终回答
```

Global Search 本质上是一个 **Map-Reduce** 模式——Map 阶段并行处理多个社区报告，Reduce 阶段汇总。这让 LLM 能"鸟瞰"整个文档集的全貌，而不需要一次性把所有文本塞进上下文窗口。

### 两种模式对比

| 维度 | Local Search | Global Search |
|------|-------------|---------------|
| **适用问题** | 具体实体、事实查询 | 全局总结、主题分析 |
| **数据来源** | 实体 + 关系 + 关联文本块 + 社区报告 | 社区报告（摘要层） |
| **LLM 调用** | 1 次（单轮生成） | 多次（Map-Reduce） |
| **延迟** | 低（秒级） | 较高（取决于社区数量） |
| **Token 消耗** | 少 | 多（多个社区并行处理） |
| **回答风格** | 精确、可溯源 | 概括性、全局视角 |

::: tip DRIFT Search
GraphRAG 较新版本还引入了 **DRIFT Search**（Dynamic Reasoning and Inference with Flexible Traversal），它结合了 Local 和 Global 的优势——先用社区报告做粗粒度定位，再用图谱遍历做细粒度补充。适用于需要既全局又精确的复杂查询。
:::

### 输出质量对比：GraphRAG vs 传统 RAG

Microsoft 在论文中使用自建的新闻与播客转录文本数据集进行了系统评测。该数据集包含虚构的新闻文章和书籍摘要，专门设计用于测试多跳推理和全局理解能力。

评测指标采用 **LLM-as-a-Judge**：让一个独立 LLM 在不知道哪个是 GraphRAG 输出的前提下，对两个系统的回答进行盲评打分。

| 评测维度 | 说明 | GraphRAG 胜率 |
|---------|------|-------------|
| **全面性（Comprehensiveness）** | 回答是否覆盖所有相关方面 | **~82%** |
| **多样性（Diversity）** | 回答是否提供多角度观点 | **~78%** |
| **实证支持度（Empowerment）** | 回答是否给出可行动的具体信息 | **~75%** |
| **直接性（Directness）** | 回答是否切中问题核心 | **~68%** |
| **综合胜率** | 四维度综合 | **~76%** |

一个具体的对比示例：

```text
📋 输入：一段 5000 字的企业内部技术文档（讨论 AI 平台架构演进）

❓ 问题："文档中关于 AI 平台技术选型的核心争议是什么？"

┌───────────────────────────────────────────────────────────────┐
│  传统向量 RAG 的回答：                                         │
│  "文档讨论了微服务架构、向量数据库选型、以及 RAG 检索精度的   │
│   提升。技术选型主要围绕 Milvus 和 Pinecone 进行对比。"        │
│                                                               │
│  ⚠️ 只覆盖了"选型是什么"，没有回答"争议是什么"                │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  GraphRAG 的回答：                                            │
│  "文档中 AI 平台技术选型的核心争议集中在三个维度：             │
│   1. 架构层面：张三主张微服务以支持独立部署，李四倾向单体      │
│      架构以降低运维复杂度；                                    │
│   2. 检索层面：向量数据库团队（张三）坚持 Milvus 因其性能      │
│      优势，图数据库团队（王五）认为 GraphRAG 更适合多跳查询；  │
│   3. 成本层面：CFO 赵六质疑 Milvus 的集群成本，要求评估        │
│      Pinecone 的托管方案。"                                   │
│                                                               │
│  ✅ 不仅列出了争议点，还关联了争议各方的角色和立场            │
└───────────────────────────────────────────────────────────────┘
```

---

## Microsoft GraphRAG 实战

### 安装

```bash
# 使用 pip 安装
pip install graphrag

# 或使用 uv（推荐，速度更快）
uv pip install graphrag
```

### 初始化项目

```bash
# 创建工作目录
mkdir my-graphrag-project && cd my-graphrag-project

# 初始化项目结构
python -m graphrag.init --root .
```

初始化后生成如下结构：

```text
my-graphrag-project/
├── input/              # 放入待索引的 .txt 文件
├── settings.yaml       # 核心配置文件
├── prompts/            # 自定义 prompt 模板（可选）
└── .env                # 环境变量（API key 等）
```

### 配置

`settings.yaml` 是 GraphRAG 的核心配置文件，关键配置项：

```yaml
# LLM 配置
llm:
  api_key: ${GRAPHRAG_API_KEY}
  type: openai_chat     # 支持 openai_chat, azure_openai_chat, ollama_chat 等
  model: gpt-4o-mini
  max_tokens: 1200
  temperature: 0        # 实体抽取用 0 温度，保证确定性

# Embedding 配置
embeddings:
  llm:
    api_key: ${GRAPHRAG_API_KEY}
    type: openai_embedding
    model: text-embedding-3-small

# 文本切分
chunks:
  size: 1200            # 每个 chunk 的 token 数
  overlap: 100          # chunk 之间的重叠 token 数

# 实体抽取
entity_extraction:
  max_gleanings: 1      # 迭代清洗轮数

# 社区检测
cluster_graph:
  max_levels: 3         # 社区层级深度
  resolution: 1.0       # 社区粒度

# 社区报告
community_reports:
  max_length: 2000      # 报告最大 token 数
```

### 索引构建

```bash
# 将文档放入 input/ 目录后执行
python -m graphrag.index --root .

# 输出存放在 output/ 目录
# 包含 Parquet 文件和图谱可视化
```

索引过程会消耗较多 LLM 调用。一篇 10 万 token 的文档，索引大约需要：

| 步骤 | LLM 调用次数（估算） |
|------|-------------------|
| 实体抽取（含 gleaning） | chunk 数 × (1 + max_gleanings) |
| 实体去重 | 实体对数 / batch_size |
| 社区报告生成 | 社区数 × 层级数 |
| **总计（约）** | **数百次** |

::: warning 成本提醒
GraphRAG 的索引成本远高于传统 RAG。建议先用 `gpt-4o-mini` 做小规模测试，确认效果后再对完整数据集索引。也可以使用 Ollama 接入本地模型（如 Qwen2.5）来降低成本。
:::

### 领域 Prompt 优化（prompt_tune）

GraphRAG 默认的实体抽取 prompt 是通用模板，可能不完全适配你的领域（如法律、医疗、金融等）。`prompt_tune` 命令可以基于你的文档自动生成领域优化的 prompt：

```bash
# 基于文档样本自动优化实体抽取 prompt
python -m graphrag.prompt_tune \
  --root . \
  --config settings.yaml \
  --domain "企业AI技术文档" \
  --limit 20 \
  --output prompts/custom
```

这会分析你的文档内容，自动生成：
- 领域定制的实体类型列表（如将默认的 `[organization, person, geo, event]` 替换为 `[技术方案, 产品, 团队, 项目, 架构组件]`）
- 领域优化的抽取 prompt 模板

优化后的 prompt 可以显著提升特定领域的实体召回率和关系抽取准确率。

### 查询

```bash
# Global Search —— 全局性问题
python -m graphrag.query \
  --root . \
  --method global \
  "文档中涉及的主要技术趋势有哪些？"

# Local Search —— 具体性问题
python -m graphrag.query \
  --root . \
  --method local \
  "张三负责什么技术方向？"
```

也可以通过 Python API 调用：

```python
import asyncio
from graphrag.query.indexed_storage import load_context
from graphrag.query.structured_search.local_search import LocalSearch
from graphrag.query.structured_search.global_search import GlobalSearch

async def main():
    # 加载索引数据
    context = load_context("output/")

    # Local Search
    local_search = LocalSearch(
        llm=llm,
        context_builder=context.local_context_builder,
    )
    result = await local_search.search("张三负责什么技术方向？")
    print(result.response)

    # Global Search
    global_search = GlobalSearch(
        llm=llm,
        context_builder=context.global_context_builder,
    )
    result = await global_search.search("文档中涉及的主要技术趋势有哪些？")
    print(result.response)

asyncio.run(main())
```

### 端到端完整示例

下面是一个从准备数据到查询结果的完整可运行示例：

```bash
# Step 1: 安装
pip install graphrag

# Step 2: 创建项目
python -m graphrag.init --root ./my-project
cd my-project

# Step 3: 准备数据（放入 .txt 文件）
cat > input/ai_team.txt << 'EOF'
张三自 2020 年起在蓝星科技担任 AI 平台负责人。他主导了公司内部 RAG 系统的架构设计，
采用微服务 + 向量数据库 Milvus 的方案。张三毕业于清华大学计算机系。

蓝星科技是一家专注于企业 AI 解决方案的科技公司，成立于 2018 年，总部位于北京。
公司目前拥有员工 500 余人，其中 AI 研发团队 120 人。CEO 为王建国。

2024 年，蓝星科技的 RAG 系统完成了重大升级，引入了 GraphRAG 技术。
张三带领团队在 3 个月内完成了技术迁移，检索精度提升了 15%。
EOF

# Step 4: 配置环境变量
echo "GRAPHRAG_API_KEY=sk-xxx" > .env

# Step 5: 索引构建（离线，消耗 LLM 调用）
python -m graphrag.index --root .
# 输出: ✓ Completed indexing. Output stored in output/

# Step 6: 查询
python -m graphrag.query --root . --method global "蓝星科技的 AI 技术方向有哪些？"
```

---

## GraphRAG 生态与变体

GraphRAG 的理念催生了一系列变体和替代实现，各有侧重：

| 项目 | 定位 | 核心差异 | 适用场景 |
|------|------|---------|---------|
| **Microsoft GraphRAG** | 官方参考实现 | 完整 pipeline，社区检测 + 层级摘要 | 生产级 GraphRAG 部署 |
| **LightRAG** | 轻量替代 | 去掉社区检测，用双层检索（低频/高频实体）替代，索引速度快 10 倍+ | 快速原型、中小规模数据 |
| **nano-graphrag** | 最小化实现 | ~1000 行代码复现 GraphRAG 核心逻辑，易于理解和二次开发 | 学习理解、定制化开发 |
| **Neo4j GraphRAG** | 图数据库原生 | 基于 Neo4j 图数据库存储和查询，支持 Cypher 查询 | 已有 Neo4j 基础设施的团队 |
| **LlamaIndex KG** | 框架集成 | LlamaIndex 的知识图谱模块，与 RAG 框架深度集成 | 已使用 LlamaIndex 的项目 |

### LightRAG：更快的替代方案

LightRAG 是港大团队提出的 GraphRAG 变体，核心改进是**去掉了昂贵的社区检测和报告生成步骤**，改用**双层检索策略**：

- **低频层**：检索出现次数少的实体（长尾信息）
- **高频层**：检索出现次数多的实体（核心信息）

这使得 LightRAG 的索引速度比 Microsoft GraphRAG 快 10 倍以上，同时保持了相当的检索质量。对中小规模数据集，LightRAG 是更实用的选择。

### nano-graphrag：最小化学习工具

nano-graphrag 将 GraphRAG 的核心逻辑压缩到约 1000 行代码中，去掉了 Microsoft 实现中的工程复杂性。它是理解 GraphRAG 工作原理的最佳入口——你可以用半小时通读全部源码，理解从文本到图谱到查询的完整流程。

---

## 实践建议与选型指南

![GraphRAG 选型决策图](/ai-study/ai-ecosystem/graphrag-introduction/graphrag-selection-guide.svg)

### 什么时候用 GraphRAG

- **多跳推理密集**：知识库的核心价值在于实体间的关系网络（如人物关系图谱、组织架构、因果链分析）
- **全局总结需求**：需要回答"这篇文档/这批文档的核心主题是什么"这类全局性问题
- **数据量适中**：文档总量在数百到数千篇以内，索引成本可控
- **对延迟不敏感**：索引可以离线批量完成，查询延迟允许秒级到十秒级

### 什么时候用传统 RAG

- **事实型问答为主**：用户查询主要是"找到包含某信息的段落"这类精确检索
- **数据量巨大**：百万级文档，GraphRAG 的索引成本难以承受
- **延迟敏感**：需要毫秒级响应的在线场景
- **成本受限**：无法承担大量 LLM 调用的索引成本

### 混合方案

实际工程中，GraphRAG 和传统向量 RAG 并不是二选一的关系。常见的混合策略：

```text
1. 向量 RAG 做粗筛     → 快速召回相关文档子集
2. GraphRAG 做精排     → 在子集上构建图谱，利用关系网络做精确推理
3. 路由层做分发        → 简单问题走向量 RAG，复杂问题走 GraphRAG
```

### 成本优化建议

| 优化策略 | 效果 | 代价 |
|---------|------|------|
| 用 `gpt-4o-mini` 做索引 | 成本降低 ~90% | 实体抽取质量略降 |
| 用 Ollama 接入本地模型 | 零 API 成本 | 需要 GPU 机器，速度较慢 |
| 增大 chunk size | 减少 LLM 调用次数 | 跨 chunk 关系可能丢失 |
| 降低 `max_gleanings` 到 0 | 减少 ~30% 调用 | 实体召回率下降 |
| 用 LightRAG 替代 | 索引速度快 10x+ | 无社区报告，全局搜索能力弱 |

### 失败模式与局限性

| 失败模式 | 表现 | 原因 | 缓解方案 |
|---------|------|------|---------|
| **实体抽取遗漏** | 重要实体未被识别，导致关系断裂 | LLM 抽取能力不足、prompt 未覆盖领域实体类型 | 调大 `max_gleanings`、自定义 entity_types |
| **实体歧义合并** | 同名不同义的实体被错误合并（如两个"张伟"） | LLM 去重时过度合并 | 在 extraction prompt 中强调消歧义 |
| **社区碎片化** | 大量单节点社区，失去摘要价值 | 数据稀疏、resolution 过高 | 降低 `resolution`、增大 chunk size |
| **全局搜索幻觉** | 社区报告未覆盖的信息被编造 | LLM 在 Reduce 阶段"脑补"缺失内容 | 强化"仅基于给定材料回答"的约束 |
| **图谱过时** | 索引后数据变更，图谱不再反映最新状态 | 索引是一次性的，无自动更新机制 | 定期重新索引（见下文增量方案） |

### 增量索引与数据更新

实际生产环境中数据会持续变化，GraphRAG 当前支持以下更新策略：

| 策略 | 适用场景 | 操作方式 |
|------|---------|---------|
| **全量重建** | 数据变更频繁或变更量大 | 直接重新运行 `graphrag.index` |
| **增量追加**（实验性） | 新增文档，旧文档不变 | 将新文档放入 `input/`，使用 `--resume` 参数 |
| **定期调度** | 数据变化有规律（如每日更新） | 用 CI/CD 定时触发索引任务 |

::: warning 增量索引的局限
GraphRAG 的增量索引功能目前仍属实验性。社区检测（Leiden 算法）必须基于完整图谱运行，增量新增节点可能导致社区划分与全量重建不一致。对于生产环境，建议**定期全量重建**，而非依赖增量更新。
:::

### 与其他技术的对比定位

GraphRAG 不是孤立的技术，了解它与相关技术的定位差异有助于选型：

| 技术 | 核心表示 | 与 GraphRAG 的关系 |
|------|---------|------------------|
| **传统向量 RAG** | 文本块 + embedding | GraphRAG 的替代/补充方案，适合简单事实查询 |
| **知识图谱 QA** | 纯图数据库查询（Cypher/SPARQL） | GraphRAG 的上层——先建图谱再查询，GraphRAG 解决"如何从文本自动建图" |
| **GraphSAGE / GNN** | 图神经网络节点分类 | GraphRAG 不使用图神经网络，仅用传统图算法（Leiden）做社区检测 |
| **Text2SQL** | 自然语言转 SQL 查询 | 互补关系——GraphRAG 处理非结构化文本，Text2SQL 处理结构化数据库 |
| **Agentic RAG** | Agent 多步推理 + 工具调用 | GraphRAG 可作为 Agentic RAG 的知识后端，提供图谱查询能力 |

---

## 总结

### 核心要点回顾

| 要点 | 说明 |
|------|------|
| **GraphRAG 解决什么** | 传统向量 RAG 在多跳推理和全局理解上的瓶颈 |
| **核心创新** | LLM 抽取实体关系建图 + Leiden 社区检测 + 层级摘要 |
| **两种查询模式** | Local Search（实体精确检索） + Global Search（社区摘要全局推理） |
| **索引成本** | 远高于传统 RAG，需合理选型模型和参数 |
| **生态选择** | 官方 GraphRAG（完整）、LightRAG（轻快）、nano-graphrag（学习） |

### 设计哲学

GraphRAG 的设计哲学可以总结为一句话：**不要只让 LLM "读"文档，要让 LLM 先"理解"文档的结构，再基于结构做推理**。

这与 CodeGraph 的理念异曲同工——代码有 AST 和调用图，文档有实体关系图，这些都是确定性的结构信息，应该优先吃掉，而不是全部依赖向量语义近似。

> **结构化信息优先于语义近似。** 这是一条适用于所有 RAG 系统的设计原则。

### 进一步阅读

- [GraphRAG 论文原文](https://arxiv.org/abs/2404.16130) — *From Local to Global: A Graph RAG Approach to Query-Focused Summarization*
- [Microsoft GraphRAG 官方文档](https://microsoft.github.io/graphrag/)
- [LightRAG 论文](https://arxiv.org/abs/2410.05779) — *LightRAG: Simple and Fast Retrieval-Augmented Generation*
- 本博客 [淘天RAG方案](/ai-study/taotian-rag-solution/) — RAG 全链路技术详解（含 GraphRAG 简述）
