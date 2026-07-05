---
title: AG-UI 学习笔记
tags:
  - AG-UI
  - Agent
  - 交互协议
  - CopilotKit
excerpt: AG-UI（Agent-User Interaction Protocol）是 CopilotKit 团队推出的开源轻量协议，标准化 AI Agent 与前端应用之间的双向通信。本文系统梳理 AG-UI 的协议定位、架构设计、事件系统、核心能力与实战用法。
createTime: 2026/07/05 10:00:00
permalink: /ai-study/ag-ui-study-notes/
---

# AG-UI 学习笔记

如果你最近在关注 AI Agent 生态，大概率听过 MCP（Anthropic 搞的，让 Agent 调用工具）和 A2A（Google 搞的，让 Agent 之间对话）。

但有一个问题，两个协议都没回答：**Agent 怎么跟用户交互？**

Agent 跑了半天，推理了一堆中间结果，调了三个工具，最后——怎么把这些东西实时、流畅地呈现给坐在浏览器前的用户？用户又怎么在执行过程中插手、审批、修改？

这就是 AG-UI 要解决的事。它是 Agent 协议栈里缺失的最后一块拼图——连接 Agent 和用户的标准化交互协议。

## 一、先搞清楚：三个协议各管哪段

在聊 AG-UI 之前，先把三个协议的分工理清。

![Agent协议栈全景](/ai-study/ai-ecosystem/ag-ui-study-notes/ag-ui-protocol-stack.svg)

| 协议 | 连接谁 | 解决什么 |
|------|--------|----------|
| MCP | Agent ↔ 工具/数据 | Agent 怎么安全地调用外部工具、获取上下文 |
| A2A | Agent ↔ Agent | 多个 Agent 之间怎么协调、分工 |
| **AG-UI** | **Agent ↔ 用户（前端）** | **Agent 怎么把结果推给用户、用户怎么在流程中插手** |

这和通信领域的 OSI 分层模型是同一个思路——每一层解决一个问题，层与层之间通过标准接口对接。MCP 管"向下连工具"，A2A 管"横向连同伴"，AG-UI 管"向上连用户"。

一个 Agent 可以同时使用这三个协议。这不是三选一的问题：一个智能体通过 MCP 调搜索引擎、通过 A2A 委派子任务给其他 Agent、通过 AG-UI 把进度和结果实时推送给用户——三个协议各司其职，协同工作。

## 二、AG-UI 是什么

一句话：**AG-UI 是一个开放、轻量、基于事件流的协议，用于标准化 Agent 和前端应用之间的双向通信。**

它由 CopilotKit 团队在 2025 年 5 月正式发布，目前已获得微软、Google、AWS、LangChain 等主流框架的官方集成。

### 2.1 它在解决什么问题

用 AI Agent 开发应用时，以下场景几乎人人都遇到过：

- **流式输出困难**：想逐 token 传输 LLM 响应，却要自己搭 WebSocket 服务器
- **工具进度不透明**：Agent 在后台调工具，前端只能干等，看不到执行进度
- **状态同步复杂**：大型、不断变化的对象（如代码或表格），全量重传太浪费
- **人工干预难实现**：想让用户在 Agent 运行中中断、审批、修改，但上下文容易丢失
- **框架适配成本高**：用 LangGraph 时写了一套 WebSocket 逻辑和 JSON 格式，要迁移到 CrewAI 就得全部重写

AG-UI 解决这些问题的方式，不是换一个更强的模型或框架，而是在 Agent 和前端之间加一层**标准化的事件流协议**。无论后端用 LangGraph、CrewAI 还是 Mastra，前端只需要对接 AG-UI Client，就能获得一致的交互体验。

### 2.2 核心设计原则

| 原则 | 含义 |
|------|------|
| 事件驱动 | 所有通信通过结构化事件流，不是请求/响应 |
| 轻量级 | 构建在 HTTP/SSE 之上，不引入复杂的基础设施 |
| 传输无关 | 支持 SSE、WebSocket、GraphQL Subscriptions |
| 双向通信 | Agent → 前端推送事件，前端 → Agent 发送指令 |
| 框架无关 | 后端 Agent 框架可自由替换，前端无感知 |

## 三、架构设计

AG-UI 遵循客户端-服务器架构，核心角色四个：

![AG-UI架构总览](/ai-study/ai-ecosystem/ag-ui-study-notes/ag-ui-architecture.svg)

### 3.1 四个核心角色

| 角色 | 职责 | 说明 |
|------|------|------|
| **Application** | 面向用户的应用 | 聊天界面、AI 助手等前端应用，负责渲染流式消息、处理用户交互 |
| **AG-UI Client** | 通信客户端 | 如 HttpAgent，负责发送请求、接收事件流、事件订阅与分发 |
| **Agent** | 后端 AI Agent | 处理请求并生成流式事件响应，可以是 LangGraph / CrewAI / Mastra 等 |
| **Secure Proxy** | 安全代理（可选） | 位于 Client 和 Agent 之间，提供鉴权、限流、日志、凭证管理 |

### 3.2 传输层

AG-UI 不绑定特定传输协议，支持多种通道：

- **SSE（Server-Sent Events）**：默认传输方式，基于 HTTP 的单向流式推送，简单可靠
- **WebSocket**：双向实时通信，适合需要频繁前端→Agent 交互的场景
- **GraphQL Subscriptions**：适合已有 GraphQL 基础设施的项目

传输层的选择对上层透明——AG-UI Client 封装了不同传输的细节，Application 层只需订阅事件即可。

### 3.3 Human-in-the-Loop（人机协同）

这是 AG-UI 最核心的能力之一。在传统 Agent 应用中，一旦任务启动，用户只能等待结果。而 AG-UI 允许用户在 Agent 执行过程中：

- **中断**：暂停当前执行
- **审批**：对工具调用结果进行确认或拒绝
- **修改**：调整 Agent 的执行参数
- **回复**：在 `input-required` 状态下提供额外信息

实现机制是：Agent 在需要人工干预时发出 `STEP_STARTED` 事件并进入等待状态，前端展示交互 UI，用户操作后通过 AG-UI Client 发回结果，Agent 从断点继续执行。

### 3.4 Frontend-Defined 工具

AG-UI 引入了一个独特的机制：**前端定义的工具**。并非所有工具都需要在 Agent 后端执行——有些操作（如打开文件选择器、获取地理位置、操作 DOM）天然属于前端能力。

AG-UI 允许在前端注册工具定义，Agent 调用这些工具时，请求会通过事件流转发到前端执行，结果再回传给 Agent。这大大扩展了 Agent 的能力边界。

## 四、事件系统

事件是 AG-UI 的核心抽象——Agent 和前端之间的所有通信都通过事件完成。理解事件系统，是用好 AG-UI 的关键。

### 4.1 事件类型总览

| 事件类别 | 代表事件 | 说明 |
|---------|---------|------|
| 生命周期事件 | `RUN_STARTED`、`RUN_FINISHED`、`RUN_ERROR`、`STEP_STARTED`、`STEP_FINISHED` | 监控 Agent 运行进度 |
| 文本消息事件 | `TEXT_MESSAGE_START`、`TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END` | 处理流式文本内容 |
| 工具调用事件 | `TOOL_CALL_START`、`TOOL_CALL_ARGS`、`TOOL_CALL_END` | 管理工具执行流程 |
| 状态管理事件 | `STATE_SNAPSHOT`、`STATE_DELTA` | Agent 与 UI 间状态同步 |
| 活动事件 | `ACTIVITY_*` | 表示正在进行的活动进度 |
| 自定义事件 | 用户定义 | 支持扩展 |

### 4.2 两种核心事件模式

AG-UI 的事件遵循两种主要模式：

![AG-UI事件流机制](/ai-study/ai-ecosystem/ag-ui-study-notes/ag-ui-event-flow.svg)

#### 模式一：Start-Content-End

用于流式内容传输（文本消息、工具调用），保证流的有序性和可追踪性：

```text
RUN_STARTED          ← Agent 运行开始
  TEXT_MESSAGE_START     ← 消息开始，分配 MessageId
    TEXT_MESSAGE_CONTENT  ← "Hello"（逐 token）
    TEXT_MESSAGE_CONTENT  ← " Wor"
    TEXT_MESSAGE_CONTENT  ← "ld"
  TEXT_MESSAGE_END       ← 消息结束
  TOOL_CALL_START        ← 工具调用开始
    TOOL_CALL_ARGS        ← 工具参数（流式传输）
  TOOL_CALL_END           ← 工具调用结束
RUN_FINISHED         ← Agent 运行结束
```

这个模式的关键在于：**先发 Start，再逐段发 Content，最后发 End**。前端收到 Start 时创建 UI 容器，收到 Content 时逐步填充，收到 End 时标记完成。即使中间出错，前端也能准确定位中断点。

#### 模式二：Snapshot-Delta

用于状态同步，兼顾初始全量和后续增量：

```text
STATE_SNAPSHOT       ← 全量快照 { items: [], loading: true }
STATE_DELTA          ← 增量 [ { op: "add", path: "/items/0", value: "Apple" } ]
STATE_DELTA          ← 增量 [ { op: "add", path: "/items/1", value: "Banana" } ]
STATE_DELTA          ← 增量 [ { op: "replace", path: "/loading", value: false } ]
```

- **STATE_SNAPSHOT**：发送完整状态，建立基线。通常在 Agent 运行开始时发送一次
- **STATE_DELTA**：发送 JSON Patch 格式的增量更新，只包含变化部分

这种设计的好处：首次同步全量建基线，后续只传 diff，大幅减少带宽消耗。对于大型状态对象（如代码编辑器内容、表格数据），这个优化非常关键。

### 4.3 STATE_DELTA 与 RFC 6902 核心理念

`STATE_DELTA` 事件中的增量更新格式并非 AG-UI 自行发明的，而是遵循 **RFC 6902 —— JSON Patch** 规范。这是一份 IETF 标准，定义了对 JSON 文档进行局部修改的标准化操作格式。

核心理念很简单：**不传整个状态，只传"变化了什么"**。RFC 6902 通过一组操作（`add`/`remove`/`replace`/`move`/`copy`/`test`）配合 JSON Pointer 路径（如 `/items/0`），精确描述每一次变更。Agent 只需要发送变化的 diff，前端按顺序应用即可。

```text
STATE_SNAPSHOT  → { items: ["Apple"], loading: true }   ← 全量基线
STATE_DELTA     → [{ op: "add", path: "/items/1", value: "Banana" }]  ← 只传增量
STATE_DELTA     → [{ op: "replace", path: "/loading", value: false }]
```

选择 RFC 6902 的原因：业界标准、各语言都有成熟实现（如 `fast-json-patch`）、路径定位精确、批量操作具备原子性。完整的 RFC 6902 规范说明（六种操作详解、JSON Pointer 语法、完整示例与最佳实践）见文末[附录 A](#附录-a-rfc-6902-完整说明)。

### 4.4 BaseEvent：所有事件的根接口

AG-UI 中的所有通信都基于**类型化事件**（typed events）。每一种事件——无论是生命周期事件、文本消息事件还是状态管理事件——都继承自同一个根接口 `BaseEvent`：

```typescript
interface BaseEvent {
  type: EventType      // 事件类型，决定事件的结构和行为
  timestamp?: number   // 事件发生的时间戳（Unix 毫秒），可选
  rawEvent?: any       // 原始事件数据，用于调试和透传，可选
}
```

#### 字段详解

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `EventType` | 是 | 事件类型枚举值，如 `TEXT_MESSAGE_CONTENT`、`STATE_DELTA`、`RUN_STARTED` 等。这是前端分发事件的唯一依据 |
| `timestamp` | `number` | 否 | 事件发生的 Unix 时间戳（毫秒级）。用于排序、延迟计算和调试，不强制要求 |
| `rawEvent` | `any` | 否 | 原始事件数据。当 AG-UI 事件是由底层传输（如 MCP 消息、A2A 消息）转换而来时，`rawEvent` 保留原始数据，方便调试和溯源 |

#### 继承体系

AG-UI 的所有具体事件类型都在 `BaseEvent` 的基础上扩展自身特有字段。继承关系如下：

```text
BaseEvent
  ├── LifecycleEvent          生命周期事件
  │     + threadId, runId, stepId?
  │     ├── RUN_STARTED
  │     ├── RUN_FINISHED
  │     ├── RUN_ERROR
  │     ├── STEP_STARTED
  │     └── STEP_FINISHED
  │
  ├── TextMessageEvent        文本消息事件
  │     + threadId, runId, messageId
  │     ├── TEXT_MESSAGE_START    (+ role)
  │     ├── TEXT_MESSAGE_CONTENT  (+ content)
  │     └── TEXT_MESSAGE_END
  │
  ├── ToolCallEvent           工具调用事件
  │     + threadId, runId, toolCallId
  │     ├── TOOL_CALL_START  (+ toolName, parentStepId?)
  │     ├── TOOL_CALL_ARGS   (+ delta)
  │     └── TOOL_CALL_END    (+ result?)
  │
  ├── StateSnapshotEvent      状态快照事件
  │     + threadId, runId, snapshot
  │
  ├── StateDeltaEvent         状态增量事件
  │     + threadId, runId, delta (RFC 6902 patch 数组)
  │
  └── CustomEvent             自定义事件
        + threadId, runId, name, value?
```

可以看到，大部分事件类型在 `BaseEvent` 的 `type` / `timestamp` / `rawEvent` 之外，还扩展了 `threadId` 和 `runId` 用于会话和运行追踪，以及各自业务相关的字段。

#### 具体事件示例

以 `TEXT_MESSAGE_CONTENT` 为例，它的完整结构是 `BaseEvent` + 消息字段的组合：

```typescript
// BaseEvent 提供的基础字段
{
  type: "TEXT_MESSAGE_CONTENT",   // ← 来自 BaseEvent
  timestamp: 1719900000000,       // ← 来自 BaseEvent（可选）

  // TextMessageEvent 扩展的字段
  threadId: "thread-abc",         // 会话 ID
  runId: "run-123",               // 运行 ID
  messageId: "msg-001",           // 消息 ID（同一消息的 Start/Content/End 共享）
  content: "Hello"                // 本次推送的文本片段
}
```

`STATE_DELTA` 事件同理，在 `BaseEvent` 基础上扩展了状态同步相关字段：

```typescript
{
  type: "STATE_DELTA",            // ← 来自 BaseEvent
  timestamp: 1719900000001,       // ← 来自 BaseEvent（可选）

  // StateDeltaEvent 扩展的字段
  threadId: "thread-abc",
  runId: "run-123",
  delta: [                        // RFC 6902 patch 操作数组
    { op: "add", path: "/items/0", value: "Apple" }
  ]
}
```

#### 设计意义

`BaseEvent` 的存在体现了 AG-UI 协议的一个核心设计哲学——**所有通信都是类型化事件，所有事件共享统一的基础形状**。这带来了三个实际好处：

- **统一分发**：前端只需一个事件分发器，根据 `type` 字段路由到对应处理器，无需为每种传输方式写不同逻辑
- **可扩展**：新增事件类型只需扩展 `BaseEvent`，前端的事件基础设施无需改动
- **可溯源**：`rawEvent` 字段保留了底层原始数据，当 Agent 事件由 MCP/A2A 等其他协议消息转换而来时，调试和问题定位更方便

## 五、核心能力详解

### 5.1 流式文本输出

AG-UI 的流式输出不是简单的文本拼接，而是基于 Start-Content-End 模式的结构化流：

- `TEXT_MESSAGE_START`：创建消息容器，分配 messageId
- `TEXT_MESSAGE_CONTENT`（多次）：逐 token 推送内容，前端实时追加
- `TEXT_MESSAGE_END`：标记消息完成

前端无需自己管理 WebSocket 连接和消息缓冲——AG-UI Client 处理了所有底层细节。

### 5.2 工具调用编排

Agent 的工具调用过程通过事件流完整暴露给前端：

```text
TOOL_CALL_START  { toolCallId: "tc-1", toolName: "search_web" }
TOOL_CALL_ARGS   { toolCallId: "tc-1", delta: '{"query":"AI' }
TOOL_CALL_ARGS   { toolCallId: "tc-1", delta: ' protocols"}' }
TOOL_CALL_END    { toolCallId: "tc-1" }
```

前端可以在 `TOOL_CALL_START` 时显示"正在搜索..."的 UI，在 `TOOL_CALL_END` 时更新为完成状态。如果工具需要人工审批，Agent 可以在 `TOOL_CALL_START` 后暂停，等待前端返回审批结果。

### 5.3 状态同步

AG-UI 的状态同步能力让 Agent 和 UI 始终保持一致：

- Agent 维护一个共享状态对象
- 初始通过 `STATE_SNAPSHOT` 全量推送给前端
- 后续每次状态变化，通过 `STATE_DELTA` 发送 JSON Patch
- 前端应用 patch 后，UI 自动更新

这种机制特别适合：代码编辑器、数据表格、多步表单等需要实时同步大型状态的场景。

### 5.4 生命周期管理

生命周期事件让前端能够追踪 Agent 的完整执行过程：

| 事件 | 触发时机 | 前端典型响应 |
|------|---------|------------|
| `RUN_STARTED` | Agent 开始执行 | 显示加载状态 |
| `STEP_STARTED` | 某一步骤开始 | 更新进度指示器 |
| `STEP_FINISHED` | 某一步骤完成 | 更新进度 |
| `RUN_ERROR` | 执行出错 | 显示错误信息 |
| `RUN_FINISHED` | Agent 执行完成 | 移除加载状态 |

## 六、实战：如何使用 AG-UI

### 6.1 前端集成

使用 AG-UI TypeScript SDK 快速集成：

```typescript
import { HttpAgent } from '@ag-ui/client'

// 创建 AG-UI Client
const agent = new HttpAgent({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
})

// 订阅事件
agent.on('TEXT_MESSAGE_CONTENT', (event) => {
  appendToChat(event.content)  // 逐 token 追加到聊天界面
})

agent.on('TOOL_CALL_START', (event) => {
  showToolProgress(event.toolName)  // 显示工具调用进度
})

agent.on('STATE_SNAPSHOT', (event) => {
  updateSharedState(event.snapshot)  // 初始化共享状态
})

agent.on('STATE_DELTA', (event) => {
  applyStatePatch(event.delta)  // 应用增量更新
})

// 发送用户消息
agent.sendMessage({
  threadId: 'thread-001',
  message: '帮我分析过去一周的销售数据',
})
```

### 6.2 后端 Agent 集成

以 LangGraph 为例，使用 AG-UI 适配器将现有 Agent 包装为 AG-UI 兼容端点：

```python
from ag_ui_langgraph import LangGraphAdapter
from langgraph.graph import StateGraph

# 你的 LangGraph Agent
graph = StateGraph(...)
# ... 定义节点和边 ...

# 用 AG-UI 适配器包装
adapter = LangGraphAdapter(graph)

# 暴露为 HTTP 端点
@app.post("/agents/run")
async def run_agent(request: Request):
    async for event in adapter.run(request):
        yield event  # 以 SSE 流式返回事件
```

### 6.3 已支持的框架

AG-UI 发布时即获得主流框架的官方集成支持：

| 框架 | 类型 | 集成状态 |
|------|------|---------|
| LangGraph | Agent 后端 | 官方适配器 |
| CrewAI | Agent 后端 | 官方适配器 |
| Mastra | Agent 后端 | 官方适配器 |
| AG2 | Agent 后端 | 官方适配器 |
| LlamaIndex | Agent 后端 | 官方适配器 |
| CopilotKit | 前端框架 | 原生支持 |

## 七、AG-UI 与 A2UI 的关系

这里有一个容易混淆的点：**AG-UI 和 A2UI 不是竞争关系，而是互补关系。**

| 维度 | AG-UI | A2UI |
|------|-------|------|
| 全称 | Agent-User Interaction Protocol | Agent-to-User Interface |
| 定位 | 交互协议——"怎么通信" | UI 协议——"画什么界面" |
| 出品方 | CopilotKit | Google |
| 核心能力 | 事件流、状态同步、人工干预 | 声明式 UI 生成、跨平台渲染 |
| 传输方式 | SSE/WebSocket | 不绑定传输，可搭 AG-UI |

一个典型场景：Agent 通过 AG-UI 的事件流通道，传输 A2UI 格式的 UI 蓝图，前端用 A2UI Renderer 渲染原生界面。两者配合使用，才能实现完整的 Agent 驱动 UI 体验。

## 八、最佳实践

### 8.1 合理使用事件类型

不要把所有信息都塞进 `TEXT_MESSAGE_CONTENT`。对于结构化数据，优先使用 `STATE_DELTA` 同步状态；对于工具调用进度，使用 `TOOL_CALL_*` 事件；对于自定义数据，使用自定义事件。

### 8.2 状态同步的粒度控制

`STATE_SNAPSHOT` 只在初始化时发送一次，后续全部使用 `STATE_DELTA`。Delta 的粒度要适中——太细（每个字段变化一条 delta）会增加事件数量，太粗（整个对象一条 delta）会失去增量传输的优势。

### 8.3 Human-in-the-Loop 的边界

不是所有工具调用都需要人工审批。建议只对**不可逆操作**（如删除数据、发送邮件、执行支付）启用审批，其他操作让 Agent 自主执行，避免过度打断用户体验。

### 8.4 错误处理

始终监听 `RUN_ERROR` 事件。Agent 执行可能因为 LLM 超时、工具异常、上下文溢出等原因失败，前端需要提供友好的错误提示和重试机制。

### 8.5 传输层选择

- 默认用 SSE：简单可靠，适合大多数场景
- 需要频繁前端→Agent 交互时用 WebSocket
- 已有 GraphQL 基础设施时用 GraphQL Subscriptions

---

## 总结

AG-UI 填补了 Agent 协议栈的最后一块空白——Agent 与用户之间的交互层。它的核心价值在于：

- **标准化**：统一了 Agent 与前端的通信方式，消除框架适配成本
- **事件驱动**：基于事件流的架构天然支持流式输出和实时交互
- **双向通信**：不仅 Agent 推送给前端，用户也能在执行过程中干预
- **框架无关**：后端可自由替换 Agent 框架，前端无感知

如果说 MCP 让 Agent 有了"手"（调用工具），A2A 让 Agent 有了"伙伴"（协作），那 AG-UI 让 Agent 有了"脸"（面向用户）。三者协同，构成了完整的 Agent 协议生态。

---

## 附录 A：RFC 6902 完整说明

> 本附录是对 4.3 节中 `STATE_DELTA` 事件所依赖的 RFC 6902（JSON Patch）规范的详细展开，供需要深入理解增量更新机制的读者参考。

### A.1 为什么是 RFC 6902

在 AG-UI 的状态同步场景中，Agent 和前端之间需要同步一个不断变化的共享状态对象。如果每次状态变化都全量传输整个对象，对于大型状态（如代码编辑器内容、数据表格、多步表单）会产生大量冗余数据。RFC 6902 提供了一套**只描述"变化了什么"的标准化语言**，完美契合 AG-UI 的增量同步需求。

选择 RFC 6902 而非自定义格式的好处：

- **标准化**：业界广泛支持的开放标准，无需额外学习成本
- **生态成熟**：几乎所有语言都有现成的 JSON Patch 实现（如 JavaScript 的 `fast-json-patch`、Python 的 `jsonpatch`）
- **精确性**：通过 JSON Pointer（RFC 6901）路径精确定位每个修改点
- **原子性**：一组 patch 操作作为一个数组批量应用，要么全部成功，要么全部回滚

### A.2 六种操作类型

RFC 6902 定义了六种对 JSON 文档的操作，AG-UI 的 `STATE_DELTA` 事件可以包含其中任意若干种的组合：

| 操作 | 关键字 | 说明 | 示例 |
|------|--------|------|------|
| **添加** | `add` | 在指定路径添加值。如果目标是数组，插入到指定索引；如果路径已存在，替换旧值 | `{"op": "add", "path": "/items/0", "value": "Apple"}` |
| **移除** | `remove` | 移除指定路径的值。如果目标是数组，删除该元素并后移后续元素 | `{"op": "remove", "path": "/items/1"}` |
| **替换** | `replace` | 替换指定路径的值。与 `add` 的区别在于：`replace` 要求路径必须已存在 | `{"op": "replace", "path": "/loading", "value": false}` |
| **移动** | `move` | 将值从一个路径移动到另一个路径。先移除源路径的值，再添加到目标路径 | `{"op": "move", "from": "/temp", "path": "/result"}` |
| **复制** | `copy` | 将值从一个路径复制到另一个路径。源路径的值保持不变 | `{"op": "copy", "from": "/template", "path": "/items/0"}` |
| **测试** | `test` | 测试指定路径的值是否等于给定值。如果不匹配，整个 patch 操作失败 | `{"op": "test", "path": "/status", "value": "ready"}` |

### A.3 JSON Pointer 路径语法

每个操作中的 `path`（以及 `move`/`copy` 的 `from`）使用 **RFC 6901 JSON Pointer** 格式来定位 JSON 文档中的目标位置：

```text
/
├── items (数组)
│   ├── 0 → "Apple"
│   └── 1 → "Banana"
├── loading → true
└── user (对象)
    ├── name → "Alice"
    └── role → "admin"
```

| 路径 | 定位到 | 说明 |
|------|--------|------|
| `/items` | `["Apple", "Banana"]` | 根级数组 |
| `/items/0` | `"Apple"` | 数组的第一个元素 |
| `/items/1` | `"Banana"` | 数组的第二个元素 |
| `/loading` | `true` | 根级字段 |
| `/user/name` | `"Alice"` | 嵌套对象字段 |
| `/user/role` | `"admin"` | 嵌套对象字段 |
| `` (空字符串) | 整个文档根 | 特殊情况，指向根对象 |

::: tip 路径转义规则
JSON Pointer 中使用 `~1` 表示 `/`（因为 `/` 本身是路径分隔符），使用 `~0` 表示 `~`（因为 `~` 本身是转义前缀）。例如路径 `/a~1b` 实际指向键名 `a/b`。
:::

### A.4 在 AG-UI 中的完整示例

假设 Agent 维护的共享状态如下：

```json
{
  "items": ["Apple", "Banana"],
  "loading": true,
  "user": { "name": "Alice", "role": "viewer" }
}
```

Agent 在运行过程中状态发生变化，通过一条 `STATE_DELTA` 事件发送批量 patch：

```json
{
  "type": "STATE_DELTA",
  "threadId": "thread-abc",
  "runId": "run-123",
  "delta": [
    { "op": "add", "path": "/items/2", "value": "Cherry" },
    { "op": "replace", "path": "/loading", "value": false },
    { "op": "replace", "path": "/user/role", "value": "admin" },
    { "op": "test", "path": "/user/name", "value": "Alice" }
  ]
}
```

前端收到后，依次应用这些操作：

1. `add /items/2` → 数组变为 `["Apple", "Banana", "Cherry"]`
2. `replace /loading` → `loading` 变为 `false`
3. `replace /user/role` → `user.role` 变为 `"admin"`
4. `test /user/name` → 验证 `user.name` 确实是 `"Alice"`，通过

最终状态：

```json
{
  "items": ["Apple", "Banana", "Cherry"],
  "loading": false,
  "user": { "name": "Alice", "role": "admin" }
}
```

::: warning test 操作的用途
`test` 操作常用于**乐观锁**场景——在修改前先验证某个前置条件是否满足。如果 `test` 失败（值不匹配），整组 patch 操作都会被拒绝，前端状态保持不变。这可以防止基于过时快照的增量更新覆盖了其他变化。
:::

### A.5 前端应用 Patch 的实现

借助成熟的 JSON Patch 库，前端应用 `STATE_DELTA` 非常简单：

```typescript
import { applyPatch } from 'fast-json-patch'

agent.on('STATE_DELTA', (event) => {
  // event.delta 是 RFC 6902 定义的 patch 操作数组
  // applyPatch 会原地修改 sharedState，并返回操作结果
  const results = applyPatch(sharedState, event.delta)
  // sharedState 已更新，触发 UI 重渲染
  triggerReRender(sharedState)
})
```

如果需要更细粒度的控制（如记录变更日志、支持撤销），可以使用 `observe` 模式：

```typescript
import { observe, generate } from 'fast-json-patch'

// 观察状态变化，自动生成 patch
const sharedState = { items: [], loading: true }
const observer = observe(sharedState)

// 前端 UI 操作修改了状态
sharedState.items.push('Apple')
sharedState.loading = false

// 获取自上次以来的所有变更（RFC 6902 格式）
const patches = generate(observer)
// patches = [
//   { op: "add", path: "/items/0", value: "Apple" },
//   { op: "replace", path: "/loading", value: false }
// ]
```

### A.6 最佳实践总结

| 实践 | 说明 |
|------|------|
| **批量发送** | 将多个变更合并为一条 `STATE_DELTA` 的数组，而非每个变更单独一条事件 |
| **路径要精确** | 尽量定位到叶子节点（如 `/user/name`），避免对大对象整体 `replace` |
| **善用 test 操作** | 在关键修改前加 `test` 前置条件，防止基于过时状态的误更新 |
| **不要省略 SNAPSHOT** | 每个 `threadId` 的首次同步必须是 `STATE_SNAPSHOT`，建立基线后才能正确应用 delta |
| **处理 patch 失败** | 如果 `applyPatch` 报错（路径不存在等），应请求 Agent 重新发送 `STATE_SNAPSHOT` 重建基线 |
