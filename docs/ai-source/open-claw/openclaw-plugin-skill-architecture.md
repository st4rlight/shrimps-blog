---
title: OpenClaw 插件 / 扩展 / Skill 体系深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 拆解插件发现与加载流程、Manifest-First 设计、60+ Plugin API、Skill 系统与 Hook 执行模型。
createTime: 2026/06/08 10:17:06
permalink: /ai-source/openclaw-plugin-skill-architecture/
---
# OpenClaw 插件 / 扩展 / Skill 体系深度解析：Manifest-First 的可扩展架构

> 📖 **阅读顺序：3 / 共 8 篇** · 🟡 核心 · 理解扩展机制（Gateway 能力的来源）
>
> 基于 `src/plugins/`、`src/plugin-sdk/`、`src/skills/`、`packages/plugin-sdk/`、`packages/plugin-package-contract/` 源码分析。本文拆解插件发现与加载的完整流程、Manifest-First 的设计哲学、Plugin API 的 60+ 注册方法、Skill 系统的发现与生命周期、Hook 系统的执行模型、Extension 即 npm 包的分发合约——揭示 OpenClaw 如何在"核心不依赖任何特定 SaaS"的前提下，实现 100+ 扩展的统一管理。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| 插件设计的根本原则是什么 | §1 Manifest-First（零代码发现） |
| 插件从哪些来源被找到 | §2 五源扫描（bundled/workspace/global/package/dev） |
| 怎么验证清单、怎么索引来源 | §3 清单注册表 |
| 从候选到运行的完整流程 | §4 插件加载 6 阶段 |
| 插件能注册什么能力 | §5 Plugin API（60+ 注册方法） |
| 外部插件怎么发版 | §6 Extension 即 npm 包 |
| Skill 跟 Plugin 有什么区别 | §7 Skill 系统 |
| 怎么在 Agent 生命周期里塞自己的逻辑 | §8 Hook 系统（39 个 hook） |
| 怎么做到冷启动快 | §9 Lazy Activation |
| 整体设计哲学 | §10 设计哲学（5 条） |

**一句话**：Plugin = 扩展 OpenClaw 的标准方式——通过 `openclaw.plugin.json` 清单发现（**不 import 插件代码**），通过 60+ `api.register*` 方法注册能力。Skill 是更轻量的扩展（Markdown + frontmatter）。**Manifest-First + Lazy Activation** 是冷启动快的核心。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/plugins/types.ts:2597              ← OpenClawPluginApi（60+ register 方法都在这）
  src/plugins/discovery.ts               ← discoverOpenClawPlugins（五源扫描）
  src/plugins/manifest.ts                ← loadPluginManifest
  src/plugins/api-builder.ts             ← buildPluginApi（实际返回 api 对象）
  src/plugins/hook-types.ts:75-120       ← 39 个 hook 联合类型
  src/skills/                            ← Skill 系统

写一个新插件：
  extensions/<your-plugin>/openclaw.plugin.json  ← 清单（id/kind/contracts/configSchema）
  extensions/<your-plugin>/src/index.ts          ← register(api) / activate(api)
  packages/plugin-package-contract/              ← 外部 npm 包的合约
```

---

## 目录

1. [Manifest-First：零代码发现的设计哲学](#1-manifest-first零代码发现的设计哲学)
2. [插件发现：五源扫描与候选收集](#2-插件发现五源扫描与候选收集)
3. [清单注册表：验证、合并与索引](#3-清单注册表验证合并与索引)
4. [插件加载：从候选到运行时](#4-插件加载从候选到运行时)
5. [Plugin API：60+ 注册方法的扩展面](#5-plugin-api60-注册方法的扩展面)
6. [Extension 即 npm 包：分发合约](#6-extension-即-npm-包分发合约)
7. [Skill 系统：内置技能的发现与生命周期](#7-skill-系统内置技能的发现与生命周期)
8. [Hook 系统：Agent 生命周期的可扩展点](#8-hook-系统agent-生命周期的可扩展点)
9. [Lazy Activation：冷启动优先的加载策略](#9-lazy-activation冷启动优先的加载策略)
10. [设计哲学总结](#10-设计哲学总结)

---

## 1. Manifest-First：零代码发现的设计哲学

OpenClaw 插件系统最核心的设计原则是 **Manifest-First**——发现、配置验证、setup 应该从元数据工作，而不是执行插件代码。

这意味着：

```
传统插件系统：
  发现 → import 插件代码 → 调用注册函数 → 获取元数据

OpenClaw 插件系统：
  发现 → 读取 openclaw.plugin.json → 获取元数据 → 按需加载代码
```

![插件体系总览](/ai-source/open-claw/openclaw-plugin-skill-overview.svg)

**收益**：
1. **冷启动快**——`openclaw doctor` 或 `openclaw configure` 不需要加载任何插件代码
2. **安全**——在验证配置之前不执行任何插件代码
3. **可诊断**——清单问题可以在加载前发现和报告
4. **构建时元数据**——`GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA` 让核心在不加载插件代码的情况下列出所有可用通道

**三个关键约束**：

| 约束 | 含义 | 为什么 |
|------|------|--------|
| Manifest-first | 发现和配置验证从元数据工作 | 零代码发现 |
| Lazy activation | 发现和激活保持懒加载 | 冷启动优先 |
| No backdoors | Bundled 插件不能用 external 插件不能用的私有通道 | 公平竞争 |

---

## 2. 插件发现：五源扫描与候选收集

`src/plugins/discovery.ts` 的 `discoverOpenClawPlugins` 函数从五个来源扫描插件候选：

```
discoverOpenClawPlugins()
  │
  ├── 来源 1: Bundled（内建捆绑）
  │     扫描 extensions/ 目录下的 openclaw.plugin.json
  │     编译时打包进核心分发
  │
  ├── 来源 2: Workspace（工作空间）
  │     当前工作空间目录中的插件
  │     开发模式下使用
  │
  ├── 来源 3: Global（全局安装）
  │     ~/.openclaw/plugins/ 目录
  │     通过 openclaw install 安装
  │
  ├── 来源 4: Package（npm 包）
  │     package.json 中的 openclaw.extensions 声明
  │     支持 npm 包分发
  │
  └── 来源 5: Dev Source（开发源）
        配置中指定的开发模式路径
        本地开发调试用
```

### 2.1 PluginCandidate

每个候选包含：

```typescript
type PluginCandidate = {
  idHint: string;           // ID 提示（从目录名/包名推断）
  source: string;           // 入口文件路径
  setupSource?: string;     // Setup 入口路径
  rootDir: string;          // 插件根目录
  origin: PluginOrigin;     // 来源类型
  format?: PluginFormat;    // 清单格式
  bundleFormat?: PluginBundleFormat;  // 捆绑格式
  workspaceDir?: string;    // 工作空间目录
  packageName?: string;     // npm 包名
  packageVersion?: string;  // npm 包版本
};
```

### 2.2 安全过滤

发现过程包含多层安全过滤：

- **目录忽略**：`.git`、`node_modules`、`dist`、`build` 等不扫描
- **硬链接检查**：`shouldRejectHardlinkedPluginFiles` 防止通过硬链接逃逸
- **路径安全**：`isPathInside` 确保插件路径不逃逸到工作目录之外
- **API 兼容性**：`satisfiesPluginApiRange` 检查插件的 API 版本范围是否与当前 OpenClaw 兼容

---

## 3. 清单注册表：验证、合并与索引

### 3.1 清单加载

`src/plugins/manifest.ts` 的 `loadPluginManifest` 负责加载和验证 `openclaw.plugin.json`：

```
openclaw.plugin.json
  │
  ├── 基本字段：id, name, description, version
  ├── 激活配置：activation (onStartup, onCommands, onEvents)
  ├── 类型声明：kind (channel, provider, memory, ...)
  ├── 工具契约：contracts (tools, memoryEmbeddingProviders)
  ├── 配置 Schema：configSchema (JSON Schema)
  ├── UI 提示：uiHints
  └── 命令别名：commandAliases
```

### 3.2 来源索引

`buildProvenanceIndex` 构建了插件的来源索引，记录每个插件的来源（bundled/installed/dev/package）和来源路径。这用于：

- 诊断：`openclaw doctor` 可以报告插件的来源和版本
- 冲突解决：同名插件的来源决定优先级
- 安全审计：追踪插件的来源

---

## 4. 插件加载：从候选到运行时

### 4.1 加载流程

```
loadOpenClawPlugins()
  │
  ├── 阶段 1：发现 → PluginCandidate[]
  ├── 阶段 2：清单加载 → PluginManifestRecord[]
  ├── 阶段 3：来源索引 → ProvenanceIndex
  ├── 阶段 4：激活规划 → ActivationPlan
  ├── 阶段 5：代码加载 → PluginRegistry
  └── 阶段 6：注册 → register(api) / activate(api)
```

### 4.2 模块加载器

`src/plugins/module-loader.ts` 处理实际的代码加载：

- 支持 JS 和 TS（通过 jiti 动态编译）
- 加载前进行路径安全检查
- 缓存已加载的模块（避免重复 import）
- 支持 `specifier + exportName` 的懒加载模式

### 4.3 Plugin Registry

`src/plugins/registry-types.ts` 定义了插件注册表的接口：

- **方法注册表**：Gateway RPC 方法
- **工具注册表**：Agent 工具
- **Hook 注册表**：生命周期钩子
- **Provider 注册表**：模型 Provider
- **Channel 注册表**：消息通道
- **命令注册表**：CLI 命令

每个注册表都是独立的，允许并行注册。

---

## 5. Plugin API：60+ 注册方法的扩展面

`src/plugins/api-builder.ts` 的 `buildPluginApi` 构建了插件与核心的交互面。这个 API 对象包含了 60+ 个注册方法，覆盖了 OpenClaw 的每一个扩展点：

### 5.1 核心注册方法

| 类别 | 方法 | 用途 |
|------|------|------|
| **通道** | `registerChannel` | 注册 Channel 插件 |
| **Provider** | `registerProvider` | 注册模型 Provider |
| **工具** | `registerTool` | 注册 Agent 工具 |
| **Hook** | `registerHook` | 注册生命周期钩子 |
| **命令** | `registerCommand` | 注册 CLI 命令 |
| **HTTP 路由** | `registerHttpRoute` | 注册 HTTP API 路由 |
| **Gateway 方法** | `registerGatewayMethod` | 注册 WS RPC 方法 |

### 5.2 专项注册方法

| 类别 | 方法 | 用途 |
|------|------|------|
| **模型目录** | `registerModelCatalogProvider` | 注册统一模型目录 Provider |
| **嵌入** | `registerEmbeddingProvider` | 注册向量嵌入 Provider |
| **语音合成** | `registerSpeechProvider` | 注册语音合成 Provider |
| **实时转录** | `registerRealtimeTranscriptionProvider` | 注册流式 STT Provider |
| **实时语音** | `registerRealtimeVoiceProvider` | 注册双工语音 Provider |
| **转录源** | `registerTranscriptSourceProvider` | 注册会议/导入转录源 |
| **媒体理解** | `registerMediaUnderstandingProvider` | 注册媒体理解 Provider |
| **图像生成** | `registerImageGenerationProvider` | 注册图像生成 Provider |
| **视频生成** | `registerVideoGenerationProvider` | 注册视频生成 Provider |
| **音乐生成** | `registerMusicGenerationProvider` | 注册音乐生成 Provider |
| **Web 搜索** | `registerWebSearchProvider` | 注册 Web 搜索 Provider |
| **Web 获取** | `registerWebFetchProvider` | 注册 Web 内容获取 Provider |

### 5.3 运行时注册方法

| 类别 | 方法 | 用途 |
|------|------|------|
| **Context Engine** | `registerContextEngine` | 注册上下文引擎（互斥 slot） |
| **Harness** | `registerAgentHarness` | 注册 Agent 运行时 |
| **Codex 扩展** | `registerCodexAppServerExtensionFactory` | Codex harness 工具结果中间件（仅 bundled 可用） |
| **运行时无关工具中间件** | `registerAgentToolResultMiddleware` | 跨 runtime 工具结果改写 |
| **压缩** | `registerCompactionProvider` | 注册上下文压缩 Provider |
| **Node Host** | `registerNodeHostCommand` | 注册 Node Host 命令 |
| **Node 调用策略** | `registerNodeInvokePolicy` | 注册 Node 调用策略 |
| **Node CLI 特性** | `registerNodeCliFeature` | 注册 `openclaw nodes` 命令组 |
| **安全审计** | `registerSecurityAuditCollector` | 注册安全审计收集器 |
| **配置迁移** | `registerConfigMigration` / `registerMigrationProvider` | 注册配置/迁移规则 |
| **自动启用探测** | `registerAutoEnableProbe` | 轻量自动启用探测 |
| **服务** | `registerService` / `registerGatewayDiscoveryService` / `registerCliBackend` / `registerTextTransforms` | 注册各种后台服务 |
| **Session 扩展** | `registerSessionExtension` | 注册 Session 状态扩展 |
| **交互处理** | `registerInteractiveHandler` | 注册交互处理器 |
| **对话绑定** | `onConversationBindingResolved` | 监听对话绑定解析 |
| **工具元数据/策略** | `registerToolMetadata` / `registerTrustedToolPolicy` | 工具展示/可信策略（仅 bundled） |
| **Control UI** | `registerControlUiDescriptor` | 注册 Control UI 描述 |
| **后台任务** | `registerDetachedTaskRuntime` | 注册 detached task 运行时（互斥 slot） |
| **记忆** | `registerMemoryCapability` / `registerMemoryPromptSection` / `registerMemoryPromptSupplement` / `registerMemoryCorpusSupplement` / `registerMemoryFlushPlan` / `registerMemoryRuntime` / `registerMemoryEmbeddingProvider` | 注册记忆插件各组件 |
| **重载/配置/命令** | `registerReload` / `registerHostedMediaResolver` / `registerCommand` | 注册重载钩子/媒体解析/无 LLM 命令 |

### 5.4 事件与调度方法

| 类别 | 方法 | 用途 |
|------|------|------|
| **Agent 事件** | `registerAgentEventSubscription` / `emitAgentEvent` | 订阅/发射 Agent 事件 |
| **运行上下文** | `setRunContext` / `getRunContext` / `clearRunContext` | 管理运行上下文 |
| **会话调度** | `scheduleSessionTurn` / `unscheduleSessionTurnsByTag` | 调度 Session Turn |
| **会话动作** | `registerSessionAction` | 注册 Session 动作 |
| **下一步注入** | `enqueueNextTurnInjection` | 注入下一轮对话的内容 |
| **附件发送** | `sendSessionAttachment` | 发送会话附件 |
| **会话调度任务** | `registerSessionSchedulerJob` | 注册会话调度任务清理元数据 |
| **生命周期** | `registerRuntimeLifecycle` | 注册插件生命周期清理 |
| **通用 Hook** | `on(hookName, handler, opts?)` | 通用 hook 订阅（带 priority/timeoutMs） |
| **路径解析** | `resolvePath` | 解析插件根目录内路径 |

---

## 6. Extension 即 npm 包：分发合约

`packages/plugin-package-contract/` 定义了外部插件的 `package.json` 合约：

```json
{
  "name": "openclaw-plugin-example",
  "openclaw": {
    "compat": {
      "pluginApi": "^1.0.0"
    },
    "build": {
      "openclawVersion": "2026.4.15"
    },
    "extensions": {
      "example-plugin": {
        "source": "./src/index.ts",
        "setupSource": "./src/setup.ts"
      }
    }
  }
}
```

### 6.1 合约字段

| 字段 | 用途 |
|------|------|
| `openclaw.compat.pluginApi` | 插件 API 版本范围（semver） |
| `openclaw.build.openclawVersion` | 构建时的 OpenClaw 版本 |
| `openclaw.extensions` | 扩展入口声明 |

### 6.2 设计权衡

**收益**：
- 免去自建 registry——利用 npm 的全球分发基础设施
- 安装简单——`npm install openclaw-plugin-example`
- 版本管理——利用 npm 的 semver 体系

**代价**：
- 供应链安全风险——任何人都可以发布 npm 包冒充插件（对应 ClawHavoc 事件）
- 需要额外的安全措施——代码签名、来源验证、权限沙箱

### 6.3 API 兼容性检查

`src/plugins/package-compat.ts` 的 `resolvePackagePluginApiRange` 从包清单中提取 API 版本范围，并与当前 OpenClaw 版本比较：

```typescript
// 插件声明兼容 pluginApi ^1.0.0
// 当前 OpenClaw 的 pluginApi 版本是 1.2.0
// 兼容性检查：1.2.0 satisfies ^1.0.0 → 通过
```

不兼容的插件会被标记为诊断问题，但不会阻止启动——只是该插件不会被加载。

---

## 7. Skill 系统：内置技能的发现与生命周期

### 7.1 Skill 与 Plugin 的区别

| 维度 | Plugin | Skill |
|------|--------|-------|
| 分发 | npm 包或 bundled | bundled only（内置） |
| 注册 | `register(api)` | frontmatter + 目录约定 |
| 运行时 | 完整的 Plugin API | 有限的工具 + 命令 |
| 配置 | `configSchema` | frontmatter |
| 生命周期 | 独立的 | 与核心绑定 |

Skill 是更轻量的扩展方式——它不需要写 TypeScript 代码，只需要一个 Markdown 文件加 frontmatter。

### 7.2 Skill 类型

```typescript
type OpenClawSkillMetadata = {
  always?: boolean;           // 是否始终加载
  skillKey?: string;          // 技能标识
  primaryEnv?: string;        // 主要环境变量
  requires?: {                // 前置条件
    bins?: string[];          // 需要的可执行文件
    anyBins?: string[];       // 任一可执行文件
    env?: string[];           // 需要的环境变量
    config?: string[];        // 需要的配置项
  };
  install?: SkillInstallSpec[]; // 安装规范
};
```

### 7.3 安装规范

Skill 声明自己需要的安装步骤：

```typescript
type SkillInstallSpec = {
  kind: "brew" | "node" | "go" | "uv" | "download";
  formula?: string;     // brew formula / node package / go module
  package?: string;     // npm/pip/go package name
  url?: string;         // download URL
  bins?: string[];      // 安装后提供的可执行文件
  os?: string[];        // 适用的操作系统
};
```

### 7.4 Skill 快照

`SkillSnapshot` 是 Skill 在运行时的快照，缓存了当前有效的 Skill 列表和 prompt：

```typescript
type SkillSnapshot = {
  prompt: string;       // 生成的 Skill 描述 prompt
  skills: Array<{ name: string; primaryEnv?: string; requiredEnv?: string[] }>;
  skillFilter?: string[];  // Agent 级别的 Skill 过滤器
  version?: number;     // 快照版本号
};
```

当 `skills.*` 配置变更时，快照版本号递增，Session 在下一轮对话时重建快照。

### 7.5 Skill 生命周期

```
discovery → loading → runtime → lifecycle
             │           │          │
             │           │          └─ archive-install / source-install / upload-store
             │           └─ cron-snapshot / session-snapshot / env-overrides
             └─ bundled-dir / frontmatter / workspace-sync
```

**发现**：从 bundled 目录、frontmatter、workspace 同步三种来源发现 Skill
**加载**：解析 frontmatter、验证前置条件
**运行时**：生成 prompt、注册命令、提供工具
**生命周期**：安装、归档、快照、环境覆盖

---

## 8. Hook 系统：Agent 生命周期的可扩展点

### 8.1 Hook 类型与执行时机

`src/plugins/hook-types.ts` 的 `PluginHookName` 联合类型定义了插件可订阅的全部 Hook 点。`PLUGIN_HOOK_NAMES` 数组在源码层强制与联合类型保持一致（编译期 `Exclude<>` 断言为 `never`）。当前共 **39 个** Hook，按生命周期阶段分组：

| 阶段 | Hook |
|------|------|
| **模型解析** | `before_model_resolve` / `agent_turn_prepare` / `before_prompt_build` |
| **Agent 生命周期** | `before_agent_start` / `before_agent_reply` / `before_agent_finalize` / `agent_end` / `before_agent_run` |
| **模型调用** | `model_call_started` / `model_call_ended` / `llm_input` / `llm_output` |
| **压缩** | `before_compaction` / `after_compaction` / `before_reset` |
| **消息流** | `inbound_claim` / `message_received` / `message_sending` / `message_sent` / `reply_payload_sending` / `before_message_write` |
| **工具调用** | `before_tool_call` / `after_tool_call` / `tool_result_persist` |
| **会话** | `session_start` / `session_end` |
| **子 Agent** | `subagent_spawning` *(deprecated)* / `subagent_delivery_target` / `subagent_spawned` / `subagent_ended` |
| **Gateway** | `gateway_start` / `gateway_stop` / `deactivate` *(deprecated)* |
| **调度/心跳** | `cron_changed` / `heartbeat_prompt_contribution` |
| **命令派发** | `before_dispatch` / `reply_dispatch` / `before_install` / `resolve_exec_env` |

> `subagent_spawning` 在 2026-08-30 后移除（被 `subagent_spawned` 替代），`deactivate` 在 2026-08-16 后移除（被 `gateway_stop` 替代）。两个 deprecated hook 都在源码中显式标注了 `DEPRECATED_PLUGIN_HOOKS` 映射和迁移路径。

### 8.2 全局 Hook Runner

`src/plugins/hook-runner-global.ts` 管理全局 Hook Runner 的初始化和执行：

```typescript
// 获取全局 Hook Runner（懒初始化）
const hookRunner = getGlobalHookRunner();

// 运行 before_agent_start Hook
const result = await hookRunner.runBeforeAgentStart(ctx, hookCtx);
// result.handled → 是否已处理
// result.provider / result.modelId → 覆盖后的 provider/model
```

### 8.3 Hook 的执行策略

Hook 按注册顺序执行，任何 Hook 可以设置 `handled: true` 来终止后续 Hook 的执行。这是一个**责任链模式**——每个 Hook 都有机会处理请求，一旦处理完成，后续 Hook 不再执行。

---

## 9. Lazy Activation：冷启动优先的加载策略

### 9.1 激活配置

插件的 `openclaw.plugin.json` 可以声明激活策略：

```json
{
  "activation": {
    "onStartup": true,       // Gateway 启动时激活
    "onCommands": ["ltm"],   // 命令触发时激活
    "onEvents": ["message"]  // 事件触发时激活
  }
}
```

### 9.2 Startup vs Deferred

- **Startup 插件**：在 Gateway 启动时立即加载和注册
- **Deferred 插件**：只在需要时才加载（如 `onCommands` 触发时）

例如，`memory-lancedb` 的 `activation.onStartup` 为 `false`，只在用户执行 `/ltm` 命令时才激活。这避免了在不需要向量存储的场景下加载 LanceDB 的依赖。

### 9.3 四阶段加载策略

```
阶段 1: 构建时元数据生成
  → GENERATED_BUNDLED_CHANNEL_CONFIG_METADATA
  → 零代码，CLI 帮助文本和配置校验

阶段 2: Bootstrap Registry
  → 轻量发现，用于 doctor 和 setup
  → 可能在完整运行时不可用时就需要通道信息

阶段 3: 运行时 Registry
  → 完整的插件注册表
  → 加载优先级：已安装 > 内建捆绑

阶段 4: 模块按需加载
  → specifier + exportName 懒加载
  → 插件主体、密钥、运行时均按需加载
```

---

## 10. 设计哲学总结

### 10.1 核心无感知

核心运行时（`src/`）完全不知道飞书、Telegram、OpenAI 等具体服务的存在。所有扩展行为通过插件机制注册，插件只能通过 `openclaw/plugin-sdk/*` 与核心交互。这确保了核心代码不会因新增或修改扩展而变更。

### 10.2 公平竞争

Bundled 插件不能用 External 插件不能用的私有通道——没有后门。这保证了第三方插件开发者与核心团队在同一个起跑线上。

### 10.3 进程稳定元数据

插件的安装、清单、目录等元数据在 Gateway 生命周期内是稳定的。变更需要重启或显式 reload。这避免了运行时的 freshness polling 开销。

### 10.4 懒加载贯穿始终

从发现（构建时元数据）到加载（懒激活）到运行时（specifier + exportName），每一步都尽可能延迟代码加载。冷启动时间是最重要的性能指标。

### 10.5 分发即 npm

Extension 即 npm 包——利用现有的全球分发基础设施，但承担供应链安全的代价。这是一个务实的权衡——自建 registry 的投入远大于供应链安全防护的投入。

---

## 🎯 如果只记 3 件事

1. **"Manifest-First = 零代码发现"** —— `openclaw.plugin.json` 是清单，`openclaw doctor` / `openclaw configure` 不 import 插件代码就能列出可用扩展。**先看 metadata，再决定要不要 import**——这是 OpenClaw 冷启动快的根本。
2. **"Plugin ≠ Skill：分层不是替代"** —— **Plugin 接外部系统**（飞书 API、OpenAI API），**Skill 接提示工程**（"用现有工具完成 X 任务"）。一个 Skill 通常只做"提示 + 前置条件 + 工具组合"，Plugin 才做"接入新服务"。
3. **"60+ `api.register*` 方法 = 完整扩展面"** —— 想接什么能力就调什么 register：Channel / Provider / Tool / Hook / Gateway Method / CLI / Node Command / Context Engine / Memory / Harness / Embedding / Speech / Media / ... **写新插件先确认走哪类路径**——错把"模型"当"Channel"接、或反之，都会被 PR review 拦下。

> 📚 **配套阅读**：
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md) §5 第五层
> - Hook 系统完整列表（39 个）：[openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md) §9.1
> - Channel 插件示例：[openclaw-channel-architecture.md](./openclaw-channel-architecture.md) §6 Feishu 实现
> - Context Engine 怎么注册：[openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md) §3
