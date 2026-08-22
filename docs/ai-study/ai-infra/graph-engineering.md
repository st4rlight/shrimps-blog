---
title: Graph Engineering 全景解析
tags:
  - Graph Engineering
  - Multi-Agent
  - LangGraph
  - Agent 架构
  - AI Infra
excerpt: Graph Engineering 没有发明新技术——图、状态机、工作流都早就存在。真正变的是 Graph 连接的对象：从连接 Step 到连接 Agent，从管住一个不靠谱的 Agent 到组织一群越来越能干的 Agent。本文从 LangGraph 讲起，梳理 Graph Engineering 的核心概念、五大工程层次关系、六大适用信号与工程实践。
createTime: 2026/08/23 16:00:00
permalink: /ai-study/graph-engineering/
---

# Graph Engineering 全景解析

> 参考资料：
> - 微信公众号文章《讲透 Graph Engineering：新瓶装旧酒，还是 Agent 变强后的必然？》
> - Anthropic 工程博客《How we built our multi-agent research system》（2025.06.13）
> - LangGraph 官方文档与 LangChain 博客
> - 本博客 [Loop Engineering 解析](/ai-study/loop-engineering/)

## 一、LangGraph 早就有了，为什么又来了个 Graph Engineering？

### 1.1 两次 Graph 热潮的背景差异

2024 年初，LangChain 发布了 LangGraph。当时的 Agent 远没有今天这么能干，典型的 Agent 就是一个 ReAct 范式的循环：**思考 → 调工具 → 看结果 → 再思考 → ……周而复始**。

这个范式把大量决定都交给了当时还不够强大的 LLM。单一的 ReAct Agent 无法满足复杂任务的需要——工具调错了怎么办？任务跑了几步开始偏怎么办？中途需要人工确认怎么办？我想强制"必须先查数据库，再做判断"又怎么办？

所以当时 LangGraph 的核心诉求是：

> **编排复杂任务的工作流，用显式的流程和状态，把不确定性约束在可控范围内，且不牺牲局部的 AI 自主性。**

方法是用 State 保存任务状态信息，用 Node 拆分步骤，用 Edge 决定下一步：可以循环、分支、并行，可以用代码或人而不是 LLM 决定下一步往哪里走。

有意思的是，Graph 在 2025-2026 年又火了。但这一次背景完全不一样。

### 1.2 从"管住一个 Agent"到"组织一群 Agent"

今天的 Agent 已经可以在适当的环境与约束下（Harness），独立工作很长时间——自己拆任务、找资料、改代码、跑验证，甚至自我循环直到目标达成（Loop Engineering）。我们面对的核心问题开始从：

> "怎么管住一个不太靠谱的 Agent？"

变成：

> "怎么组织一群越来越能干的 Agent？"

以前，Graph 更多是在 Agent **内部**建立秩序；现在，Graph Engineering 更关注的是：

> **如何在 Agent 之间建立秩序**——谁负责什么、哪些任务并行、状态怎样共享、各自工作的上下文、谁来验收、失败后谁接管，以及哪些决定必须留给确定的代码或人。

| 维度 | 第一次 Graph 热潮（2024） | 第二次 Graph 热潮（2025-2026） |
|------|--------------------------|-------------------------------|
| **Agent 能力** | 弱，需要约束 | 强，可以独立完成一段工作 |
| **Graph 连接对象** | Step（一次工具调用） | Agent（能自主完成一段工作的实体） |
| **核心问题** | 怎么管住一个不太靠谱的 Agent？ | 怎么组织一群越来越能干的 Agent？ |
| **重点** | Agent 内部建立秩序 | Agent 之间建立秩序 |

::: tip 关键洞察
所谓的 Graph Engineering 没有出现新技术。Graph、状态机、工作流都早就存在。但 Graph 连接的东西有变化：**过去连接的更多是 Step，现在更多连接的是能够自主完成一段工作的 Agent。**
:::

需要强调的是，这里说的是重心的变化，而非技术的绝对分界。LangGraph 很早就可以编排多 Agent；今天的 Graph Engineering 也绝不只连接 Agent——节点可以是 Agent、工具、函数，甚至人。

---

## 二、Graph Engineering 到底是什么？

### 2.1 从 Chain 到 Graph 的拓扑演进

从计算机科学的基本定义看，Graph 没什么神秘的：一组节点（Node），加上一组连接节点的边（Edge）。

具体到任务处理过程，拓扑复杂度是递进的：

![从 Chain 到 Graph 的拓扑演进](/ai-study/ai-infra/graph-engineering/topology-evolution-mechanism.svg)

- **链（Chain）**：一路向前，无法分支、无法回头。LangChain 最初的 Chain 就是这个级别
- **有向无环图（DAG）**：开始出现分支和并行，但还是不能"回头"。一些早期的工作流编排框架只支持 DAG
- **有向图（Directed Graph）**：允许循环、回退、重试。在 Claude Code 这样的 Coding Agent 系统中，这种循环能力不可或缺——失败了可以返工、结果不如人意再优化，直到满足条件

一旦允许流程"回头"，就不再是 DAG，而是更通用的有向图。

### 2.2 Agent Graph 的三要素

一张 Agent Graph，有最基本的三个东西：

| 要素 | 说明 | 例子 |
|------|------|------|
| **Node（节点）** | 专业 Agent 或步骤，可以有自己的 LLM、工具和任务 | Researcher Agent、Writer Agent、代码审查 Agent |
| **Edge（边）** | 连接节点，代表接下来去哪。可以是条件分支、并行分支、循环 | 审核通过 → 发布；审核不通过 → 返回修改 |
| **State（状态）** | 节点之间的共享状态——一个节点处理的信息可供下个节点使用 | 研究结果、草稿内容、审查反馈 |

### 2.3 一个完整的 Agent Graph 例子

以编写研究报告为例：

![研究报告 Agent Graph](/ai-study/ai-infra/graph-engineering/research-pipeline-mechanism.svg)

看起来只是几个方框和箭头。但重要的是，在这张 Graph 中：**谁负责什么、什么情况下往哪里走、状态传递了什么、什么时候结束**，都不再由某个 Agent 自己决定，而是成为 Agent 系统的一部分。

这就是 Graph Engineering 要工程化的部分。

---

## 三、Graph 里明明有 Loop，为什么它不是 Loop Engineering？

### 3.1 同样有 Loop，关注的层次不同

上面的例子里，Reviewer 节点不通过，流程会重新回到 Writer。这明明就是一个 Loop（循环），那它和 Loop Engineering 有什么区别？

关键不在于"有没有 Loop"，而在于**两者关注与解决的问题不一样**。

**Loop Engineering** 关注的是：一个 Agent 如何持续推进工作，Loop 是必须的机制。它关心的是如何让这个 Coding Agent 不需要人类介入，就能自己验证结果、修复代码、持续推进，直到完成目标。

**Graph Engineering** 关注的是：多个 Agent 如何协同运行，而 Loop 只是其中一种模式。Graph 关心的是：Researcher 做完以后交给谁？Writer 写完谁来审核？审核失败回到哪里返工？哪些任务可以并行？如何让 Writer 知道 Reviewer 的审查结果？什么时候必须让人介入？

![Loop vs Graph 关注层次对比](/ai-study/ai-infra/graph-engineering/loop-vs-graph-comparison.svg)

| 维度 | Loop Engineering | Graph Engineering |
|------|-----------------|-------------------|
| **关注对象** | 单个 Agent | 多个 Agent |
| **核心问题** | Agent 如何持续推进工作 | Agent 之间如何协同运行 |
| **Loop 的角色** | 必须的核心机制 | 其中一种连接模式 |
| **视角** | Agent 内部 | Agent 之间 |

### 3.2 两者可以"套"在一起

你甚至可以把两者"套"在一起。比如一个全栈开发任务：

![Graph + Loop 两层共存](/ai-study/ai-infra/graph-engineering/loop-in-graph-mechanism.svg)

Graph 负责高层的组织关系；Loop 负责每个 Agent 节点内部的行动——两者完全可以共存。

所以也能理解为什么 Agent 强大之后，Graph 的价值才开始涌现：**当 Agent 的自主能力越来越强，它们之间的秩序设计才更有意义。去组织一些尚"无法自理"的 Agent 互相协作，只会越来越乱。**

---

## 四、Prompt、Context、Harness、Loop、Graph——五个工程的关系

### 4.1 不是替代，而是扩大的控制圈

在理清 Loop Engineering 与 Graph Engineering 后，我们更进一步，看看这些熟悉的 Engineering 之间到底是什么关系。

它们当然不是简单的五次技术迭代——Prompt 过时了升级 Context，Context 不够了升级 Harness……最后一路升级到 Graph。

它们更适合理解成 **Agent 工程不断向外扩大的五个控制圈**：

![Agent 工程的五层控制圈](/ai-study/ai-infra/graph-engineering/engineering-layers-overview.svg)

### 4.2 五层工程的大白话

| 工程层 | 核心问题 | 大白话 | 比喻 |
|--------|---------|--------|------|
| **Prompt Engineering** | 怎么跟模型说话？ | 如何对模型说话 | 会和员工沟通 |
| **Context Engineering** | 模型推理时需要看到什么？ | 让模型看到什么 | 给他资料 |
| **Harness Engineering** | Agent 运行需要什么环境？ | Agent 如何做事 | 给他电脑、工具、权限、办公室 |
| **Loop Engineering** | Agent 如何持续自主工作？ | Agent 怎样持续推进做事 | 让他自己把事情持续做完 |
| **Graph Engineering** | 多个 Agent 如何协同？ | 一群 Agent 怎样一起做事 | 多个能干员工如何成为组织 |

### 4.3 嵌套而非替代

这些 Engineering 不是替代关系，也不是严格的上下级关系：

- 一个 Graph 节点内部，完全可以运行自己的 Loop
- 一个 Graph 里的每个 Agent，仍然需要好的 Harness
- 好的 Harness 自然也少不了好的 Context 与 Prompt 设计
- **Agent 系统越复杂，前面这些能力越需要同时存在**

---

## 五、什么时候你真的需要 Graph Engineering？

### 5.1 不是所有 Agent 任务都需要 Graph

理解了 Graph，并不意味着所有 Agent 工程都应该被画成一张 Graph。

很多实际任务是目标清晰的单一任务，有明确的验收标准：修复一个程序 Bug、处理邮件收件箱、撰写一个分析报告——它们大部分都不需要 Graph，一个好的 Agent 或者 Loop 已经足够。

### 5.2 六大信号

什么时候 Graph 真正开始有价值？不能简单地用"任务复杂"来概括，而是从以下六个关键信号开始：

#### 信号一：一个 Agent 已经不适合对整个任务负责

当任务内不同步骤的专业方向与职责有较大差异时，把所有事情塞给一个超级 Agent 反而会更难控制，输出质量下降。

比如一个决策型研究任务——搜集分析、撰稿、审稿本来就是不同的角色，它们需要看到的上下文、承担的责任也不同。如果让一个 Agent 不断切换身份和思考模式，不同角色的 Prompt、Context、目标等就会混在一起。

更自然的方式是把它们拆成 Graph 中的多个 Agent 节点，并通过状态传递完成协作。

#### 信号二：任务中开始出现真正的并行与依赖

比如需要同时抓取分析 10 个竞品网站的数据。简单的 Loop 只能串行等待；而 Graph 可以直接分发给 10 个节点 Agent 并行处理，最后再聚合结果。

在 Claude Code 中通过动态工作流开展并行的代码开发或重构也是这个模式。Loop Engineering 擅长表达"下一步做什么"；Graph 则擅长表达"哪些步骤可以同时进行，哪些步骤又需要等待，结果在哪里汇合"这些复杂拓扑。

#### 信号三：不同步骤需要不同的模型、工具和权限

在任务的不同阶段，并非总是需要相同的执行能力：

| 步骤 | 模型选择 | 工具需求 | 权限级别 |
|------|---------|---------|---------|
| 简单分类 | 免费小模型 | 无 | 只读 |
| 复杂推理 | 最强大模型 | 搜索 + 代码执行 | 受限写 |
| 提交部署 | 中等模型 | 生产访问工具 | 严格权限控制 |

如果所有步骤都交给同一个 Agent，一方面会造成资源浪费，另一方面也会增加安全风险。Graph 可以允许你在不同节点拥有不同的配置：模型、工具、技能、权限、人工审核等。

#### 信号四：需要高确定性、可审计的控制流

在很多高确定性要求的领域，你需要的不仅是一个任务结果，还需要过程的可控——哪些是 Agent 控制、哪些需要用确定的代码和人来控制。

这种可控性有助于在金融、医疗、通讯等领域，了解 Agent 执行过程中遵循了什么规则、经历了哪些审批、调用了什么工具、失败后什么走向等。这时候，**显式的 Graph 要比几百万 token 的 LLM 聊天轨迹更容易审计**。

#### 信号五：任务的执行与验证必须独立

有两种可能的需求：

1. **希望用独立的验证节点**——让验证结果更加"公正"，而不是让运动员当裁判。比如用其他模型驱动的 Agent 来审核当前 Agent 的输出质量。
2. **防范验证器"过载"**——单个验证器承担了过多职责（比如"代码是否正确、安全是否达标、风格是否规范"），会导致遗漏。此时可以用多个验证节点来让职责更加专注。

独立的验证节点应该拥有不同的上下文、工具、只读权限和审查依据。

#### 信号六：任务中途涉及暂停和恢复，需要持久化

很多企业 Agent 在中途需要等待人工批准、回调发生、补充输入等。只靠一个在线 Agent 会话维持状态，有时会变得脆弱（比如超时）。

Graph 由于有着清晰的步骤和状态，借助于持久化机制（落磁盘或数据库），可以保存状态快照，并用于 HITL（Human-in-the-Loop）、故障恢复、记忆等，实现"断点续跑"。

### 5.3 信号速查表

| 信号 | 一句话 | 典型场景 |
|------|--------|---------|
| **职责分化** | 一个 Agent 不适合对整个任务负责 | 研究→撰稿→审稿 |
| **并行依赖** | 任务中开始出现真正的并行 | 同时分析 10 个竞品 |
| **资源隔离** | 不同步骤需要不同模型/工具/权限 | 简单分类 vs 复杂推理 vs 生产部署 |
| **可审计性** | 需要高确定性、可审计的控制流 | 金融、医疗、通讯 |
| **独立验证** | 执行与验证必须独立 | 代码审查、质量把关 |
| **持久化恢复** | 任务中途涉及暂停和恢复 | 人工审批、断点续跑 |

---

## 六、Multi-Agent Graph 的工程实践

### 6.1 Anthropic 的多 Agent 研究系统

Anthropic 在 2025 年 6 月分享了他们构建多 Agent 研究系统的工程经验。这个系统使用 **orchestrator-worker 模式**——一个 Lead Agent 协调全局，同时创建多个专门的 Subagent 并行搜索信息。

![Anthropic 多 Agent 研究系统](/ai-study/ai-infra/graph-engineering/anthropic-research-mechanism.svg)

他们在内部评估中发现：使用 Claude Opus 4 作为 Lead Agent + Claude Sonnet 4 作为 Subagent 的多 Agent 系统，**在内部研究评估中比单 Agent Claude Opus 4 高出 90.2%**。

### 6.2 多 Agent 系统为什么有效

Anthropic 的分析揭示了三个关键发现：

| 发现 | 数据 | 启示 |
|------|------|------|
| **Token 用量是性能主因** | 占性能方差的 80% | 多 Agent 通过独立上下文窗口扩展了 token 容量 |
| **工具调用次数** | 占性能方差的额外部分 | 并行工具调用让 Agent 在同一时间探索更多方向 |
| **模型选择** | 升级模型 > 加倍 token | Claude Sonnet 4 的提升大于在 Sonnet 3.7 上加倍 token |

核心洞察是：**多 Agent 系统之所以有效，本质上是因为它帮助花掉了足够多的 token 来解决问题。** 多 Agent 架构通过将工作分配到具有独立上下文窗口的 Agent 中，为并行推理增加了更多容量。

### 6.3 代价与局限

多 Agent 系统不是银弹。Anthropic 的数据显示：

| 指标 | Chat 交互 | 单 Agent | 多 Agent 系统 |
|------|----------|---------|-------------|
| **Token 用量** | 1× | ~4× | ~15× |
| **适用场景** | 简单问答 | 单一目标任务 | 高价值、高并行任务 |

多 Agent 系统烧 token 极快。为了经济可行性，**多 Agent 系统需要任务价值足够高，能覆盖增加的性能成本。**

此外，有些领域并不适合多 Agent：

- 需要所有 Agent 共享相同上下文的场景
- Agent 之间有大量依赖关系、需要频繁协调的场景
- 大多数编码任务（真正可并行的子任务比研究少）
- LLM Agent 尚不擅长实时协调和委派其他 Agent

::: warning 多 Agent 的适用边界
多 Agent 系统在以下场景表现出色：**高价值任务、大量可并行的工作、超出单上下文窗口的信息、需要与众多复杂工具交互**。如果你的任务不满足这些条件，一个强 Agent + Loop 通常更经济。
:::

### 6.4 编排模式

从工程实践看，Multi-Agent Graph 有几种常见的编排模式：

| 模式 | 结构 | 适用场景 | 代表 |
|------|------|---------|------|
| **Orchestrator-Worker** | 中心调度 + 并行执行 | 研究型任务、信息收集 | Anthropic Research |
| **Pipeline** | 线性传递，逐级加工 | 内容生产（研究→撰稿→审稿） | 研究报告 Graph |
| **Supervisor** | 主管分派 + 汇总验收 | 复杂任务分解与整合 | LangGraph Supervisor |
| **Peer-to-Peer** | 无中心，Agent 互相调用 | 去中心化协作 | 实验性系统 |

---

## 七、实践建议

### 7.1 什么时候不用 Graph

在考虑"怎么设计 Graph"之前，先确认"是否真的需要 Graph"：

- ✅ 目标单一、有明确验收标准的任务 → 一个好 Agent 足够
- ✅ 可以被验证器闭环的任务 → Loop Engineering 足够
- ✅ 没有并行需要的任务 → 不需要 Graph 的拓扑表达
- ✅ 任务可以在单次会话内完成 → 不需要持久化和断点续跑

### 7.2 什么时候开始考虑 Graph

当你观察到以下信号时，可以开始考虑 Graph Engineering：

- ⚠️ 一个 Agent 在不同步骤间频繁切换身份 → 考虑拆成多个节点
- ⚠️ 任务有明显可并行的子任务 → 考虑用并行边
- ⚠️ 不同步骤需要不同模型或权限 → 考虑节点级配置
- ⚠️ 需要审计 Agent 的决策路径 → 考虑显式 Graph
- ⚠️ 执行和验证混在一起 → 考虑独立验证节点
- ⚠️ 任务需要中途暂停和恢复 → 考虑状态持久化

### 7.3 常见踩坑

1. **过度图化**：只有 3 步的简单工作流不需要 Graph——Chain 或 Loop 更合适，强行画成图只增加复杂度
2. **节点粒度不当**：节点太细变成函数调用编排，太粗又退化为单 Agent——节点应该是"能自主完成一段工作的实体"
3. **State 设计混乱**：Graph 的 State 应该包含所有节点需要的信息——State 是节点间通信的唯一通道，不是全局变量
4. **忽视成本**：多 Agent 系统的 token 用量是单 Agent 的 ~15 倍——任务价值必须能覆盖成本
5. **循环无终点**：带环 Graph 必须有明确的终止条件——否则 Agent 死循环
6. **忽视可观测性**：Graph 的执行路径比线性链难追踪——要记录"走了哪条路径"，否则出了问题无法调试

---

## 八、总结

### 核心要点回顾

| 要点 | 说明 |
|------|------|
| **Graph Engineering 没有新技术** | 图、状态机、工作流都早就存在，变的是 Graph 连接的对象 |
| **连接对象的变化** | 从连接 Step（一次工具调用）到连接 Agent（能自主完成一段工作的实体） |
| **两次 Graph 热潮** | 2024：管住一个不靠谱的 Agent；2025-2026：组织一群越来越能干的 Agent |
| **三要素** | Node（节点）、Edge（边）、State（状态）——和 LangGraph 一样 |
| **Loop vs Graph** | Loop 关注一个 Agent 如何持续推进；Graph 关注多个 Agent 如何协同 |
| **五层工程嵌套** | Prompt → Context → Harness → Loop → Graph，是扩大的控制圈，不是替代 |
| **六大信号** | 职责分化、并行依赖、资源隔离、可审计性、独立验证、持久化恢复 |
| **多 Agent 的代价** | Token 用量 ~15× chat，只适合高价值高并行任务 |

### 设计哲学

Graph Engineering 的核心洞察可以浓缩为一句话：**当 Agent 足够强，组织它们的方式就比约束它们的方式更重要。**

这就像公司管理：当员工能力不足时，管理者关注的是"怎么管住他别出错"（Loop Engineering）；当员工足够优秀时，管理者关注的是"怎么让他们协同起来做更大的事"（Graph Engineering）。

> **Graph Engineering 的本质不是技术革新，而是组织革新。** Agent 变强了，图的价值才真正涌现。

### 进一步阅读

- [Anthropic：How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) — 多 Agent 研究系统的工程实践
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/) — Graph 编排框架
- [Google ADK 文档](https://google.github.io/adk-docs/) — Google Agent Development Kit
- 本博客 [Loop Engineering 解析](/ai-study/loop-engineering/) — 理解 Loop 与 Graph 的关系
- 本博客 [Managed Agents 解析](/ai-study/anthropic-managed-agents/) — Anthropic 的托管 Agent 架构
