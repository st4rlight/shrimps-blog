---
title: OpenClaw Channel 架构深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 从核心抽象到 Feishu 插件实现，拆解 Channel 的适配器契约、消息投递与入站可靠性防御。
createTime: 2026/06/08 00:01:02
permalink: /ai-source/openclaw-channel-architecture/
---
# OpenClaw Channel 架构深度解析：从核心抽象到 Feishu 插件实现

> 📖 **阅读顺序：7 / 共 8 篇** · 🔵 深入 · IM 通道系统（飞书/Telegram/Slack/...）— 按需读

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| Channel 怎么分类、怎么命名 | 核心层 ChatType / ChannelId |
| 一个 Channel 插件要实现什么 | §3 ChannelPlugin 适配器契约（38 个可选槽位） |
| Channel 怎么被发现和加载 | §4 四阶段注册（构建时元数据 → Bootstrap → 运行时 → 懒加载） |
| 消息怎么发出去 | §5 消息投递契约（durableFinal / live / receive） |
| 飞书怎么从消息进来又出去 | §6 Feishu 插件实现（含 bot.ts 1788 行详解） |
| 一条飞书消息的完整旅程 | §7 完整消息流转链路 |
| 整体设计理念是什么 | §8 架构设计哲学（7 条） |

**一句话**：Channel = OpenClaw 对接 30+ IM/邮件平台的统一抽象。`ChannelPlugin` 类型有 38 个**可选**适配器（不强制实现），核心通过 `openclaw/plugin-sdk/*` 边界与插件交互。Feishu 是最复杂的实现（约 20 个适配器 + 1788 行 bot.ts + 五层入站处理 + 多种渲染模式）。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/channels/chat-type.ts:11                ← "direct" | "group" | "channel" 三种标准类型
  src/channels/plugins/types.plugin.ts:66     ← ChannelPlugin 泛型类型
  src/channels/plugins/types.adapters.ts      ← 38 个适配器的具体类型
  src/channels/plugins/bundled-ids.ts         ← 内建 channel ID 注册表
  src/channels/plugins/bootstrap-registry.ts  ← Bootstrap 注册

写一个新 Channel 插件，按这个顺序：
  extensions/<your-channel>/openclaw.plugin.json  ← 清单
  extensions/<your-channel>/src/channel.ts         ← ChannelPlugin 入口
  extensions/<your-channel>/src/monitor.account.ts ← 入站监听
  extensions/<your-channel>/src/bot.ts             ← 业务逻辑
  extensions/<your-channel>/src/outbound.ts        ← 出站发送
```

---

## 目录

1. [概述](#概述)
2. [核心层：通道的基础定义](#核心层通道的基础定义)
3. [ChannelPlugin：插件类型契约](#channelplugin插件类型契约)
4. [注册与加载机制](#注册与加载机制)
5. [消息投递契约](#消息投递契约)
6. [Feishu 插件实现分析](#feishu-插件实现分析)
7. [完整消息流转链路](#完整消息流转链路)
8. [架构设计哲学](#架构设计哲学)

---

## 概述

OpenClaw 是一个多通道 AI 代理平台，核心设计原则是 **"Core stays plugin-agnostic"**——核心运行时不知道任何具体通道的细节，所有通道行为都通过插件机制注册和驱动。`src/channels` 定义通道的抽象契约，`extensions/` 下各插件提供具体实现。

这套架构让 OpenClaw 可以同时对接飞书、Telegram、Slack、Discord 等十多个消息平台，核心路由、会话管理、消息去重等逻辑保持统一。

### 整体分层

```
┌─────────────────────────────────────────────────┐
│                  用户 / 消息平台                   │
└────────────────────┬────────────────────────────┘
                     │  各平台协议
┌────────────────────▼────────────────────────────┐
│           extensions/* — 通道插件层               │
│  (feishu / telegram / slack / discord / ...)     │
│  实现 ChannelPlugin 契约，内化平台差异            │
└────────────────────┬────────────────────────────┘
                     │  plugin-sdk 公共 API
┌────────────────────▼────────────────────────────┐
│          src/channels — 核心抽象层                │
│  ChannelPlugin 类型 / Registry / MessageAdapter  │
│  统一 ChatType / MessagingTarget / Session 路由  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           src/agents — Agent 运行时               │
│  prompt 组装 / LLM 调用 / 工具执行               │
└─────────────────────────────────────────────────┘
```

**关键边界**：插件只能通过 `openclaw/plugin-sdk/*` 与核心交互，不能直接导入核心 `src/**` 内部模块。

---

## 核心层：通道的基础定义

### Channel ID 与身份体系

每个通道有一个全局唯一标识符 `ChatChannelId`（即 `string`），核心层通过三层机制管理通道身份：

| 层级 | 机制 | 作用 |
|------|------|------|
| 规范化 | `normalizeChatChannelId` | 统一小写，确保 `Feishu` 和 `feishu` 等价 |
| 别名 | `aliases` 字段 | 同一通道可注册多个名字（如 `feishu` 别名 `lark`） |
| 生成元数据 | `GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA` | 构建时扫描 `extensions/` 生成，让核心在不加载插件代码的前提下就知道有哪些通道可用 |

**设计意图**：构建时元数据实现了"零加载发现"——核心启动时不需要 import 任何插件代码即可列出所有可用通道。如果生成元数据缺失，运行时回退到文件系统目录扫描。

### ChannelMeta：通道元数据

`ChannelMeta` 是用户可见的通道描述信息，驱动 UI 展示和文档生成。关键字段包括：

- **`id`**：通道标识（如 `"feishu"`）
- **`label` / `selectionLabel`**：短名与选择器标签（如 `"Feishu"` / `"Feishu/Lark (飞书)"`）
- **`docsPath`**：文档路径（如 `"/channels/feishu"`）
- **`aliases`**：别名数组（如 `["lark"]`）
- **`order`**：UI 排序权重
- **`markdownCapable` / `showInSetup`**：能力与可见性标记

Feishu 的 meta 额外设置了 `preferSessionLookupForAnnounceTarget: true`，表示广播目标选择时优先从会话记录中查找，因为飞书的群组 ID 不像用户 ID 那样直观。

### ChannelCapabilities：能力声明

每个通道声明自己支持的功能，核心运行时据此决定路由策略和降级行为。能力项涵盖了消息操作的方方面面：

| 能力 | 语义 | Feishu 声明 |
|------|------|-------------|
| `chatTypes` | 支持的会话类型 | `["direct", "channel"]` |
| `threads` | 线程/话题 | ✅ |
| `media` | 媒体消息 | ✅ |
| `reactions` | 表情回应 | ✅ |
| `edit` | 消息编辑 | ✅ |
| `reply` | 消息回复 | ✅ |
| `polls` | 投票 | ❌ |
| `tts` | 语音合成 | ✅（语音笔记 + 音频转码） |
| `blockStreaming` | 块级流式 | 未声明 |

> **为什么 Feishu 的 chatTypes 是 `["direct", "channel"]` 而不含 `"group"`？**
> 这是 OpenClaw 的语义映射：飞书的 `group` 和 `topic_group` 两种群聊类型，在核心抽象中被统一归入 `channel` 语义——即"多参与者会话"。核心不关心平台是叫"群"还是"频道"，只关心会话的交互模式。

### ChatType：会话类型抽象

OpenClaw 将所有平台的会话归纳为三种标准类型：

| ChatType | 语义 | 飞书映射 | Telegram 映射 |
|----------|------|----------|---------------|
| `direct` | 一对一私聊 | `p2p` / `private` | `private` |
| `group` | 群聊（核心知道成员关系） | — | `group` |
| `channel` | 频道/公开群 | `group` / `topic_group` | `supergroup` |

**设计意图**：不同平台对"群"和"频道"的定义千差万别。OpenClaw 不试图统一命名，而是通过通道插件的映射函数将平台语义转换为内部语义，核心只基于标准类型做路由和策略。

### 消息目标体系

`MessagingTarget` 是跨通道统一的消息目标描述，每个目标由 `kind`（`"user"` 或 `"channel"`）和 `id` 组成，附带 `raw`（原始值）和 `normalized`（规范化后的 `kind:id` 格式）。

核心提供了多种解析策略，按确定性优先级依次尝试：
1. **@mention 模式**（`parseTargetMention`）— 解析平台特有的提及语法
2. **前缀模式**（`parseTargetPrefix`）— 解析 `user:xxx`、`chat:xxx` 等
3. **@user 简写**（`parseAtUserTarget`）— 解析 `@user` 形式

这种策略链模式确保了不同输入风格都能被解析，同时优先选择最确定性的匹配。

---

## ChannelPlugin：插件类型契约

`ChannelPlugin` 是整个通道系统的核心类型契约，定义了插件必须或可以选择实现的适配器槽位。它是一个泛型类型 `ChannelPlugin<ResolvedAccount, Probe, Audit>`，允许插件指定自己的账号解析结果、状态探测结果和安全审计结果类型。

### 适配器总览

全部槽位均为可选，插件只需实现自己关心的部分：

| 类别 | 适配器 | 职责 |
|------|--------|------|
| **身份** | `id` + `meta` + `capabilities` | 通道标识、元数据、能力声明 |
| **配置** | `config` / `configSchema` / `defaults` / `reload` | 账号解析、配置读写、热重载 |
| **生命周期** | `setup` / `setupWizard` / `lifecycle` / `doctor` | 设置向导、启动诊断、配置迁移 |
| **安全** | `security` / `allowlist` / `auth` / `pairing` / `approvalCapability` | DM/群策略审计、白名单、登录认证、配对验证 |
| **消息** | `outbound` / `message` / `messaging` / `streaming` | 出站发送、消息适配器、目标路由、流式输出 |
| **交互** | `actions` / `commands` / `agentPrompt` / `agentTools` | 工具动作、命令树、Agent 提示、专属工具 |
| **社交** | `directory` / `mentions` / `groups` / `threading` | 通讯录、@提及、群组策略、线程路由 |
| **运维** | `gateway` / `gatewayMethods` / `gatewayMethodDescriptors` / `status` / `heartbeat` / `secrets` | 通道启停、状态探测、密钥管理 |
| **绑定** | `bindings` / `conversationBindings` / `elevated` / `resolver` | 会话绑定、提升权限、ID 解析 |

**设计意图**：这种"可选适配器"模式实现了关注点分离——简单通道只实现 `config` + `gateway` + `outbound` 即可运行，而功能丰富的通道（如 Feishu）可以实现大部分槽位。核心通过 `??` 和条件判断优雅处理缺失适配器。

### 关键适配器深入分析

#### `config` — 账号解析与配置

这是唯一**必选**的适配器，负责将原始配置（JSON/env）解析为类型安全的 `ResolvedAccount`。Feishu 的实现使用了 `createHybridChannelConfigAdapter`，支持顶层默认 + 多账号覆盖的合并模式——即 `accounts` 中的每个账号可以覆盖顶层 `appId`/`appSecret` 等默认值。

#### `messaging` — 消息路由大脑

这个适配器承担了通道最核心的路由计算职责：

- **目标规范化**（`normalizeTarget`）：将各种格式的目标 ID 统一化
- **投递目标解析**（`resolveDeliveryTarget`）：将会话 ID 映射为实际的飞书目标地址（直接会话 → `user:openId`，话题线程 → `chat:chatId` + `threadId`）
- **出站会话路由**（`resolveOutboundSessionRoute`）：根据目标前缀和 ID 特征判断是 DM 还是群聊
- **会话解析**（`resolveSessionConversation`）：解析会话 ID 的层次关系（如话题 → 父群）

#### `gateway` — 通道启停入口

负责建立与消息平台的连接（WebSocket/Webhook），管理连接生命周期。Feishu 的实现通过动态 import 加载 monitor 模块，支持 `AbortSignal` 驱动的优雅停止。

---

## 注册与加载机制

通道注册分为四个渐进阶段，核心思想是**尽可能延迟代码加载**：

```
构建时元数据 → Bootstrap Registry → 运行时 Registry → 模块按需加载
   (零代码)       (轻量发现)         (完整插件)        (懒加载)
```

### 阶段一：构建时元数据生成

构建过程扫描 `extensions/` 目录，生成 `GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA`，包含所有内建通道的 id、别名和排序。这让核心在不加载任何插件代码的情况下就能列出可用通道——对于 CLI 帮助文本和配置校验等场景至关重要。

### 阶段二：Bootstrap Registry

`bootstrap-registry.ts` 在完整运行时注册之前提供轻量级通道发现，主要用于 `doctor` 和 `setup` 流程——这些流程可能在完整运行时不可用时就需要通道信息。

Bootstrap 会合并运行时制品和设置制品（`mergeBootstrapPlugin`），确保即使在部分安装状态下也能工作。

### 阶段三：运行时 Registry

完整运行时通过 `registry-loaded.ts` 和 `registry-lookup.ts` 管理已加载的通道插件。**加载优先级**：

```
已加载的运行时插件 > 内建捆绑插件
```

这个优先级意味着：如果用户通过插件市场安装了新版本的通道插件，它会覆盖内建的捆绑版本，无需修改核心代码。

### 阶段四：模块加载器与安全

`module-loader.ts` 处理实际的代码加载，支持 JS 和 TS（通过 jiti）。加载前会进行路径安全检查（`openRootFileSync`），**防止插件模块路径逃逸到工作目录之外**。

`registry-lookup.ts` 构建了按 id 和别名索引的双索引快速查找表（`byKey` + `byId`），使用版本号做缓存失效，确保热重载后查找表与实际状态一致。

---

## 消息投递契约

OpenClaw 的消息投递采用分层适配器设计，`ChannelMessageAdapterShape` 定义了三种消息能力：

| 能力 | 语义 | 使用场景 |
|------|------|----------|
| `durableFinal` | 可靠的最终投递 | Agent 完成回复后的确定性发送 |
| `live` | 实时流式 | 流式预览、进度指示 |
| `receive` | 入站消息确认 | 消息回执和确认策略 |

**设计意图**：将消息投递分为"最终投递"和"实时预览"两个独立能力，让通道可以只实现 `durableFinal` 而不支持流式，也可以同时实现两者提供更好的用户体验。

Feishu 声明了 `durableFinal` 的 `text` 和 `media` 能力，其 `send.text` 和 `send.media` 分别委托给 `feishuOutbound` 的对应方法。这是典型的**适配器委托模式**——`ChannelMessageAdapter` 是面向核心的统一接口，内部委托给通道特有的出站实现。

---

## Feishu 插件实现分析

### 插件清单与配置

Feishu 插件根目录 `extensions/feishu/`，清单文件 `openclaw.plugin.json` 声明了：

- **通道绑定**：`channels: ["feishu"]`
- **工具契约**：`feishu_chat`、`feishu_doc`、`feishu_drive`、`feishu_perm`、`feishu_wiki`、`feishu_bitable_*`
- **配置 Schema**：基于 JSON Schema，支持多账号

关键配置项的架构设计意图：

| 配置 | 架构意义 |
|------|----------|
| `connectionMode` | 抽象连接方式，WebSocket（推荐，低延迟）和 Webhook（兼容防火墙） |
| `renderMode` | 三种渲染策略，平衡体验和兼容性（详见出站部分） |
| `domain` | 统一国内版/国际版差异，运行时据此选择 API 端点 |
| `replyInThread` | 控制回复策略，影响会话路由和消息展示方式 |
| `accounts` | 多租户支持——同一 OpenClaw 实例可对接多个飞书应用 |

### 插件入口与懒加载

Feishu 使用 `defineBundledChannelEntry` 注册为内建通道，其入口设计体现了三层懒加载架构：

```
入口层 (index.ts)           — 仅注册元数据和加载说明
  ├── plugin   specifier + exportName  → 懒加载插件主体
  ├── secrets  specifier + exportName  → 懒加载密钥契约
  └── runtime  specifier + exportName  → 懒加载运行时注入
注册层 (registerFull)       — 独立注册飞书特有工具
  ├── feishu_doc            — 文档工具
  ├── feishu_chat           — 聊天工具
  ├── feishu_wiki           — 知识库工具
  ├── feishu_drive          — 云文档工具
  ├── feishu_perm           — 权限工具
  └── feishu_bitable        — 多维表格工具
```

**设计意图**：
1. **specifier + exportName 模式**：启动时只加载入口文件，插件主体、密钥、运行时均按需加载，显著减少冷启动时间
2. **工具注册分离**：飞书特有的工具（文档、知识库、多维表格等）不污染核心工具注册，只在 `registerFull` 中声明，核心通过工具契约发现它们
3. **运行时注入**（`setFeishuRuntime`）：核心启动后将运行时依赖（如 channelRuntime）注入插件，反转了依赖方向——插件不依赖核心的启动时序

### Feishu 的 ChannelPlugin 组装

Feishu 的 `ChannelPlugin` 通过 `createChatChannelPlugin` 工厂函数构建（约 1400 行），将适配器分为 `base`（核心）和外部（`security`、`pairing`、`outbound`）两组。这种分组是因为 `createChatChannelPlugin` 对 base 中的适配器做了额外的包装和验证，而外部适配器直接透传。

Feishu 实现了约 20 个适配器，覆盖了大部分功能，体现了飞书作为企业级消息平台的丰富能力。

### 消息入站：分层处理链路

入站消息经过分层递进处理，每层解决一个特定的问题。飞书的 monitor 实现不是单一的 `monitor.ts`，而是**按职责拆分**到多个文件：

```
飞书服务端
  │  (WebSocket / Webhook)
① monitor.account.ts — 账号调度
  │  遍历启用的账号，为每个账号启动独立的监听
② monitor.transport.ts — 传输层
  │  建立 WebSocket 长连接 或注册 Webhook 处理器
③ monitor.state.ts / monitor.bot-identity.ts — 状态与身份
  │  bot 身份解析、消息认领（去重）状态
④ bot.ts — 业务逻辑
  │  消息解析 → 权限检查 → 会话路由 → 回复分发
⑤ 核心运行时 — Agent 执行
```

> **注意**：入站消息的"去重 / 防抖 / 合并 / 顺序队列"等预处理步骤的代码**分散在 `monitor.state.ts` / `monitor.bot-identity.ts` / `bot.ts` 等多个文件中**（没有独立的 `monitor.message-handler.ts`），各模块按职责归属。`extensions/feishu/src/` 共有约 100 个生产源码文件（不含 `*.runtime.ts` / `*.test-support.ts` / `*.test-helpers.ts` 等辅助文件）。

![入站消息三层可靠性纵深防御](/ai-source/open-claw/openclaw-channel-inbound-defense.svg)

#### 消息预处理的关键设计

这一层是入站消息可靠性的核心，解决三个问题：

**1. 去重（Processing Claims）**

使用 `tryBeginFeishuMessageProcessing` 实现基于 claim 的互斥：当一条消息被接收后，其 dedupe key 被"认领"，后续相同 key 的消息直接丢弃。处理完成后通过 `finalizeFeishuMessageProcessing` 释放 claim。这比简单的"已处理"集合更健壮——它能区分"正在处理"和"已经处理"两种状态。

**2. 防抖（Inbound Debouncer）**

用户在飞书中快速连续发送多条文本消息时，防抖器会将它们合并为一条消息处理。防抖键格式为 `feishu:{accountId}:{chatId}:{threadKey}:{senderId}`，确保：
- 不同用户的消息不会合并
- 不同群的消息不会合并
- 同一群内不同话题的消息不会合并
- 只对纯文本消息防抖（非文本消息如图片、卡片不参与合并）

合并策略：保留最后一条消息的结构，将所有消息的文本拼接，mention 列表取并集。

**3. 顺序队列（Sequential Queue）**

同一会话的消息必须按顺序处理，否则可能发生回复错乱。顺序队列以 chat ID 为 key，确保同一聊天中的消息严格串行处理。队列还内置了超时驱逐机制——如果某个任务执行超时，自动从队列中移除，避免后续消息被永久阻塞。

#### 第四层：Bot 的业务逻辑

Bot 是入站消息的核心处理器（约 1700 行），执行：

- **消息解析**：将飞书的 `text`、`post`（富文本）、`interactive`（卡片）、`media`（媒体）等消息类型统一解析为 OpenClaw 的消息格式
- **@提及检测**：判断是否 @了机器人，这影响群聊中的触发策略
- **权限检查**：多层策略——DM 策略（`dmPolicy`）、群策略（`groupPolicy`）、发送者白名单（`allowFrom`/`groupAllowFrom`）
- **会话路由**：根据 `FeishuGroupSessionScope` 计算 sessionKey，决定消息路由到哪个 Agent
- **动态 Agent 创建**：DM 场景下可选地为每个用户创建独立 Agent 实例，拥有独立的工作空间
- **回复分发**：通过 `createFeishuReplyDispatcher` 发送回复，支持流式预览和最终投递

### 消息出站：渲染与发送

出站消息经过三层处理：

```
Agent 生成回复
  │
① outbound adapter — 格式选择
  │  判断渲染模式，构建 Presentation 或纯文本
② send.ts — API 调用
  │  创建飞书 Client，构建消息体，调用 API
③ 飞书服务端 — 消息投递
```

#### 渲染模式的三策略设计

| 模式 | 策略 | 适用场景 |
|------|------|----------|
| `auto` | 自动判断：含代码块或表格 → 卡片，否则 → 纯文本 | 大多数场景的最佳选择 |
| `raw` | 始终纯文本（飞书 post 格式） | 需要最大兼容性时 |
| `card` | 始终交互式卡片（Schema 2.0） | 需要最佳 Markdown 渲染效果时 |

`auto` 模式的判断逻辑：检测文本中是否包含代码围栏（ triple-backtick ）或 Markdown 表格（`|...|` 分隔线），有则使用卡片渲染，否则使用纯文本。这个策略基于一个经验事实——飞书纯文本模式对代码块和表格的渲染效果较差，而卡片模式的 Markdown 渲染更优。

#### 卡片构建与安全

飞书卡片使用 Schema 2.0 格式，支持 Markdown 内容、交互按钮、头部标题和颜色模板。按钮 URL 安全校验是关键安全设计——只允许 `https:` 和 `http:` 协议的 URL，防止 `javascript:` 等危险协议注入。卡片 Markdown 内容还经过 HTML 实体转义（`<` → `&lt;` 等），防止 XSS。

#### 回复策略与降级

飞书支持两种回复模式：

| 模式 | API 行为 | 效果 |
|------|----------|------|
| Inline Reply | `im.message.reply` + `replyToMessageId` | 回复引用原始消息 |
| Thread Reply | `im.message.reply` + `reply_in_thread: true` | 在话题线程中创建回复 |

**关键降级设计**：如果回复目标消息已被撤回，飞书 API 会返回错误。Feishu 插件检测到撤回错误后，自动降级为直接发送（`sendFallbackDirect`），而不是让消息丢失。这种"尽力投递"策略保证了即使原始上下文被用户删除，Agent 的回复仍能送达。

### 会话作用域：飞书特有的会话隔离

飞书的群聊支持"话题"（Topic）功能，这是许多其他平台没有的。OpenClaw 为此设计了 **FeishuGroupSessionScope** 机制，提供四种粒度的会话隔离：

| 作用域 | 语义 | 会话 ID 格式 | 典型场景 |
|--------|------|-------------|----------|
| `group` | 整个群为一个会话 | `{chatId}` | 简单群助手 |
| `group_sender` | 群内每个发送者独立会话 | `{chatId}:sender:{openId}` | 群内多用户各自独立对话 |
| `group_topic` | 每个话题独立会话 | `{chatId}:topic:{topicId}` | 话题群，不同话题互不干扰 |
| `group_topic_sender` | 话题内每个发送者独立会话 | `{chatId}:topic:{topicId}:sender:{openId}` | 最细粒度隔离 |

**设计意图**：会话作用域直接决定 Agent 的上下文范围。在 `group` 模式下，群内所有人共享一个对话上下文；在 `group_topic_sender` 模式下，每个用户在每个话题中都有独立的对话上下文。作用域的选择取决于业务需求——是希望 Agent "记住"整个群的对话，还是每个话题独立，还是每个用户独立。

作用域还支持优雅降级：例如 `group_topic_sender` 模式下，如果消息不在话题中，则退化为 `group_sender`；如果连 `senderOpenId` 也缺失，则退化为 `group`。

此外，存在向后兼容设计：旧的 `topicSessionMode: "enabled"` 配置自动映射为 `groupSessionScope: "group_topic"`，确保升级后行为不变。

---

## 完整消息流转链路

以一条典型的飞书群消息为例，展示从入站到出站的完整流转：

```
1. 用户在飞书群中 @机器人 发送消息
      │
2. 飞书服务端推送事件到 OpenClaw
   (WebSocket 长连接 或 Webhook HTTP POST)
      │
3. monitor.transport.ts 接收原始事件
      │
4. 消息预处理（去重 / 防抖 / 顺序队列等逻辑分散在
   monitor.state.ts、monitor.bot-identity.ts、bot.ts 等多个文件中）：
   a. 解析事件负载
   b. Processing Claim 去重检查
   c. 防抖入队（仅文本消息参与防抖）
   d. 防抖 flush 时合并文本、去重、保留最新结构
      │
5. Sequential Queue 按 chat 串行执行
      │
6. bot.ts 业务处理：
   a. 解析消息内容（文本 / 富文本 / 卡片 / 媒体）
   b. 检测 @提及、执行 DM/群权限策略
   c. 根据 groupSessionScope 计算会话 ID
   d. 解析 Agent 路由（绑定 > 配置 > 默认）
   e. 加载聊天历史作为上下文
   f. 构建入站事件上下文，调用核心运行时
      │
7. 核心运行时 → Agent 执行：
   a. 组装 prompt（系统提示 + 历史消息 + 工具定义）
   b. 调用 LLM（通过 provider 插件）
   c. 处理工具调用（可能调用 feishu_chat、feishu_doc 等）
   d. 生成最终回复
      │
8. 核心运行时 → outbound adapter：
   a. 流式预览（如果启用 streaming）
   b. 最终投递 → feishuOutbound
      │
9. outbound.ts 渲染与发送：
   a. 根据 renderMode 选择渲染方式
   b. 构建 Presentation（卡片）或纯文本
   c. 调用 send.ts 的发送函数
      │
10. send.ts → 飞书 API：
    a. 解析目标地址（user:openId / chat:chatId）
    b. 创建飞书 Client
    c. 调用 im.message.create 或 im.message.reply
    d. 发送失败时执行降级（如回复目标撤回 → 直接发送）
       │
11. 飞书服务端投递消息给用户
```

---

## 架构设计哲学

### 1. 插件隔离，核心无关

核心运行时（`src/`）完全不知道飞书、Telegram 等具体通道的存在。所有通道行为通过 `ChannelPlugin` 类型契约注册，插件只能通过 `openclaw/plugin-sdk/*` 与核心交互。这确保了：
- 核心代码不会因新增或修改通道而变更
- 插件之间完全隔离，一个插件的 bug 不会影响其他通道
- 新通道实现者只需要关注类型契约

### 2. 适配器模式，按需实现

`ChannelPlugin` 有 30+ 适配器槽位，全部可选。Feishu 实现了约 20 个（config、outbound、messaging、actions、gateway、directory、status、security、doctor、threading 等），而简单通道可能只需要 5-6 个。核心通过条件判断优雅处理缺失适配器，不要求"空实现"。

### 3. 渐进加载，冷启动优先

四阶段加载策略（构建时元数据 → Bootstrap → 运行时 Registry → 模块按需加载）确保冷启动时间最短。用户运行 `openclaw doctor` 或 `openclaw configure` 时，不需要加载任何插件的完整代码。

### 4. 统一抽象，平台差异内化

核心定义了 `ChatType`（direct/group/channel）、`MessagingTarget`（user/channel）、`InboundEventKind`（user_request/room_event）等统一抽象。各通道插件负责将平台特有概念映射到这些抽象——例如飞书的 `topic_group` 映射为 `channel`，话题线程映射为 `group_topic` 会话作用域。这种设计让核心的路由和策略逻辑保持平台无关。

### 5. 可靠性纵深防御

入站消息经过去重（processing claims）→ 防抖（debounce 合并）→ 顺序队列（串行处理）三重保障，确保消息不重复、不丢失、不乱序。出站消息有降级策略（回复目标撤回时自动降级为直接发送）。这种纵深防御不是冗余——每层解决不同的问题：去重防网络重传，防抖防用户连发，顺序队列防并发竞态。

### 6. 安全内建，而非外挂

- 模块加载有路径逃逸检查
- 卡片按钮有 URL 协议白名单（仅 https/http）
- 卡片内容经过 HTML 实体转义
- 密钥通过 `secrets` 适配器管理，支持 env/file/exec 多种来源
- DM/群策略、白名单、工具权限（`resolveToolPolicy`）形成多层权限检查

### 7. 配置向后兼容

会话作用域设计保留了旧配置的兼容路径（`topicSessionMode: "enabled"` → `groupSessionScope: "group_topic"`），而 `doctor` 命令负责将旧配置迁移到新格式。运行时只消费最新格式的配置，不做兼容降级——兼容逻辑属于迁移层，不属于运行时层。

---

## 🎯 如果只记 3 件事

1. **"Channel 插件 = 30+ 可选适配器 + 1 个必选 `config`"** —— 简单通道实现 5-6 个就能跑，复杂通道（Feishu）实现 20+。**`config` 是唯一必选**，其他都可选。**核心不会因插件缺适配器崩溃**——它通过 `??` 和条件判断优雅处理。
2. **"Channel 只做消息翻译，不做产品决策"** —— 它把外部事件翻译成内部 `InboundEvent`，把内部消息翻译成外部格式。**不**拥有命令树、不**拥有** Provider 策略、不**拥有**特性菜单。这是和"消息总线"的根本区别。
3. **"入站三层可靠性纵深防御**"——**去重**（processing claims，防网络重传）+ **防抖**（debounce 合并，防用户连发）+ **顺序队列**（按 chat 串行，防并发竞态）。**每层解决不同问题**，缺一不可。出站有"回复目标撤回 → 降级为直接发送"兜底。

> 📚 **配套阅读**：
> - Channel 怎么接入 Gateway：[openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §6 广播系统
> - Channel 怎么喂消息给 Agent：[openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md) §8 路由解析
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md) §6 第六层
> - Channel 插件怎么被发现/加载：[openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md) §2-4
