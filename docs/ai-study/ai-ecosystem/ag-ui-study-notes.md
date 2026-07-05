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

这是 AG-UI 最核心的能力之一。在传统 Agent 应用中，一旦任务启动，用户只能等待结果。AG-UI 通过**中断感知的运行生命周期**（interrupt-aware run lifecycle）实现了更强大的人机协同。

#### 中断与恢复机制

当 Agent 需要人工介入时（如审批敏感操作、请求结构化输入、等待策略决策），它不会简单地暂停等待，而是通过 `RUN_FINISHED` 事件携带 `outcome` 字段来声明中断：

```text
Agent 运行中
  → RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }
     ← Agent 暂停，等待用户响应

用户操作后
  → 新的 RunAgentInput { resume: [...] }
     ← Agent 从断点继续执行
```

每个中断对象（Interrupt）包含以下字段：

| 字段 | 说明 |
|------|------|
| `id` | 中断的唯一标识，用于关联恢复请求 |
| `reason` | 中断原因分类（如 `tool_call`、`input_required`） |
| `message` | 人类可读的提示文本，通用 UI 回退内容 |
| `toolCallId` | 绑定到之前的 `TOOL_CALL_*` 序列（工具审批场景） |
| `responseSchema` | 期望的恢复数据的 JSON Schema |
| `expiresAt` | 可选的 ISO-8601 过期时间，过期后恢复会产生 `RUN_ERROR` |
| `metadata` | 自由格式的框架特定数据 |

#### 恢复（Resume）

用户响应后，前端发起新的运行，在 `RunAgentInput` 中携带 `resume` 数组：

```typescript
type ResumeEntry = {
  interruptId: string        // 对应中断的 id
  status: "resolved" | "cancelled"  // resolved=已响应，cancelled=已放弃
  payload?: any              // resolved 时的响应数据，按 responseSchema 校验
}
```

- **resolved**：用户已响应。`payload` 携带响应内容，拒绝也通过 payload 表达（如 `{ approved: false }`），而非单独的状态
- **cancelled**：用户放弃，不提供有效输入，`payload` 应省略

#### 中断契约规则

1. **同线程**：恢复请求必须使用与中断运行相同的 `threadId`
2. **覆盖所有中断**：单次 `resume` 数组必须处理被中断运行中的**所有**开放中断，不支持部分恢复
3. **待处理中断阻塞新输入**：如果线程有未解决的中断，任何新的 `RunAgentInput` 必须包含 `resume` 来处理它们
4. **幂等性**：相同 `(threadId, interruptId, status, payload)` 的恢复可以安全重放
5. **Payload 校验**：如果中断声明了 `responseSchema`，`payload` 必须通过校验

#### 工具审批与参数编辑

最常见的 HITL 场景是工具调用审批。Agent 在发起 `sendEmail` 等敏感工具调用后中断，等待用户确认：

```json
{
  "outcome": {
    "type": "interrupt",
    "interrupts": [{
      "id": "int-abc123",
      "reason": "tool_call",
      "message": "确认发送邮件给 a@b.com？",
      "toolCallId": "tc-001",
      "responseSchema": {
        "type": "object",
        "properties": {
          "approved": { "type": "boolean" },
          "editedArgs": { "type": "object", "description": "工具参数的完整替换，非合并" }
        },
        "required": ["approved"]
      }
    }]
  }
}
```

`editedArgs` 是工具参数的**完整替换**而非部分合并。它在 schema 中的存在是客户端可以提供编辑 UI 的能力信号。Agent 还可以通过 Capabilities 声明 `approveWithEdits: true` 来表示支持参数编辑。

### 3.4 Frontend-Defined 工具

AG-UI 引入了一个独特的机制：**前端定义的工具**。并非所有工具都需要在 Agent 后端执行——有些操作（如打开文件选择器、获取地理位置、操作 DOM）天然属于前端能力。

AG-UI 允许在前端注册工具定义，Agent 调用这些工具时，请求会通过事件流转发到前端执行，结果再回传给 Agent。这大大扩展了 Agent 的能力边界。

#### Tool 结构定义

每个工具遵循统一的结构：

```typescript
interface Tool {
  name: string          // 工具名称，唯一标识
  description: string   // 工具描述，帮助 Agent 理解何时使用
  parameters: {         // JSON Schema 定义的参数结构
    type: "object"
    properties: { ... }
    required: string[]
  }
}
```

`parameters` 字段使用 [JSON Schema](https://json-schema.org/) 定义工具接受的参数结构。这个 schema 同时被 Agent（用于生成有效的工具调用）和前端（用于校验和解析工具参数）使用。

#### 工具调用流程

```text
1. 前端定义工具 → 通过 RunAgentInput.tools 传递给 Agent
2. Agent 决定调用工具 → 发出 TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
3. 前端执行工具（如果是前端工具）→ 或 Agent 后端执行
4. 工具结果作为 ToolMessage 加入对话历史 → Agent 继续推理
```

工具执行后，结果以 `ToolMessage` 的形式返回给 Agent：

```typescript
{
  id: "result-789",
  role: "tool",
  content: "true",           // 工具结果字符串
  toolCallId: "tool-123"     // 引用原始工具调用
}
```

### 3.5 RunAgentInput：Client → Agent 的输入

前面讲的都是 Agent → 前端方向的事件流。反方向——前端 → Agent——通过 `RunAgentInput` 完成。这是前端启动 Agent 运行时发送的完整输入 payload：

```typescript
interface RunAgentInput {
  threadId: string        // 会话线程 ID，贯穿同一对话的所有运行
  runId: string           // 本次运行的唯一 ID
  parentRunId?: string    // 父运行 ID，用于分支/时间旅行
  state: any              // 共享状态对象
  messages: Message[]     // 完整对话历史
  tools: Tool[]           // 前端定义的工具列表
  context: Context[]      // 额外上下文信息
  forwardedProps: any     // 透传属性
  resume?: ResumeEntry[]  // 恢复中断运行（HITL）
}
```

| 字段 | 说明 |
|------|------|
| `threadId` | 会话线程标识。同一对话的多次运行共享同一 `threadId`，Agent 据此维护对话上下文 |
| `runId` | 单次运行的唯一标识。Agent 在 `RUN_STARTED` 事件中回传此 ID，后续所有事件都关联到它 |
| `parentRunId` | 可选的父运行 ID。用于分支和时间旅行——创建一个基于先前运行的分支，类似 git 的 append-only 日志 |
| `state` | 共享状态对象。Agent 可以通过 `STATE_SNAPSHOT` / `STATE_DELTA` 事件更新它 |
| `messages` | 完整的对话消息历史，包含 user / assistant / system / tool / developer / activity / reasoning 等角色 |
| `tools` | 前端定义的工具列表。Agent 在运行中可以调用这些工具，调用请求通过事件流转发到前端执行 |
| `context` | 额外的上下文信息数组，为 Agent 提供补充描述 |
| `forwardedProps` | 透传属性，用于向 Agent 传递框架特定的自定义数据 |
| `resume` | 可选的中断恢复数组。当 Agent 之前以 `outcome: interrupt` 结束时，前端通过此字段提交用户的响应 |

核心执行接口很简单：

```typescript
// 核心协议抽象：运行 Agent 并接收事件流
type RunAgent = (input: RunAgentInput) => Observable<BaseEvent>
```

前端调用 `agent.runAgent(input)` 发起运行，返回一个事件流的 Observable。Agent 处理输入并以 `RUN_STARTED` 开始、`RUN_FINISHED` 或 `RUN_ERROR` 结束的事件流作为响应。

### 3.6 消息类型系统

`RunAgentInput.messages` 中的每条消息都遵循统一的 `BaseMessage` 接口，并通过 `role` 字段区分类型：

```typescript
interface BaseMessage {
  id: string              // 消息唯一标识
  role: string            // 发送者角色
  content?: string        // 可选的文本内容
  name?: string           // 可选的发送者名称
  encryptedContent?: string  // 可选的加密内容，用于隐私保护的状态延续
}
```

`role` 可以是 `user`、`assistant`、`system`、`tool`、`developer`、`activity` 或 `reasoning`。

::: tip encryptedContent 的用途
`encryptedContent` 支持隐私保护工作流——敏感内容（如推理链）可以跨轮次传递而不暴露原始内容。这对于零数据保留（ZDR）合规和 `store:false` 场景特别有用。
:::

#### 主要消息类型

| 类型 | role | 说明 |
|------|------|------|
| **UserMessage** | `user` | 用户消息，`content` 支持纯文本或多模态内容（图片、音频、视频、文档） |
| **AssistantMessage** | `assistant` | AI 助手回复，可包含文本内容和工具调用 |
| **SystemMessage** | `system` | 系统指令或上下文 |
| **ToolMessage** | `tool` | 工具执行结果，通过 `toolCallId` 关联到原始工具调用 |
| **DeveloperMessage** | `developer` | 开发者级别的指令 |
| **ReasoningMessage** | `reasoning` | 推理过程消息（思维链） |

#### 多模态输入

`UserMessage` 的 `content` 可以是纯文本，也可以是多模态内容数组：

```typescript
type InputContent =
  | TextInputContent      // 纯文本
  | ImageInputContent     // 图片（URL 或 Base64）
  | AudioInputContent     // 音频
  | VideoInputContent     // 视频
  | DocumentInputContent  // 文档
```

这种设计让传统纯文本输入和富媒体负载在同一个消息结构中共存。

### 3.7 能力声明（Capabilities）

Agent 可以在运行时声明自己支持哪些能力，前端据此做功能适配和特性开关：

```typescript
interface AgentCapabilities {
  identity?: IdentityCapabilities         // 身份信息（名称、版本、描述）
  transport?: TransportCapabilities       // 支持的传输方式
  state?: StateCapabilities               // 状态管理能力
  multiAgent?: MultiAgentCapabilities     // 多 Agent 协作
  reasoning?: ReasoningCapabilities       // 推理可见性
  multimodal?: MultimodalCapabilities     // 多模态输入/输出
  execution?: ExecutionCapabilities       // 执行控制（沙箱、超时、迭代上限）
  humanInTheLoop?: HumanInTheLoopCapabilities  // 人机协同
  custom?: Record<string, unknown>        // 自定义能力扩展
}
```

其中 `HumanInTheLoopCapabilities` 与 3.3 节的中断机制直接相关：

```typescript
interface HumanInTheLoopCapabilities {
  supported?: boolean       // 是否支持任何形式的人机协同
  approvals?: boolean       // 是否支持敏感操作审批
  interventions?: boolean   // 是否支持中途干预和修改计划
  feedback?: boolean        // 是否支持用户反馈（点赞/纠正）
  interrupts?: boolean      // 是否参与 AG-UI 中断协议
  approveWithEdits?: boolean // 工具审批是否接受 editedArgs
}
```

前端可以根据能力声明做条件渲染——只有 Agent 声明了 `approvals: true` 才显示审批 UI，只有声明了 `interrupts: true` 才启用中断恢复流程。

## 四、事件系统

事件是 AG-UI 的核心抽象——Agent 和前端之间的所有通信都通过事件完成。理解事件系统，是用好 AG-UI 的关键。

### 4.1 事件类型总览

| 事件类别 | 代表事件 | 说明 |
|---------|---------|------|
| 生命周期事件 | `RUN_STARTED`、`RUN_FINISHED`、`RUN_ERROR`、`STEP_STARTED`、`STEP_FINISHED` | 监控 Agent 运行进度。`RUN_FINISHED` 可携带 `outcome` 声明成功或中断 |
| 文本消息事件 | `TEXT_MESSAGE_START`、`TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END`、`TEXT_MESSAGE_CHUNK` | 处理流式文本内容。`CHUNK` 是便捷事件，自动展开为 Start→Content→End |
| 工具调用事件 | `TOOL_CALL_START`、`TOOL_CALL_ARGS`、`TOOL_CALL_END`、`TOOL_CALL_RESULT`、`TOOL_CALL_CHUNK` | 管理工具执行流程。`RESULT` 携带工具执行结果，`CHUNK` 是便捷事件 |
| 状态管理事件 | `STATE_SNAPSHOT`、`STATE_DELTA`、`MESSAGES_SNAPSHOT` | Agent 与 UI 间状态同步。`MESSAGES_SNAPSHOT` 提供完整对话历史 |
| 推理事件 | `REASONING_START`、`REASONING_MESSAGE_*`、`REASONING_END`、`REASONING_ENCRYPTED_VALUE` | 展示 Agent 内部推理过程，支持加密推理项跨轮次传递 |
| 活动事件 | `ACTIVITY_SNAPSHOT`、`ACTIVITY_DELTA` | 表示正在进行的活动进度 |
| 原始事件 | `RAW` | 透传底层协议的原始事件，用于调试和溯源 |
| 自定义事件 | `CUSTOM` | 支持扩展，携带自定义 `name` 和 `value` |

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
  │     ├── RUN_STARTED     (+ parentRunId?, input?)
  │     ├── RUN_FINISHED    (+ outcome?, result?)
  │     ├── RUN_ERROR
  │     ├── STEP_STARTED
  │     └── STEP_FINISHED
  │
  ├── TextMessageEvent        文本消息事件
  │     + threadId, runId, messageId
  │     ├── TEXT_MESSAGE_START    (+ role)
  │     ├── TEXT_MESSAGE_CONTENT  (+ content)
  │     ├── TEXT_MESSAGE_END
  │     └── TEXT_MESSAGE_CHUNK     (+ delta, 可选便捷事件)
  │
  ├── ToolCallEvent           工具调用事件
  │     + threadId, runId, toolCallId
  │     ├── TOOL_CALL_START   (+ toolName, parentMessageId?)
  │     ├── TOOL_CALL_ARGS    (+ delta)
  │     ├── TOOL_CALL_END
  │     ├── TOOL_CALL_RESULT  (+ messageId, content, role)
  │     └── TOOL_CALL_CHUNK   (+ delta, 可选便捷事件)
  │
  ├── StateSnapshotEvent      状态快照事件
  │     + threadId, runId, snapshot
  │
  ├── StateDeltaEvent         状态增量事件
  │     + threadId, runId, delta (RFC 6902 patch 数组)
  │
  ├── MessagesSnapshotEvent   消息历史快照事件
  │     + threadId, runId, messages (完整对话历史)
  │
  ├── ReasoningEvent          推理事件
  │     + threadId, runId, messageId
  │     ├── REASONING_START
  │     ├── REASONING_MESSAGE_START
  │     ├── REASONING_MESSAGE_CONTENT  (+ delta)
  │     ├── REASONING_MESSAGE_END
  │     ├── REASONING_MESSAGE_CHUNK     (+ delta, 可选便捷事件)
  │     ├── REASONING_END
  │     └── REASONING_ENCRYPTED_VALUE   (+ value, 加密推理项)
  │
  ├── ActivityEvent           活动事件
  │     + threadId, runId
  │     ├── ACTIVITY_SNAPSHOT  (+ activity)
  │     └── ACTIVITY_DELTA    (+ delta)
  │
  ├── RawEvent                原始事件
  │     + threadId, runId, source?, data?
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
TOOL_CALL_RESULT { toolCallId: "tc-1", content: "AI protocols are..." }
```

前端可以在 `TOOL_CALL_START` 时显示"正在搜索..."的 UI，在 `TOOL_CALL_END` 时更新为完成状态，`TOOL_CALL_RESULT` 则携带工具执行的实际结果。如果工具需要人工审批，Agent 可以通过中断机制（3.3 节）暂停等待用户确认。

::: tip 便捷事件 TOOL_CALL_CHUNK
`TOOL_CALL_CHUNK` 是一个便捷事件，客户端流转换器会自动将其展开为标准的 Start→Args→End 三部曲。首个 chunk 必须包含 `toolCallId` 和 `toolCallName`，后续 chunk 只需 `delta`。`TEXT_MESSAGE_CHUNK` 同理。
:::

### 5.3 状态同步

AG-UI 的状态同步能力让 Agent 和 UI 始终保持一致：

- Agent 维护一个共享状态对象
- 初始通过 `STATE_SNAPSHOT` 全量推送给前端
- 后续每次状态变化，通过 `STATE_DELTA` 发送 JSON Patch
- 前端应用 patch 后，UI 自动更新
- `MESSAGES_SNAPSHOT` 可用于同步完整对话历史（如页面刷新后恢复）

这种机制特别适合：代码编辑器、数据表格、多步表单等需要实时同步大型状态的场景。

### 5.4 生命周期管理与中断

生命周期事件让前端能够追踪 Agent 的完整执行过程：

| 事件 | 触发时机 | 前端典型响应 |
|------|---------|------------|
| `RUN_STARTED` | Agent 开始执行（携带 `threadId`、`runId`） | 显示加载状态 |
| `STEP_STARTED` | 某一步骤开始 | 更新进度指示器 |
| `STEP_FINISHED` | 某一步骤完成 | 更新进度 |
| `RUN_ERROR` | 执行出错 | 显示错误信息 |
| `RUN_FINISHED` | Agent 执行完成 | 移除加载状态，检查 `outcome` |

`RUN_STARTED` 和 `RUN_FINISHED`（或 `RUN_ERROR`）是**必须**的，构成 Agent 运行的边界。`RUN_STARTED` 还可携带 `parentRunId`（分支/时间旅行）和 `input`（本次运行的输入 payload）。

`RUN_FINISHED` 的 `outcome` 字段是中断感知生命周期的核心：

- `outcome: { type: "success" }` — 正常完成
- `outcome: { type: "interrupt", interrupts: [...] }` — 暂停等待人工输入
- 省略 `outcome` — 传统生产者，视为正常完成

### 5.5 推理过程可见性

AG-UI 支持将 Agent 的内部推理过程（思维链）通过事件流暴露给前端：

```text
REASONING_START           ← 推理开始
  REASONING_MESSAGE_START     ← 推理消息开始
    REASONING_MESSAGE_CONTENT  ← 逐段推送推理内容
    REASONING_MESSAGE_CONTENT  ← "因此，可以推断..."
  REASONING_MESSAGE_END       ← 推理消息结束
REASONING_END             ← 推理结束
```

推理事件遵循与文本消息相同的 Start-Content-End 模式，前端可以折叠展示或单独显示推理过程。

`REASONING_ENCRYPTED_VALUE` 事件支持加密推理项的跨轮次传递——在 `store:false` 或零数据保留（ZDR）场景下，推理内容可以加密形式在轮次间传递而不暴露原始内容。这与消息的 `encryptedContent` 字段配合使用。

::: warning 旧版 THINKING 事件
早期的 `THINKING_START`、`THINKING_END`、`THINKING_TEXT_MESSAGE_*` 事件已被标记为废弃，将在 1.0.0 版本移除。新项目应使用 `REASONING_*` 系列事件。
:::

### 5.6 人机协同（Human-in-the-Loop）

基于 3.3 节介绍的中断机制，AG-UI 的 HITL 工作流如下：

```text
1. Agent 运行中需要人工介入
2. Agent 发出 RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }
3. 前端根据 interrupts 展示交互 UI（审批对话框、表单等）
4. 用户操作后，前端发起新运行：RunAgentInput { resume: [...] }
5. Agent 收到 resume，从断点继续执行
```

常见场景：

- **工具调用审批**：Agent 提议发送邮件 → 中断等待确认 → 用户批准/拒绝 → Agent 继续/取消
- **结构化输入请求**：Agent 需要用户提供表季报表数据 → 中断并附带 `responseSchema` → 用户填写表单 → Agent 继续
- **参数编辑**：Agent 提议工具调用 → 中断并接受 `editedArgs` → 用户修改参数 → Agent 用修改后的参数执行

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

不要把所有信息都塞进 `TEXT_MESSAGE_CONTENT`。对于结构化数据，优先使用 `STATE_DELTA` 同步状态；对于工具调用进度，使用 `TOOL_CALL_*` 事件；对于推理过程，使用 `REASONING_*` 事件；对于自定义数据，使用 `CUSTOM` 事件。`MESSAGES_SNAPSHOT` 用于页面刷新等需要恢复完整对话历史的场景。

### 8.2 状态同步的粒度控制

`STATE_SNAPSHOT` 只在初始化时发送一次，后续全部使用 `STATE_DELTA`。Delta 的粒度要适中——太细（每个字段变化一条 delta）会增加事件数量，太粗（整个对象一条 delta）会失去增量传输的优势。

### 8.3 Human-in-the-Loop 的边界

不是所有工具调用都需要人工审批。建议只对**不可逆操作**（如删除数据、发送邮件、执行支付）启用中断审批，其他操作让 Agent 自主执行，避免过度打断用户体验。同时注意：

- 恢复（resume）必须覆盖**所有**开放中断，不支持部分恢复
- 如果中断声明了 `responseSchema`，前端必须校验用户输入
- 善用 `approveWithEdits` 能力，让用户可以修改工具参数而非只能批准/拒绝
- 过期的中断（`expiresAt`）不应尝试恢复，应重新发起运行

### 8.4 错误处理

始终监听 `RUN_ERROR` 事件。Agent 执行可能因为 LLM 超时、工具异常、上下文溢出、中断过期等原因失败，前端需要提供友好的错误提示和重试机制。

### 8.5 能力声明与降级

前端应根据 Agent 的 `Capabilities` 做特性开关。如果 Agent 未声明 `interrupts: true`，不应启用中断恢复流程；如果未声明 `reasoning`，不应显示推理面板。`custom` 字段可以携带框架特定的能力信息。

### 8.6 传输层选择

- 默认用 SSE：简单可靠，适合大多数场景
- 需要频繁前端→Agent 交互时用 WebSocket
- 已有 GraphQL 基础设施时用 GraphQL Subscriptions

---

## 总结

AG-UI 填补了 Agent 协议栈的最后一块空白——Agent 与用户之间的交互层。它的核心价值在于：

- **标准化**：统一了 Agent 与前端的通信方式，消除框架适配成本
- **事件驱动**：基于事件流的架构天然支持流式输出和实时交互
- **双向通信**：`RunAgentInput` 携带完整上下文发往 Agent，事件流推送结果回前端
- **中断感知**：通过 `RUN_FINISHED` 的 `outcome: interrupt` 机制实现可靠的人机协同
- **能力声明**：Agent 运行时声明能力，前端按需启用功能
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
