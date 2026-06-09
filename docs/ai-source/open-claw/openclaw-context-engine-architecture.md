---
title: OpenClaw Context Engine & 记忆系统深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 拆解 Context Engine 的接口设计、注册表机制、记忆插件架构、Dreaming 机制与 Prompt Cache 感知。
createTime: 2026/06/08 10:14:40
permalink: /ai-source/openclaw-context-engine-architecture/
---
# OpenClaw Context Engine & 记忆系统深度解析：可插拔的上下文管理哲学

> 📖 **阅读顺序：6 / 共 8 篇** · 🔵 深入 · 上下文管理（Agent 用的）— 按需读
>
> 基于 `src/context-engine/`、`extensions/memory-*`、`extensions/active-memory/` 源码分析。本文拆解 Context Engine 的接口设计、注册表机制、检疫代理、Legacy 适配器、记忆插件的三层架构（memory-core / memory-lancedb / active-memory）、Dreaming 机制、Prompt Cache 感知——揭示 OpenClaw 如何将"上下文管理"从一个硬编码的管道，演进为一个可替换、可隔离、可观测的插件化引擎。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| Context Engine 是什么、解决什么问题 | §1 为什么需要可插拔 |
| 引擎要实现哪些方法、必选 vs 可选 | §2 ContextEngine 接口契约 |
| 怎么注册、怎么切换、怎么互斥 | §3 注册表机制 |
| 引擎崩了怎么办 | §4 检疫代理（自动降级） |
| 不写新引擎能跑吗 | §5 Legacy 适配器 |
| 外部引擎拒绝参数怎么办 | §6 SessionKey 兼容性代理 |
| 记忆怎么组织、有几个插件 | §7 记忆插件家族 |
| AI 有"睡眠"机制吗 | §8 Dreaming（三阶段） |
| 对话前会自动找相关记忆吗 | §9 Active Memory |
| 引擎能感知 prompt cache 吗 | §10 Prompt Cache 感知 |

**一句话**：Context Engine = 把"上下文怎么管理"从硬编码管道变成可插拔接口——实现接口就能换引擎，崩了自动降级到 Legacy，外部引擎参数不兼容也有兼容层兜底。记忆是 4 个并行插件（不是三层），Dreaming 模拟人类睡眠整理。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/context-engine/types.ts:238          ← ContextEngine 接口（8 方法 + 1 属性）
  src/context-engine/registry.ts:646       ← GUARDED_CONTEXT_ENGINE_METHODS（9 个被保护方法）
  src/context-engine/registry.ts:767       ← wrapContextEngineWithRuntimeQuarantine
  src/context-engine/legacy.ts:22          ← LegacyContextEngine（适配器模式）
  src/context-engine/host-compat.ts        ← 宿主能力声明

深入某个子系统：
  src/context-engine/registry.ts:359-410   ← 注册表 + 检疫生命周期
  extensions/memory-core/                  ← 工具契约 + Dreaming 入口
  extensions/memory-lancedb/               ← 向量存储 + autoCapture / autoRecall
  extensions/active-memory/                ← 对话前阻塞式召回
  extensions/memory-wiki/                  ← Wiki 风格知识库
```

---

## 目录

1. [为什么需要可插拔的 Context Engine](#1-为什么需要可插拔的-context-engine)
2. [ContextEngine 接口契约](#2-contextengine-接口契约)
3. [注册表机制：Slot、Owner 与优先级](#3-注册表机制slotowner-与优先级)
4. [检疫代理：运行时故障的自动降级](#4-检疫代理运行时故障的自动降级)
5. [Legacy 适配器：100% 向后兼容的包装器](#5-legacy-适配器100-向后兼容的包装器)
6. [SessionKey 兼容性代理：新旧参数的透明桥接](#6-sessionkey-兼容性代理新旧参数的透明桥接)
7. [记忆插件三层架构](#7-记忆插件三层架构)
8. [Dreaming：AI 的"睡眠"机制](#8-dreamingai-的睡眠机制)
9. [Active Memory：对话前的阻塞式召回](#9-active-memory对话前的阻塞式召回)
10. [Prompt Cache 感知：让 Engine 理解缓存](#10-prompt-cache-感知让-engine-理解缓存)
11. [设计哲学总结](#11-设计哲学总结)

---

## 1. 为什么需要可插拔的 Context Engine

在 Context Engine 出现之前，OpenClaw 的上下文管理是一个硬编码的管道：

```
SessionManager 持久化消息
  → attempt.ts 中 sanitize → validate → limit → repair 管道处理
  → compactEmbeddedAgentSessionDirect 执行压缩
```

这个管道有三个问题：

1. **不可替换**：如果你想用向量检索增强上下文，只能修改核心代码
2. **不可观测**：管道内部的状态变化对外不可见
3. **不可隔离**：如果压缩逻辑出错，整个 Agent Run 都会失败

Context Engine 的引入将这个管道抽象为一个**可替换的接口**——任何人都可以实现自己的上下文管理策略，只要遵循接口契约。

```
之前：硬编码管道
  SessionManager → sanitize → validate → limit → repair → compact

之后：可插拔引擎
  ContextEngine.bootstrap → ingest → assemble → compact → maintain → afterTurn
```

---

## 2. ContextEngine 接口契约

`src/context-engine/types.ts` 定义了 `ContextEngine` 接口——这是 OpenClaw 上下文管理的核心抽象。接口共有 **8 个方法 + 1 个只读元数据属性**：

```typescript
interface ContextEngine {
  // ── 元数据（1 个只读属性） ──
  readonly info: ContextEngineInfo;

  // ── 必选方法（3 个） ──
  ingest(params): Promise<IngestResult>;      // 摄入消息
  assemble(params): Promise<AssembleResult>;  // 组装上下文
  compact(params): Promise<CompactResult>;    // 压缩上下文

  // ── 可选方法（7 个） ──
  bootstrap?(params): Promise<BootstrapResult>;       // 初始化
  maintain?(params): Promise<MaintenanceResult>;      // 转录维护
  ingestBatch?(params): Promise<IngestBatchResult>;   // 批量摄入
  afterTurn?(params): Promise<void>;                  // 回合后处理
  prepareSubagentSpawn?(params): Promise<...>;        // 子 Agent 准备
  onSubagentEnded?(params): Promise<void>;            // 子 Agent 结束通知
  dispose?(): Promise<void>;                          // 资源释放
}
```

### 2.1 生命周期流程

```
bootstrap → [ingest → assemble → LLM call → afterTurn → maintain]* → compact → ...
```

**每个方法的生命周期角色**：

| 方法 | 何时调用 | 做什么 | 不做什么 |
|------|----------|--------|----------|
| `bootstrap` | Session 首次使用时 | 初始化 Engine 状态，可选导入历史 | 不负责创建 Session |
| `ingest` | 每条消息产生时 | 将消息摄入 Engine 的存储 | 不负责 SessionManager 持久化 |
| `assemble` | 每次 LLM 调用前 | 在 token 预算内组装上下文 | 不负责 sanitize/validate（Legacy Engine 委托给核心） |
| `afterTurn` | 每次 Agent Turn 完成后 | 持久化上下文、触发后台压缩 | 不负责写入 Session 文件 |
| `maintain` | Turn 后或压缩后 | 转录重写、条目清理 | 不负责删除 Session |
| `compact` | 上下文接近或超过预算时 | 生成摘要、裁剪历史 | 不负责 Session 文件轮转（只返回新的 sessionId/file） |

### 2.2 AssembleResult：组装结果的多维表达

```typescript
type AssembleResult = {
  messages: AgentMessage[];          // 有序的消息列表
  estimatedTokens: number;           // 估算的 token 数
  promptAuthority?: "assembled" | "preassembly_may_overflow";
  systemPromptAddition?: string;     // 追加到系统提示的指令
  contextProjection?: ContextEngineProjection;  // 投影生命周期
};
```

**`promptAuthority`** 是一个精巧的设计：
- `"assembled"`：预检查只使用组装后的 token 估算
- `"preassembly_may_overflow"`：预检查取组装估算和未窗口化的历史估算的最大值

第二种模式用于"组装视图可能隐藏了仍然影响底层转录的溢出"的引擎——比如某些 Engine 可能在组装时裁剪了上下文，但底层的转录仍然是满的。

### 2.3 ContextEngineProjection：线程引导投影

```typescript
type ContextEngineProjection = {
  mode: "per_turn" | "thread_bootstrap";
  epoch?: string;           // 稳定的上下文纪元
  fingerprint?: string;     // 诊断指纹
};
```

这是为拥有**持久后端线程**的宿主设计的：

- `per_turn`：每次 Turn 都投影上下文（传统模式）
- `thread_bootstrap`：只在线程纪元变更时投影一次，之后复用后端线程

这允许 Context Engine 利用某些 LLM Provider 的线程功能（如 Anthropic 的 conversation cache），避免每次 Turn 都重新发送完整上下文。

### 2.4 CompactResult：压缩结果与 Session 轮转

```typescript
type CompactResult = {
  ok: boolean;
  compacted: boolean;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    sessionId?: string;      // 压缩后的新 Session ID
    sessionFile?: string;    // 压缩后的新 Session 文件
  };
};
```

`sessionId` 和 `sessionFile` 是压缩可能**轮转 Session** 的信号。Agent Loop 在压缩后会调用 `adoptCompactionTranscript` 来采纳新的 Session，而不是在原位修改——这是一种"状态轮转而非原地修改"的设计。

---

## 3. 注册表机制：Slot、Owner 与优先级

### 3.1 注册 API

`src/context-engine/registry.ts` 提供了两个注册入口：

```typescript
// 内部 API（核心使用，可指定 owner）
registerContextEngineForOwner(id, factory, owner, opts?)

// 公共 API（插件使用，owner 为 "public-sdk"）
registerContextEngine(id, factory)
```

### 3.2 Slot 机制

Context Engine 的选择通过插件 Slot 配置：

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "memory-lancedb"  // 指定使用哪个 Engine
    }
  }
}
```

解析顺序：
1. `config.plugins.slots.contextEngine`（显式 Slot 覆盖）
2. 默认 Slot 值 `"legacy"`

### 3.3 Owner 保护

注册表有 Owner 保护机制——同一个 ID 不能被不同 Owner 重复注册：

```typescript
if (existing && existing.owner !== normalizedOwner) {
  return { ok: false, existingOwner: existing.owner };
}
```

**默认 Engine ID 保护**：`"legacy"` 这个 ID 是核心拥有的，插件不能注册同名 Engine：

```typescript
if (id === defaultSlotIdForKey("contextEngine") && normalizedOwner !== CORE_CONTEXT_ENGINE_OWNER) {
  return { ok: false, existingOwner: CORE_CONTEXT_ENGINE_OWNER };
}
```

### 3.4 全局单例

注册表使用 `resolveGlobalSingleton` 确保进程内只有一个实例——即使有重复的 dist chunk，运行时仍然共享同一个注册表 Map：

```typescript
const CONTEXT_ENGINE_REGISTRY_STATE = Symbol.for("openclaw.contextEngineRegistryState");
const contextEngineRegistryState = resolveGlobalSingleton<ContextEngineRegistryState>(
  CONTEXT_ENGINE_REGISTRY_STATE,
  () => ({ engines: new Map(), quarantinedEngines: new Map() }),
);
```

---

## 4. 检疫代理：运行时故障的自动降级

![Context Engine 生命周期与检疫机制](/ai-source/open-claw/openclaw-context-engine-lifecycle.svg)

### 4.1 检疫机制

当非默认的 Context Engine 在运行时抛出异常时，注册表会将其**检疫**——后续所有调用自动降级到默认 Engine：

```typescript
function wrapContextEngineWithRuntimeQuarantine(params): ContextEngine {
  // 使用 Proxy 包装 Engine
  // 每个被保护的方法调用时：
  //   1. 检查是否已检疫 → 如果是，直接调用 fallback Engine
  //   2. 尝试调用原始 Engine
  //   3. 如果失败且非 abort → 记录检疫 + 降级到 fallback
}
```

### 4.2 检疫的范围

**会被检疫的方法**（`GUARDED_CONTEXT_ENGINE_METHODS`）：
- `bootstrap`、`maintain`、`ingest`、`ingestBatch`、`afterTurn`、`assemble`、`compact`、`prepareSubagentSpawn`、`onSubagentEnded`

**不会被检疫的错误**：
- `AbortError`——这是调用者的意图，不是 Engine 的不稳定性，不应触发检疫

### 4.3 检疫后的降级行为

检疫后，不同方法的降级行为不同：

| 方法 | 降级行为 |
|------|----------|
| `bootstrap` | 返回 `{ bootstrapped: false, reason: "context engine downgraded to legacy" }` |
| `ingest` | 返回 `{ ingested: false }` |
| `assemble` | 调用 fallback Engine 的 `assemble` |
| `compact` | 抛出原始错误（压缩失败不应静默降级） |
| `maintain` | 返回 `{ changed: false, bytesFreed: 0, rewrittenEntries: 0 }` |
| `afterTurn` | no-op |
| `prepareSubagentSpawn` | no-op |

**关键设计**：`compact` 和 `prepareSubagentSpawn` 失败时**不降级**，而是直接抛出错误——因为压缩失败静默降级可能导致上下文丢失，子 Agent 准备失败静默降级可能导致状态不一致。

### 4.4 检疫的持久性

检疫是**进程级**的——一旦 Engine 被检疫，它在当前 Gateway 进程的生命周期内都不会恢复。这避免了"间歇性故障导致反复检疫-恢复-检疫"的振荡。

```typescript
// 检疫只在以下情况下清除：
// 1. 重启 Gateway
// 2. 同一 Owner 重新注册 Engine（registerContextEngineForOwner + allowSameOwnerRefresh）
// 3. 显式调用 clearContextEngineRuntimeQuarantine
```

---

## 5. Legacy 适配器：100% 向后兼容的包装器

`src/context-engine/legacy.ts` 的 `LegacyContextEngine` 是一个典型的**适配器模式**——将旧系统包装成新接口：

```typescript
class LegacyContextEngine implements ContextEngine {
  info = { id: "legacy", name: "Legacy Context Engine", version: "1.0.0" };

  async ingest(params) {
    return { ingested: false };  // no-op：SessionManager 直接处理持久化
  }

  async assemble(params) {
    return { messages: params.messages, estimatedTokens: 0 };  // pass-through
  }

  async compact(params) {
    return await delegateCompactionToRuntime(params);  // 委托给原有压缩函数
  }
}
```

**设计意图**：
- `ingest` 是 no-op——Legacy 模式下 SessionManager 直接处理消息持久化
- `assemble` 是 pass-through——现有的 sanitize/validate/limit 管道在 attempt.ts 中处理
- `compact` 委托给 `delegateCompactionToRuntime`——最终调用 `compactEmbeddedAgentSessionDirect`

这保证了**100% 向后兼容**——引入 Context Engine 接口后，所有现有行为不变。

---

## 6. SessionKey 兼容性代理：新旧参数的透明桥接

`registry.ts` 中的 `wrapContextEngineWithSessionKeyCompat` 是一个精巧的代理，解决了一个渐进迁移问题：

**问题**：OpenClaw 核心 Host 在调用 Engine 方法时传递了 `sessionKey` 和 `prompt` 等参数，但某些外部 Engine（如 honcho）使用 Zod/JSON Schema 验证参数，会拒绝这些"多余"的字段。

**解决方案**：代理在 Engine 方法调用失败时，自动检测是否因为"不认识的字段"而失败，如果是，则去掉这些字段重试：

```typescript
async function invokeWithLegacyCompat(method, params, allowedKeys) {
  try {
    return await method(params);  // 先尝试带 legacy 字段调用
  } catch (error) {
    const rejectedKeys = detectRejectedLegacyCompatKeys(error, allowedKeys);
    if (rejectedKeys.size > 0) {
      // 去掉被拒绝的字段重试
      return await method(withoutLegacyCompatKeys(params, rejectedKeys));
    }
    throw error;  // 不是 legacy 字段的问题，重新抛出
  }
}
```

**检测逻辑**非常健壮——它遍历错误链（`error.cause`），匹配多种错误消息格式（Zod、JSON Schema、自定义验证器等），确保不会误检。

**性能优化**：一旦检测到某个 Engine 拒绝特定字段，代理会记住这个信息（`isLegacy` 标志 + `rejectedKeys` 集合），后续调用直接走快速路径：

```typescript
if (isLegacy && allowedKeys.some(key => rejectedKeys.has(key) && hasOwnLegacyCompatKey(params, key))) {
  return method(withoutLegacyCompatKeys(params, rejectedKeys));  // 快速路径
}
```

---

## 7. 记忆插件家族

OpenClaw 的记忆系统由 **4 个并行插件**组成，**不是严格的三层架构**——它们各自负责不同的关注点，通过互斥的 `memory` slot 和 `embeddingProviders` 等合约协作：

| 插件 | 路径 | 主要职责 |
|------|------|---------|
| **Memory Core** | `extensions/memory-core/` | 工具契约（`memory_get` / `memory_search`）、本地嵌入、命令别名、Dreaming 流程 |
| **Memory LanceDB** | `extensions/memory-lancedb/` | 基于 LanceDB 的向量存储、嵌入配置（openai/ollama/...）、auto-capture / auto-recall |
| **Memory Wiki** | `extensions/memory-wiki/` | Wiki 风格的知识库（与前两者并列，不是层级下的子层） |
| **Active Memory** | `extensions/active-memory/` | 对话前的**阻塞式**记忆召回——跑一个短命的记忆子 Agent 搜索相关记忆，注入上下文 |

### 7.1 Memory Core

Memory Core 是记忆系统的"工具+流程"插件，提供：

- **工具契约**：`memory_get`、`memory_search`——Agent 可以主动获取和搜索记忆
- **记忆嵌入提供者**：`local`——本地嵌入计算
- **命令别名**：`/dreaming` → `openclaw memory`
- **Dreaming 机制**（详见下一节）

### 7.2 Memory LanceDB

Memory LanceDB 基于 LanceDB 提供向量存储，是"存储与检索后端"：

- **工具契约**：`memory_forget`、`memory_recall`、`memory_store`
- **嵌入配置**：支持多种 provider（openai、ollama 等）、自定义模型、自定义维度
- **自动捕获**（`autoCapture`）：自动从对话中提取重要信息
- **自动召回**（`autoRecall`）：自动注入相关记忆到上下文
- **Dreaming 支持**：当此插件拥有 memory slot 时，可消费 Dreaming 配置

### 7.3 Active Memory 的"对话前召回"模式

`active-memory` 与 core/lancedb 是**正交**的——它不提供存储，而是在每次 Agent 回复前运行一个**短命的记忆子 Agent**，搜索与当前对话相关的记忆，将结果注入主 Agent 上下文。这是一种"运行时召回"，与 Memory Core / LanceDB 的"工具时检索"互补：

```
用户发消息
  │
  ├── Active Memory 触发（对话前，阻塞式、有超时）
  │     调用 memory_search / memory_recall 搜索相关记忆
  │     将搜索结果注入主 Agent 上下文
  │
  ├── Agent 执行（对话中）
  │     可通过 memory_get / memory_search 主动获取记忆
  │     可通过 memory_store 存储新记忆
  │
  └── Dreaming 触发（对话后 / Cron）
        调用 memory-core 的 Dreaming 流程
        整理记忆文件（MEMORY.md、DREAMS.md）
```

> **关于"三层架构"的修正**：原描述把 active-memory → memory-core → memory-lancedb 画成层级关系，但实际它们是 4 个**独立插件**，可单独安装/启用。"层级"只在 Active Memory *调用* memory-core/lancedb 的工具时成立；它本身不依赖 core 才能工作（只是默认会通过 `memory_search` 工具搜索）。

---

## 8. Dreaming：AI 的"睡眠"机制

Dreaming 是 OpenClaw 记忆系统最独特的设计——模拟人类睡眠的三个阶段来整理记忆：

### 8.1 三阶段 Dreaming

```
阶段 1: Light Dream（浅睡眠）
  ├── 回顾最近 lookbackDays 的对话
  ├── 提取关键信息和事实
  ├── 去重（dedupeSimilarity 阈值）
  └── 写入短期记忆

阶段 2: REM Dream（快速眼动期）
  ├── 发现对话中的模式和关联
  ├── 识别重复出现的主题
  ├── 记录模式强度（minPatternStrength）
  └── 写入关联记忆

阶段 3: Deep Dream（深度睡眠）
  ├── 从长期记忆中选择最重要的事实
  ├── 基于召回频率、唯一查询数、时效性评分
  ├── 剪裁到 maxPromotedSnippetTokens
  └── 写入 MEMORY.md（长期持久记忆）
```

### 8.2 配置项

每个阶段都有独立的配置：

```json
{
  "dreaming": {
    "enabled": true,
    "frequency": "0 3 * * *",
    "model": "anthropic/claude-sonnet-4-6",
    "storage": {
      "mode": "inline"
    },
    "phases": {
      "light": {
        "enabled": true,
        "lookbackDays": 7,
        "limit": 100,
        "dedupeSimilarity": 0.85
      },
      "rem": {
        "enabled": true,
        "lookbackDays": 30,
        "minPatternStrength": 0.6
      },
      "deep": {
        "enabled": true,
        "limit": 50,
        "minScore": 0.7,
        "minRecallCount": 2,
        "recencyHalfLifeDays": 30,
        "maxAgeDays": 365
      }
    }
  }
}
```

### 8.3 设计哲学

Dreaming 的设计哲学是 **MD 文件优先**：

- `MEMORY.md`：长期持久记忆——最重要的、经过 Deep Dream 筛选的事实
- `DREAMS.md`：Dreaming 过程的日志——记录每次 Dreaming 的内容和结果
- `memory/YYYY-MM-DD.md`：每日记忆文件——原始的、未整理的记忆

**收益**：可以 `git commit` 整个 agent state，用 diff 工具查看记忆变化
**代价**：同步与去重需要 app 侧兜底——因为 MD 文件不是数据库，没有事务和唯一约束

---

## 9. Active Memory：对话前的阻塞式召回

### 9.1 核心机制

Active Memory 是一个**阻塞式的记忆召回机制**——在每次 Agent 回复前，先运行一个短命的记忆子 Agent，搜索与当前对话相关的记忆，然后将结果注入上下文：

```
用户发消息
  │
  ├── Active Memory 子 Agent（阻塞式，有超时）
  │     ├── 读取用户消息和最近对话
  │     ├── 调用 memory_search / memory_recall 搜索
  │     ├── 判断是否需要注入记忆
  │     └── 返回记忆摘要
  │
  ├── 将记忆摘要注入上下文
  │
  └── 主 Agent 执行（已有记忆上下文）
```

### 9.2 配置粒度

Active Memory 提供了精细的控制：

- **allowedChatTypes**：哪些会话类型启用（direct / group / channel / explicit）
- **allowedChatIds / deniedChatIds**：白名单/黑名单
- **queryMode**：子 Agent 看到多少上下文（message / recent / full）
- **promptStyle**：召回策略（balanced / strict / contextual / recall-heavy / precision-heavy / preference-only）
- **circuitBreaker**：连续超时后的断路器（自动跳过召回）

### 9.3 断路器机制

```json
{
  "circuitBreakerMaxTimeouts": 3,
  "circuitBreakerCooldownMs": 60000
}
```

断路器避免了"记忆服务慢 → 每次对话都等超时 → 用户体验更差"的恶性循环。

---

## 10. Prompt Cache 感知：让 Engine 理解缓存

Context Engine 接口包含了 Prompt Cache 的感知能力，这是很多 AI 助手系统忽视的一个重要优化维度：

```typescript
type ContextEnginePromptCacheInfo = {
  retention?: "none" | "short" | "long" | "in_memory" | "24h";
  lastCallUsage?: ContextEnginePromptCacheUsage;
  observation?: ContextEnginePromptCacheObservation;
  lastCacheTouchAt?: number;
  expiresAt?: number;
};
```

### 10.1 为什么 Engine 需要知道 Cache？

不同的 LLM Provider 有不同的 Prompt Cache 策略：

- **Anthropic**：cache_control 标记，5 分钟 TTL
- **OpenAI**：自动缓存，基于前缀匹配
- **Google**：context caching，显式创建和删除

Engine 可以根据 Cache retention 策略调整 context 的组装方式——例如，如果 Cache retention 是 `"long"`，Engine 可以保持 context 前缀不变，最大化 Cache 命中率；如果 Cache 刚刚失效（`observation.broke === true`），Engine 可以趁机重组 context 结构。

### 10.2 Cache Observation

`ContextEnginePromptCacheObservation` 记录了 Cache 行为的变化：

```typescript
type ContextEnginePromptCacheObservation = {
  broke: boolean;              // Cache 是否中断
  previousCacheRead?: number;  // 上次 Cache 读取量
  cacheRead?: number;          // 本次 Cache 读取量
  changes?: ContextEnginePromptCacheObservationChange[];  // 变化原因
};
```

**变化原因**（`changes`）包括：
- `cacheRetention`：Cache retention 策略变了
- `model`：模型变了
- `streamStrategy`：流式策略变了
- `systemPrompt`：系统提示变了
- `tools`：工具列表变了
- `transport`：传输方式变了

Engine 可以利用这些信息做出更智能的组装决策。

---

## 11. 设计哲学总结

### 11.1 可插拔而非可配置

Context Engine 的设计不是"在原有管道上加配置项"，而是"将整个管道抽象为可替换的接口"。这种选择更激进但更灵活——新的上下文管理策略不需要修改核心代码，只需要实现接口并注册。

### 11.2 渐进迁移而非一步到位

从 Legacy Engine 到自定义 Engine 的迁移是渐进的：
1. 默认使用 Legacy Engine（100% 向后兼容）
2. 通过 Slot 配置切换到自定义 Engine
3. 自定义 Engine 失败时自动降级到 Legacy（检疫机制）
4. SessionKey 兼容性代理透明处理参数差异

每一步都有回退机制，不会因为切换 Engine 而导致服务中断。

### 11.3 MD 优先而非 DB 优先

记忆用 Markdown（`MEMORY.md`、`DREAMS.md`、`memory/YYYY-MM-DD.md`），向量索引可换（sqlite-vec / LanceDB / honcho）。这是一个深思熟虑的权衡：

- **收益**：可以 `git commit` 整个 agent state、可以用 diff 工具查看变化、人类可直接阅读和编辑
- **代价**：同步与去重需要 app 侧兜底、没有事务保证、大规模记忆的查询效率较低

在"个人 AI 助手"的场景下，记忆规模通常不大（几千条级别），MD 优先的收益远大于代价。

### 11.4 检疫是降级，不是重启

当 Context Engine 运行时异常时，系统选择**检疫并降级**而不是**抛出异常并重启**。这是因为：

- 上下文管理是**每次对话都需要的**，Engine 不稳定时用户不应该无法对话
- 降级到 Legacy Engine 后，对话仍然可以继续，只是丢失了自定义 Engine 的增强能力
- 检疫是进程级的，避免了间歇性故障导致的振荡

### 11.5 接口即合约

ContextEngine 接口中的每个方法都有明确的"做什么"和"不做什么"的语义。这种清晰的合约边界让不同的实现可以在不互相干扰的情况下协作——Legacy Engine 不负责持久化，自定义 Engine 不需要理解 Session 文件格式，Active Memory 不需要知道记忆存储的细节。

---

## 🎯 如果只记 3 件事

1. **"Context Engine 是可替换接口，不是可配置开关"** —— 实现 8 个方法（3 必选 + 7 可选）就能换引擎。**Legacy Engine 是默认 100% 兼容的占位**。
2. **"检疫 = 进程级自动降级"** —— 引擎运行时异常 → 当次调用返回降级结果 + 整进程标记 quarantine → 后续调用直接走 Legacy。**只有 `compact` 和 `prepareSubagentSpawn` 不降级**（降级会丢上下文/状态）。
3. **"记忆是 4 个并行插件，MD 优先"** —— memory-core（工具+流程）/ memory-lancedb（向量存储）/ memory-wiki（知识库）/ active-memory（对话前召回）**互相不依赖、可单独装**。`MEMORY.md` / `DREAMS.md` / `memory/YYYY-MM-DD.md` 是 source of truth，可 `git commit`。

> 📚 **配套阅读**：
> - Context Engine 怎么被 Agent 调用：[openclaw-agent-session-architecture.md](./openclaw-agent-session-architecture.md) §3 Provider/Model/Harness 解析链
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md)
> - Plugin 系统怎么注册 Engine：[openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md) §5.3 `registerContextEngine`
