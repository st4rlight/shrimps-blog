---
title: OpenClaw 架构分层设计深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 从六层架构模型、核心执行链路到关键设计权衡，全面拆解 OpenClaw 的整体架构设计。
createTime: 2026/06/08 09:58:16
permalink: /ai-source/openclaw-architecture-analysis/
---
# OpenClaw 架构分层设计深度解析

> 📖 **阅读顺序：1 / 共 8 篇** · 🟢 入门（30 分钟） · 六层架构全局观
>
> 基于 `openclaw/openclaw` 源码分析，拆解六层架构模型、核心执行链路与关键设计权衡。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| OpenClaw 是什么、不是什么 | §1 一句话定位 |
| 整张架构图长啥样 | §2 六层架构总览 |
| 一条消息怎么从飞书一路走到 LLM 再回来 | §9 一条消息的完整旅程 |
| 6 个最重要的设计权衡 | §10 六个关键设计权衡 |
| 数据存在哪、为什么 | §11 数据存储策略 |
| 跟着哪 5 个文件读源码最快 | §0 读源码路径（先看这里） |

**一句话**：OpenClaw = 一个跑在你机器上的 Gateway 守护进程 + 100+ 插件扩展 + 移动端/桌面端节点，把 IM / 邮件 / 语音 / 屏幕"串"成一个统一的 agent 入口。

---

## 0. 读源码路径

如果你想跟着这份架构深入读代码，按这个顺序最高效：

```
30 分钟快速建立整体感：
  src/entry.ts:109-116              ← isMainModule 守卫，CLI 入口怎么"防误触发"
  src/cli/run-main.ts:651           ← 8 阶段流水线（一个 runCli 函数讲完 CLI 编排）
  src/gateway/server.impl.ts:649    ← startGatewayServer，Gateway 启动的唯一入口
  src/agents/embedded-agent-runner/run.ts:570-633  ← 双重队列（enqueueSession / enqueueGlobal）
  src/context-engine/registry.ts    ← Context Engine 注册表 + 检疫机制

深入某个子系统，按需看：
  src/routing/session-key.ts        ← session key 构造（看清 4 种 dmScope 怎么映射）
  src/plugins/types.ts:2597         ← OpenClawPluginApi（60+ 注册方法都在这）
  src/channels/plugins/types.plugin.ts:66  ← ChannelPlugin 类型（38 个适配器）
  src/node-host/invoke.ts           ← 设备节点命令分发
```

---

## 1. 一句话定位

OpenClaw 是一个 **local-first 的 personal AI assistant 网关**。你安装一个 `openclaw` CLI，它启动一个 Gateway 守护进程，把你日常用的 IM / 邮件 / 语音 / 屏幕 / 编辑器 / 桌面菜单栏"串"成一个 agent 统一入口，并允许你把这个 agent 沙箱化、限权、多端配对。

> **关于 OpenAI Codex 的归属**：在 OpenClaw 当前的实现里，所有 Codex 相关路径都已**合并到 `openai` provider**（`extensions/openai/`），没有独立的 `openai-codex` provider/plugin/auth/model 路由。`openai-codex/*` profile/metadata 只作为历史输入被 doctor 迁移代码识别，运行时只走 `openai` + `openai/*` 的现代路径。下文提到 "codex" 多数指 extensions/codex 下的 OpenAI Codex **app-server harness**（运行容器内的 codex CLI），不是 provider。

三个"不是"：

- **不是 SaaS** — 核心形态是本地 Gateway + 多端 Node，数据留在你的机器上
- **不是 coding IDE** — 内置 coding-agent 等 skill，但与 Claude Code / Cursor / Codex 是能力互补而非直接竞争
- **不是通用框架** — 是一个成品助手，安装完就有 macOS 菜单栏、iOS/Android 伴随 app、30+ 通道、50+ 模型 provider

> 💡 **Takeaway**：用"你是不是想装一个能自己跑、不上传数据、连着 IM 的个人助理"判断——是，就装；不是，去看 Claude Code / Cursor 那些 IDE 形态的。

---

## 2. 六层架构总览

从 `src/` 的 100+ 个直接子目录、`packages/` 的 21 个 SDK/合约包、`extensions/` 的 140+ 扩展中，可以抽象出以下六层结构：

```
┌─────────────────────────────────────────────────┐
│           Layer 6 — Channel & 端侧设备           │
│   src/channels · extensions/{whatsapp,telegram}  │
│   apps/macos · apps/ios · apps/android           │
├─────────────────────────────────────────────────┤
│         Layer 5 — 插件 / 扩展 / Skill             │
│   src/plugins · src/plugin-sdk · extensions/      │
│   packages/plugin-sdk · packages/plugin-package-  │
│   contract · src/skills                           │
├─────────────────────────────────────────────────┤
│       Layer 4 — Context Engine & 记忆             │
│   src/context-engine · extensions/memory-*        │
│   extensions/active-memory                        │
├─────────────────────────────────────────────────┤
│        Layer 3 — Agent & Session 模型             │
│   src/agents · src/sessions · src/routing         │
│   src/chat · src/hooks · src/auto-reply           │
├─────────────────────────────────────────────────┤
│         Layer 2 — Gateway 控制面                   │
│   src/gateway · src/daemon · packages/gateway-    │
│   protocol · packages/gateway-client              │
├─────────────────────────────────────────────────┤
│          Layer 1 — 启动 & CLI 入口                 │
│   src/entry.ts · src/cli · src/bootstrap          │
└─────────────────────────────────────────────────┘
```

**层间依赖规则**：上层依赖下层，下层不感知上层。Gateway 是"总线 + 协议解释器"，Agent 在 Gateway 进程内执行，插件通过 SDK 边界与核心交互，Channel 只做消息翻译。

> 💡 **Takeaway**：六层划分的关键不在于"有六层"这个数字，而在于**依赖方向**——核心只依赖更下层，不反向依赖插件或 Channel。打破这个方向的修改都会被 PR review 拦下。

---

## 3. 第一层：启动 & CLI 入口

### 3.1 入口链路

`src/entry.ts` 是一切开始的入口点。它的职责极其克制——做最少的初始化，然后快速把控制权交给后续阶段：

```
entry.ts
  ├── 编译缓存检查 (enableOpenClawCompileCache)
  ├── 进程标记 (ensureOpenClawExecMarkerOnProcess)
  ├── 警告过滤器安装
  ├── 环境变量规范化 (normalizeEnv)
  ├── 版本快速路径 (tryHandleRootVersionFastPath)
  └── runMainOrRootHelp(argv)
        ├── 根帮助快速路径 (预计算帮助文本)
        └── import("./cli/run-main.js") → runCli(argv)
```

**设计要点**：`entry.ts` 采用了多层快速路径（fast path）策略——`--version`、`--help`、子命令预计算帮助文本都可以跳过整个 Commander 命令树的加载。这种"先试快速路径，不行再走完整初始化"的模式贯穿整个 CLI 层。

> 💡 **Takeaway**：`entry.ts` 的设计哲学是"**能 import 时就 import，能短路就短路**"。它只在模块顶层加 `isMainModule` 守卫，原因是打包器可能把 `entry.js` 作为共享依赖 import，不加守卫会触发**双重 runCli**——端口/锁冲突直接崩。

### 3.2 CLI 主编排

`src/cli/run-main.ts` 是 CLI 的核心编排器（1155 行），核心是一个 `runCli(argv)` 函数。8 阶段流水线（详见 [openclaw-cli-startup-architecture.md](./openclaw-cli-startup-architecture.md) §4）：

1. **argv 解析**：Windows 归一化、容器参数、profile 参数
2. **环境初始化**：`.env` 加载、运行时版本检查、PATH 设置
3. **快速路径**：预计算帮助文本、`gateway run` 直通、路由分发
4. **Crestodian 引导流程**：首次使用的交互式向导
5. **Commander 程序构建**：完整的命令树构建与命令解析
6. **进程信号处理**：SIGINT/SIGTERM 的优雅清理

**容器 / Docker 支持**：`--container` 参数允许 CLI 在容器中运行，与 `--profile` 互斥。`buildCliRespawnPlan()` 会在需要时重新派生进程以切换运行时环境。

### 3.3 Daemon 管理

`src/daemon/` 负责守护进程的跨平台管理：

- **macOS**：`launchd.ts` / `launchd-plist.ts` 生成和管理 launchd plist
- **Linux**：`systemd.ts` / `systemd-unit.ts` 生成 systemd unit 文件
- **Windows**：`schtasks.ts` 使用 Windows 计划任务

---

## 4. 第二层：Gateway 控制面

### 4.1 核心定位

Gateway 是 OpenClaw 的心脏。它**不是 API Gateway（反向代理）**，而是"**总线 + 协议解释器**"：

- Channel 把外部事件翻译成内部协议
- Gateway 负责 session/agent 分发
- Tools 的执行是在 gateway 进程或子进程里完成的
- 所有端（CLI、WebChat、iOS Node、macOS 菜单栏、各 Channel）都通过同一个 WS 端口 18789 与 Gateway 通信

### 4.2 启动流程

`src/gateway/server.impl.ts`（2030 行）的启动流程严格按照多阶段顺序执行（源码中通过 `startupTrace.measure(...)` 显式标记的关键阶段约 20 个，可总结为 11 个高层阶段）：

```
1.  环境初始化与网络运行时引导
2.  配置快照加载与认证引导
3.  插件查找表构建与引导
4.  运行时配置解析（绑定地址、TLS、Control UI 等）
5.  网关运行时状态、HTTP/WS 服务器创建
6.  早期运行时（Bonjour 发现、媒体清理等）
7.  事件订阅与运行时服务
8.  Gateway 方法注册（核心 + 插件 + 辅助）
9.  请求上下文创建与 WS 处理器挂载
10. HTTP 监听、后置挂载运行时（频道启动、Tailscale 等）
11. 配置热重载器启动与 post-ready 维护
```

**关键设计**：Gateway 在启动时会 `pinActivePluginChannelRegistry` 和 `pinActivePluginHttpRouteRegistry`，将插件注册表"冻结"为运行时快照。这保证了运行时热路径不做 freshness polling（`stat`/`realpath`/JSON reread），是一个"元数据进程稳定"的核心设计约束。

### 4.3 线协议

Gateway 使用 WebSocket + JSON 文本帧的线协议，定义在 `packages/gateway-protocol/` 中：

- 第一帧**必须**是 `connect`
- 请求：`{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`
- 事件：`{type:"event", event, payload, seq?, stateVersion?}`
- Schema 由 TypeBox 定义，自动生成 JSON Schema 和 Swift 模型

### 4.4 认证与配对

认证是多层的（详见 [openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §4）：

1. **Gateway 认证**：共享密钥（token/password）、Tailscale 身份、可信代理模式
2. **设备配对**：所有 WS 客户端（operator + node）都需要设备身份
   - 新设备需要配对审批，Gateway 签发 device token
   - 本地 loopback 可自动审批
   - 远程连接必须显式审批
   - 签名绑定 `challenge` nonce + `platform` + `deviceFamily`

> 💡 **Takeaway**：设备配对的签名绑定 `platform + deviceFamily` 是为了**防止"同一设备身份被复用到不同平台"**——如果攻击者把 iPhone 的设备证书复制到 Linux 上跑，签名会失败。

### 4.5 方法注册表

`src/gateway/methods/` 实现了 Gateway 的 RPC 方法注册系统：

- **核心方法**：`health`、`status`、`send`、`agent`、`system-presence` 等
- **插件方法**：Channel 插件可以注册自己的 Gateway 方法
- **方法作用域**：`ADMIN_SCOPE` 等作用域控制方法的访问权限

> 💡 **Takeaway**：插件注册方法时**会被强制做"作用域降级保护"**——核心方法预留的 `config.*` / `exec.approvals.*` / `wizard.*` / `update.*` 命名空间即使被插件声明更宽松的 scope，也会被强制 normalize 到 `operator.admin`。这是为了让插件不能"用同名方法偷换核心方法的能力"。

### 4.6 配置热重载

`src/gateway/config-reload.ts` 实现了配置热重载：

- 监听配置文件变更
- 计算配置差异（`config-diff.ts`）
- 按差异计划重载（重载 Channel、重载插件、重载认证等）
- `promoteConfigSnapshotToLastKnownGood` 确保配置一致性

> 💡 **Takeaway**：配置重载是**差异驱动**的——`GatewayReloadPlan` 精确计算最小必要重载范围（`gateway.bind` 变 → 整进程重启；`plugins.*` 变 → 只重载插件；`skills.*` 变 → 强制 Session 重建快照）。`promoteSnapshot` 机制保证重载失败时回退到上一份"已知良好"配置。

---

## 5. 第三层：Agent & Session 模型

### 5.1 Agent Loop 核心

`src/agents/embedded-agent-runner/run.ts`（3890 行）是 OpenClaw 对话 Agent Loop 的核心。它负责一次完整对话 turn 的执行，核心是一个 `while(true)` 重试循环：

```
runEmbeddedAgent(params)
  ├── 阶段 1：sessionKey 补填 & 队列初始化
  ├── 阶段 2：双重队列调度（session 串行 + global 并发）
  ├── 阶段 3：运行时初始化
  │     ├── workspace/hooks 解析
  │     ├── model 解析与 harness 选择
  │     ├── auth profile 初始化
  │     └── 循环状态变量初始化
  ├── 阶段 4：while(true) 主循环
  │     ├── attempt dispatch — 调度一次 LLM 调用
  │     ├── result processing — 结果分类与异常处理
  │     ├── failover — 错误/超时的 failover 决策
  │     └── terminal paths — 各种终止路径的 return
  └── 阶段 5：finally cleanup
```

**双重队列机制**：先入 session 队列（串行化同一会话的请求），再入 global 队列（控制整体并发）。这保证了同一 session 的请求不会并发执行，同时全局并发度受控。

**认证 Profile 轮转**：支持多个 API key 的轮转与故障冷却。当一个 profile 失败后，会标记冷却时间并尝试下一个 profile，实现自动 failover。

**执行合约**：`strict-agentic` 模式限制模型只做执行不做规划，防止模型在工具调用中"空转"。

### 5.2 Session 模型

Session 由 `src/sessions/` 和 `src/routing/` 共同管理：

**Session Key 格式**：
```
agent:<agentId>:main                          ← 主 session
agent:<agentId>:direct:<userId>               ← DM 独立 session
agent:<agentId>:<channel>:channel:<channelId> ← 群组 session
agent:<agentId>:<channel>:<account>:direct:<id> ← 完整限定 session
```

**路由解析**（`src/routing/resolve-route.ts`）：将入站消息映射到具体的 agent + session：

```
入站消息 → resolveAgentRoute()
         → 匹配 binding 规则（peer / guild+roles / team / account / channel）
         → 生成 ResolvedAgentRoute { agentId, sessionKey, lastRoutePolicy, matchedBy }
```

**dmScope 策略**：
- `main`：所有 DM 路由到主 session
- `per-peer`：每个对端独立 session
- `per-channel-peer`：按通道+对端隔离
- `per-account-channel-peer`：最细粒度隔离

### 5.3 Compaction（上下文压缩）

`src/agents/compaction.ts` 实现了上下文压缩策略：

1. **分块**：将历史消息按 token 预算分块
2. **摘要**：使用 LLM 为每个块生成摘要
3. **合并**：将多个部分摘要合并为一个连贯的摘要
4. **回退**：摘要失败时使用 "No prior history." 作为兜底

### 5.4 Agent Run Terminal Outcome

`src/agents/agent-run-terminal-outcome.ts` 标准化了 Agent 运行的终止状态——7 个互斥 reason：

```
"completed"    ← 正常完成（LLM 返回无工具调用的文本）
"hard_timeout" ← 硬超时（MAX_RUN_DURATION_MS 全局上限）
"timed_out"    ← 软超时（runTimeoutMs 配置）
"cancelled"    ← 用户主动取消（AbortSignal）
"aborted"      ← 系统中止
"blocked"      ← 活性检测连续失败
"failed"       ← 执行失败
```

> 💡 **Takeaway**：优先级是 `cancelled > hard_timeout > timed_out > blocked > failed > completed`——用户主动取消永远赢，**无论是否同时超时**。`hard_timeout` 和 `cancelled` 是"粘性"的（`isStickyAgentRunTerminalOutcome`），后续普通 status 不会覆盖它们。

---

## 6. 第四层：Context Engine & 记忆系统

### 6.1 可插拔的 Context Engine

`src/context-engine/types.ts` 定义了 `ContextEngine` 接口——OpenClaw 上下文管理的核心抽象。8 个方法 + 1 个元数据属性（详见 [openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md) §2）：

- **必选 3 个**：`ingest` / `assemble` / `compact` —— 引擎的核心生命周期
- **可选 7 个**：`bootstrap` / `maintain` / `ingestBatch` / `afterTurn` / `prepareSubagentSpawn` / `onSubagentEnded` / `dispose` —— 增强能力
- **元数据**：`info: ContextEngineInfo` —— 引擎标识 + 自身能力声明

**注册表机制**（`src/context-engine/registry.ts`）：

- 内置 `LegacyContextEngine` 作为默认回退引擎
- 插件通过 `api.registerContextEngine()` 注册自定义引擎
- 支持 slot 机制：同一 slot 只有一个活跃引擎
- 隔离/检疫代理：当引擎运行时异常时，自动回退到 legacy 引擎

**关键生命周期**：

```
bootstrap → [ingest → assemble → LLM call → afterTurn → maintain]* → compact → ...
```

### 6.2 Legacy Context Engine

`src/context-engine/legacy.ts` 的 `LegacyContextEngine` 包装了预插件时代的上下文行为：

- `ingest`：no-op（SessionManager 直接处理持久化）
- `assemble`：pass-through（attempt.ts 中的 sanitize/validate/limit 管道处理）
- `compact`：委托给 `compactEmbeddedAgentSessionDirect`

这是一个典型的适配器模式——将旧系统包装成新接口，保证 100% 向后兼容。

> 💡 **Takeaway**：Context Engine 的关键设计不是"可配置"，而是"**可替换**"——用 slot + 检疫机制让切换是渐进、可降级的（详见 §6.1 的注册表机制和 §4 检疫机制）。

### 6.3 记忆插件家族

`extensions/` 下 **4 个并行插件**（详见 [openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md) §7）：

- `memory-core/`：工具契约、Dreaming 流程、本地嵌入
- `memory-lancedb/`：LanceDB 向量存储、auto-capture / auto-recall
- `memory-wiki/`：Wiki 风格知识库
- `active-memory/`：对话前的**阻塞式召回**子 Agent

**设计哲学**：MD 文件是 source of truth（`SOUL.md`、`AGENTS.md`、`TOOLS.md` + `memory/YYYY-MM-DD.md`），vector 检索只是加速器。代价是同步与去重需要 app 侧兜底，收益是可以 `git commit` 整个 agent state。

> 💡 **Takeaway**：记忆选型时先问"我要 MD 可读还是要向量检索"——能 MD 解决就别上向量库。**在个人助理场景下，记忆规模通常几千条级别**，MD 的可读性 + git diff 优势远大于查询性能劣势。

### 6.4 Prompt Cache 感知

Context Engine 接口中包含了 Prompt Cache 的感知能力——`ContextEnginePromptCacheInfo` 记录了 cache retention 策略、最后一次使用量、cache 行为变化观测等。

Engine 可以根据 cache retention 策略调整 context 的组装方式，最大化 prompt cache 命中率。

> 💡 **Takeaway**：不同 LLM 的 prompt cache 行为差异巨大——Anthropic 是 5 分钟 TTL 的显式 `cache_control` 标记，OpenAI 是基于前缀匹配的自动缓存，Google 是显式创建/删除的 context caching。**Cache-aware 引擎**在 cache 刚失效时（`observation.broke === true`）可以趁机重组 context 结构，而不是被动接受 cache miss。

---

## 7. 第五层：插件 / 扩展 / Skill 体系

### 7.1 插件体系架构

OpenClaw 的插件系统是其扩展性的核心。`src/plugins/` 拥有 520+ 个文件，分为**控制面**和**运行时面**两个关注点：

```
控制面（discovery, manifest, config, setup）
  └── discovery.ts       — 发现候选插件
  └── manifest-registry  — 清单注册表
  └── config-state       — 启用/激活配置
  └── activation-planner — 激活计划

运行时面（execution, hooks, tools）
  └── loader.ts          — 加载和注册插件
  └── runtime/           — 运行时注册表
  └── hook-runner-global — 全局 hook 执行器
  └── provider-runtime   — Provider 运行时
```

**关键约束**：

1. **Manifest-first**：发现、配置验证、setup 应该从元数据工作，而不是执行插件代码
2. **Lazy activation**：发现和激活流程保持懒加载，不提前 import 插件运行时
3. **No backdoors**：bundled 插件不能使用 external 插件不能用的私有通道

### 7.2 插件发现与加载

```
discoverOpenClawPlugins()           → PluginCandidate[]
        ↓
loadPluginManifestRegistry()        → PluginManifestRecord[]
        ↓
buildProvenanceIndex()              → 来源索引
        ↓
loadOpenClawPlugins()               → PluginRegistry
        ↓
register(api) / activate(api)       → 插件注册入口
```

**来源类型**：
- **Bundled**：编译时打包进核心分发的插件
- **Installed**：通过 `openclaw install` 安装的插件
- **Dev source**：开发模式下的本地源码
- **Load path**：配置中指定的额外加载路径

### 7.3 插件 SDK

插件通过两个 SDK 与核心交互：

**`src/plugin-sdk/`**（运行时 SDK，520+ 文件）：
- Channel 抽象：`channel-inbound.ts`、`channel-outbound.ts`、`channel-lifecycle.ts`
- Provider 抽象：`provider-entry.ts`、`provider-auth.ts`、`provider-stream.ts`
- Agent 工具：`agent-core.ts`、`agent-harness.ts`、`agent-sessions.ts`
- 审批流程：`approval-runtime.ts`、`approval-delivery-runtime.ts`
- 记忆系统：`memory-core.ts`、`memory-host-core.ts`

**`packages/plugin-sdk/`**（独立包 SDK，24 文件）：
- `plugin-entry.ts`：插件入口点
- `provider-entry.ts`：Provider 入口点
- `provider-stream-shared.ts`：流式共享
- `provider-auth.ts`：认证抽象

**`packages/plugin-package-contract/`**（包合约）：
- 定义 `package.json` 中 `openclaw` 块的兼容性元数据
- `openclaw.compat.pluginApi`：插件 API 版本范围
- `openclaw.build.openclawVersion`：构建时的 OpenClaw 版本

### 7.4 插件类型

`extensions/` 中的 100+ 扩展主要分为以下类型：

| 类型 | 示例 | 数量 |
|------|------|------|
| **Channel** | whatsapp, telegram, feishu, discord, slack, signal | ~25 |
| **Provider** | openai, anthropic, google, deepseek, qwen, ollama | ~30 |
| **Memory** | memory-core, memory-lancedb, memory-wiki, active-memory | ~5 |
| **Media** | image-generation-core, media-understanding-core, video-generation-core | ~8 |
| **Tool** | browser, diffs, firecrawl, webhooks, canvas | ~10 |
| **Diagnostic** | diagnostics-otel, diagnostics-prometheus | ~2 |
| **Migration** | migrate-claude, migrate-hermes | ~2 |
| **Voice** | talk-voice, voice-call, azure-speech, elevenlabs | ~5 |
| **Other** | policy, workboard, thread-ownership, acpx | ~15+ |

**Channel 与 Provider 的对偶性**：一个是"信息从哪进来"，一个是"模型从哪调"。两者都被纳入 extension 体系，是 140+ 扩展的主体。

> 💡 **Takeaway**：写新插件时**先确认走 Channel 还是 Provider 路径**——前者接 IM 平台（需要 inbound + outbound + 配置），后者接 LLM（需要 provider + 模型目录 + 认证）。**最容易出错的是"模型走 Channel"或"消息走 Provider"**，这两种都会被 PR review 拦下。

### 7.5 Skill 系统

`src/skills/` 管理了 OpenClaw 的内置技能——**比 Plugin 轻量**（Markdown + frontmatter，不写 TS）。关键 metadata：

- `always`：是否始终加载（true 的 Skill 进系统 prompt）
- `skillKey`：技能标识
- `primaryEnv`：主要环境变量
- `requires.bins / env / config`：前置条件（`openclaw doctor` 会检查并提示缺失）
- `install`：安装规范（brew / node / go / uv / download）

Skill 的生命周期：

```
discovery → loading → runtime → lifecycle
             │           │          │
             │           │          └─ archive-install / source-install / upload-store
             │           └─ cron-snapshot / session-snapshot / env-overrides
             └─ bundled-dir / frontmatter / workspace-sync
```

> 💡 **Takeaway**：Plugin 写复杂业务，Skill 写"提示 + 前置条件 + 工具组合"——**两者不是替代关系，是分层的**。一个 Skill 通常只做"提示 LLM 怎么用现有工具完成一件事"，Plugin 才做"接入新的外部系统"。

### 7.6 Hook 系统

`src/plugins/hook-types.ts` 的 `PluginHookName` 联合类型定义了 **39 个** Hook 点（详见 [openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md) §9.1 和 [openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md) §8.1），按生命周期阶段分组：

- **模型解析**：`before_model_resolve` / `agent_turn_prepare` / `before_prompt_build`
- **Agent 生命周期**：`before_agent_start` / `before_agent_reply` / `before_agent_finalize` / `agent_end` / `before_agent_run`
- **模型调用**：`model_call_started` / `model_call_ended` / `llm_input` / `llm_output`
- **压缩**：`before_compaction` / `after_compaction` / `before_reset`
- **消息流**：`inbound_claim` / `message_received` / `message_sending` / `message_sent` / `reply_payload_sending` / `before_message_write`
- **工具调用**：`before_tool_call` / `after_tool_call` / `tool_result_persist`
- **会话/子 Agent/Gateway/调度/派发**：~15 个

Hook 可以修改行为、注入上下文、甚至请求重试。

---

## 8. 第六层：Channel 通道与端侧设备

### 8.1 Channel 抽象

`src/channels/` 定义了 Channel 的核心抽象，真实通道实现落在 `extensions/<channel>`：

```
src/channels/           → 接口与通用逻辑
extensions/whatsapp/    → WhatsApp 实现
extensions/telegram/    → Telegram 实现
extensions/feishu/      → 飞书实现
extensions/discord/     → Discord 实现
...
```

**Channel Plugin 类型**（`src/channels/plugins/types.plugin.ts`）：

Channel 插件由多个 Adapter 组合而成：

```typescript
type ChannelPlugin = {
  id: ChannelId;
  name: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  // Adapter 组合
  config?: ChannelConfigAdapter;
  setup?: ChannelSetupAdapter;
  auth?: ChannelAuthAdapter;
  outbound?: ChannelOutboundAdapter;
  inbound?: ChannelInboundAdapter;
  lifecycle?: ChannelLifecycleAdapter;
  message?: ChannelMessageActionAdapter;
  streaming?: ChannelStreamingAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter;
  ...
};
```

**关键设计**：Channel 只做消息翻译——把外部事件翻译成内部协议，把内部消息翻译成外部格式。Channel **不**拥有产品命令树、不拥有插件/Provider 策略、不拥有特性菜单。

### 8.2 消息动作系统

`src/channels/plugins/message-action-names.ts` 定义了统一的 Message Action 名称：

Channel 插件贡献 schema fragment 到共享的 `message` 工具中，而不是自己定义独立的工具。这保证了跨 Channel 的消息动作是一致的。

### 8.3 设备配对

`src/pairing/` 管理设备配对流程：

```
pairing-challenge.ts  — 生成和验证配对挑战
pairing-store.ts     — 持久化配对记录
pairing-messages.ts  — 配对消息协议
setup-code.ts        — 配对码生成
```

### 8.4 Node Host

`src/node-host/` 是端侧设备（iOS/Android/macOS/Headless）的宿主运行时：

```
runner.ts           — CLI 入口，通过 WS 连接 Gateway
invoke.ts           — 命令分发（系统命令、审批、插件命令）
invoke-system-run.ts — 系统命令执行与审批策略
plugin-node-host.ts — 插件注册的 Node Host 命令
exec-policy.ts      — 执行策略
```

**Node 模型配对**：iOS/Android 不是 RPC 客户端，而是"设备节点"（`apps/ios`、`apps/android`、`src/pairing`）。节点承担摄像头/屏幕/麦克风等本地能力，Gateway 负责编排。

**连接流程**：
1. Node 通过 WS 连接 Gateway，声明 `role: node` + caps/commands/permissions
2. Gateway 验证配对状态和设备身份
3. Node 暴露 `canvas.*`、`camera.*`、`screen.record`、`location.get` 等命令
4. Gateway 可以远程调用 Node 的命令

### 8.5 端侧应用

| 应用 | 路径 | 技术栈 |
|------|------|--------|
| macOS | `apps/macos/` | Swift (SPM) |
| iOS | `apps/ios/` | SwiftUI + WatchApp |
| Android | `apps/android/` | Kotlin |
| 共享 Kit | `apps/shared/OpenClawKit/` | Swift (SPM) |
| macOS MLX TTS | `apps/macos-mlx-tts/` | Swift + MLX |

iOS App 结构（`apps/ios/Sources/`）：
- `Gateway/` — Gateway WS 连接管理
- `Chat/` — 聊天 UI
- `Voice/` — 语音交互
- `Camera/` — 摄像头能力
- `Onboarding/` — 引导流程
- `Push/` — 推送通知
- `Device/` — 设备能力

---

## 9. 一条消息的完整旅程

以"飞书群里 @ 机器人发一句话"为例：

```
1. 飞书事件 → extensions/feishu/ 接收
2. Channel 插件翻译为内部 InboundEvent
3. src/channels/inbound-event/ 分类（direct/group/mention）
4. src/routing/resolve-route.ts 路由解析
   → ResolvedAgentRoute { agentId, sessionKey, lastRoutePolicy }
5. src/gateway/server-chat.ts 创建 chat run
6. runEmbeddedAgent() 进入 Agent Loop
7. Context Engine assemble() 组装上下文
8. LLM 调用（Provider → extensions/openai/ 或 extensions/anthropic/ 等）
9. 工具执行（bash / browser / message / ...）
10. 结果流式回传 → Channel outbound adapter → 飞书 API
11. afterTurn() → Context Engine 维护
12. 如果需要 compaction → Context Engine compact()
```

![一条消息的完整旅程](/ai-source/open-claw/openclaw-message-journey.svg)

---

## 10. 六个关键设计权衡

### 10.1 MD 优先而非 DB 优先

记忆用 Markdown（`memory/`、`SOUL.md`、`DREAMS.md`），vector 索引可换（sqlite-vec / LanceDB / honcho）。收益是可以 `git commit` 整个 agent state；代价是同步与去重需要 app 侧兜底。

### 10.2 Extension 即 npm 包

`packages/plugin-package-contract` 规定扩展可直接以 npm 包分发（`package.json` 的 `openclaw` 块），免去自建 registry；代价是给供应链安全带来压力。

### 10.3 Sandbox Mode 是 per-session 的

main session 默认可直接执行 host 命令；non-main session 默认跑在 per-session Docker 沙箱里。"你是谁比你做什么更重要"——这是身份优先安全观。

### 10.4 Gateway 不是反向代理

Gateway 是"总线 + 协议解释器"，不是 API Gateway。Channel 把外部事件翻译成内部协议，Gateway 负责 session/agent 分发，tools 的执行在 gateway 进程或子进程里完成。

### 10.5 Node 模型配对

iOS/Android 不是 RPC 客户端，而是"设备节点"。节点承担摄像头/屏幕/麦克风等本地能力，Gateway 负责编排。

### 10.6 Channels 与 Provider 是对偶的

一个是"信息从哪进来"，一个是"模型从哪调"。两者都被纳入 extension 体系，是 100+ 扩展的主体。

---

## 11. 数据存储策略

### 11.1 SQLite 为唯一存储

OpenClaw 的存储哲学是 **SQLite only**：

- **共享状态 DB**：`state/openclaw.sqlite` — 全局运行时状态和插件 KV 数据
- **Agent DB**：`agents/<agentId>/agent/openclaw-agent.sqlite` — Agent 级别的状态/缓存
- **专用 DB**：仅在 schema、数据量或生命周期明显不匹配上述两个时使用

**不使用** JSON/JSONL/TXT/sidecar 文件存储运行时状态。文件存储仅限于命名产品工件（导入/导出、用户附件、日志、备份）。

### 11.2 运行时只读规范配置

Core 运行时只消费当前规范形状的配置。旧格式/退役形状只在 `doctor --fix` 迁移代码中规范化，运行时不做 shims、aliases 或 fallback readers。

---

## 12. Packages 生态

`packages/` 中的 21 个包提供了核心 SDK 和共享类型：

| 包名 | 职责 |
|------|------|
| `gateway-protocol` | WS 线协议类型、JSON Schema、验证器 |
| `gateway-client` | Gateway WS 客户端 |
| `agent-core` | Agent Loop 核心（harness、llm 抽象） |
| `acp-core` | Agent Control Protocol |
| `plugin-sdk` | 独立插件 SDK 包 |
| `plugin-package-contract` | 外部插件的 package.json 合约 |
| `llm-core` / `llm-runtime` | LLM 核心类型和运行时 |
| `model-catalog-core` | 统一模型目录类型 |
| `markdown-core` | Markdown 解析和 IR |
| `media-core` | 媒体处理核心 |
| `media-generation-core` | 媒体生成 Provider 接口 |
| `media-understanding-common` | 媒体理解 Provider 接口 |
| `memory-host-sdk` | 记忆宿主 SDK |
| `speech-core` | 语音处理核心 |
| `terminal-core` | 终端 ANSI 处理 |
| `normalization-core` | 输入规范化工具 |
| `net-policy` | 网络策略 |
| `tool-call-repair` | 工具调用修复 |
| `web-content-core` | Web 内容处理 |
| `sdk` | 通用 SDK |

---

## 13. 总结

OpenClaw 的架构可以总结为一句话：**一个 Gateway 总线驱动六层可插拔架构，从 CLI 到 Channel 端到端打通 agent 生命周期**。

核心设计理念：

1. **Local-first**：Gateway 在你自己的机器上跑，数据留在本地
2. **Plugin-agnostic core**：核心不依赖任何特定 SaaS，Channel/Provider 都是插件
3. **身份优先安全**：per-session sandbox，"你是谁比你做什么更重要"
4. **可插拔 Context Engine**：上下文管理是可替换的，默认 legacy 引擎保证兼容
5. **Node 设备模型**：端侧不是薄客户端，而是有本地能力的设备节点
6. **进程稳定元数据**：Gateway 运行时冻结插件注册表，热路径不做 freshness polling

这六个理念相互支撑，形成了 OpenClaw "个人 AI 助手网关"的独特定位。

---

## 🎯 如果只记 3 件事

1. **"核心不感知插件，插件通过 SDK 注册"** —— 改任何 OpenClaw 行为前先问：这是核心该做的，还是插件该做的？99% 的情况下答案是**插件**。
2. **"Gateway 是总线，不是反向代理"** —— 它有状态（Session/Agent Run/Client Registry），在进程内执行工具，所有端都通过同一个 WS 端口 18789 接入。
3. **"进程稳定元数据"** —— Gateway 启动时冻结插件元数据，热路径不做 freshness polling。元数据变更要重启或显式 reload/install/doctor。这条直接决定你能写多高效的插件——别在请求路径里 stat 文件。

> 📚 **配套阅读**：本文是入口，7 篇子系统分析是它的展开：
>
> | 子系统 | 文档 |
> |--------|------|
> | CLI 启动细节 | [openclaw-cli-startup-architecture.md](./openclaw-cli-startup-architecture.md) |
> | Gateway 控制面 | [openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) |
> | Agent & Session | [openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md) |
> | Context Engine & 记忆 | [openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md) |
> | Channel 通道 | [openclaw-channel-architecture.md](./openclaw-channel-architecture.md) |
> | Node & 端侧设备 | [openclaw-node-device-architecture.md](./openclaw-node-device-architecture.md) |
> | Plugin & Skill | [openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md) |
