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

|| 你想知道 | 看这一节 |
|---------|---------|
| OpenClaw 是什么、不是什么 | §1 一句话定位 |
| 整张架构图长啥样 | §2 六层架构总览 |
| 为什么是六层而不是五层或七层 | §2.2 分层的必然性 |
| 一条消息怎么从飞书一路走到 LLM 再回来 | §9 一条消息的完整旅程 |
| 6 个最重要的设计权衡 | §10 六个关键设计权衡 |
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

### 2.1 每层的一句话职责

| 层 | 核心职责 | 设计意图 |
|---|---------|---------|
| **L1 启动入口** | 最少初始化 + 快速路径 + 把控制权交给下游 | **能短路就短路**——`--version` 不加载 Commander |
| **L2 Gateway** | WS 总线 + 协议解释 + Session 分发 | **有状态总线**——不是反向代理，在进程内执行工具 |
| **L3 Agent & Session** | 对话循环 + 队列调度 + 路由解析 | **身份优先**——同一个 session 串行，不同 session 并发 |
| **L4 Context Engine** | 上下文组装 + 压缩 + 记忆检索 | **可替换而非可配置**——slot + 检疫让切换可降级 |
| **L5 插件 / Skill** | 扩展注册 + Hook 执行 + 能力组合 | **Manifest-first**——发现和激活不执行插件代码 |
| **L6 Channel & Node** | 消息翻译 + 端侧能力暴露 | **只翻译不决策**——Channel 不拥有命令树和特性菜单 |

### 2.2 为什么是六层——分层的必然性

这六层不是随意划分的，每一层都对应一个**独立的变更理由**（单一职责的变体）：

- **L1 vs L2**：CLI 入口的变更（新子命令、参数解析）不应影响 Gateway 的运行时行为。反过来，Gateway 热重载不应触发 CLI 重解析。
- **L2 vs L3**：Gateway 是调度器，Agent 是执行器。把"谁来跑"和"怎么跑"分开，Gateway 才能做 session 级别的 failover 和并发控制。
- **L3 vs L4**：Agent Loop 关注"调 LLM + 跑工具"，Context Engine 关注"给 LLM 看什么"。分开后，换一个记忆引擎不需要改 Agent Loop。
- **L4 vs L5**：Context Engine 是核心抽象，插件是实现。插件可以崩溃、被卸载、被替换——核心不能。
- **L5 vs L6**：插件提供能力，Channel 提供通道。一个 Channel 可以用多个插件的工具，一个插件可以服务于多个 Channel。

> 💡 **Takeaway**：六层划分的关键不在于"有六层"这个数字，而在于**依赖方向**——核心只依赖更下层，不反向依赖插件或 Channel。打破这个方向的修改都会被 PR review 拦下。判断"这该放哪层"的方法很简单：**如果 X 的变更会迫使 Y 也变更，X 应该在 Y 的更下层。**

---

## 3. 第一层：启动 & CLI 入口

> 📚 完整分析见 [openclaw-cli-startup-architecture.md](./openclaw-cli-startup-architecture.md)

### 3.1 设计意图：克制的入口哲学

`src/entry.ts` 是一切开始的入口点，但它的设计哲学是"**能 import 时就 import，能短路就短路**"：

- `--version` / `--help` / 预计算帮助文本 → 跳过整个 Commander 命令树的加载
- `gateway run` → 只加载 5-6 个模块的快速路径
- 完整子命令 → 才走 20+ 模块的完整初始化

这种"先试快速路径，不行再走完整初始化"的模式贯穿整个 CLI 层。`entry.ts` 只在模块顶层加 `isMainModule` 守卫，原因是打包器可能把 `entry.js` 作为共享依赖 import，不加守卫会触发**双重 runCli**——端口/锁冲突直接崩。

### 3.2 CLI 主编排

`src/cli/run-main.ts` 的 `runCli(argv)` 是一个 8 阶段流水线（1155 行），核心节奏是"**渐进式加载**"——每个阶段只初始化本阶段需要的模块，越早的阶段越轻量：

1. argv 解析 → 2. 环境初始化 → 3. 快速路径 → 4. 首次引导 → 5. Commander 构建 → 6. 信号处理

**容器支持**：`--container` 参数允许 CLI 在容器中运行，`buildCliRespawnPlan()` 会在需要时重新派生进程以切换运行时环境。

### 3.3 Daemon 管理

`src/daemon/` 负责守护进程的跨平台管理（macOS launchd / Linux systemd / Windows schtasks），把 Gateway 装成系统服务，实现开机自启和崩溃自动重启。

---

## 4. 第二层：Gateway 控制面

> 📚 完整分析见 [openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md)

### 4.1 核心定位：不是反向代理，是总线

Gateway 是 OpenClaw 的心脏。它**不是 API Gateway（反向代理）**，而是"**总线 + 协议解释器**"：

- Channel 把外部事件翻译成内部协议，Gateway 负责 session/agent 分发
- Tools 的执行是在 gateway 进程或子进程里完成的
- 所有端（CLI、WebChat、iOS Node、macOS 菜单栏、各 Channel）都通过同一个 WS 端口 18789 与 Gateway 通信

**"有状态总线"与"无状态代理"的本质区别**：API Gateway 转发请求到后端，自己不持有状态。而 Gateway 持有 Session、Agent Run、Client Registry 三大运行时状态——它**在进程内**执行工具、管理会话、推送事件。

### 4.2 启动流程：11 阶段严格编排

`src/gateway/server.impl.ts`（2030 行）的启动流程严格按照多阶段顺序执行，可总结为 11 个高层阶段：

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

**进程稳定元数据**：Gateway 在启动时会 `pinActivePluginChannelRegistry` 和 `pinActivePluginHttpRouteRegistry`，将插件注册表"冻结"为运行时快照。这保证了运行时热路径不做 freshness polling（`stat`/`realpath`/JSON reread），是一个"元数据进程稳定"的核心设计约束。

### 4.3 线协议

Gateway 使用 WebSocket + JSON 文本帧的线协议，定义在 `packages/gateway-protocol/` 中：

- 第一帧**必须**是 `connect`
- 请求：`{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`
- 事件：`{type:"event", event, payload, seq?, stateVersion?}`

选择 JSON 文本帧而非二进制协议，是**可调试性优先于极致性能**的体现——在个人助理场景下，消息吞吐量远达不到需要二进制协议的程度。

### 4.4 认证与配对

认证是多层的四层纵深防御：

1. **Gateway 认证**：共享密钥、Tailscale 身份、可信代理模式
2. **设备配对**：所有 WS 客户端都需要设备身份——新设备需配对审批，本地 loopback 可自动审批，远程必须显式审批
3. **签名绑定**：`challenge` nonce + `platform` + `deviceFamily`——防止"同一设备身份被复用到不同平台"
4. **方法作用域**：核心方法命名空间被强制 `operator.admin` 保护，插件无法用同名方法偷换核心方法的能力

### 4.5 配置热重载

配置重载是**差异驱动**的——`GatewayReloadPlan` 精确计算最小必要重载范围：

- `gateway.bind` 变 → 整进程重启
- `plugins.*` 变 → 只重载插件
- `skills.*` 变 → 强制 Session 重建快照

`promoteSnapshot` 机制保证重载失败时回退到上一份"已知良好"配置。

---

## 5. 第三层：Agent & Session 模型

> 📚 完整分析见 [openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md)

### 5.1 Agent Loop 核心

`src/agents/embedded-agent-runner/run.ts`（3890 行）是 OpenClaw 对话 Agent Loop 的核心，负责一次完整对话 turn 的执行。设计上有三个关键机制：

**双重队列**：先入 session 队列（串行化同一会话的请求），再入 global 队列（控制整体并发）。这保证了同一 session 的请求不会并发执行，同时全局并发度受控。

**认证 Profile 轮转**：支持多个 API key 的轮转与故障冷却。当一个 profile 失败后，会标记冷却时间并尝试下一个 profile，实现自动 failover。

**执行合约**：`strict-agentic` 模式限制模型只做执行不做规划，防止模型在工具调用中"空转"——这是从实践中提炼的防御性设计，针对某些模型倾向于"思考不行动"的行为。

### 5.2 Session 路由

Session Key 格式决定了消息的路由粒度：

```
agent:<agentId>:main                          ← 主 session
agent:<agentId>:direct:<userId>               ← DM 独立 session
agent:<agentId>:<channel>:channel:<channelId>  ← 群组 session
agent:<agentId>:<channel>:<account>:direct:<id> ← 完整限定 session
```

**dmScope 策略**控制了隔离粒度——从 `main`（所有 DM 共享）到 `per-account-channel-peer`（最细粒度隔离）。选择哪种策略的判断标准是：**同一个人在不同 Channel 上对你来说是不是"同一个人"？** 如果是，用 `per-peer`；如果不是，用更细的粒度。

### 5.3 Compaction（上下文压缩）

上下文压缩是四步流程：分块 → 摘要 → 合并 → 回退（失败时使用 "No prior history." 兜底）。关键设计决策是：**压缩是 Context Engine 的职责，不是 Agent Loop 的**——这使得换一个 Context Engine 可以同时改变压缩策略，而不需要修改 Agent Loop。

### 5.4 Agent Run 的 7 种终态

7 个互斥 reason 标准化了 Agent 运行的终止状态：`completed`、`hard_timeout`、`timed_out`、`cancelled`、`aborted`、`blocked`、`failed`。

优先级是 `cancelled > hard_timeout > timed_out > blocked > failed > completed`——用户主动取消永远赢。其中 `hard_timeout` 和 `cancelled` 是"粘性"的（`isStickyAgentRunTerminalOutcome`），后续普通 status 不会覆盖它们。

> 💡 **Takeaway**：粘性终态的设计意图是**防止"已经取消的 run 又被标记为正常完成"**——这在并发场景下很重要：用户点取消的同时，LLM 可能刚好返回了一个文本响应。没有粘性，这个 run 就会被误标为 `completed`。

---

## 6. 第四层：Context Engine & 记忆系统

> 📚 完整分析见 [openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md)

### 6.1 可插拔的 Context Engine

`src/context-engine/types.ts` 定义了 `ContextEngine` 接口——8 个方法 + 1 个元数据属性。核心生命周期三个：

```
bootstrap → [ingest → assemble → LLM call → afterTurn → maintain]* → compact → ...
```

**注册表机制**（`src/context-engine/registry.ts`）的关键设计不是"可配置"，而是"**可替换**"：

- slot 机制：同一 slot 只有一个活跃引擎
- **隔离/检疫代理**：当引擎运行时异常时，自动回退到 `LegacyContextEngine`
- 检疫不是"发现异常就永久禁用"，而是"异常时回退，下次新 session 可以再试"

这是从微服务断路器模式借鉴来的——**渐进、可降级，而非一刀切**。

### 6.2 记忆插件家族

`extensions/` 下 4 个并行插件：

| 插件 | 职责 | 关键词 |
|------|------|--------|
| `memory-core/` | 工具契约、Dreaming 流程、本地嵌入 | 基础能力 |
| `memory-lancedb/` | LanceDB 向量存储、auto-capture / auto-recall | 语义检索 |
| `memory-wiki/` | Wiki 风格知识库 | 结构化知识 |
| `active-memory/` | 对话前的阻塞式召回子 Agent | 主动回忆 |

**MD 优先的设计哲学**：MD 文件是 source of truth（`SOUL.md`、`AGENTS.md`、`TOOLS.md` + `memory/YYYY-MM-DD.md`），vector 检索只是加速器。在个人助理场景下，记忆规模通常几千条级别，MD 的可读性 + git diff 优势远大于查询性能劣势。选型时先问"我要 MD 可读还是要向量检索"——能 MD 解决就别上向量库。

### 6.3 Prompt Cache 感知

Context Engine 接口中包含了 Prompt Cache 的感知能力。不同 LLM 的 prompt cache 行为差异巨大——Anthropic 是 5 分钟 TTL 的显式 `cache_control` 标记，OpenAI 是基于前缀匹配的自动缓存，Google 是显式创建/删除的 context caching。

**Cache-aware 引擎**在 cache 刚失效时（`observation.broke === true`）可以趁机重组 context 结构，而不是被动接受 cache miss。这是一个"**把约束变机会**"的设计——cache 失效反而成了重组 context 的最佳时机。

---

## 7. 第五层：插件 / 扩展 / Skill 体系

> 📚 完整分析见 [openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md)

### 7.1 插件体系的设计哲学

OpenClaw 的插件系统是其扩展性的核心（`src/plugins/` 520+ 个文件），设计哲学可以概括为三条约束：

1. **Manifest-first**：发现、配置验证、setup 从元数据工作，不执行插件代码——**安全与性能的双重保障**
2. **Lazy activation**：发现和激活流程保持懒加载，不提前 import 插件运行时——**Gateway 启动速度取决于你激活了多少插件**
3. **No backdoors**：bundled 插件不能使用 external 插件不能用的私有通道——**公平性约束，防止核心"走后门"**

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

来源类型：**Bundled**（编译时打包）、**Installed**（`openclaw install`）、**Dev source**（本地开发）、**Load path**（配置指定路径）。

### 7.3 Channel 与 Provider 的对偶性

`extensions/` 中的 100+ 扩展最核心的两类：

- **Channel**（~25 个）：WhatsApp, Telegram, 飞书, Discord, Slack...——"信息从哪进来"
- **Provider**（~30 个）：OpenAI, Anthropic, Google, DeepSeek, Ollama...——"模型从哪调"

两者都被纳入 extension 体系，是 140+ 扩展的主体。**写新插件时先确认走 Channel 还是 Provider 路径**——最容易出错的是"模型走 Channel"或"消息走 Provider"，这两种都会被 PR review 拦下。

### 7.4 Skill 系统

Skill 比 Plugin 轻量——**Markdown + frontmatter，不写 TS**。一个 Skill 通常只做"提示 LLM 怎么用现有工具完成一件事"，Plugin 才做"接入新的外部系统"。两者不是替代关系，是分层的。

### 7.5 Hook 系统

39 个 Hook 点按生命周期阶段分组，覆盖模型解析、Agent 生命周期、模型调用、压缩、消息流、工具调用等。Hook 可以修改行为、注入上下文、甚至请求重试——是插件干预核心行为的**唯一合法通道**。

---

## 8. 第六层：Channel 通道与端侧设备

> 📚 完整分析见 [openclaw-channel-architecture.md](./openclaw-channel-architecture.md) 和 [openclaw-node-device-architecture.md](./openclaw-node-device-architecture.md)

### 8.1 Channel 抽象

Channel 的核心设计约束极其克制——**只做消息翻译**：

- 把外部事件翻译成内部 InboundEvent
- 把内部消息翻译成外部格式
- **不**拥有产品命令树、**不**拥有插件/Provider 策略、**不**拥有特性菜单

Channel 插件由多个**可选** Adapter 组合而成（`ChannelPlugin` 类型有 38 个可选槽位），不强制实现——写一个最小 Channel 插件只需要 `inbound` + `outbound` 两个适配器。

### 8.2 设备配对

`src/pairing/` 管理设备配对流程。Node 通过 WS 连接 Gateway，声明 `role: node` + caps/commands/permissions，Gateway 验证配对状态后可以远程调用 Node 的命令（`canvas.*`、`camera.*`、`screen.record`、`location.get` 等）。

### 8.3 Node Host：设备节点而非 RPC 客户端

`src/node-host/` 是端侧设备的宿主运行时。iOS/Android 不是 RPC 客户端，而是"**设备节点**"——节点承担摄像头/屏幕/麦克风等本地能力，Gateway 负责编排。

这个选择的架构含义是：**端侧不是"瘦客户端"，而是有本地能力的协作方**。如果 Node 只是 RPC 客户端，所有能力都在 Gateway 端，那端侧就只能是"显示+转发"；但 Node 模型允许端侧暴露自己的能力给 Gateway 调度，使得"Gateway 编排 + Node 执行"成为可能。

### 8.4 端侧应用

| 应用 | 路径 | 技术栈 |
|------|------|--------|
| macOS | `apps/macos/` | Swift (SPM) |
| iOS | `apps/ios/` | SwiftUI + WatchApp |
| Android | `apps/android/` | Kotlin |
| 共享 Kit | `apps/shared/OpenClawKit/` | Swift (SPM) |
| macOS MLX TTS | `apps/macos-mlx-tts/` | Swift + MLX |

---

## 9. 一条消息的完整旅程

以"飞书群里 @ 机器人发一句话"为例，一条消息从飞书到 LLM 再回到飞书，穿过了六层中的五层（CLI 入口层不参与运行时消息处理）：

```
┌─────────────────────────────────────────────────────────┐
│ L6  Channel                                             │
│   飞书事件 → feishu 插件接收 → 翻译为 InboundEvent       │
│   ↓ 分类（direct / group / mention）                     │
├─────────────────────────────────────────────────────────┤
│ L3  Agent & Session                                     │
│   resolveAgentRoute() → 匹配 binding → 生成 sessionKey   │
│   runEmbeddedAgent() → 进入 Agent Loop                  │
├─────────────────────────────────────────────────────────┤
│ L4  Context Engine                                      │
│   assemble() → 组装上下文（系统 prompt + 历史 + 记忆）    │
├─────────────────────────────────────────────────────────┤
│ L5  Provider（插件）                                     │
│   LLM 调用 → extensions/openai/ 或 extensions/anthropic/ │
│   工具执行 → bash / browser / message / ...              │
├─────────────────────────────────────────────────────────┤
│ L2  Gateway                                             │
│   结果流式回传 → Channel outbound adapter → 飞书 API     │
│   afterTurn() → Context Engine 维护                      │
│   如果需要 compaction → Context Engine compact()         │
└─────────────────────────────────────────────────────────┘
```

![一条消息的完整旅程](/ai-source/open-claw/openclaw-message-journey.svg)

**旅程中的关键设计决策**：

| 步骤 | 设计决策 | 为什么 |
|------|---------|--------|
| L6 → L3 | Channel 不直接创建 Agent，而是走路由解析 | 解耦"消息来源"和"谁来处理"——同一条消息可以路由到不同 Agent |
| L3 入队 | 双重队列（session + global） | 同一 session 串行保证一致性，global 队列控制并发保护资源 |
| L3 → L4 | Agent Loop 不自己组装上下文 | 可替换的 Context Engine——换引擎不需要改 Loop |
| L4 组装 | Cache-aware 组装 | 在 cache 失效时趁机重组，把约束变机会 |
| L3 终态 | 7 种互斥 reason + 粘性终态 | 并发场景下防止"取消的 run 被标为完成" |
| L2 回传 | 流式 + afterTurn 维护 | 流式提升体验，afterTurn 保证记忆同步 |

---

## 10. 六个关键设计权衡

### 10.1 MD 优先而非 DB 优先

记忆用 Markdown（`memory/`、`SOUL.md`、`DREAMS.md`），vector 索引可换（sqlite-vec / LanceDB / honcho）。收益是可以 `git commit` 整个 agent state；代价是同步与去重需要 app 侧兜底。

这个选择的深层原因：**个人助理的记忆规模通常在几千条级别**，MD 的可读性 + git diff 优势远大于查询性能劣势。只有当记忆规模突破万条、语义检索成为刚需时，才需要上向量库——但即便如此，MD 仍然是 source of truth，向量只是索引。

### 10.2 Extension 即 npm 包

`packages/plugin-package-contract` 规定扩展可直接以 npm 包分发（`package.json` 的 `openclaw` 块），免去自建 registry。收益是零基建的分发生态；代价是给供应链安全带来压力——任何 npm 包都可以声明自己是 OpenClaw 插件。

缓解措施是 `buildProvenanceIndex()` 会追踪每个插件的来源类型（Bundled / Installed / Dev / Load-path），配合 `openclaw doctor` 做安全检查。

### 10.3 Sandbox Mode 是 per-session 的

main session 默认可直接执行 host 命令；non-main session 默认跑在 per-session Docker 沙箱里。这是"**身份优先安全观**"——"你是谁比你做什么更重要"。

为什么不是 per-tool 或 per-action？因为工具调用的序列可以组合出不可预测的行为。一个看似无害的 `file_read` + `bash_exec` 序列可能比一个 `sudo rm -rf` 更危险。**身份是最稳定的信任边界**——session 的创建者比 session 中的某个工具调用更可信。

### 10.4 Gateway 不是反向代理

Gateway 是"总线 + 协议解释器"，不是 API Gateway。Channel 把外部事件翻译成内部协议，Gateway 负责 session/agent 分发，tools 的执行在 gateway 进程或子进程里完成。

这个选择意味着 Gateway 是**有状态的**——它持有 Session、Agent Run、Client Registry。好处是省去了一次网络跳转和状态同步；代价是 Gateway 是单点——崩溃恢复依赖 Session 的持久化和 `wake(sessionId)` 机制。对于 local-first 的个人助理场景，这个 trade-off 是合理的。

### 10.5 Node 是设备节点而非 RPC 客户端

iOS/Android 不是 RPC 客户端，而是"设备节点"。节点承担摄像头/屏幕/麦克风等本地能力，Gateway 负责编排。

如果 Node 只是 RPC 客户端，所有能力都在 Gateway 端，端侧就只能是"显示+转发"——这意味着每次新增端侧能力（如摄像头、屏幕录制、GPS）都需要改 Gateway。Node 模型把能力声明权交给了端侧：**Node 暴露什么能力，Gateway 就编排什么能力**，Gateway 不需要预知。

### 10.6 Channels 与 Provider 是对偶的

Channel 是"信息从哪进来"，Provider 是"模型从哪调"。两者都被纳入 extension 体系，是 100+ 扩展的主体。

这个对偶性的架构含义是：**OpenClaw 的核心是一个"中间人"**——它左边接 Channel（信息输入），右边接 Provider（模型输出），自己在中间做 Agent 编排。Channel 和 Provider 对核心来说是完全对称的——都是"通过插件注册的外部系统"。

---

## 11. 数据存储策略

### 11.1 SQLite 为唯一存储

OpenClaw 的存储哲学是 **SQLite only**：

- **共享状态 DB**：`state/openclaw.sqlite` — 全局运行时状态和插件 KV 数据
- **Agent DB**：`agents/<agentId>/agent/openclaw-agent.sqlite` — Agent 级别的状态/缓存
- **专用 DB**：仅在 schema、数据量或生命周期明显不匹配上述两个时使用

**不使用** JSON/JSONL/TXT/sidecar 文件存储运行时状态。文件存储仅限于命名产品工件（导入/导出、用户附件、日志、备份）。

选择 SQLite 的原因：**local-first 意味着没有分布式存储需求**。SQLite 是单机场景下最成熟、最可靠、零基建的选择——不需要额外的数据库进程，不需要连接池，不需要考虑网络分区。代价是无法水平扩展，但这在 local-first 场景下根本不是问题。

### 11.2 运行时只读规范配置

Core 运行时只消费当前规范形状的配置。旧格式/退役形状只在 `doctor --fix` 迁移代码中规范化，运行时不做 shims、aliases 或 fallback readers。

这个约束的意图是**保持运行时代码路径的简洁性**——如果运行时要兼容 N 种配置格式，代码路径就会指数级膨胀。把兼容性责任推给 `doctor --fix`，运行时只需要处理一种格式。

---

## 12. 总结

OpenClaw 的架构可以总结为一句话：**一个 Gateway 总线驱动六层可插拔架构，从 CLI 到 Channel 端到端打通 agent 生命周期**。

核心设计理念：

1. **Local-first**：Gateway 在你自己的机器上跑，数据留在本地——这是架构的基座，所有其他决策都受它约束
2. **Plugin-agnostic core**：核心不依赖任何特定 SaaS，Channel/Provider 都是插件——这保证了核心的稳定性和可替换性
3. **身份优先安全**：per-session sandbox，"你是谁比你做什么更重要"——session 是最稳定的信任边界
4. **可替换而非可配置**：Context Engine 是 slot + 检疫机制，而非配置开关——这保证了渐进降级而非一刀切
5. **Node 设备模型**：端侧不是薄客户端，而是有本地能力的设备节点——能力声明权在端侧，编排权在 Gateway
6. **进程稳定元数据**：Gateway 运行时冻结插件注册表，热路径不做 freshness polling——这直接决定了插件的性能上限

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
