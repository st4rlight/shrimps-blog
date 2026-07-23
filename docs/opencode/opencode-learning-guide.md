---
title: OpenCode 源码学习路径 — Coding Agent 设计思路全解析
tags:
  - OpenCode
  - AI编程工具
  - 源码分析
  - Effect框架
excerpt: 从零开始，逐层拆解 OpenCode 的架构设计、核心循环、工具系统与会话管理——不仅告诉你"源码是什么"，更讲清楚"为什么这样设计、设计者在思考什么、做了哪些取舍"。
createTime: 2026/07/23 10:00:00
permalink: /opencode/opencode-learning-guide/
---

# OpenCode 源码学习路径 — Coding Agent 设计思路全解析

> 源码分析版本：opencode v1.18 · 核心仓库：`github.com/anomalyco/opencode` · 运行时：Bun + TypeScript · 框架：Effect · Monorepo：30+ packages

从零开始，逐层拆解 OpenCode 的架构设计、核心循环、工具系统与会话管理——不仅告诉你"源码是什么"，更讲清楚"为什么这样设计、设计者在思考什么、做了哪些取舍"。

---

## 1. 架构全景与 Monorepo 结构

在深入任何一行代码之前，先搞清楚整个仓库的骨架——哪些包做什么、谁依赖谁、数据从哪里流到哪里。

> **设计理念：为什么要这样分层？**
>
> **解决什么问题：** Coding Agent 涉及类型定义、领域逻辑、HTTP API、终端 UI、桌面 UI 等多种关注点。如果不分层，所有代码混在一起，改一处影响全局，测试困难，复用不可能。
>
> **核心思考：** OpenCode 的设计者把整个系统分成五层：`Schema → Core → Protocol → Server → Client`。这条规则写在 `AGENTS.md` 中——"Schema 到 Core/Protocol 单向依赖，Client 可以依赖 Schema/Protocol 但绝不依赖 Core/Server"。
>
> **这样做的目的：** Schema 是纯类型定义，不包含任何逻辑——它可以被 Client SDK 引用而不拉入服务器代码。Protocol 是 API 契约——修改后可以自动重新生成 Client。Core 是领域逻辑——可以被 Server 复用但不暴露给外部。这种分层让每个包都有明确的职责边界。
>
> | 替代方案：单包应用 | 当前方案：严格分层 |
> |---|---|
> | 所有代码在一个包里，import 随意。好处是简单。坏处是 Client SDK 会包含 Server 逻辑，发布包体积膨胀；改一个类型可能引发全局编译错误；无法独立测试某一层。 | 更多包 = 更多 import 复杂度。但换来的是：Client SDK 干净（不含服务端逻辑）、可独立发布、可独立测试、改 Schema 时编译器会精确报错影响范围。 |
>
> **为什么用 Effect 框架而不是纯 OOP：** Effect 的 `Context.Service` 模式让依赖关系在类型层面可见。`Layer.effect` 的泛型参数列出所有依赖的 Service，编译器会确保它们都被正确提供。这让整个系统的依赖图是自文档化的。测试时可以替换任意 Layer，多个实例可以共存（`InstanceState` 支持 per-directory 的服务实例隔离）。

### 1.1 架构分层图

![OpenCode 五层架构与依赖方向](/opencode/opencode-learning-guide/opencode-architecture-overview.svg)

### 1.2 Effect Service 模式 — 项目骨架的基石

OpenCode 几乎每个子系统都是一个 Effect `Context.Service`。以 Agent Service 为例（`packages/opencode/src/agent/agent.ts`）：

```typescript
// 1. 定义 Interface — 声明这个 Service 能做什么
export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
}

// 2. 创建 Service 标识符
export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

// 3. 用 Layer 提供具体实现 — 依赖通过 yield* 注入
const layer = Layer.effect(Service, Effect.gen(function* () {
  const config = yield* Config.Service    // 依赖 Config
  const auth = yield* Auth.Service         // 依赖 Auth
  // ...返回 Interface 的实现
}))
```

> **为什么选 Effect 而不是纯 OOP？**
>
> 传统 OOP 用 class 继承和构造函数注入依赖。问题是：依赖关系不透明——你不知道一个 Service 依赖什么直到运行时报错；全局单例难以测试——mock 一个全局对象容易引发竞态；多实例共存困难——全局单例意味着所有项目目录共享同一个 Agent 实例。
>
> Effect 的 Service 模式更接近"能力注入"（capability injection）。每个 Service 只声明它需要什么能力，不关心谁提供。Layer 系统在编译期就确定了依赖图，运行时自动解析。测试可以替换任意 Layer。多个实例通过 `InstanceState` 的 `ScopedCache` 以目录为 key 隔离——每个项目目录有独立的 Service 实例。

### 1.3 核心目录树

```
packages/
├── schema/src/           # 领域类型定义层
├── core/src/             # 领域逻辑层
├── llm/src/              # LLM 抽象层
├── protocol/src/         # HTTP API 契约
├── server/src/           # 服务器实现
├── client/src/           # 自动生成 SDK
└── opencode/src/         # 主应用
    ├── cli/  agent/  session/  tool/  server/  ...
```

---

## 2. Schema 层 — 类型契约与运行时校验

Schema 层是整个项目的类型契约——它不依赖任何其他包，但被所有人依赖。理解 Schema 层就理解了 OpenCode 的"数据长什么样"。

> **设计理念：为什么需要独立的 Schema 层？**
>
> **解决什么问题：** Coding Agent 需要在 LLM、数据库、HTTP API、终端 UI 之间传递复杂的数据结构（消息、工具调用、权限规则等）。如果类型只在 TypeScript 层定义，运行时无法校验——LLM 返回的 JSON 可能缺字段、类型错，直接用会崩溃。
>
> **核心思考：** Effect Schema 让类型定义**同时用于编译期类型推导和运行时校验**。一个 Schema 既是 TypeScript 类型，也是运行时 Decoder。这意味着 LLM 返回的 JSON 数据、数据库读出的行、HTTP 请求的 body，都可以用同一个 Schema 校验。不需要写两套——一套给 TypeScript，一套给运行时。
>
> **为什么不用 Zod：** Effect Schema 与 Effect 框架深度集成——`Schema.decodeUnknownEffect` 返回 `Effect` 类型，可以自然地嵌入 Effect 的错误处理和追踪系统。Zod 是同步的，需要手动包装成 Effect。此外 Effect Schema 的 `.annotate()` 可以附加元数据（如 description），这些元数据被提取成 JSON Schema 传给 LLM——一套定义，三种用途。

### 2.1 Part 模型 — 消息的多部件设计

OpenCode 不直接使用 OpenAI 的 `{ role, content }` 消息格式，而是自建了 **Part 模型**：一条 Message 包含多个 Part，每个 Part 有 `type` 字段决定结构：

```typescript
type Part =
  | { type: "text", text: string, synthetic?: boolean }
  | { type: "tool", tool: string, callID: string,
      state: { status: "pending"|"running"|"completed"|"error", ... } }
  | { type: "reasoning", text: string, metadata?: unknown }
  | { type: "file", url: string, mime: string }
  | { type: "step-start" | "step-finish" | "patch" }
```

> **为什么不用 OpenAI 的 flat message 格式？**
>
> **设计目的：** OpenAI 的格式假设消息只有 text 和 tool_call 两种内容。但 OpenCode 需要表达更丰富的信息：推理过程（reasoning）、文件附件、步骤标记（step-start/finish）、代码补丁。flat 数组无法表达"一条 assistant 消息同时包含推理、文本和两个工具调用"这种结构。
>
> **synthetic 标记的设计目的：** 当用户在消息中附上一个文件时，系统会用 Read 工具读取文件内容并生成一段 synthetic text part。这个 `synthetic: true` 标记让 UI 可以区分"用户真的写了这段话"还是"系统自动生成的上下文"。在上下文压缩（compaction）时，synthetic parts 可以被安全地丢弃——它们只是文件内容的副本。
>
> **工具状态机的设计目的：** `pending → running → completed/error` 的状态转换不是装饰——它是**崩溃恢复**的基础。LLM 的 tool-call 事件先创建 pending Part，参数到达后变 running，执行完成后变 completed。如果进程在 running 状态崩溃，恢复时数据库里留有这条记录——系统知道"这个工具执行到一半"，可以选择重试或报告失败。没有状态机，就无法区分"工具已执行"和"工具正在执行"。

---

## 3. 入口与 CLI 命令分发

用户输入 `opencode` 后发生了什么？从入口文件到 Server 启动的完整链路。

> **设计理念：多入口点架构**
>
> **解决什么问题：** 同一个 Coding Agent 引擎需要以不同形态运行——在终端里是 TUI 交互式界面、给桌面 App 提供 HTTP API、作为 IDE 插件的后端、甚至作为 MCP Server 暴露给其他 AI 工具。如果每种形态写一个独立入口，代码会大量重复。
>
> **核心思考：** OpenCode 的设计者让所有形态共享同一个 Server 引擎，不同的只是前端：`run` 命令启动 Server + TUI 线程；`serve` 只启动 Server；`acp` 作为 ACP 服务端；`mcp` 以 MCP Server 模式运行。这意味着**无论从哪个入口进入，Agent 的行为是一致的**——因为核心循环、工具系统、权限系统都是同一套代码。
>
> **为什么 `process.exit()` 是必要的：** 源码注释写道："Some subprocesses don't react properly to SIGTERM... most notably, some docker-container-based MCP servers don't handle such signals unless run using docker run --init." MCP Server 可能运行在 Docker 容器中，这些容器不处理 SIGTERM。如果不显式 exit，进程会因为子进程挂起而永远不退出。

### 3.1 命令分发流程

1. **用户输入 `opencode`** — Bun 执行 `bin/opencode` → 加载 `src/index.ts`
2. **Yargs 全局中间件** — 设置 `AGENT=1`、`OPENCODE=1` 环境变量，启动 Heap 监控
3. **Bootstrap 初始化** — 加载配置、初始化项目上下文、构建 Effect Runtime
4. **RunCommand 执行** — 启动 HTTP Server → 启动 TUI 线程 → TUI 通过 WebSocket 连接 Server

### 3.2 主要命令

| 源码路径 | 命令 | 说明 |
|---------|------|------|
| `cli/cmd/run.ts` | `run`（默认） | 启动 Server 和 TUI 线程，进入交互式编码会话 |
| `cli/cmd/serve.ts` | `serve` | 仅启动 HTTP Server，不启动 TUI。用于被 App/Desktop 连接 |
| `cli/cmd/acp.ts` | `acp` | ACP 模式——作为 IDE 的 Agent 后端 |
| `cli/cmd/agent.ts` | `agent` | 非交互模式——直接传 prompt，输出后退出。适合 CI/CD |
| `cli/cmd/mcp.ts` | `mcp` | 以 MCP Server 模式运行，将工具暴露给其他 AI |

---

## 4. Agent 系统 — 角色、权限与提示词策略

Coding Agent 不是单一的 LLM 调用——它是一个有角色、有权限、有工具集、有提示词策略的复合体。

> **设计理念：Agent 是可组合的身份**
>
> **解决什么问题：** 不同的任务需要不同的 Agent 行为——开发时需要全权限，分析代码时应该只读，复杂搜索需要委托给子 Agent。如果每种场景写一个完整的 agent 实现，代码会大量重复。
>
> **核心思考：** 设计者把"Agent"拆成了六个可组合的维度：**名字与模式**（primary 还是 subagent）、**权限规则**（allow/deny/ask）、**模型与参数**（哪个 LLM、什么 temperature）、**提示词**（system prompt）、**步数限制**（防死循环）、**工具集**（通过权限隐式控制）。想加一个"测试 Agent"？定义一个只允许 `read` 和 `shell` 工具的 Agent 就行——不需要写新代码，只需要写配置。

### 4.1 Agent 定义结构

```typescript
export const Info = Schema.Struct({
  name: Schema.String,
  mode: Schema.Literals(["subagent", "primary", "all"]),
  permission: PermissionV1.Ruleset,  // 权限规则集
  model: Schema.optional(Schema.Struct({ modelID, providerID })),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),  // 最大步数
})
```

### 4.2 权限系统 — 安全的基石

权限系统在 `permission/index.ts` 中。核心是模式匹配引擎：

```typescript
export function evaluate(permission, pattern, ...rulesets) {
  return rulesets.flat()
    .findLast(rule => Wildcard.match(permission, rule.permission)
                   && Wildcard.match(pattern, rule.pattern))
    ?? { action: "ask", permission, pattern: "*" }
}
```

> **三个关键设计决策：**
>
> **1. 为什么用 `findLast` 而不是 `findFirst`？**
>
> 后定义的规则优先级更高。这让规则可以**叠加覆盖**：Agent 定义基础权限（如 `"*": "allow"`），Session 可以叠加更严格的规则（如 `"edit": "ask"`），用户在会话中可以临时覆盖。如果是 `findFirst`，先定义的规则就锁死了，无法被更具体的场景覆盖。
>
> **2. 为什么默认 action 是 `"ask"` 而不是 `"allow"`？**
>
> 安全优先。如果没有任何规则匹配，最安全的选择是问用户。`"allow"` 方便但危险——一个未配置的工具可能静默执行危险操作。`"deny"` 安全但令人沮丧——用户不知道为什么不工作。`"ask"` 是平衡点：不静默执行，但也不直接拒绝，让用户有机会做决策。
>
> **3. `"ask"` 的实现机制：**
>
> 权限系统创建一个 Effect `Deferred`——本质是一个异步 Promise。通过事件系统向 UI 发送询问请求，然后**阻塞等待**用户回复。用户选择"允许"/"拒绝"/"总是允许"后，`reply()` 方法解决 Deferred。"总是允许"的回复会追加到 `approved` 列表，后续相同模式不再询问——这是 UX 优化，避免重复打扰。

### 4.3 Per-Model 提示词策略

在 `session/system.ts` 中：

```typescript
export function provider(model: Provider.Model) {
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.includes("gpt-4")) return [PROMPT_BEAST]
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  return [PROMPT_DEFAULT]
}
```

> **为什么不用统一的 system prompt？**
>
> 不同模型的"脾气"完全不同。Claude 对 XML 标签的响应很好（`<env>...</env>`），GPT 系列偏好更直接的指令格式，Gemini 有自己的格式偏好。写一个"万能 prompt"意味着取最低公约数——对每个模型都不是最优的。
>
> 务实的做法：针对每个模型族写专用 prompt。虽然维护成本高（改一个 prompt 要改多份），但每个模型都能得到最适合它的指令格式。这是**正确性优于简洁性**的设计选择。

### 4.4 Agent 的六个维度

![Agent 的六个可组合维度](/opencode/opencode-learning-guide/opencode-agent-dimensions.svg)

### 4.5 内置 Agent

| 模式 | 名称 | 说明 |
|------|------|------|
| `primary` | **build**（默认） | 全权限开发 Agent。`permission: { "*": "allow" }`。可读写文件、执行 shell、运行任意工具 |
| `primary` | **plan**（只读） | 只读分析 Agent。`edit: deny, write: deny, bash: ask`。适合探索陌生代码库、规划变更 |
| `subagent` | **general**（子 Agent） | 通用子 Agent，通过 task 工具调用。运行在独立子会话中 |

---

## 5. 工具系统 — 定义、注册与执行

工具是 Agent 的手和眼。工具系统的设计决定了 Agent 能做什么、能做多安全、出错时能否自修正。

> **设计理念：自修正的工具执行**
>
> **解决什么问题：** LLM 会犯错——传错参数、漏字段、类型不对。如果工具执行时遇到非法参数就崩溃，Agent 会卡住。用户不得不手动干预。
>
> **核心思考：** 工具参数用 Effect Schema 定义。LLM 返回的 JSON 先过 Schema Decoder——如果校验失败，不崩溃，而是抛出 `InvalidArgumentsError`，其 `message` 属性是一段人类可读的错误说明：**"The read tool was called with invalid arguments: filePath is required. Please rewrite the input so it satisfies the expected schema."** 这段文字会被返回给 LLM 作为工具结果——LLM 看到错误说明后会重新调用工具，这次用正确的参数。
>
> **这是一个自修正闭环：** LLM 调用 → Schema 校验 → 失败 → 错误说明返回给 LLM → LLM 修正参数 → 重新调用 → 成功。不需要任何特殊重试逻辑——错误就是工具的输出，LLM 自然会看到并修正。
>
> | 替代方案：报错终止 | 当前方案：错误即反馈 |
> |---|---|
> | 参数校验失败 → 抛异常 → 循环中断 → 用户看到错误。用户需要手动重新输入消息。体验差。 | 参数校验失败 → 错误说明返回给 LLM → LLM 自动修正 → 重新调用。用户无感知。体验好。 |

### 5.1 工具定义与执行包装

每个工具由 `Def` 接口定义（`tool/tool.ts`），`wrap()` 函数在 `execute` 外层包了三件事：

```typescript
toolInfo.execute = (args, ctx) => Effect.gen(function* () {
  // 1. Schema 校验 — LLM 传的参数先过 Decoder
  const decoded = yield* decode(args).pipe(
    Effect.mapError(error => new InvalidArgumentsError({
      tool: id, detail: String(error),  // ← 这段文字会返回给 LLM
    })),
  )
  // 2. 执行原始逻辑
  const result = yield* execute(decoded, ctx)
  // 3. 输出截断 — 超长输出写入临时文件，只返回摘要
  const truncated = yield* truncate.output(result.output, {}, agent)
  return { ...result, output: truncated.content,
    metadata: { ...result.metadata, truncated: truncated.truncated } }
})
```

> **三个设计决策的理由：**
>
> **1. 为什么权限检查在工具内部（`ctx.ask()`）而不是外层拦截？**
>
> 工具自己最清楚它需要什么权限——`edit` 工具需要文件路径权限，`shell` 工具需要命令文本权限。如果在外层拦截，外层需要知道每个工具的权限语义，违反了关注点分离。在工具内部调用 `ctx.ask({ permission: "edit", patterns: [filePath] })` 让权限检查与工具逻辑紧密结合。
>
> **2. 为什么输出要截断？**
>
> LLM 的上下文窗口有限。一个 100KB 的文件读取如果全量返回，会迅速占满上下文。截断逻辑把超长输出写入临时文件，只返回前面一部分内容加一个 `outputPath`——LLM 如果需要更多内容，可以用 Read 工具按 `offset` 和 `limit` 分段读取。
>
> **3. 为什么 Schema 用 Effect Schema 而不是 JSON Schema？**
>
> Effect Schema 的 `.annotate({ description: "..." })` 注解会被提取成 JSON Schema 传给 LLM——一套定义，编译期给 TypeScript 用，运行时给校验用，提取后给 LLM 用。JSON Schema 只是其中一种输出格式。

### 5.2 ToolRegistry — 工具的收集与过滤

工具来自三个来源：**内置工具**（直接 import，如 ReadTool、EditTool）、**MCP 工具**（从 MCP Server 动态发现）、**Plugin 工具**（通过 `plugin.trigger("tool")` 钩子注入）。`tools(model)` 方法根据 Agent 权限和模型能力过滤可用工具。

### 5.3 关键内置工具

**read**（`tool/read.ts`）

参数：`filePath`、`offset`（行号）、`limit`。限制：`DEFAULT_READ_LIMIT = 2000` 行、`MAX_LINE_LENGTH = 2000` 字符截断、`MAX_BYTES = 50KB`。文件不存在时用 fuzzysort 在同目录找相似文件名提示。支持图片检测和 LSP 符号跳转。

**edit**（`tool/edit.ts`）

search-and-replace 编辑。核心流程：读取文件 → 执行替换 → 生成 diff → **调用 `ctx.ask()` 请求用户确认** → 写入文件 → 格式化 → 触发 LSP 诊断。LSP 诊断结果写入 metadata——如果编辑引入了语法错误，LLM 会通过 metadata 看到诊断信息并自行修正。

**task**（`tool/task.ts`）

启动子 Agent 会话。创建子 Session，调用 `SessionPrompt.prompt()` 在子会话中执行，结果以 XML 格式返回。支持 `background` 后台模式和 `task_id` 恢复已有任务。

---

## 6. 核心循环 — Agent Loop 深度剖析

这是整个项目最核心的部分——当用户发送一条消息后，系统如何跑完一轮"LLM 思考 → 调用工具 → 继续思考"的完整循环。

> **设计理念：为什么是 while(true) 循环？**
>
> **解决什么问题：** Agent 的"智能"不在于单次 LLM 调用——而在于**自修正闭环**：LLM 输出工具调用 → 执行工具 → 结果返回给 LLM → LLM 继续推理 → 可能再次调用工具 → ……直到 LLM 不再需要工具，输出最终回答。
>
> **为什么用 `while(true)` 而不是递归？** 两个原因：**1. 栈安全**——如果 Agent 做了 50 步工具调用（完全可能），递归会栈溢出。`while(true)` 让每轮的上下文独立，不累积调用栈。**2. 可中断性**——循环可以在任意位置被 `AbortSignal` 中断，用户按 ESC 取消时，Effect 的中断机制会干净地清理所有进行中的工具调用。
>
> **为什么每轮都重新加载消息历史？** 循环顶部 `msgs = yield* MessageV2.filterCompactedEffect(sessionID)` 从数据库重新加载。原因是：用户可能在 Agent 思考时发了一条新消息（steering）——这条消息需要被纳入下一轮的上下文。如果用内存中的旧 `msgs`，用户的消息会被忽略。

### 6.1 循环全景图

![Agent 核心循环](/opencode/opencode-learning-guide/opencode-agent-loop.svg)

### 6.2 runLoop() — 核心循环源码（简化版）

```typescript
const runLoop = Effect.fn("SessionPrompt.run")(function* (sessionID) {
  let step = 0
  while (true) {
    yield* status.set(sessionID, { type: "busy" })

    // ★ 1. 重新加载消息历史（为什么不用内存中的？见下文）
    let msgs = yield* MessageV2.filterCompactedEffect(sessionID)
    const { user: lastUser, assistant: lastAssistant, tasks } = MessageV2.latest(msgs)

    // ★ 2. 检查是否应退出循环
    const hasToolCalls = lastAssistant?.parts.some(
      p => p.type === "tool" && !p.metadata?.providerExecuted
    ) ?? false
    if (lastAssistant?.finish && !["tool-calls"].includes(lastAssistant.finish)
        && !hasToolCalls) break

    step++
    const model = yield* getModel(lastUser.model.providerID, ...)

    // ★ 3. 处理 subtask（task 工具触发的子 Agent）
    if (task?.type === "subtask") { yield* handleSubtask(...); continue }

    // ★ 4. 处理 compaction（上下文压缩）
    if (task?.type === "compaction") { ... continue }

    // ★ 5. 检查 token 溢出 → 自动压缩
    if (yield* compaction.isOverflow({ tokens, model })) {
      yield* compaction.create({ sessionID, auto: true }); continue
    }

    // ★ 6. 获取 Agent，检查步数限制
    const agent = yield* agents.get(lastUser.agent)
    const isLastStep = step >= (agent.steps ?? Infinity)

    // ★ 7. 组装上下文 + 创建 AssistantMessage + 解析工具
    const tools = yield* SessionTools.resolve({ agent, session, model, ... })
    const [skills, env, instructions, mcpInstr, modelMsgs] = yield* Effect.all([...])
    const system = [...env, ...instructions, ...mcpInstr, ...skills]

    // ★ 8. 调用 LLM + 处理事件流
    const result = yield* handle.process({
      user: lastUser, agent, system, messages: modelMsgs, tools, model,
      ...(isLastStep ? { messages: [...modelMsgs, MAX_STEPS_PROMPT] } : {}),
    })

    // ★ 9. 判断结果
    if (result === "stop") break
    if (result === "compact") yield* compaction.create({ sessionID, auto: true })
    // continue → 回到 while(true) 顶部
  }
})
```

### 6.3 SessionProcessor — 事件消费器

`processor.ts` 中的 `handleEvent()` 消费所有 LLM 事件：

```typescript
switch (value.type) {
  case "text-delta":       // 追加文本（增量写入 DB！）
  case "tool-call":       // 更新工具状态 → running
    // ★ DOOM LOOP 检测
    const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD) // = 3
    if (recentParts.length === 3 &&
        recentParts.every(p => p.tool === value.name
          && JSON.stringify(p.state.input) === JSON.stringify(input))) {
      yield* permission.ask({ permission: "doom_loop", ... })
    }
  case "tool-result":      // 完成工具调用
  case "reasoning-delta":  // 追加推理（增量写入 DB）
  case "step-finish":      // 记录 usage/cost，生成 patch
}
```

> **五个关键设计决策的理由：**
>
> **1. 为什么增量写入数据库（text-delta 每次都写 DB）？**
>
> 崩溃恢复。如果进程在 LLM 输出到一半时崩溃，用户不应该丢失已有内容。每个 text-delta 都立即写入数据库——即使中途崩溃，已输出的文本不会丢失。代价是数据库写入频繁，但 SQLite 的 WAL 模式让增量写入非常快。
>
> **2. 为什么 Doom Loop 阈值是 3？**
>
> 一次重复可能是合法重试（工具因网络错误失败后重试）。两次重复可能是 LLM 在尝试变体。连续三次完全相同的工具调用（相同 tool name + 相同 input）几乎确定是死循环——LLM 困在了一个模式里。阈值 3 是经验值，平衡误报和漏报。触发后不是直接终止，而是通过权限系统询问用户是否继续——给用户决策权。
>
> **3. 为什么 Compaction 用小模型而不是主模型？**
>
> 两个原因：**成本**——总结不需要 Claude Opus 级别的推理能力，用小模型（如 Haiku）便宜很多。**token 效率**——总结的目的是释放上下文空间，如果用主模型生成总结，总结本身也占空间。小模型的输出通常更简洁。关键参数：`PRUNE_MINIMUM = 20000`（压缩阈值 token 数）、`DEFAULT_TAIL_TURNS = 2`（保留最近 2 轮完整对话）、`TOOL_OUTPUT_MAX_CHARS = 2000`（工具输出压缩后最大字符数）。
>
> **4. 为什么 `isLastStep` 时追加 `MAX_STEPS_PROMPT` 而不是直接停止？**
>
> 给 LLM 一个"收尾"的机会。直接停止意味着 LLM 可能输出到一半被切断——用户看到的是不完整的回答。追加 `MAX_STEPS_PROMPT`（如"你即将达到步数上限，请总结当前进度并给出下一步建议"）让 LLM 有意识地收尾，输出一个有意义的结束。同时 `toolChoice` 在最后一步被设为 `"none"`——禁止再调工具，确保这真的是最后一步。
>
> **5. 为什么 V1→V2 要把 prompt 和 execution 分离？**
>
> V1 的循环是**内存态**的——`SessionPrompt.prompt()` 直接进入 `runLoop()`，如果进程死亡，循环就丢失了。V2 的设计是：`SessionV2.prompt()` 先写入一条 durable `session_input` 数据库行，然后调度 `SessionExecution.wake(sessionID)` 异步执行。这意味着**即使进程崩溃，用户的消息也不会丢失**——重启后可以从数据库恢复未完成的执行。这是从"单进程工具"到"可恢复 Agent"的关键演进。`SessionRunCoordinator` 使用 `Deferred` + `pendingWake` 机制：同一个 Session 的多个 resume 请求会合并（join），不同 Session 可以并发执行。

---

## 7. LLM 与 Provider 层

OpenCode 不绑死单一 LLM——它支持 15+ 个 Provider。理解这两层就理解了"如何让同一个 Agent 用不同的模型"。

> **设计理念：模型不可知 + 双路径**
>
> **解决什么问题：** 用户可能用 Anthropic、OpenAI、Google 或自建端点。如果绑死一个 provider，用户受限；但支持 15+ 个 provider 的 API 差异巨大，维护成本高。
>
> **核心思考：** OpenCode 的设计者选择了**双路径**架构：**AI SDK 路径**用 Vercel 的 `streamText()`——它已经抽象了多个 provider 的差异，开箱即用。但有时候 AI SDK 不支持某些 provider 的新特性（如 OpenAI Responses API 的某些功能），这时候需要**原生协议路径**——直接实现 HTTP 请求，绕过 AI SDK 获得更细粒度的控制。
>
> **为什么 Provider SDK 用动态 import？** 启动性能。`BUNDLED_PROVIDERS` 字典里列了 15+ 个 `@ai-sdk/*` 包。如果全部静态 import，冷启动会加载所有 provider SDK——即使用户只用其中一个。动态 import 只在首次使用某个 provider 时加载对应包，减少启动时间。这正是 AGENTS.md 中"Prefer dynamic imports for heavy modules that are only needed in selected code paths"规则的实践。
>
> **为什么需要 ProviderTransform？** 不同模型对工具 schema 的支持不同。有些支持 `format: "enum"`，有些不支持；有些支持 `$schema` 字段，有些会报错。ProviderTransform 在发送前根据模型能力转换 schema——对不支持的特性降级（如 enum 降级为字符串 + description 描述可选值）。这让工具定义不需要为每个模型写不同版本。

### 7.1 LLM Service 接口

```typescript
export type StreamInput = {
  model: Provider.Model       // 哪个模型
  agent: Agent.Info           // 哪个 Agent
  system: string[]            // system prompts
  messages: ModelMessage[]    // 对话历史
  tools: Record<string, Tool>  // 可用工具
  toolChoice?: "auto" | "required" | "none"
}
export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent>
}
```

### 7.2 Provider 动态加载

```typescript
const BUNDLED_PROVIDERS = {
  "@ai-sdk/anthropic":      () => import("@ai-sdk/anthropic").then(m => m.createAnthropic),
  "@ai-sdk/openai":         () => import("@ai-sdk/openai").then(m => m.createOpenAI),
  "@ai-sdk/google":         () => import("@ai-sdk/google").then(m => m.createGoogleGenerativeAI),
  // ... 15+ providers
}
```

---

## 8. Plugin 与 MCP 生态

三层扩展体系：Provider 解决"用哪个模型"，Plugin 解决"认证和业务钩子"，MCP 解决"工具的跨平台复用"。

> **设计理念：三层扩展各司其职**
>
> **解决什么问题：** 不同用户有不同的扩展需求——有的需要自定义认证流程（如公司内部 OAuth），有的需要注入额外工具（如查内部知识库），有的需要复用已有的 MCP 工具生态。如果把这些都塞进核心代码，核心会膨胀。
>
> **核心思考：** 三个扩展点各解决一类问题：**Provider** 层解决"用哪个模型"——通过配置声明；**Plugin** 层解决"业务逻辑钩子"——通过 Hooks 接口在关键路径注入逻辑；**MCP** 层解决"工具复用"——通过标准协议连接外部工具服务器。三层互相独立——你可以用 Anthropic Provider + GitHub Copilot Auth Plugin + 外部 MCP 工具，组合完全自由。
>
> **为什么 Plugin 用 `(input, output) => Promise<void>` 模式而不是纯函数？** Plugin 需要能**修改** output——比如 `chat.message` 钩子可以在消息发送前追加上下文。纯函数（`input => output`）意味着每次都要返回完整的 output 对象，对复杂结构来说不方便。可变 output 模式让插件只修改它关心的部分，其余保持不变。
>
> **为什么内置插件主要是认证类？** 认证是最高频的扩展点——每个 provider 有不同的认证流程（OAuth、API Key、Bearer Token...）。把认证做成插件意味着可以独立更新认证逻辑而不需要改核心代码。如果 GitHub Copilot 的 OAuth 流程变了，只需要更新 `CopilotAuthPlugin`，不需要重新发布整个 opencode。

### 8.1 Plugin 钩子

```typescript
export interface Interface {
  readonly trigger: <Name>(name: Name, input: Input, output: Output) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly init: () => Effect.Effect<void>
}
```

常见钩子：`tool.execute.before/after`、`chat.message`、`shell.env`、`experimental.text.complete`。

### 8.2 MCP 集成

支持三种传输：`StdioClientTransport`（本地进程）、`StreamableHTTPClientTransport`（HTTP 流）、`SSEClientTransport`（SSE）。MCP 工具动态注册到 ToolRegistry，和内置工具一起暴露给 LLM。还实现了 MCP OAuth 认证流。

---

## 9. Server 与通信架构

Server-Client 分离架构让一个 Server 可以被多个 UI 客户端同时连接。

> **设计理念：一个引擎，多个界面**
>
> **解决什么问题：** 用户可能在终端用 TUI、在桌面用 App、在 IDE 用插件——这些界面应该看到**同一个** Agent 会话的实时状态。如果每个界面各自运行一个 Agent 实例，状态会不一致。
>
> **核心思考：** Server-Client 分离。Server 运行 Agent 引擎（Session、Loop、Tool 等），Client（TUI/App/IDE）通过 WebSocket 连接 Server，订阅事件流。所有客户端看到的是同一个 Session 的实时状态——TUI 里用户发消息，App 里也能看到；IDE 里 Agent 调用工具，TUI 里也能看到 diff。
>
> **为什么用 WebSocket 而不是 HTTP polling？** LLM 输出是**流式**的——文本一个字一个字出现。Polling 意味着客户端每隔 N 毫秒问一次"有新内容吗？"——延迟高、请求多。WebSocket 是服务端主动推送——每个 text-delta 事件实时推到所有连接的客户端，延迟接近零。
>
> **为什么 Protocol 层用 Effect HttpApi？** Effect 的 `HttpApi` 让 API 定义是**类型安全**的——每个路由的请求和响应都有 Schema 定义，编译器会检查 handler 返回的数据是否匹配。更重要的是，`HttpApi` 可以自动生成 OpenAPI 文档和 Client SDK——修改 Protocol 后运行 `bun run generate` 就能重新生成 Client，不需要手写。这就是为什么 `AGENTS.md` 说"After changing the public Protocol or Server HttpApi, run bun run generate from packages/client"。
>
> **为什么需要 Location 中间件？** 一个 Server 可能同时管理多个项目目录。每个 API 请求需要知道"你在哪个目录操作"。Location 中间件通过 HTTP header 注入 `InstanceRef`，然后 `InstanceState` 的 `ScopedCache` 以目录为 key 提供对应的 Service 实例。这就是多目录隔离的 HTTP 层实现。

### 9.1 Event 系统

重要操作都发事件，通过 WebSocket 实时推送：`session.prompt`、`session.assistant.text`、`session.assistant.tool`、`session.tool.result`、`permission.asked` 等。

---

## 10. 配置系统与多目录隔离

配置系统驱动 Agent 行为，多目录隔离让一个 Server 管理多个项目。

> **设计理念：分层配置 + 目录级隔离**
>
> **解决什么问题：** 用户有全局偏好（API Key），项目有特定需求（自定义 Agent、MCP Server），团队有共享配置（权限规则）。如果只有一个配置文件，这些需求互相冲突。
>
> **核心思考 — 分层配置：** 配置从三个来源加载并合并：全局 `~/.config/opencode/opencode.json`（API Key、通用偏好）→ 项目 `.opencode/opencode.json`（Agent、MCP、权限）→ 远程 URL（团队共享）。`mergeConfigConcatArrays()` 深合并，数组字段**拼接**而非覆盖——`instructions` 字段在多个配置中声明会被合并去重。这让"全局 + 项目 + 团队"的配置自然叠加。
>
> **核心思考 — 目录级隔离（InstanceState）：** 一个 Server 管理多个项目。每个项目需要独立的 Permission 状态（A 项目允许的 shell 命令 B 项目可能不允许）、独立的 Agent 实例、独立的 Tool 配置。`InstanceState` 用 Effect 的 `ScopedCache` 以**目录路径**为 key 缓存 Service 实例：`ScopedCache.get(self.cache, yield* directory)`。当切换到另一个目录时，自动获取该目录的 Service 实例——如果不存在，用 `init(ctx)` 函数创建。当目录被 dispose 时，`registerDisposer` 注册的清理函数会清理对应实例。
>
> **这不是全局单例能做到的。** 全局单例意味着所有项目共享同一个 Permission Map——A 项目的"总是允许"会泄漏到 B 项目。InstanceState 让每个项目有自己的独立状态空间。

### 10.1 配置加载流程

1. **全局配置** — `~/.config/opencode/opencode.json` — API Key、通用偏好
2. **项目配置** — `.opencode/opencode.json` — Agent、Provider、MCP、权限
3. **远程配置（可选）** — 从 URL 加载团队共享配置，支持 `${VAR}` 变量替换
4. **合并** — 深合并，数组拼接，`instructions` 去重

### 10.2 InstanceState 源码

```typescript
// 以目录为 key 的 ScopedCache
export const make = (init) => Effect.gen(function* () {
  const cache = yield* ScopedCache.make({
    capacity: Infinity,
    lookup: () => init(yield* context),  // context = 当前目录
  })
  registerDisposer((dir) => ScopedCache.invalidate(cache, dir))
  return { cache }
})

// 获取当前目录的 Service 实例
export const get = (self) => Effect.gen(function* () {
  return yield* ScopedCache.get(self.cache, yield* directory)
})
```

---

## 11. 定制化开发实战指南

学完前面 10 个阶段后，你可以开始定制化开发了。以下是五种最常见的定制场景。

> **定制化开发的底层逻辑**
>
> OpenCode 的所有扩展点都遵循同一个理念：**配置优于代码**。自定义 Agent 不需要写 TS 代码——写 JSON 配置。自定义 Provider 不需要改核心——声明一个 npm 包。自定义工具可以通过 Plugin 钩子注入。这种设计让**非开发者也能定制 Agent 行为**——只要会写 JSON。

### 11.1 添加自定义 Agent

```json
// .opencode/opencode.json
{
  "agent": [{
    "name": "test-runner",
    "description": "只运行测试的 Agent",
    "mode": "primary",
    "permission": { "read": "allow", "bash": "ask", "edit": "deny", "write": "deny" },
    "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-5-20250514" },
    "steps": 10
  }]
}
```

权限规则会被 `Permission.evaluate()` 在每次工具调用时评估。`steps` 限制会通过 `maxSteps` 在 `runLoop()` 中强制执行——到最后一步追加 `MAX_STEPS_PROMPT`。

### 11.2 添加自定义工具

```typescript
import * as Tool from "./tool"
import { Effect, Schema } from "effect"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "搜索查询" }),
})

export const MyTool = Tool.define("my_search", Effect.gen(function* () {
  return {
    description: "搜索内部知识库",
    parameters: Parameters,
    execute: (args, ctx) => Effect.gen(function* () {
      const results = yield* searchKnowledgeBase(args.query)
      return { title: `搜索: ${args.query}`, metadata: { count: results.length },
               output: JSON.stringify(results) }
    }),
  }
}))
```

工具会自动通过 `wrap()` 获得 Schema 校验、输出截断、tracing 能力。在 `tool/registry.ts` 中注册即可。

### 11.3 添加自定义 Provider

```json
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://my-llm.com/v1", "apiKey": "${MY_API_KEY}" },
      "models": { "my-model": { "name": "My Model" } }
    }
  }
}
```

### 11.4 编写 Plugin

```typescript
export default function myPlugin(input) {
  return { hooks: {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "shell") console.log(`Shell: ${output.args.command}`)
    },
    "chat.message": async (input, output) => {
      output.message.parts.push({
        type: "text",
        text: "时间: " + new Date().toISOString(),
        synthetic: true
      })
    },
  }}
}
```

### 11.5 连接 MCP Server

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["node", "/path/to/server.js"],
      "enabled": true
    }
  }
}
```

---

## 总结

> **Coding Agent 设计的五个核心洞察**
>
> 1. **Agent = 角色 + 权限 + 工具集 + 提示词 + 模型参数**。不是单一 LLM 调用，而是可组合的多维度定义。
> 2. **核心循环 = prompt → stream → process → tool → loop**。Agent 的"智能"在于自修正闭环——LLM 调用工具 → 执行 → 结果返回 → LLM 继续推理。
> 3. **Schema 驱动一切**。从工具参数到 API 契约到权限规则，都是 Schema 定义 + 运行时校验。非法输入不崩溃，而是返回错误让 LLM 重新调用。
> 4. **Server-Client 分离 = 多前端支持**。一个 Server 通过 Event 系统同时服务 TUI、App、IDE。
> 5. **三层扩展：Provider / Plugin / MCP**。分别解决模型选择、业务钩子、工具复用，组合自由。
