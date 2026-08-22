---
title: Graph Engineering 全景解析
tags:
  - Graph Engineering
  - Graph of Thought
  - LangGraph
  - Agent 架构
  - AI Infra
excerpt: Graph Engineering 是 Agent 架构的下一个范式——从"线性链"到"图结构"的跃迁。Chain of Thought 看到了推理链，Graph of Thought 看到了推理网；线性 Loop 看到了单次循环，Graph-based Orchestration 看到了多路径编排。本文系统梳理 Graph Engineering 的核心概念、技术架构与工程实践。
createTime: 2026/08/23 16:00:00
permalink: /ai-study/graph-engineering/
---

# Graph Engineering 全景解析

> 当 Agent 只做一件事时，线性链够用——输入、思考、工具调用、输出，一气呵成。但当一个 Agent 需要面对不确定路径、多步推理、分支决策时，线性链就变成了思维的牢笼。Graph Engineering 的核心命题很简单：**Agent 的推理和编排，应该从 Chain（链）进化到 Graph（图）**。

---

## 背景与动机：从 Chain 到 Graph

### Chain of Thought 的天花板

Chain of Thought（CoT）是 LLM 推理的第一个范式——让模型一步步推理，写出中间步骤，最终得到答案。这个思路非常成功，但它有一个根本局限：**推理路径是线性的**。

```
Chain of Thought（线性推理）：
  输入 → 步骤1 → 步骤2 → 步骤3 → ... → 输出
        ↓ 单一方向、不能分叉、不能回溯
```

线性的 CoT 在以下场景下暴露短板：

| 场景 | 线性 CoT 的困难 | 需要的结构 |
|------|-----------------|-----------|
| **多路探索** | "这道题有 3 种解法，试了第一种不行要转第二种" | 分支结构——一条路走不通可以回退到分支点走另一条 |
| **依赖回溯** | "后来的发现推翻了前面的假设" | 双向边——后面的节点可以指回前面的节点 |
| **协同推理** | "两个子任务的输出合在一起才能得到最终答案" | 汇聚结构——多个节点的输出汇聚到一个节点 |
| **并行执行** | "这两个步骤互不依赖，应该同时跑" | 并行边——一个节点的多条出边可以同时激活 |
| **动态路径** | "下一步走哪条路取决于上一步的结果" | 条件边——边的激活取决于状态 |

### Graph of Thought 的突破

2023 年，Maciej Besta 等人在论文 *Graph of Thoughts* 中提出了核心洞察：**人类解决复杂问题时，不是一个线性推理链，而是在一张思维图中探索**。

```
Graph of Thought（图推理）：
          ┌─ 思路A1 ─┐
  输入 → 思路A ─→ 思路A2 ─┼─→ 评估 ─→ 输出
          └─ 思路B1 ─┘          ↑
                         （选出最优路径）
```

关键区别：

| 维度 | Chain of Thought | Graph of Thought |
|------|-----------------|------------------|
| **拓扑** | 线性链 | 有向图（DAG 或含环） |
| **方向** | 单向推进 | 分叉、汇聚、回溯 |
| **路径数** | 单一路径 | 多路径并行探索 |
| **错误恢复** | 从头重来 | 回退到分支点 |
| **最优选择** | 不能比较 | 评估多条路径选最优 |

![Graph Engineering 在 AI 中的定位](/ai-study/ai-infra/graph-engineering/graph-ai-reference.png)

### Agent 架构中的 Graph 层

如果把所有 Agent 架构模式排成一个谱系，"图"处在承上启下的位置：

```text
Prompt Engineering        "写成一条条指令"
    ↓
Chain of Thought          "连成一条条推理链"
    ↓
Loop Engineering          "套成一层层循环"
    ↓
Graph Engineering         "拼成一张张图"   ← 我们在这
    ↓
(未来) World Model & Planning Graph
```

Loop Engineering 解决的是"Agent 如何持续运行"——通过循环驱动 Agent 自主工作。但循环内部的决策路径是线性的：每一步只有一个"下一步"。Graph Engineering 填补了这个空缺——让"下一步"从一个变成多个，让 Agent 具备**多路径探索和选择**的能力。

---

## Graph Engineering 的核心概念

### 概念一：推理图（Graph of Thought）

GoT 的核心思想是把推理过程建模为图，其中：
- **节点** = 一个"Thought"（推理状态/中间结论/假设）
- **边** = 从一个 Thought 到另一个 Thought 的操作（细化、反驳、组合、泛化）

四种基本操作：

| 操作 | 含义 | 例子 |
|------|------|------|
| **细化（Refine）** | 在当前 Thought 上深化 | "这个思路可行 → 展开计算细节" |
| **反驳（Refute）** | 挑战当前 Thought | "这个假设有问题 → 找到反例" |
| **组合（Combine）** | 合并多个 Thoughts | "思路 A + 思路 B → 得到综合方案" |
| **泛化（Generalize）** | 抽取更一般的结论 | "从具体案例 → 提炼出通用规律" |

```python
# Graph of Thought 的伪代码
class Thought:
    content: str          # 当前推理状态
    score: float          # 评估分数
    predecessors: List[Thought]  # 前驱节点

class GraphOfThought:
    thoughts: List[Thought]
    
    def explore(self, thought: Thought):
        # 从当前节点分叉探索多条路径
        candidates = generate_next_thoughts(thought)
        for candidate in candidates:
            candidate.score = evaluate(candidate)
            self.thoughts.append(candidate)
    
    def solve(self, problem: str) -> str:
        root = Thought(content=problem)
        while not should_stop(root):
            # 选择最有希望的节点进行扩展
            frontier = select_frontier(self.thoughts)
            for thought in frontier:
                self.explore(thought)
        # 返回得分最高的完整路径
        return extract_best_path(self.thoughts)
```

### 概念二：编排图（Orchestration Graph）

当 Graph Engineering 从推理层延伸到编排层，就变成了 Agent 的工作流设计：

```
传统 Agent Loop：
  while True:
      next_action = decide_next()   # 只有一个"下一步"
      execute(next_action)
      if done: break

Graph-based Agent：
  graph = {
      "start": condition(lambda s: "research" if s.complex else "answer"),
      "research": condition(lambda s: "synthesize" if s.done else "research"),
      "synthesize": action(generate_answer),
      "answer": action(final_output)
  }
  # 同一个状态可以有多个候选下一步，按条件选
```

关键区别：**循环是"重复执行同一个函数"，图结构是"按照拓扑遍历不同节点"**。

### 概念三：多 Agent 图（Multi-Agent Graph）

在 Multi-Agent 系统中，图成为一种天然的架构语言：

```
Multi-Agent Graph：
  ┌──────────┐     ┌──────────┐
  │ Researcher│────→│ Synthesizer│
  └──────────┘     └──────────┘
       │                 ↑
       ↓                 │
  ┌──────────┐          │
  │ Critic   │──────────┘
  └──────────┘

  - Researcher 找到的信息传递给 Synthesizer
  - Critic 审阅 Synthesizer 的输出，不够好就发回重做
  - 形成带环的图结构（可以返回前面步骤）
```

### 概念四：Planning Graph

Planning Graph 把 Agent 的规划问题建模为图搜索：
- **节点** = 世界状态
- **边** = 行动（从一个状态到另一个状态）
- **路径** = 一个从初始状态到目标状态的完整规划

与经典 AI Planning 不同，Graph Engineering 中的 Planning Graph 是由 LLM 在运行时**动态构建**的，而非预先定义好的状态机。

---

## Graph Engineering 的技术架构

### 核心架构模式

#### 模式一：DAG 编排（有向无环图）

最常见也是最实用的模式。工作流是一个有向无环图，节点是操作，边是数据流。

```
DAG 编排示例：
                   ┌─ 分析子任务1 ─┐
  用户请求 → 拆解 ─┼─ 分析子任务2 ─┼─→ 汇总 ─→ 输出
                   └─ 分析子任务3 ─┘
```

适用场景：任务可以拆成互不依赖的子任务，最终合并。

#### 模式二：循环图（带环图）

引入了条件跳转和循环，让 Agent 可以回溯、重试、迭代优化：

```
带环图示例：
  输入 → 生成方案 → 评估
              ↑         │
              │    不满意│
              └─── 修改 ←┘
               (循环直到满意)
```

适用场景：需要迭代优化、质量不达标要返回重做的场景。

#### 模式三：自适应路由

根据输入动态选择路径——同一个入口，不同类型的问题走不同的分支：

```
自适应路由示例：
               ┌─ 简单问题 → 直接回答 ─┐
  用户提问 → 分类 ─┼─ 复杂问题 → 深度研究 ─┼─→ 输出
               └─ 开放问题 → 讨论生成 ─┘
```

适用场景：输入类型多样，需要不同处理策略。

### LangGraph：Graph Engineering 的工程实践

LangGraph 是 LangChain 推出的图编排框架，可以视为 Graph Engineering 的第一个系统性工程实现。

```python
from langgraph.graph import StateGraph

# 1. 定义状态
class AgentState(TypedDict):
    messages: List[str]
    next_step: str
    result: str

# 2. 构建图
graph = StateGraph(AgentState)

# 3. 添加节点（每节点是一个独立函数/Agent）
graph.add_node("research", research_node)
graph.add_node("analyze", analyze_node)
graph.add_node("synthesize", synthesize_node)
graph.add_node("review", review_node)

# 4. 添加边（定义节点间的跳转关系）
graph.add_edge("research", "analyze")
graph.add_edge("analyze", "synthesize")
graph.add_conditional_edges("synthesize", 
    lambda state: "review" if state["needs_review"] else "end")
graph.add_conditional_edges("review",
    lambda state: "synthesize" if state["approved"] else "research")

# 5. 编译并运行
app = graph.compile()
result = app.invoke({"messages": ["研究主题"]})
```

LangGraph 的核心设计原则：

| 原则 | 说明 |
|------|------|
| **State 是一等公民** | 所有节点共享一个 State 对象，不依赖隐式上下文 |
| **节点是纯函数** | 输入 State，输出 State 的更新（不可变更新） |
| **边是显式跳转** | 节点之间的流转条件清晰可见、可测试 |
| **支持循环和分支** | 天然支持条件跳转和循环重试 |
| **可持久化** | 支持 checkpoint——暂停、恢复、时间旅行 |

### 与其他编排模式的对比

| 编排模式 | 代表 | 拓扑 | 适合 |
|---------|------|------|------|
| **Chain** | LLMChain / Sequential | 线性 | 固定流水线 |
| **Router** | RouterChain | 星型 | 输入分类分发 |
| **Loop** | AgentExecutor | 环形 | 单 Agent 反复执行 |
| **Graph** | LangGraph / CrewAI Flows | 任意图 | 多路径、复杂依赖 |

---

## Graph for AI 的四大工程范式

### 范式一：Graph of Thought —— 推理从链到网

**问题**：复杂问题的推理不是单链，而是需要比较、组合、回溯多条思路。

**GoT 解法**：把推理建模为图，允许同时探索多条推理路径，最终选出最优。

**实际效果**：
- 在 Sort、Shortest Path 等需要多步探索的任务上，GoT 比 CoT 准确率高 20-70%
- 允许"群体智慧"——多个 Thought 节点协作，综合得到更优结论
- 关键代价：推理成本与图的宽度（同时探索的路径数）线性增长

### 范式二：Graph-based Orchestration —— 工作流从线到图

**问题**：Agent 的工作流越来越复杂——有条件分支、有并行子任务、有循环重试。线性 Loop 表达不了。

**解法**：用有向图编排 Agent 的工作流，节点是操作步骤，边是跳转条件。

**实际案例**：

```text
研究助手 Agent 的图结构：

  用户提问 → 意图分类
              ├─ 事实型 → 检索 → 验证 → 回答
              ├─ 分析型 → 拆解 → [并行研究子问题] → 交叉验证 → 综合回答
              └─ 观点型 → 正反论证 → 评估 → 带立场的回答
```

### 范式三：Multi-Agent Graph —— 协作从中心化到网络化

**问题**：多个 Agent 协作时，谁是中心？谁分配任务？谁汇总结果？中心化调度容易成为瓶颈。

**解法**：用图定义 Agent 之间的协作关系——哪些 Agent 的输出喂给谁，谁有权力触发重做。

```text
代码审查 Multi-Agent Graph：

  CodeWriter → CodeReviewer → TestRunner
                    ↑                │
                    └─── BugReport ←─┘
                    
  - CodeWriter 写完代码给 CodeReviewer
  - CodeReviewer 审查通过 → 交给 TestRunner 测
  - TestRunner 发现问题 → 返回给 CodeReviewer（不是直接给 CodeWriter）
  - CodeReviewer 决定是直接修改还是退回 CodeWriter 重写
```

### 范式四：Planning Graph —— 规划从序列到图搜索

**问题**：Agent 的规划问题（"为了达成目标，先做什么后做什么"）如果只用线性规划，无法处理执行过程中的不确定性。

**解法**：把 Planning 建模为图搜索——状态空间中的路径搜索，LLM 负责生成候选行动和评估状态。

---

## Graph Engineering 的全景图

### 与已有文章的关系

本博客已有两篇 Graph for AI 的实践文章：

| 文章 | 涉及层次 | 核心贡献 |
|------|---------|---------|
| [CodeGraph 介绍](/ai-study/codegraph-introduction/) | 图建模 + 图检索 | 把代码的调用关系建模成图，让 Agent 通过图查询理解代码结构 |
| [GraphRAG 技术详解](/ai-study/graphrag-introduction/) | 图检索 + 图计算 | 用图结构增强 RAG，实现多跳推理和全局理解 |

这两篇文章侧重于"图作为知识表示"——用图来**存**信息。本文则侧重于"图作为计算范式"——用图来**编排**和**推理**。

### 与 Loop Engineering 的关系

Loop Engineering 和 Graph Engineering 是 Agent 架构的两面：

| 维度 | Loop Engineering | Graph Engineering |
|------|-----------------|-------------------|
| **关注点** | 时间维度——Agent 如何持续运行 | 空间维度——Agent 的决策如何拓扑展开 |
| **核心问题** | "下一步做什么？" | "下一步有哪些选项？" |
| **结构** | while 循环 | 有向图 |
| **决策** | 单步决策 | 多路径评估 |
| **适用场景** | 单一 Agent 反复执行 | 多路径探索、多 Agent 协作 |

两者互补：循环内部可以是图，图节点内部可以有循环。

---

## 实践建议与选型指南

### 场景一：单 Agent 多步推理（GoT 模式）

**需求**：一个 Agent 解决复杂问题，需要探索多条思路并选出最优。

**推荐**：
- 架构：Graph of Thought
- 节点：思考步骤（假设、推理、验证）
- 操作：细化、反驳、组合、泛化
- 评估：为每条路径打分，选出最优

### 场景二：多步骤工作流（DAG 编排）

**需求**：Agent 需要按步骤执行，步骤间有条件分支和并行。

**推荐**：
- 架构：DAG / StateGraph
- 框架：LangGraph / CrewAI Flows
- 关键点：定义好 State 结构、节点函数、边条件

### 场景三：迭代优化（循环图）

**需求**：Agent 生成内容后需要评估和重试，直到达标。

**推荐**：
- 架构：带环图（Loop Graph）
- 节点：生成 → 评估 → (不满意) → 修改 → 评估 → ...
- 终止条件：评估分数达标 / 达到最大迭代次数

### 场景四：多 Agent 协作（Multi-Agent Graph）

**需求**：多个 Agent 各司其职，协作完成复杂任务。

**推荐**：
- 架构：Multi-Agent Graph
- 关键设计：谁产生信息、谁消费信息、谁有终止权
- 陷阱：避免循环依赖（A 等 B、B 等 C、C 又等 A）

::: warning 常见踩坑
1. **过度设计**：只有 3 步的简单工作流不需要图编排——Chain 或 Loop 更合适
2. **图太宽**：GoT 同时探索太多路径会导致成本激增——设定最大分支数
3. **循环终点**：带环图必须有明确的终止条件——否则 Agent 死循环
4. **State 设计不当**：图编排的 State 应该包含所有节点需要的信息——State 是节点间通信的唯一通道
5. **忽视可观测性**：图的执行路径比线性链难追踪——要记录"走了哪条路径"
:::

---

## 总结

### 核心要点回顾

| 要点 | 说明 |
|------|------|
| **Chain → Graph** | Agent 从线性推理进化到图推理，从单一路径进化到多路径探索 |
| **GoT 四种操作** | 细化、反驳、组合、泛化——图的节点扩展基本操作 |
| **编排图三模式** | DAG 编排、循环图、自适应路由 |
| **LangGraph 五原则** | State 一等公民、节点纯函数、边显式跳转、支持循环分支、可持久化 |
| **四大工程范式** | Graph of Thought、Graph-based Orchestration、Multi-Agent Graph、Planning Graph |
| **Loop + Graph** | 循环解决时间维度（持续运行），图解决空间维度（多路径探索） |

### 设计哲学

Graph Engineering 的核心洞察可以浓缩为一句话：**Agent 的能力瓶颈不在于"能不能执行下一步"，而在于"能不能看到所有可能的下一步，并选出最优的那条路"。**

线性 Chain 让 Agent 变成了一个"只能往前看一步"的迷宫探索者——每次都选一个方向，碰壁就退回重来。图结构让 Agent 拥有了"鸟瞰地图"的能力——看到全局拓扑，比较多条路径，做出更好的选择。

这个理念贯穿了从推理到编排的完整链路：

- **Graph of Thought** 让推理从"一条链"变成"一张网"，可以回溯、比较、组合
- **Graph-based Orchestration** 让工作流从"一个循环"变成"一张图"，可以分叉、并行、条件跳转
- **Multi-Agent Graph** 让协作从"中心化调度"变成"网络化协作"，每个 Agent 都可以触发其他 Agent
- **Planning Graph** 让规划从"序列执行"变成"图搜索"，可以动态调整路径

> **让 Agent 看到地图，而不只是看到下一步。** 这是 Graph Engineering 给出的答案。

### 进一步阅读

- [Graph of Thought 论文](https://arxiv.org/abs/2308.09932) — Maciej Besta et al., 2023
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [CrewAI Flows](https://docs.crewai.com/concepts/flows) — CrewAI 的图编排能力
- 本博客 [Loop Engineering 解析](/ai-study/loop-engineering/) — 理解循环与图的关系
- 本博客 [CodeGraph 介绍](/ai-study/codegraph-introduction/) — 代码知识图谱实践
- 本博客 [GraphRAG 技术详解](/ai-study/graphrag-introduction/) — 图增强 RAG
