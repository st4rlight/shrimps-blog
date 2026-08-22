---
title: Graph Engineering 全景解析
tags:
  - Graph Engineering
  - 图计算
  - 知识图谱
  - 图神经网络
  - 图数据库
excerpt: Graph Engineering 是将"图思维"系统化应用于工程实践的完整技术体系，涵盖图建模、图存储、图计算、图查询与图智能。本文从图思维出发，系统梳理图数据库选型、图计算引擎架构、图查询语言演进、知识图谱工程化与图神经网络实践，帮助你建立对图技术栈的全局认知与选型能力。
createTime: 2026/08/23 16:00:00
permalink: /ai-study/graph-engineering/
---

# Graph Engineering 全景解析

> 当你的数据本质上是"谁认识谁"、"哪个函数调用了哪个函数"、"哪个实体依赖哪个实体"时，关系型数据库的 JOIN 就是在用错误的工具做正确的事。Graph Engineering 不是"换个数据库"，而是一整套把"关系"作为一等公民来建模、存储、查询和分析的工程体系。

---

## 背景与动机：从"表格思维"到"图思维"

### 关系型数据库的连接瓶颈

绝大多数工程师最熟悉的思维模型是**表格**——行是记录，列是属性，外键连接表与表。这套模型统治了数据工程三十年，但在面对**深度连接查询**时，它会暴露根本性短板。

考虑一个社交网络场景：找到"张三"的三度人脉（朋友的朋友的朋友）。在关系型数据库中：

```sql
-- 三度人脉查询：需要 3 次自连接
SELECT DISTINCT u3.name
FROM users u1
JOIN friendships f1 ON u1.id = f1.user_id
JOIN users u2 ON f1.friend_id = u2.id
JOIN friendships f2 ON u2.id = f2.user_id
JOIN users u3 ON f2.friend_id = u3.id
JOIN friendships f3 ON u3.id = f3.user_id
JOIN users u4 ON f3.friend_id = u4.id
WHERE u1.name = '张三' AND u4.id != u1.id;
```

这段 SQL 存在三个致命问题：

| 问题 | 说明 |
|------|------|
| **JOIN 指数膨胀** | 每多一跳深度，JOIN 的中间结果集就指数级增长，四度查询已经几乎不可行 |
| **查询意图不透明** | SQL 没有表达"图遍历"的语义，优化器无法做图特有的剪枝优化 |
| **schema 刚性** | 新增一种关系类型需要改表结构或加关联表，建模和迁移成本高 |

### 图模型的天然优势

图数据模型把**节点**（Node）和**关系**（Edge）都作为一等公民，每条关系是一条**显式存储的连接**，不需要 JOIN 计算。同一个三度人脉查询，在图查询语言中是这样的：

```cypher
// Cypher 写法：MATCH 语义直观表达图遍历
MATCH (u:User {name: '张三'})-[:FRIEND*1..3]->(fof:User)
RETURN DISTINCT fof.name
```

关键差异在于：图数据库在存储层面**直接保存了邻接关系**——给定一个节点，获取它的邻居链表头指针是 $O(1)$ 的，不需要扫描全表。这使得多跳遍历从关系型数据库的「每次 JOIN 都需要全表扫描或索引查找」变为沿邻接链表直接遍历，复杂度从 $O(d^n)$ 降低到 $O(b^n)$（$d$ 为平均度数，$b$ 为实际遍历的分支数，$n$ 为跳数），且支持沿路剪枝。

![图查询 vs 表格JOIN对比](/ai-study/ai-ecosystem/graph-engineering/graph-vs-table-comparison.svg)

但这只是"图存储"这一层。Graph Engineering 真正的含义远不止"换个数据库"。

### 什么是 Graph Engineering

**Graph Engineering** 是将图思维系统化应用于工程实践的完整技术体系，覆盖从数据建模到智能分析的五个层次：

| 层次 | 核心问题 | 典型技术 |
|------|---------|---------|
| **图建模** | 如何用图描述真实世界的实体与关系 | 属性图、RDF、本体设计 |
| **图存储** | 如何高效存储和检索图结构 | 原生图数据库（Neo4j、NebulaGraph） |
| **图计算** | 如何在大规模图上运行算法 | Spark GraphX、Giraph、Plato |
| **图查询** | 如何用语言表达图遍历和分析意图 | Cypher、Gremlin、GQL |
| **图智能** | 如何让机器学习图结构中的隐含模式 | GCN、GAT、GraphSAGE、GraphRAG |

这五个层次构成了一个完整的技术栈，每层都可以独立选型，也可以纵向打通。理解这五层的关系和各自的技术选型空间，是做 Graph Engineering 的基础。

---

## Graph Engineering 全景图

![Graph Engineering 技术全景](/ai-study/ai-ecosystem/graph-engineering/graph-engineering-overview.svg)

上图展示了 Graph Engineering 的五层架构以及每层的主要技术选型。值得注意的是，这五层并非严格的串行流水线——你可以只用图存储 + 图查询构建一个简单的图查询服务，也可以打通五层构建端到端的知识图谱智能平台。

### 与已有技术的关系

在本博客的其他文章中，已经涉及了 Graph Engineering 的两个重要应用场景：

| 文章 | 涉及层次 | 核心贡献 |
|------|---------|---------|
| [CodeGraph 介绍](/ai-study/codegraph-introduction/) | 图存储 + 图查询 | 用 tree-sitter 把代码解析成知识图谱存入 SQLite，通过 MCP 工具让 AI Agent 直接查询 |
| [GraphRAG 技术详解](/ai-study/graphrag-introduction/) | 图智能 | 用 LLM 从文本抽取实体关系建图，再用社区检测生成层级摘要增强 RAG |

这两篇文章分别从**代码智能**和**文档智能**两个角度展示了图思维的实际价值。本文则从更基础的层面——图数据模型、存储引擎、计算引擎、查询语言和神经网络——为理解它们提供完整的技术地图。

---

## 图数据模型与建模

图数据模型的选择是一切 Graph Engineering 的起点。不同的模型决定了后续的存储引擎选型、查询语言和算法生态。

### 两大主流模型：属性图 vs RDF

![属性图与RDF对比](/ai-study/ai-ecosystem/graph-engineering/property-graph-vs-rdf.svg)

#### 属性图（Property Graph）

属性图是最主流的图数据模型，用**带标签的节点**和**带类型的边**表达实体与关系，节点和边都可以有任意数量的**属性**（键值对）。

```text
(张三:Person {age: 32, title: "AI架构师"})
    --[WORKS_AT {since: 2020, role: "Tech Lead"}]-->
(蓝星科技:Company {founded: 2018, employees: 500})
```

属性图的核心特征：

| 特征 | 说明 |
|------|------|
| 节点标签 | 一个节点可以有多个标签（如 `:Person:Employee`） |
| 边类型 | 每条边有且仅有一个类型（如 `WORKS_AT`） |
| 属性 | 节点和边都可以挂任意键值对 |
| 方向 | 每条边有明确方向（有向图） |
| 多重边 | 两个节点之间可以有多条不同类型的边 |

#### RDF 三元组

RDF（Resource Description Framework）是 W3C 标准，用**主-谓-宾三元组**（Subject-Predicate-Object）描述世界：

```text
<张三> <worksAt> <蓝星科技>
<张三> <age> "32"
<蓝星科技> <founded> "2018"
```

RDF 的设计哲学是**语义网**——每个实体和关系都用 URI 标识，可跨数据集复用。它配套有 SPARQL 查询语言和 OWL 推理引擎。

#### 模型选择决策

| 维度 | 属性图 | RDF |
|------|--------|-----|
| **表达力** | 属性丰富，边可带属性 | 边无属性（需转为节点） |
| **查询语言** | Cypher / GQL | SPARQL |
| **语义推理** | 不内置 | OWL / RDFS 推理 |
| **主要生态** | Neo4j、NebulaGraph | Apache Jena、Virtuoso |
| **典型场景** | 社交网络、知识图谱、推荐 | 语义网、数据互联、学术图谱 |
| **学习曲线** | 较低（直觉化） | 较高（需要理解 RDF/OWL 栈） |

::: tip 选择建议
面向应用的图数据库选属性图，面向数据互联和语义推理选 RDF。工程实践中，属性图占绝对主流——Neo4j、NebulaGraph、TigerGraph 全部基于属性图。RDF 更多出现在学术、政府数据和语义集成场景。
:::

### 从 ER 图到属性图：建模实践

传统的关系型建模从 ER 图出发，做范式化拆分。图建模的思路不同——它更像是"把 ER 图直接当 schema 用"。

| 关系型建模 | 图建模 |
|-----------|--------|
| 实体 → 表 | 实体 → 节点标签 |
| 属性 → 列 | 属性 → 节点/边属性 |
| 外键 → JOIN 计算 | 关系 → 显式边 |
| 关联表（M:N） | 关联表消失，直接用多条边 |
| 范式化拆分 | 适度反范式，以查询效率为优先 |

一个实际的建模示例——电商推荐场景：

```text
属性图模型：
(:User {id, name, age})
    -[:VIEWED {times, last_time}]-> (:Product {id, name, price})
    -[:PURCHASED {quantity, price}]-> (:Product)
    -[:BELONGS_TO]-> (:Category {name})
    -[:SIMILAR_TO {score}]-> (:Product)

对比关系型建模需要 5+ 张表：users, products, categories, user_product_views, user_product_purchases, product_similarity
```

图建模的核心优势是：**关系本身就是数据**。在关系型数据库里，"张三买了 iPhone"是 `purchases` 表里的一行；在图数据库里，它是一条 `PURCHASED` 边，可以自带 `quantity`、`price`、`timestamp` 等属性，也可以直接在遍历时被过滤。

---

## 图存储引擎：原生图数据库

图存储引擎是 Graph Engineering 的基础设施层。它的核心使命是：**让"找邻居"这件事快到 O(1)**。

### 为什么不用关系型数据库

关系型数据库存储数据以**行**为单位，关系靠**外键 + JOIN** 在查询时动态计算。当你查"张三的朋友"时，数据库需要扫描 `friendships` 表中 `user_id = 张三` 的行——这本质上是 $O(\log n)$（有索引时）或 $O(n)$（无索引时）的查找。

图数据库则不同——它在存储层面直接维护每个节点的**邻接链表**（Adjacency List）。给定一个节点，获取它的所有邻居是 $O(1)$ 的指针解引用，不需要扫描任何表。

```text
关系型数据库：找邻居 = 索引查找 + JOIN
  users表 → 通过user_id索引找到张三 → 扫描friendships表找user_id=张三 → 再JOIN回users表取朋友信息
  复杂度：O(log n) 索引查找 + O(m) 遍历朋友  （m=朋友数，n=表行数）

图数据库：找邻居 = 解引用邻接指针
  张三节点 → 邻接链表 → 直接拿到所有邻居节点的指针
  复杂度：O(1) 获取链表头 + O(m) 遍历朋友  （m=朋友数）
```

### 原生图存储的底层结构

图数据库的存储引擎主要有三种底层结构：

| 存储结构 | 原理 | 优势 | 劣势 | 代表系统 |
|---------|------|------|------|---------|
| **邻接链表** | 每个节点维护一个邻居指针链表 | 遍历极快，内存友好 | 随机访问慢，磁盘 IO 高 | Neo4j |
| **CSR（压缩稀疏行）** | 节点排序后，用两个数组（偏移 + 邻居）存储紧凑表示 | 缓存友好，内存效率极高 | 增删边需要重建数组 | TigerGraph, GraphBase |
| **邻接矩阵** | 用 $V \times V$ 矩阵存储边 | 矩阵运算友好 | 空间 $O(V^2)$，稀疏图浪费大 | 学术研究为主 |

Neo4j 的"免索引邻接"（Index-Free Adjacency）是属性图数据库的标志性设计——节点直接存储邻居的物理地址指针，不需要任何索引查找。

### 主流图数据库对比

![主流图数据库对比](/ai-study/ai-ecosystem/graph-engineering/graph-database-comparison.svg)

| 维度 | Neo4j | NebulaGraph | TigerGraph | Memgraph |
|------|-------|-------------|------------|----------|
| **架构** | 单机为主，集群版较新 | 分布式（Raft + 分片） | MPP 分布式 | 单机内存优先 |
| **存储** | 免索引邻接（磁盘） | KV 存储（RocksDB） | CSR + GSQL 原生 | 内存 + 持久化 |
| **查询语言** | Cypher / GQL | nGQL | GSQL | Cypher |
| **开源** | 社区版 GPL | Apache 2.0 | 闭源（有免费版） | Apache 2.0 |
| **适用规模** | ~百亿边 | ~千亿边 | ~千亿边 | ~亿级边 |
| **强项** | 生态成熟、文档完善 | 大规模分布式 | 内置图算法+ML | 毫秒级实时 |
| **弱项** | 分布式能力弱 | 学习曲线陡 | 闭源、价格高 | 单机容量限制 |

#### Neo4j：生态王者

Neo4j 是属性图数据库的事实标准。它的核心价值不在性能（分布式能力反而偏弱），而在**生态成熟度**：

- **Cypher** 是最直觉化的图查询语言，已被 ISO 纳入 GQL 标准
- **APOC** 库提供数百个实用过程函数
- **GDS（Graph Data Science）** 库内置 200+ 图算法
- **Neo4j Bloom** 提供可视化图探索

适用场景：中小规模（十亿边以内）、需要快速原型验证、注重开发体验。

#### NebulaGraph：大规模分布式

NebulaGraph 是国内开源的分布式图数据库，核心设计目标是**横向扩展**。它的存储层把图分割后分布在多个节点上（基于 Partition + Vertex ID 哈希），用 Raft 协议保证一致性。

适用场景：超大规模图（百亿到千亿边）、多数据中心部署、需要高吞吐写入。

#### TigerGraph：分析型重器

TigerGraph 用 CSR 存储配合 GSQL——一种图原生的编程语言，支持嵌套查询和并行计算。它最强的是**内置图算法和机器学习能力**，一条 GSQL 语句能表达复杂的多跳分析逻辑。

适用场景：金融反欺诈、供应链分析等需要复杂图算法的大规模场景。

#### Memgraph：实时之选

Memgraph 是内存优先的图数据库，完全兼容 Cypher 查询语言。它的设计哲学是**低延迟**——毫秒级响应，适合实时推荐、实时风控等场景。

适用场景：需要 Cypher 语法但延迟要求极高、图规模在亿级以内。

---

## 图计算引擎：离线分析与流图

图数据库擅长的是**在线查询**——给定起点，做局部遍历。但很多图分析任务需要**全图计算**——比如对整个社交网络跑一次 PageRank、对所有节点做社区检测。这就需要**图计算引擎**。

图计算引擎与图数据库的关键区别：

| 维度 | 图数据库 | 图计算引擎 |
|------|---------|-----------|
| **目标** | 在线低延迟查询 | 离线批量计算 |
| **数据规模** | 通常可全内存或部分磁盘 | 通常超内存，需要分布式 |
| **典型任务** | "找张三的三度人脉" | "计算全图所有节点的 PageRank" |
| **更新方式** | 随机读写 | 批量读取，批量写入 |
| **延迟要求** | 毫秒~秒级 | 分钟~小时级 |

### 图计算模型：BSP 与 GAS

![图计算引擎模型](/ai-study/ai-ecosystem/graph-engineering/graph-compute-mechanism.svg)

分布式图计算的核心挑战是：图天然不均匀——有些节点连接很少（度数低），有些节点连接极多（超级节点，如明星的社交账号）。这会导致分布式计算时负载严重倾斜。

两种主流计算模型：

#### BSP（Bulk Synchronous Parallel）

由 Google Pregel 提出，核心思想是**超步（Superstep）**：

```text
超步循环：
  1. 每个节点并行执行用户定义的 compute() 函数
  2. 节点可以给其他节点发送消息
  3. 超步结束时有全局同步屏障（Barrier）
  4. 所有节点收到消息后进入下一个超步
  5. 所有节点投票终止时，计算结束
```

BSP 的优势是**编程模型简单**——开发者只需写 `compute()` 函数，框架负责消息传递和同步。劣势是**同步屏障**会导致快的节点等慢的节点（Straggler 问题）。

#### GAS（Gather-Apply-Scatter）

由 PowerGraph 提出，专门解决超级节点的负载倾斜问题。它把每个超步拆成三个阶段：

| 阶段 | 操作 | 特点 |
|------|------|------|
| **Gather** | 每个节点收集邻居信息，做聚合（如求和、求最大值） | 可并行化，超级节点的 Gather 可被切分到多个机器 |
| **Apply** | 用 Gather 的结果更新节点自身状态 | 本地操作，无通信 |
| **Scatter** | 将更新后的状态广播给邻居 | 可异步，不阻塞 |

GAS 的核心改进是：把超级节点的 Gather 阶段拆分到多个 worker 上并行执行，避免单点瓶颈。这对**幂律图**（Power-Law Graph，少量超级节点有大量连接）效果显著。

### 主流图计算引擎

| 引擎 | 计算模型 | 技术栈 | 适用场景 |
|------|---------|--------|---------|
| **Apache Spark GraphX** | BSP | Spark 生态 | 已有 Spark 集群，图计算作为 Spark 任务 |
| **Apache Giraph** | BSP（Pregel 实现） | Hadoop 生态 | 超大规模图，如 Facebook 社交图分析 |
| **PowerGraph / Plato** | GAS | C++ | 幂律图，国内腾讯开源 |
| **GraphFrames** | DataFrame API | Spark | 需要 SQL/DataFrame 接口 |
| **Ligraph** | 多模型 | C++ | 图嵌入 + 图算法统一 |

#### Spark GraphX 示例

```scala
import org.apache.spark.graphx._
import org.apache.spark.rdd.RDD

// 构建图：节点和边
val vertices: RDD[(VertexId, (String, Int))] =
  sc.parallelize(Seq(
    (1L, ("张三", 32)), (2L, ("李四", 28)),
    (3L, ("王五", 35)), (4L, ("赵六", 40))
  ))

val edges: RDD[Edge[String]] =
  sc.parallelize(Seq(
    Edge(1L, 2L, "朋友"), Edge(2L, 3L, "同事"),
    Edge(3L, 4L, "家人"), Edge(1L, 3L, "朋友")
  ))

val graph = Graph(vertices, edges)

// 运行 PageRank
val ranks = graph.pageRank(0.0001).vertices
ranks.collect().foreach { case (id, rank) =>
  println(s"节点 $id 的 PageRank: $rank")
}

// 运行连通分量（等价于社区检测的粗粒度版本）
val cc = graph.connectedComponents().vertices
cc.collect().foreach { case (id, componentId) =>
  println(s"节点 $id 属于社区 $componentId")
}
```

### 核心图算法库

图计算引擎通常内置以下算法库：

| 算法类别 | 典型算法 | 用途 |
|---------|---------|------|
| **中心性** | PageRank、Betweenness、Closeness、Degree | 识别关键节点 |
| **社区检测** | Louvain、Leiden、Label Propagation | 发现群体结构 |
| **路径分析** | Dijkstra、A*、BFS/DFS | 最短路径、可达性 |
| **连通性** | Connected Components、SCC | 连通子图发现 |
| **相似性** | Jaccard、Cosine、SimRank | 推荐与匹配 |
| **遍历** | BFS、DFS、Random Walk | 图采样与探索 |

::: tip 社区检测的选择
Louvain 是最经典的社区检测算法，速度快但可能产生不连通的社区。Leiden 是 Louvain 的改进版，保证社区内部连通，GraphRAG 就采用了 Leiden。对于实时性要求高的场景，Label Propagation 是更轻量的选择——只需一轮信息传播即可。
:::

---

## 图查询语言

图查询语言是图数据库与使用者之间的接口。一个好的查询语言应该能**自然表达图遍历语义**，而不需要把图拆成关系来做 JOIN。

### 四大查询语言对比

![图查询语言对比](/ai-study/ai-ecosystem/graph-engineering/query-language-comparison.svg)

| 维度 | Cypher | Gremlin | GQL | nGQL |
|------|--------|---------|-----|------|
| **设计风格** | 声明式（SQL-like） | 命令式 + 函数式 | 声明式（ISO 标准） | 声明式（Cypher 变体） |
| **起源** | Neo4j (2010) | Apache TinkerPop (2009) | ISO/IEC (2024) | NebulaGraph |
| **语法直觉** | ⭐⭐⭐⭐⭐ 最直觉 | ⭐⭐ 需理解遍历器 | ⭐⭐⭐⭐ Cypher 超集 | ⭐⭐⭐⭐ 接近 Cypher |
| **表达能力** | 模式匹配为主 | 图灵完备的遍历 DSL | 模式匹配 + 过程式扩展 | 模式匹配 |
| **多数据库支持** | Neo4j, Memgraph, RedisGraph | Neo4j, JanusGraph, Amazon Neptune | 新标准，逐步推广 | NebulaGraph |

#### Cypher：模式匹配的艺术

Cypher 的设计哲学是"用画图的方式写查询"——用 `()` 表示节点，`-[]->` 表示关系：

```cypher
// 找张三的朋友的朋友（排除张三自己）
MATCH (u:User {name: '张三'})-[:FRIEND]->(f)-[:FRIEND]->(fof)
WHERE fof.name <> '张三'
RETURN DISTINCT fof.name, fof.age
ORDER BY fof.age DESC
LIMIT 10

// 最短路径
MATCH p = shortestPath(
  (u1:User {name: '张三'})-[:FRIEND*..5]-(u2:User {name: '王五'})
)
RETURN p

// 创建带属性的节点和关系
CREATE (zhang:User {name: '张三', age: 32})
CREATE (lan:Company {name: '蓝星科技', founded: 2018})
CREATE (zhang)-[:WORKS_AT {since: 2020, role: 'Tech Lead'}]->(lan)
```

Cypher 的 `MATCH` 语法本质上是一种**子图模式匹配**——你画出"想要什么样的子图"，数据库负责找到匹配。这种声明式风格让复杂的多跳查询变得非常直觉化。

#### Gremlin：遍历器的函数式编程

Gremlin 走的是另一条路——它是一种**图灵完备的遍历 DSL**，用函数式风格的管道组合表达遍历逻辑：

```groovy
// 找张三的朋友的朋友
g.V().has('User', 'name', '张三')
  .out('FRIEND')
  .out('FRIEND')
  .dedup()
  .values('name')

// 更复杂的遍历：带条件和聚合
g.V().has('User', 'name', '张三')
  .repeat(out('FRIEND'))
    .times(3)
    .emit()
  .dedup()
  .groupCount().by('city')  // 按城市分组统计
```

Gremlin 的特点是**完全过程式**——你告诉引擎"先做什么，再做什么"。这让它的表达能力极强（图灵完备），但也让复杂查询变得难以优化。

#### GQL：ISO 标准的未来

2024 年，ISO/IEC 正式发布了 **GQL（Graph Query Language）**标准（ISO/IEC 39075），这是继 SQL 之后第二个 ISO 标准化的数据库查询语言。GQL 的语法基础来自 Cypher，但增加了过程式扩展和图模式定义能力。

GQL 的意义在于**标准化**——未来不同图数据库可以用同一种标准语言，就像关系型数据库都用 SQL 一样。目前 Neo4j 5.x 已经支持 GQL，其他厂商也在跟进。

### 查询语言选型

| 场景 | 推荐语言 | 原因 |
|------|---------|------|
| 快速原型 / 教学 | Cypher | 语法最直觉，学习成本最低 |
| 已有 TinkerPop 生态 | Gremlin | 原生兼容 |
| 面向未来标准化 | GQL | ISO 标准，长期趋势 |
| 使用 NebulaGraph | nGQL | 原生支持 |

---

## 知识图谱工程化

知识图谱（Knowledge Graph）是 Graph Engineering 在**语义层**的实践——把图存储从"存数据"提升到"存知识"。

### 知识图谱 vs 图数据库

一个常见困惑是：知识图谱和图数据库有什么区别？

| 维度 | 图数据库 | 知识图谱 |
|------|---------|---------|
| **抽象层** | 存储引擎 | 语义层（可基于图数据库构建） |
| **关注点** | 存储效率和查询性能 | 语义建模、推理和质量 |
| **schema** | 标签和类型（灵活） | 本体（Ontology，严谨） |
| **典型操作** | CRUD + 遍历 | 实体链接、推理、质量校验 |
| **代表** | Neo4j、NebulaGraph | 企业知识图谱、领域本体 |

简言之：**图数据库是基础设施，知识图谱是上层应用**。你可以用图数据库存一个简单的社交图（不需要本体），但如果要做企业级知识图谱，就需要本体设计、实体消歧、关系推理等工程化能力。

### 知识图谱构建流程

![知识图谱构建流程](/ai-study/ai-ecosystem/graph-engineering/kg-pipeline-mechanism.svg)

知识图谱的构建是一个多阶段流水线：

#### 第 1 步：本体设计

本体（Ontology）定义了知识图谱的 schema——有哪些实体类型、关系类型、属性约束。好的本体设计是知识图谱质量的基石。

```text
# 本体设计示例（电商领域）

实体类型：
  - Person: {name, age, gender}
  - Product: {id, name, price, category}
  - Brand: {name, country}
  - Category: {name, parent?}

关系类型：
  - Person -[PURCHASED]-> Product
  - Product -[MANUFACTURED_BY]-> Brand
  - Product -[BELONGS_TO]-> Category
  - Category -[SUBCLASS_OF]-> Category
  - Person -[REVIEWED]-> Product {rating, content}

约束：
  - PURCHASED 必须有 timestamp 属性
  - Product.price > 0
  - Category 不能形成环
```

本体设计的核心原则是**够用就好**——不要为了"完整性"设计过于复杂的本体，而要根据实际查询需求来定义。如果从不需要查"产品评论的情感分析"，就不要在 PURCHASED 边上设计 `sentiment_score` 属性。

#### 第 2 步：实体抽取与链接

从结构化数据或非结构化文本中抽取实体，并做消歧和链接。

| 数据源 | 抽取方法 | 工具 |
|--------|---------|------|
| 结构化（数据库/表格） | 字段映射 + ETL | 自定义脚本 |
| 半结构化（HTML/JSON） | 规则抽取 + 包装器 | BeautifulSoup, jsonpath |
| 非结构化（文本） | NER + 关系抽取 | LLM / SpaCy / BERT |

非结构化文本的实体抽取是当前最活跃的研究方向。传统方法用 NER 模型抽取实体，再用关系抽取模型找关系对。LLM 时代的新范式是——直接让 LLM 做端到端的实体+关系抽取，这正是 [GraphRAG](/ai-study/graphrag-introduction/) 的核心做法。

#### 第 3 步：关系抽取与消歧

抽取出的实体可能存在歧义——两个"张伟"是同一个人吗？一个"苹果"是水果还是品牌？这就需要**实体链接**和**消歧**。

```text
实体消歧策略：

1. 字符串相似度（编辑距离）
   "张三" vs "张三工程师" → 可能是同一人

2. 上下文相似度（embedding）
   "乔布斯在苹果发布 iPhone" vs "乔布斯离开苹果" → 同一个"苹果"

3. 图结构一致性
   如果两个"张三"都连接到"蓝星科技"且时间重叠 → 可能是同一人

4. LLM 辅助判断
   给 LLM 两个实体的描述和上下文，让它判断是否为同一实体
```

#### 第 4 步：质量校验

知识图谱的质量直接影响下游应用的效果。常见的质量维度：

| 质量维度 | 检查方法 | 自动化程度 |
|---------|---------|-----------|
| **完整性** | 本体覆盖度、属性填充率 | 高（规则检查） |
| **一致性** | 同类实体属性类型一致、无矛盾关系 | 中（规则 + 推理） |
| **准确性** | 抽取正确率、人工抽样校验 | 低（人工为主） |
| **时效性** | 数据更新频率、过期检测 | 中（定时任务） |

### 知识图谱与 GraphRAG 的衔接

GraphRAG 可以看作知识图谱的一种**自动化构建方案**——它用 LLM 从文本中抽取实体和关系，构建图谱，再用社区检测做层次化摘要。与传统的知识图谱工程化相比：

| 维度 | 传统 KG 工程化 | GraphRAG |
|------|--------------|----------|
| **构建方式** | 人工本体设计 + 规则/模型抽取 | LLM 端到端抽取 |
| **schema** | 严格本体 | 自由 schema（LLM 决定实体类型） |
| **质量控制** | 人工校验 + 规则约束 | LLM 抽取质量依赖 prompt |
| **推理能力** | OWL 推理引擎 | 社区检测 + 社区报告 |
| **适用场景** | 领域知识图谱（医疗/法律/金融） | 文档问答、知识发现 |

两者不是替代关系，而是**互补**——传统 KG 适合精度要求高的领域知识图谱，GraphRAG 适合快速从文档中构建知识库。

---

## 图神经网络（GNN）

图神经网络是 Graph Engineering 的"图智能"层——让机器学习模型理解图结构，而不仅仅是把节点当成独立样本。

### 为什么需要图神经网络

传统的机器学习模型（如 MLP、CNN、RNN）处理的数据是**欧几里得结构**的——图像是规则的网格，文本是规则的序列。但图数据是**非欧几里得结构**——节点数量可变、邻居数量不一、没有固定的空间排列。

GNN 的核心思想是**消息传递**（Message Passing）：每个节点从邻居那里收集信息，更新自己的表示，经过多轮迭代后，节点的表示编码了其局部邻域的结构信息。

```text
GNN 消息传递框架：

对每个节点 v，在第 l 层：
  1. 消息计算：m_v = aggregate({h_u : u ∈ neighbors(v)})
  2. 状态更新：h_v^(l) = update(h_v^(l-1), m_v)

其中：
  - h_v^(l) 是节点 v 在第 l 层的隐藏表示
  - aggregate 是聚合函数（如求和、平均、最大值）
  - update 是更新函数（通常是 MLP + 非线性）
```

### 三大经典 GNN 模型

![GNN模型架构对比](/ai-study/ai-ecosystem/graph-engineering/gnn-models-overview.svg)

| 模型 | 核心创新 | 聚合方式 | 适用场景 |
|------|---------|---------|---------|
| **GCN** | 谱图卷积的一阶近似 | 对称归一化均值 | 节点分类（同质图） |
| **GraphSAGE** | 归纳式学习 + 邻居采样 | 可选（均值/LSTM/最大池化） | 大规模图、动态图 |
| **GAT** | 注意力机制学习邻居权重 | 注意力加权求和 | 异质图、关键邻居识别 |

#### GCN：图卷积网络

GCN（Graph Convolutional Network）用谱图理论推导出一阶近似的图卷积公式：

$$H^{(l+1)} = \sigma(\tilde{D}^{-1/2}\tilde{A}\tilde{D}^{-1/2}H^{(l)}W^{(l)})$$

其中 $\tilde{A} = A + I$ 是加了自环的邻接矩阵，$\tilde{D}$ 是对应的度矩阵，$W^{(l)}$ 是可学习参数。

直觉理解：每个节点的新表示 = 自己的旧表示 + 邻居的旧表示的加权平均，再做线性变换和非线性激活。

GCN 的优势是**简洁有效**——在标准节点分类基准上，一个两层 GCN 就能达到很好的效果。劣势是它做的是**转导式学习**（Transductive），推理时需要看到全图，不适合动态新增节点的场景。

#### GraphSAGE：归纳式图学习

GraphSAGE（Sample and Aggregate）解决了 GCN 的转导式限制。它的做法是：

1. **邻居采样**：不使用全部邻居，而是固定数量 $K$ 个（避免超级节点问题）
2. **归纳式**：学习的是聚合函数的参数，推理时可以直接对没见过的节点做预测

```python
# GraphSAGE 伪代码
def graphsage_forward(node, layers):
    h = node.features  # 初始特征
    for layer in layers:
        # 采样固定数量的邻居
        neighbors = sample(node.neighbors, k=layer.k)
        # 聚合邻居表示
        neighbor_agg = aggregate([n.h for n in neighbors])
        # 拼接自身表示和邻居聚合，过 MLP
        h = relu(W * concat(h, neighbor_agg))
    return h
```

GraphSAGE 是工业界最常用的 GNN 模型——Pinterest 的 PinSage 就是基于 GraphSAGE 做的推荐系统，处理了 30 亿节点的图。

#### GAT：图注意力网络

GAT（Graph Attention Network）引入了**注意力机制**——让模型自动学习每个邻居的重要性权重，而不是用固定的度数归一化：

$$\alpha_{ij} = \text{softmax}_j(\text{LeakyReLU}(a^T[Wh_i || Wh_j]))$$

其中 $\alpha_{ij}$ 是节点 $i$ 对邻居 $j$ 的注意力权重。这让模型可以区分"重要邻居"和"不重要邻居"。

GAT 的优势是**可解释性**——你可以可视化注意力权重，看到模型在关注哪些邻居。劣势是计算开销比 GCN 和 GraphSAGE 大。

### GNN 工程框架

| 框架 | 背景 | 特点 | 适用场景 |
|------|------|------|---------|
| **DGL** | AWS / NYU | 底层抽象完善，支持多种后端 | 研究与生产通用 |
| **PyG** | PyTorch 团队 | 简洁 API，丰富模型库 | 学术研究、快速实验 |
| **Euler** | 阿里巴巴 | 大规模分布式 GNN | 工业级推荐系统 |

#### DGL 示例

```python
import dgl
import torch
import torch.nn as nn
import torch.nn.functional as F
from dgl.nn import GraphConv

# 构建图
g = dgl.graph(([0, 1, 1, 2, 3, 4], [1, 0, 2, 3, 4, 1]))
g.ndata['feat'] = torch.randn(5, 16)  # 5 个节点，每个 16 维特征

# 两层 GCN
class GCN(nn.Module):
    def __init__(self, in_feats, h_feats, num_classes):
        super().__init__()
        self.conv1 = GraphConv(in_feats, h_feats, allow_zero_in_degree=True)
        self.conv2 = GraphConv(h_feats, num_classes, allow_zero_in_degree=True)

    def forward(self, g, in_feat):
        h = F.relu(self.conv1(g, in_feat))
        h = self.conv2(g, h)
        return h

model = GCN(16, 32, 3)  # 输入16维 → 隐藏32维 → 输出3类
logits = model(g, g.ndata['feat'])
print(logits.shape)  # torch.Size([5, 3])
```

### 图表示学习与图嵌入

GNN 的一个核心应用是**图嵌入**（Graph Embedding）——把图结构映射到低维向量空间，让相似的节点在向量空间中距离更近。

| 方法 | 思路 | 代表算法 |
|------|------|---------|
| **矩阵分解** | 分解邻接矩阵 | DeepWalk、LINE |
| **随机游走** | 用游走序列类比 NLP 的句子 | DeepWalk、node2vec |
| **GNN 编码** | 用神经网络学习节点表示 | GraphSAGE、GAT |
| **对比学习** | 让相邻节点表示相似，不相邻的拉远 | GraphCL、DGI |

图嵌入的下游应用非常广泛：

- **推荐系统**：用户和商品的图嵌入做协同过滤
- **欺诈检测**：异常节点的嵌入偏离正常分布
- **药物发现**：分子图中预测分子性质
- **社交网络**：好友推荐、社区发现

---

## 实践建议与选型指南

![Graph Engineering 选型决策图](/ai-study/ai-ecosystem/graph-engineering/graph-engineering-guide.svg)

### 场景一：简单图查询（社交网络、推荐系统）

**需求**：多跳遍历查询，数据量在亿级以内，需要毫秒级响应。

**推荐**：
- 存储：Neo4j（单机够用）或 Memgraph（内存优先）
- 查询语言：Cypher
- 不需要图计算引擎和 GNN

```text
典型架构：
  应用层 → Cypher 查询 → Neo4j → 返回子图/路径
```

### 场景二：大规模图分析（金融风控、社交分析）

**需求**：百亿到千亿边，需要跑 PageRank、社区检测等全图算法。

**推荐**：
- 存储：NebulaGraph（分布式）
- 计算：Spark GraphX 或 Plato
- 查询语言：nGQL

```text
典型架构：
  数据导入 → NebulaGraph 存储 → 导出为 GraphX 子图 → 跑算法 → 结果写回
```

### 场景三：知识图谱构建（企业知识库）

**需求**：从多源数据构建领域知识图谱，支持语义查询和推理。

**推荐**：
- 存储：Neo4j + Neo4j GDS 库
- 本体设计：Protégé（本体编辑工具）
- 实体抽取：LLM + GraphRAG（自动化）或 NER 模型（精度优先）
- 查询语言：Cypher + SPARQL（如需推理）

```text
典型架构：
  数据源 → ETL/抽取 → 本体映射 → Neo4j 存储 → GDS 算法 → 应用层
```

### 场景四：图智能应用（推荐、欺诈检测）

**需求**：用 GNN 学习图表示，做节点分类、链路预测或图分类。

**推荐**：
- 存储：DGL 的内置图结构（不需要独立图数据库）
- 框架：DGL 或 PyG
- 模型：GraphSAGE（大规模）或 GAT（需要可解释性）

```text
典型架构：
  图数据 → DGL 图构建 → GraphSAGE 训练 → 图嵌入 → 下游任务（分类/推荐）
```

### 成本与性能权衡

| 权衡维度 | 低成本方案 | 高成本方案 | 注意事项 |
|---------|-----------|-----------|---------|
| **存储** | Neo4j 社区版 | TigerGraph 企业版 | 分布式成本随节点数线性增长 |
| **计算** | Spark GraphX | 专用图计算引擎 | 专用引擎性能好但运维复杂 |
| **GNN** | PyG + CPU | DGL + 多 GPU | GNN 训练对 GPU 显存要求高 |
| **知识图谱** | GraphRAG 自动构建 | 人工本体 + 专业抽取 | 人工成本是知识图谱的大头 |

::: warning 常见踩坑
1. **过早分布式**：百亿边以内用 Neo4j 单机往往够用，过早引入分布式图数据库会大幅增加运维成本
2. **忽视图建模**：好的图建模比好的图数据库更重要——错误的建模让再好的数据库也查不快
3. **GNN 不是万能药**：如果规则和图算法能解决的问题，不要急着上 GNN——训练成本和不确定性都更高
4. **忽略增量更新**：图数据通常持续变化，选型时要考虑增量更新的支持程度
:::

---

## 总结

### 核心要点回顾

| 要点 | 说明 |
|------|------|
| **Graph Engineering 五层** | 图建模 → 图存储 → 图计算 → 图查询 → 图智能，从基础设施到智能分析 |
| **图思维的本质** | 把"关系"作为一等公民——不是靠 JOIN 计算，而是显式存储和遍历 |
| **图数据库选型** | Neo4j（生态/中小规模）、NebulaGraph（分布式/超大规模）、TigerGraph（分析型） |
| **图计算模型** | BSP（Pregel/Giraph）适合通用场景，GAS（PowerGraph）适合幂律图 |
| **查询语言趋势** | Cypher 是最直觉化的选择，GQL 是 ISO 标准的未来 |
| **知识图谱工程化** | 本体设计是基石，LLM（GraphRAG）正在改变自动化构建方式 |
| **GNN 三大模型** | GCN（简洁基线）、GraphSAGE（工业首选）、GAT（可解释性） |

### 设计哲学

Graph Engineering 的核心洞察可以浓缩为一句话：**关系本身就是数据**。

传统数据库把数据存在行里、把关系靠外键在查询时临时计算。图思维则认为：如果"谁连到谁"本身就是你要查询和分析的核心信息，那就应该把它**显式存储、显式遍历、显式建模**。

这个理念贯穿了整条技术链：

- **CodeGraph** 把代码的调用关系存成图，让 Agent 不再靠 grep 盲目搜索
- **GraphRAG** 把文档的实体关系存成图，让 RAG 能做多跳推理和全局理解
- **GNN** 把图结构编码进向量空间，让机器学习模型理解"连接"的语义

> **结构化关系优先。** 无论你是在做代码智能、文档问答还是推荐系统，先把结构化的关系网络建好——图的威力在于它让你看到表格看不到的连接。

### 进一步阅读

- [Neo4j 官方文档](https://neo4j.com/docs/) — Cypher 查询语言与 GDS 图算法库
- [DGL 教程](https://docs.dgl.ai/) — 深度学习框架的图神经网络实践
- [GraphRAG 论文](https://arxiv.org/abs/2404.16130) — *From Local to Global: A Graph RAG Approach*
- 本博客 [CodeGraph 介绍](/ai-study/codegraph-introduction/) — 代码场景下的图工程实践
- 本博客 [GraphRAG 技术详解](/ai-study/graphrag-introduction/) — 文档场景下的图增强 RAG