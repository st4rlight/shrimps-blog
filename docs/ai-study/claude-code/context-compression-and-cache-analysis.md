---
title: Claude Code 上下文压缩机制与缓存命中率深度分析
tags:
  - Claude Code
  - 上下文压缩
  - Prompt Cache
excerpt: 从六层压缩防线、缓存保护体系到具体源码路径，系统分析 Claude Code 如何在压缩上下文时尽量保住缓存命中率。
createTime: 2026/05/17 15:07:14
permalink: /ai-study/claude-code-context-compression-and-cache-analysis/
---

# Claude Code 上下文压缩机制与缓存命中率深度分析

> 源码分析版本：2026-05
> 核心目录：`src/services/compact/`, `src/services/api/`, `src/query.ts`

---

## 目录

1. [全景概览](#1-全景概览)
2. [L1: Snip 历史裁剪](#2-l1-snip-历史裁剪)
3. [L2: Microcompact 微压缩](#3-l2-microcompact-微压缩)
4. [L3: Context Collapse 上下文折叠](#4-l3-context-collapse-上下文折叠)
5. [L4: Auto-Compact 自动压缩](#5-l4-auto-compact-自动压缩)
6. [L5: Reactive Compact 反应式压缩](#6-l5-reactive-compact-反应式压缩)
7. [L6: API Context Management 服务端上下文管理](#7-l6-api-context-management-服务端上下文管理)
8. [压缩对缓存命中率的影响矩阵](#8-压缩对缓存命中率的影响矩阵)
9. [缓存命中率保护体系](#9-缓存命中率保护体系)
10. [设计哲学与核心洞察](#10-设计哲学与核心洞察)

---

## 1. 全景概览

### 1.1 六层压缩防线

Claude Code 构建了一个从最轻量到最重量级的 6 层上下文压缩体系，在每轮查询循环 (`src/query.ts`) 中按顺序执行：

```
用户消息
  ↓
[L1] Snip — 历史裁剪（中间范围删除）
  ↓
[L2] Microcompact — 工具结果压缩（三条子路径）
  ↓
[L3] Context Collapse — 上下文折叠（归档+投影）
  ↓
[L4] Auto-Compact — 自动压缩（SM Compact 或 Legacy Compact）
  ↓
发送 API 请求
  ↓
[L5] Reactive Compact — 反应式压缩（413 后触发）
  ↓
[L6] API Context Management — 服务端上下文管理（请求参数）
```

**核心设计原则**：尽量用轻量机制避免触发重量级压缩。每层都比下一层对缓存的破坏更小，只有在上一层无法解决问题时才降级。

### 1.2 上下文窗口分配

系统不是将全部 context window 都开放给 Agent，而是严格预留扣减：

```typescript
// src/utils/context.ts
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// src/services/compact/autoCompact.ts
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// 有效可用窗口 = 总窗口 - 为 Summary 预留的 token
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  return contextWindow - reservedTokensForSummary
}
```

**预留逻辑**：当触发压缩时，API 还需塞下完整的历史对话 + 生成 Summary 的提示词 + Summary 输出本身。如果不预留空间，压缩请求本身就会超限。

### 1.3 Token 估算体系

由于客户端无法精确计算 token 数（真正的 tokenizer 在服务端），系统采用两层估算：

- **`tokenCountWithEstimation()`**：优先使用上一轮 API 响应中的 `usage.input_tokens`（最精确），回退到 `roughTokenCountEstimation()`（4/3 字符比估算，偏保守）
- **`roughTokenCountEstimationForMessages()`**：纯客户端快速估算，遍历每个 content block（text/tool_result/thinking/tool_use）分别估算

---

## 2. L1: Snip 历史裁剪

### 2.1 工作原理

Snip 允许用户主动选择裁剪对话中某段消息范围，也可由系统自动触发。被 snip 的消息**保留在磁盘日志中**（append-only JSONL），但通过边界标记中的 `snipMetadata.removedUuids` 在加载时过滤。

### 2.2 压缩策略

- **如何确定压缩内容**：由用户选择范围（通过 SnipTool），或在特定条件下系统自动选择中间消息段
- **如何执行压缩**：在边界消息上记录 `removedUuids`，加载时 `applySnipRemovals()` 从 Map 中删除对应 UUID 的消息
- **是否调用模型**：**否**，纯客户端数据操作

### 2.3 关键实现

```typescript
// src/utils/sessionStorage.ts:1978
function applySnipRemovals(messages: Map<UUID, TranscriptMessage>): void {
  type WithSnipMeta = { snipMetadata?: { removedUuids?: UUID[] } }
  const toDelete = new Set<UUID>()
  for (const entry of messages.values()) {
    const removedUuids = (entry as WithSnipMeta).snipMetadata?.removedUuids
    if (!removedUuids) continue
    for (const uuid of removedUuids) {
      toDelete.add(uuid)
    }
  }
  for (const uuid of toDelete) {
    messages.delete(uuid)
  }
}
```

### 2.4 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ❌ 从 snip 点之后全部失效 |
| 缓存消息体 | ❌ 被删消息不再命中 |
| 整体影响 | 🔴 **高** — 消息序列被改变，服务端缓存从断点开始全部 miss |

### 2.5 缓存应对

Snip 释放的 token 数通过 `snipTokensFreed` 传递给后续 autocompact 判断逻辑：

```typescript
// src/query.ts:638
const { isAtBlockingLimit } = calculateTokenWarningState(
  tokenCountWithEstimation(messagesForQuery) - snipTokensFreed,
  toolUseContext.options.mainLoopModel,
)
```

这防止了一个关键 bug：snip 已经把 token 降到阈值以下，但 stale usage 数据（反映 snip 前的大小）仍显示超限，导致误触发阻塞限制。

---

## 3. L2: Microcompact 微压缩

微压缩包含**三条子路径**，在 `microcompactMessages()` 中按优先级依次执行：

### 3.1 Time-Based Microcompact（时间触发微压缩）

#### 工作原理

Anthropic 服务端的 prompt cache 有 TTL（5 分钟短期 / 1 小时长期）。当距离最后一个 assistant 消息超过 `gapThresholdMinutes`（默认 60 分钟）时，cache **必然已过期**，全量重写在即。此时提前清空旧工具结果，可以**缩小重写体积**。

#### 压缩策略

- **如何确定压缩内容**：检测最后一个 assistant 消息的时间戳，如果 `now - timestamp > gapThresholdMinutes`，触发。选择所有"可压缩工具"（COMPACTABLE_TOOLS）的结果，但保留最近 `keepRecent`（默认 5）个
- **如何执行压缩**：将工具结果 content 替换为占位文本 `[Old tool result content cleared]`
- **是否调用模型**：**否**

#### 可压缩工具列表

```typescript
// src/services/compact/microCompact.ts
const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,    // 文件读取
  ...SHELL_TOOL_NAMES,     // Shell 命令
  GREP_TOOL_NAME,         // 搜索
  GLOB_TOOL_NAME,         // 文件匹配
  WEB_SEARCH_TOOL_NAME,   // 网页搜索
  WEB_FETCH_TOOL_NAME,    // 网页抓取
  FILE_EDIT_TOOL_NAME,    // 文件编辑
  FILE_WRITE_TOOL_NAME,   // 文件写入
])
```

#### 配置

```typescript
// src/services/compact/timeBasedMCConfig.ts
const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,
  gapThresholdMinutes: 60,  // 匹配服务端 1h cache TTL
  keepRecent: 5,
}
```

#### 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ✅ 无影响 — cache 本身已过期 |
| 缓存消息体 | ✅ 无影响 — cache 本身已过期 |
| 整体影响 | 🟢 **零** — 反而减少 cache 重建时的 token 数 |

#### 缓存应对

这是**唯一对缓存完全无损**的压缩方式。清除后：

1. 调用 `notifyCacheDeletion(querySource)` 告知 cache break detection 系统下次 cache read 下降是预期的
2. 调用 `resetMicrocompactState()` 重置 cached MC 状态，防止后续 turn 尝试 cache_edit 已不存在的条目

---

### 3.2 Cached Microcompact（缓存编辑微压缩）

#### 工作原理

这是**最精巧也最缓存友好**的压缩机制。利用 Anthropic 的 **cache editing API**，**不修改本地消息内容**，而是在 API 请求层附加 `cache_reference` 和 `cache_edits` 指令，告诉服务端"从缓存中删除这些 tool_use 的内容"。

核心思路：

```
原始缓存:  [system|tools|msg1(FileRead:a.txt)|msg2(Bash:ls)|msg3(Grep:pattern)|...]
cache_edit: 删除 msg1, msg2 的 tool_result
缓存结果:  [system|tools|msg1(标记删除)|msg2(标记删除)|msg3(Grep:pattern)|...]
                                                        ↑ msg3 及之后仍然 cache hit!
```

#### 压缩策略

- **如何确定压缩内容**：
  1. 每轮遍历消息，收集所有"可压缩工具"的 tool_use ID
  2. 将 tool_result 按 user message 分组注册到 `CachedMCState`
  3. 当某个 user message 中注册的工具数超过 `triggerThreshold`（GrowthBook 配置）时，计算需要删除的工具
  4. 保留最近 `keepRecent`（GrowthBook 配置）个工具结果

- **如何执行压缩**：
  1. 调用 `createCacheEditsBlock(state, toolsToDelete)` 创建 `cache_edits` 块
  2. 块类型为 `{ type: 'delete', cache_reference: string }[]`
  3. `cache_reference` 就是 `tool_use_id`，服务端通过此 ID 定位缓存中的条目
  4. 块通过 `pendingCacheEdits` 暂存，在 `addCacheBreakpoints()` 时注入到请求的最后一个 user message
  5. 通过 `pinCacheEdits(userMessageIndex, block)` 记录编辑位置，后续请求在同一位置重新发送已确认的 edits

- **是否调用模型**：**否** — 纯客户端构造 API 参数

#### API 层实现

```typescript
// src/services/api/claude.ts:3052-3210
type CachedMCEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

function addCacheBreakpoints(..., useCachedMC, newCacheEdits, pinnedEdits, ...) {
  // 1. 重新插入已 pinned 的 cache_edits 到原始位置
  for (const pinned of pinnedEdits ?? []) {
    const msg = result[pinned.userMessageIndex]
    insertBlockAfterToolResults(msg.content, pinned.block)
  }

  // 2. 插入新的 cache_edits 到最后一个 user message
  if (newCacheEdits) {
    insertBlockAfterToolResults(lastUserMsg.content, newCacheEdits)
    pinCacheEdits(i, newCacheEdits)  // 记录位置，后续请求重发
  }

  // 3. 为缓存前缀内的 tool_result 添加 cache_reference
  //    API 要求 cache_reference 必须出现在最后一个 cache_control 之前
  for (let i = 0; i < lastCCMsg; i++) {
    msg.content[j] = Object.assign({}, block, {
      cache_reference: block.tool_use_id,
    })
  }
}
```

#### cache_reference 的工作机制

`cache_reference` 是实现缓存编辑的关键。服务端需要它来定位缓存中的条目：

1. 每个 `tool_result` 块添加 `cache_reference: tool_use_id` 属性
2. 服务端通过此 ID 在缓存中找到对应条目
3. `cache_edits` 中的 `delete` 操作引用同一 ID，告诉服务端"清除这个 ID 对应的缓存内容"
4. 这样，**缓存前缀（system + tools + 早期消息）仍然完整命中**，只有被标记删除的条目的内容被清空

#### Pinned Edits 的持久化

被确认的 cache_edits 必须**在后续每次请求中重新发送**，否则服务端会恢复被删除的内容：

```typescript
// 注册时：记录 userMessageIndex 和 block
pinCacheEdits(userMessageIndex, block)

// 重发时：在 addCacheBreakpoints 中遍历 pinnedEdits
for (const pinned of pinnedEdits ?? []) {
  insertBlockAfterToolResults(msg.content, pinned.block)
}
```

同时系统还会**去重**：同一 `cache_reference` 不会被多次删除（`seenDeleteRefs` Set）。

#### 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ✅ **完整保留** — system prompt + tools + 早期消息全部命中 |
| 缓存消息体 | ⚠️ 被编辑部分降级 — 删除的 tool_result 从 cache_read 变为 cache_creation |
| 整体影响 | 🟡 **低** — 只有被删除的条目产生 cache miss，前缀完整保留 |

#### 缓存应对

调用 `notifyCacheDeletion(querySource)` 标记 `cacheDeletionsPending = true`，当下一轮 API 响应中 `cache_read_input_tokens` 下降时，不会误报为 cache break。

#### 限制

- 仅支持特定模型（`isModelSupportedForCacheEditing`）
- 仅在主线程执行（`isMainThreadSource`），子 agent 不注册
- 需要 `CACHE_EDITING_BETA_HEADER`（latched session-stable）

---

### 3.3 Legacy Microcompact（遗留微压缩）

#### 工作原理

直接修改本地消息内容，将旧工具结果替换为占位文本。

#### 当前状态

**已移除**。源码注释：

> `Legacy microcompact path removed — tengu_cache_plum_violet is always true`

此路径已被移除，因为 cached MC 在所有支持的模型上都可用。

---

## 4. L3: Context Collapse 上下文折叠

> Ant 内部实验特性（`CONTEXT_COLLAPSE` feature flag），源码通过 `require()` 动态加载以避免泄漏到外部构建。

### 4.1 工作原理

不同于传统压缩的"替换+丢弃"模式，Collapse 采用**归档+投影**模式：

1. **归档**：将旧消息从活跃消息流中移出，存入 collapse store
2. **投影**：每次查询前，`projectView()` 重放 commit log，生成一个"压缩视图"——包含摘要和近期消息
3. **渐进归档**：每轮可以 commit 更多 collapse，而不是一次性全部压缩

### 4.2 压缩策略

- **如何确定压缩内容**：基于 token 占用阈值（90% 开始 commit，95% 阻塞式 spawn）。系统维护一个 staged collapse queue
- **如何执行压缩**：commit 时生成摘要消息存入 collapse store，原始消息从 REPL 数组中移除。投影时 replay commit log
- **是否调用模型**：**是**，commit 时需要调用模型生成摘要（但这是在 collapse store 中，不影响主消息流）

### 4.3 与 Autocompact 的关系

Collapse 在 Autocompact 之前执行，存在一个精巧的竞争条件：

```
Autocompact 触发点 = effectiveContextWindow - 13,000
Collapse commit 点 ≈ effectiveContextWindow × 90%

如果 effectiveContextWindow = 200,000：
  Autocompact 触发 = 187,000 (93.5%)
  Collapse commit  = 180,000 (90%)

→ Collapse 先于 Autocompact 触发
→ 如果 Collapse 能把 token 降到 187,000 以下，Autocompact 就不触发
→ 保留了更细粒度的上下文，而不是单一摘要
```

源码注释（`src/services/compact/autoCompact.ts:205-223`）：

> Autocompact firing at effective-13k (~93% of effective) sits right between collapse's commit-start (90%) and blocking (95%), so it would race collapse and usually win, nuking granular context that collapse was about to save.

### 4.4 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ❌ 归档消息从流中消失，改变消息前缀 |
| 缓存消息体 | ❌ 投影的摘要消息不命中旧缓存 |
| 整体影响 | 🟠 **中** — 比全量压缩细粒度，每次只归档一部分 |

### 4.5 缓存应对

- 在 Autocompact 之前执行，争取用细粒度归档替代全量压缩
- 413 错误时优先 drain staged collapses，只在无法恢复时 fallback 到 reactive compact
- `resetContextCollapse()` 在 post-compact cleanup 中调用

---

## 5. L4: Auto-Compact 自动压缩

### 5.1 触发条件

```typescript
// src/services/compact/autoCompact.ts
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS  // ~187,000
}
```

五级状态：

| 状态 | token 占比 | 行为 |
|------|-----------|------|
| 正常 | <87% | 正常运行 |
| 警告 | 87%-90% | 显示 warning，建议 /compact |
| 错误 | 90%-93% | 显示 error |
| 自动压缩 | 93.5% | 触发 autocompact |
| 阻塞 | >98.5% | 阻止发送，强制手动 /compact |

### 5.2 两条路径

#### 5.2.1 Session Memory Compact（会话记忆压缩）

**优先路径**。利用后台持续维护的 session memory 文件（`SESSIONS.md` 等），直接作为摘要。

**压缩策略**：
- **如何确定压缩内容**：查找 `lastSummarizedMessageId`，此 ID 之前的消息全部被摘要替代
- **如何执行压缩**：用 session memory 内容替换被摘要的消息，保留此 ID 之后的消息（`messagesToKeep`），同时保留最小 10,000 token 和至少 5 条含文本的消息
- **是否调用模型**：**否** — 使用已有 session memory，零额外 API 调用

**保留近期消息的算法**：

```typescript
// src/services/compact/sessionMemoryCompact.ts
export function calculateMessagesToKeepIndex(
  messages: Message[],
  lastSummarizedIndex: number,
): number {
  // 从 lastSummarizedIndex 之后开始
  let startIndex = lastSummarizedIndex + 1

  // 向前扩展直到满足:
  //   - 至少 minTokens (10,000) token
  //   - 至少 minTextBlockMessages (5) 条含文本的消息
  // 但不超过 maxTokens (40,000)
  // 且不跨过已有的 compact boundary
}
```

**边界条件保护**：

```typescript
// src/services/compact/sessionMemoryCompact.ts:232
export function adjustIndexToPreserveAPIInvariants(
  messages: Message[],
  startIndex: number,
): number {
  // Step 1: 确保 tool_use/tool_result 配对完整
  //   如果保留的消息中有 tool_result，必须包含对应的 assistant tool_use
  
  // Step 2: 确保同 id 的 assistant 消息不被分割
  //   流式输出会产生多个同 message.id 的 assistant 块
  //   （thinking, tool_use 等），必须保持完整
}
```

**对缓存命中率的影响**：

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ⚠️ 保留近期消息的缓存前缀 |
| 缓存消息体 | ❌ 远期被摘要替代 |
| 整体影响 | 🟠 **中** — 比全量压缩好，但仍改变消息前缀 |

#### 5.2.2 Legacy Compact（Forked Agent 总结）

**兜底路径**。当 Session Memory 不可用或失败时使用。

**压缩策略**：
- **如何确定压缩内容**：**全部**历史消息
- **如何执行压缩**：通过 Forked Agent 调用模型生成结构化摘要（9 段式），然后用 `[boundary + summary + re-injected context]` 替换全部历史
- **是否调用模型**：**是** — 调用 Forked Agent 生成摘要

**摘要 Prompt 结构**（`src/services/compact/prompt.ts`）：

```
<analysis>  — 起草分析区域（最终被 strip 掉）
<summary>
  1. Primary Request and Intent
  2. Key Technical Concepts
  3. Files and Code Sections
  4. Errors and fixes
  5. Problem Solving
  6. All user messages
  7. Pending Tasks
  8. Current Work
  9. Optional Next Step
</summary>
```

系统先用 `<analysis>` 让模型组织思路，再用 `formatCompactSummary()` 提取 `<summary>` 内容，去除分析草稿。

**压缩前的脱水操作**：

```typescript
// 1. 剥离图片和文档块（防止压缩请求本身超限）
stripImagesFromMessages(messages)
// 将 image/document 块替换为 [image]/[document] 文本标记

// 2. 剥离将被重新注入的附件（避免浪费 token 且污染摘要）
stripReinjectedAttachments(messages)
// 移除 skill_discovery/skill_listing 等 attachment
```

**Forked Agent 的缓存共享**（核心优化）：

```typescript
// src/services/compact/compact.ts:1179-1200
const result = await runForkedAgent({
  promptMessages: [summaryRequest],
  cacheSafeParams,        // ← 关键：传递主对话的缓存参数
  canUseTool: createCompactCanUseTool(),
  querySource: 'compact',
  forkLabel: 'compact',
  maxTurns: 1,
  skipCacheWrite: true,   // ← 不写入新缓存（因为是临时 fork）
  // 注意：不设置 maxOutputTokensOverride！
  //    因为会改变 thinking config，导致 cache key 不匹配
})
```

Forked Agent 通过发送与主线程相同的 `cacheSafeParams`（system prompt、tools、model、messages prefix、thinking config），使 Anthropic 服务端将压缩请求视为同一对话的延续，命中已有缓存。

注释中的实验数据（2026年1月）：

> false path is 98% cache miss, costs ~0.76% of fleet cache_creation (~38B tok/day), concentrated in ephemeral envs (CCR/GHA/SDK) with cold GB cache and 3P providers where GB is disabled.

**PTL（Prompt Too Long）降级**：

```typescript
// src/services/compact/compact.ts:460-491
// 如果压缩请求本身超限，剥洋葱式丢弃最老的 API-round 分组
const truncated = ptlAttempts <= MAX_PTL_RETRIES
  ? truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
  : null
```

`truncateHeadForPTLRetry()` 使用 `groupMessagesByApiRound()` 按 API 轮次分组，计算需要丢弃多少组才能覆盖 token 差值，默认丢弃 20%。

**状态重建（State Re-injection）**：

压缩完成后，系统立即重新注入以下上下文确保 Agent 不"失忆"：

```typescript
// src/services/compact/compact.ts:517-585
// 1. 文件附件 — 最近读取的文件内容
createPostCompactFileAttachments(preCompactReadFileState, context, 5)
// 限制：最多 5 个文件，每个 5K token，总 budget 50K

// 2. Plan 附件 — 正在执行的 Plan
createPlanAttachmentIfNeeded(context.agentId)

// 3. Plan Mode 附件 — 当前处于 plan mode
createPlanModeAttachmentIfNeeded(context)

// 4. Skill 附件 — 已激活的 Skill
createSkillAttachmentIfNeeded(context.agentId)
// 限制：每个 5K token，总 budget 25K
// 按调用时间倒序排列，budget 压力时丢弃最不相关的
// 每个 skill 截断保留头部（setup/usage 指令通常在头部）

// 5. 工具声明 — 重新宣告所有 deferred tools
getDeferredToolsDeltaAttachment(context.options.tools, ...)
// 空消息历史 → diff against nothing → 全量宣告

// 6. Agent 列表 — 重新宣告 agent 定义
getAgentListingDeltaAttachment(context, [])

// 7. MCP 指令 — 重新宣告 MCP server 指令
getMcpInstructionsDeltaAttachment(...)

// 8. Session Start Hooks — 恢复 CLAUDE.md 等元数据
processSessionStartHooks('compact', { model })
```

**文件附件的智能去重**：

```typescript
// src/services/compact/compact.ts:1421-1430
// 如果保留的消息中已有 Read tool 的完整结果，跳过该文件的重新注入
// 避免浪费最多 25K token/compact
const preservedReadPaths = collectReadToolFilePaths(preservedMessages)
// ... filter out files already in preserved messages
```

**熔断器（Circuit Breaker）**：

```typescript
// src/services/compact/autoCompact.ts:70
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// 连续失败 3 次后，完全停发该会话的 autocompact 请求
if (tracking?.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
  return { wasCompacted: false }
}
```

BQ 数据（2026-03-10）：1,279 个会话有 50+ 连续失败（最多 3,272 次），每天浪费 ~250K 次 API 调用。这个简单的熔断器节省了巨额资源。

**重压缩检测（Recompaction Detection）**：

```typescript
export type RecompactionInfo = {
  isRecompactionInChain: boolean        // 是否是链式重压缩
  turnsSincePreviousCompact: number     // 距上次压缩的轮次数
  previousCompactTurnId?: string        // 上次压缩的 turn ID
  autoCompactThreshold: number          // 当前阈值
  querySource?: QuerySource
}
```

系统追踪压缩是否形成链式循环（压缩后立即又触发压缩），以及距上次压缩经过了多少轮。`willRetriggerNextTurn` 标志预测压缩结果是否会在下一轮立即再次触发压缩。

**对缓存命中率的影响**：

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ❌ **全部重建** — 消息列表被完全替换 |
| 缓存消息体 | ❌ **全部重建** — 只有 summary + attachments |
| 整体影响 | 🔴 **高** — 但 Forked Agent 侧命中主缓存 |

---

## 6. L5: Reactive Compact 反应式压缩

### 6.1 工作原理

**被动触发**。只有当 API 返回 413 (Prompt Too Long) 时才执行，而不是提前预测。核心思路是从消息尾部逐步剥离旧消息直到能塞进窗口。

### 6.2 压缩策略

- **如何确定压缩内容**：从消息列表尾部开始，按 `groupMessagesByApiRound()` 分组，逐步剥离最老的 API 轮次分组，直到 token 数低于窗口大小
- **如何执行压缩**：与 Legacy Compact 相同的 Forked Agent 总结流程
- **是否调用模型**：**是** — 调用 Forked Agent

### 6.3 与其他机制的协作

```typescript
// src/query.ts:1086-1117
if (isWithheld413) {
  // 优先级1: drain staged context-collapses
  if (feature('CONTEXT_COLLAPSE') && contextCollapse && 
      state.transition?.reason !== 'collapse_drain_retry') {
    const drained = contextCollapse.recoverFromOverflow(messagesForQuery, querySource)
    if (drained.committed > 0) {
      // 成功 → 重试
      continue
    }
  }
}

// 优先级2: reactive compact
if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
  const compacted = await reactiveCompact.tryReactiveCompact(...)
  if (compacted) {
    // 成功 → 重试
    continue
  }
}

// 优先级3: 都失败了 → 报错退出
yield lastMessage
return { reason: 'prompt_too_long' }
```

### 6.4 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ⚠️ 保留未被剥离的部分 |
| 缓存消息体 | ❌ 被剥离部分丢失 |
| 整体影响 | 🟠 **中** — 尾部剥离比全量压缩破坏范围小 |

### 6.5 Reactive-Only 模式

当 GrowthBook `tengu_cobalt_raccoon` 开启时，系统进入 Reactive-Only 模式：**抑制 proactive autocompact**，让 reactive compact 在 API 返回 413 时才触发。

源码注释（`src/services/compact/autoCompact.ts:189-199`）：

> returning false here also means autoCompactIfNeeded never reaches trySessionMemoryCompaction in the query loop — the /compact call site still tries session memory first.

---

## 7. L6: API Context Management 服务端上下文管理

### 7.1 工作原理

利用 Anthropic API 原生的 `context_management` 参数，在服务端执行上下文优化。客户端只需在请求中附加配置，服务端自动在推理时处理。

### 7.2 压缩策略

两种策略：

#### 策略1：`clear_tool_uses_20250919`

- **如何确定压缩内容**：由服务端决定。客户端仅提供触发阈值（`trigger.value = 180,000 input_tokens`）、清除目标（`clear_tool_inputs` — 指定哪些工具的 result 可以被清除）和最少清除量（`clear_at_least = 140,000 tokens`）
- **如何执行压缩**：服务端在推理时自动清除符合条件的 tool_result 内容
- **是否调用模型**：**否** — 服务端自动处理

```typescript
// src/services/compact/apiMicrocompact.ts
const strategy: ContextEditStrategy = {
  type: 'clear_tool_uses_20250919',
  trigger: { type: 'input_tokens', value: 180_000 },
  clear_at_least: { type: 'input_tokens', value: 140_000 },
  clear_tool_inputs: [
    ...SHELL_TOOL_NAMES,
    GLOB_TOOL_NAME, GREP_TOOL_NAME,
    FILE_READ_TOOL_NAME,
    WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME,
  ],
}
```

#### 策略2：`clear_thinking_20251015`

- **如何确定压缩内容**：客户端指定保留策略
- **如何执行压缩**：服务端清除之前 assistant turn 的 thinking 块，只保留指定的轮次数
- **是否调用模型**：**否**

```typescript
strategies.push({
  type: 'clear_thinking_20251015',
  keep: clearAllThinking ? { type: 'thinking_turns', value: 1 } : 'all',
})
```

当 `clearAllThinking = true`（空闲 >1h，cache 必然 miss）时，只保留最后一轮思考。

### 7.3 对缓存命中率的影响

| 维度 | 影响 |
|------|------|
| 缓存前缀 | ✅ **完整保留** — 服务端在推理时执行，不影响缓存前缀 |
| 缓存消息体 | ✅ **保留** — 被清除的部分在缓存层面仍然存在，只是推理时跳过 |
| 整体影响 | 🟢 **零** — 最缓存友好的压缩方式 |

---

## 8. 压缩对缓存命中率的影响矩阵

### 8.1 综合对比

| 机制 | 缓存前缀 | 缓存消息体 | 整体命中率影响 | 需要模型调用 | 恢复速度 |
|------|----------|-----------|--------------|------------|---------|
| **Snip** | ❌ 从切断点后失效 | ❌ 被删消息无法命中 | 🔴 高 | 否 | 下轮重建 |
| **Time-Based MC** | ✅ 已过期无影响 | ✅ 已过期无影响 | 🟢 零 | 否 | 即时 |
| **Cached MC** | ✅ **完整保留** | ⚠️ 被编辑部分降级 | 🟡 低 | 否 | 即时 |
| **Context Collapse** | ❌ 归档消息消失 | ❌ 投影摘要不命中 | 🟠 中 | 是 | 渐进恢复 |
| **SM Compact** | ⚠️ 保留近期 | ❌ 远期被摘要替代 | 🟠 中 | 否 | 下轮重建 |
| **Legacy Compact** | ❌ **全部重建** | ❌ **全部重建** | 🔴 高 | 是 | 1-2轮 |
| **Reactive Compact** | ⚠️ 保留未剥离部分 | ❌ 被剥离部分丢失 | 🟠 中 | 是 | 立即重试 |
| **API Context Mgmt** | ✅ **完整保留** | ✅ **完整保留** | 🟢 零 | 否 | 即时 |

### 8.2 缓存命中率恢复曲线

```
Cache Hit Rate
100% ┤██████████ 基线
    │
 90% ┤████████░░ Time-Based MC（零损失）
    │         ░░ Cached MC（仅被编辑部分 miss）
 80% ┤         ░░░░ Collapse / SM Compact（渐进恢复）
    │              ░░░░░░ Reactive Compact（尾部 miss）
 60% ┤                   ░░░░░░░░ Legacy Compact（全量重建）
    │
    └──────────────────────────────────→ 轮次
     压缩发生          缓存恢复
```

---

## 9. 缓存命中率保护体系

### 9.1 Prompt Cache Break Detection（缓存断裂检测）

**`src/services/api/promptCacheBreakDetection.ts`** — 两阶段检测系统：

#### Phase 1: recordPromptState()（预调用）

在 API 调用前，记录当前 prompt 状态快照：

```typescript
export type PromptStateSnapshot = {
  system: TextBlockParam[]
  toolSchemas: BetaToolUnion[]
  querySource: QuerySource
  model: string
  agentId?: AgentId
  fastMode?: boolean
  globalCacheStrategy?: string
  betas?: readonly string[]
  autoModeActive?: boolean
  isUsingOverage?: boolean
  cachedMCEnabled?: boolean
  effortValue?: string | number
  extraBodyParams?: unknown
}
```

系统计算 11 项 hash 比较：
- `systemHash` — system prompt 文本内容（去除 cache_control）
- `toolsHash` — tools schema 内容（去除 cache_control）
- `cacheControlHash` — 专门追踪 cache_control 的变化（捕获 scope/TTL 翻转）
- `model` — 模型名称
- `fastMode` — 快速模式
- `globalCacheStrategy` — 全局缓存策略
- `betas` — beta 头列表
- `autoModeActive` — 自动模式
- `isUsingOverage` — 超额状态
- `cachedMCEnabled` — cached MC 状态
- `effortValue` / `extraBodyHash` — 努力级别/额外参数

#### Phase 2: checkResponseForCacheBreak()（响应后）

检查 API 响应的 `cache_read_input_tokens` 是否下降 >5% 且绝对值 >2000 tokens：

```typescript
const tokenDrop = prevCacheRead - cacheReadTokens
if (
  cacheReadTokens >= prevCacheRead * 0.95 ||
  tokenDrop < MIN_CACHE_MISS_TOKENS  // 2000
) {
  return  // 不是 cache break
}
```

如果检测到断裂，根据 pendingChanges 生成原因解释：

| 原因 | 判断条件 |
|------|---------|
| model changed | `changes.modelChanged` |
| system prompt changed | `changes.systemPromptChanged` + 字符差值 |
| tools changed | `changes.toolSchemasChanged` + 工具增减数 |
| fast mode toggled | `changes.fastModeChanged` |
| cache strategy changed | `changes.globalCacheStrategyChanged` |
| cache_control scope/TTL | `changes.cacheControlChanged`（独立于其他变化时才报告） |
| betas changed | `changes.betasChanged` + 差异列表 |
| auto mode toggled | `changes.autoModeChanged` |
| effort changed | `changes.effortChanged` |
| extra body changed | `changes.extraBodyChanged` |
| 可能 1h TTL 过期 | 最后 assistant 消息 >1h，无客户端变化 |
| 可能 5min TTL 过期 | 最后 assistant 消息 >5min，无客户端变化 |
| 可能服务端问题 | <5min gap，prompt 未变 |
| 未知原因 | 无变化标志，无时间信息 |

系统还会写入 diff 文件（`createPatch()` 格式），记录断裂前后的完整 prompt 差异，供调试分析。

### 9.2 三种缓存保护通知

| 通知 | 函数 | 触发时机 | 作用 |
|------|------|---------|------|
| `notifyCompaction()` | `promptCacheBreakDetection.ts:689` | 压缩完成后 | 重置 `prevCacheReadTokens=null`，跳过下次比较 |
| `notifyCacheDeletion()` | `promptCacheBreakDetection.ts:673` | Cached MC 删除后 | 标记 `cacheDeletionsPending=true`，跳过 cache_edits 导致的下降 |
| `markPostCompaction()` | `bootstrap/state.js` | 压缩后标记 | 供其他模块检查 post-compaction 状态 |

这些通知防止了以下误报场景：

1. **压缩后 cache read 自然下降** → `notifyCompaction()` 重置基线
2. **Cached MC 删除 tool result** → `notifyCacheDeletion()` 标记预期
3. **Time-Based MC 清除内容后** → `notifyCacheDeletion()` 标记预期

### 9.3 Forked Agent Cache Sharing

**核心优化**：Forked Agent 复用主对话的 prompt cache。

```
主线程缓存:  [system|tools|msg1|msg2|...|msgN|latest_user_msg]
                                           ↑ cache hit 前缀
Forked Agent: [system|tools|msg1|msg2|...|msgN|summary_request]
                                           ↑ 完全相同的 cache hit 前缀！
```

关键约束（源码注释 `src/services/compact/compact.ts:1181-1187`）：

> DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's prompt cache by sending identical cache-key params (system, tools, model, messages prefix, thinking config). Setting maxOutputTokens would clamp budget_tokens via Math.min(budget, maxOutputTokens-1) in claude.ts, creating a thinking config mismatch that invalidates the cache.

实现：

```typescript
const result = await runForkedAgent({
  promptMessages: [summaryRequest],     // 只发送额外的总结指令
  cacheSafeParams,                       // 传递主对话的缓存安全参数
  maxTurns: 1,                           // 只执行一轮
  skipCacheWrite: true,                  // 不写入新缓存（临时 fork）
})
```

### 9.4 Cache Breakpoints 策略

**单一标记原则**（`src/services/api/claude.ts:3078-3089`）：

> Exactly one message-level cache_control marker per request. With two markers the second-to-last position is protected and its locals survive an extra turn even though nothing will ever resume from there — with one marker they're freed immediately.

```typescript
const markerIndex = skipCacheWrite ? messages.length - 2 : messages.length - 1
```

对于 `skipCacheWrite = true` 的 fork（如 compact），标记放在倒数第二个消息，这样 fork 不会在 KVCC 中留下自己的尾部。

### 9.5 递进式压缩避免全量重建

```
零成本: Time-Based MC（cache 已过期）
  ↓ 无法解决
低损失: Cached MC（仅 cache_edit，前缀完整）
  ↓ 无法解决
中损失: Collapse / SM Compact（渐进归档 / 保留近期）
  ↓ 无法解决
高损失: Legacy Compact（全量重建）
```

### 9.6 Post-Compact 重建的缓存考量

重新注入的内容有严格的 token 限流，避免一次性注入太多 token 导致立即再次触发压缩：

| 重建内容 | 单项上限 | 总预算 | 缓存影响 |
|----------|---------|--------|---------|
| 文件内容 | 5K tok/file | 50K tok | `cache_creation`（新注入） |
| Plan 内容 | 无上限 | 含在文件中 | `cache_creation` |
| Skill 内容 | 5K tok/skill | 25K tok | `cache_creation`（新注入） |
| Deferred Tools | — | — | `cache_creation`（全量宣告） |
| Session Start Hooks | — | — | 恢复 CLAUDE.md 缓存 |

**不重置 `sentSkillNames`**（源码注释 `src/services/compact/compact.ts:524-529`）：

> Intentionally NOT resetting sentSkillNames: re-injecting the full skill_listing (~4K tokens) post-compact is pure cache_creation with marginal benefit. The model still has SkillTool in its schema and invoked_skills attachment (below) preserves used-skill content.

### 9.7 Beta Header 的 Session-Stable 策略

Cache editing 和 auto-mode 的 beta header 一旦出现就被锁定（latched），即使 feature flag 后续关闭，也不再移除。这避免了 header 变化导致的 cache key 不匹配：

```typescript
// src/services/api/claude.ts:1673-1686
if (cachedMCEnabled && !betasParams.includes(cacheEditingBetaHeader)) {
  betasParams.push(cacheEditingBetaHeader)  // latched on
}
```

---

## 10. 设计哲学与核心洞察

### 10.1 缓存效率是第一优先级

Claude Code 的压缩设计不是追求"压缩比最高"，而是追求"在保证缓存效率的前提下释放足够的上下文空间"。最极端的体现：

- **Time-Based MC**：只在 cache 必然过期时才清除，实现零额外 miss
- **Cached MC**：通过 cache_edits API 实现唯一不破坏缓存前缀的压缩
- **Forked Agent Cache Sharing**：压缩本身也利用缓存，而非另起炉灶

### 10.2 渐进降级优于一步到位

六层防线从 L1 到 L6 逐步加重，每一层都只在上一层无法解决问题时才触发。这种设计确保：

- 大多数情况下 Time-Based MC + Cached MC 就能解决上下文压力
- 只有极端场景才需要全量压缩
- 缓存断裂的影响被限制在最小范围

### 10.3 可观测性驱动优化

Cache Break Detection 系统不仅检测断裂，还精确定位原因（客户端 vs 服务端 vs TTL），并写入 diff 文件。这种精细的可观测性使得：

- 区分"预期的 cache 下降"和"意外的 cache break"
- 通过 BQ 分析发现：关闭 cache sharing 时 98% miss，~38B tok/day 的额外创建
- 通过 BQ 发现：连续失败 session 浪费 ~250K API calls/day

### 10.4 压缩不是终点，状态连续性才是

压缩后立即进行的状态重建（re-injection）确保 Agent 不"失忆"。这体现了 Claude Code 的一个核心洞察：**压缩的价值不在于减少多少 token，而在于压缩后的 Agent 是否能无缝继续工作**。

---

## 附录：关键源码索引

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/query.ts` | 401-410 | Snip 执行入口 |
| `src/query.ts` | 413-426 | Microcompact 执行入口 |
| `src/query.ts` | 440-447 | Context Collapse 执行入口 |
| `src/query.ts` | 453-467 | Auto-Compact 执行入口 |
| `src/query.ts` | 1086-1117 | 413 后的恢复链（Collapse → Reactive → 报错） |
| `src/services/compact/autoCompact.ts` | 62-91 | 阈值计算与触发逻辑 |
| `src/services/compact/autoCompact.ts` | 160-239 | shouldAutoCompact 判断 |
| `src/services/compact/autoCompact.ts` | 241-351 | autoCompactIfNeeded 主流程 |
| `src/services/compact/compact.ts` | 145-200 | stripImagesFromMessages |
| `src/services/compact/compact.ts` | 387-763 | compactConversation 主流程 |
| `src/services/compact/compact.ts` | 1136-1396 | streamCompactSummary（Forked Agent + Fallback） |
| `src/services/compact/compact.ts` | 1398-1464 | createPostCompactFileAttachments |
| `src/services/compact/microCompact.ts` | 253-293 | microcompactMessages 主流程 |
| `src/services/compact/microCompact.ts` | 305-399 | cachedMicrocompactPath |
| `src/services/compact/microCompact.ts` | 422-530 | maybeTimeBasedMicrocompact |
| `src/services/compact/timeBasedMCConfig.ts` | 1-43 | Time-Based MC 配置 |
| `src/services/compact/sessionMemoryCompact.ts` | 514-630 | trySessionMemoryCompaction |
| `src/services/compact/prompt.ts` | 19-143 | 摘要 Prompt 模板 |
| `src/services/compact/grouping.ts` | 22-63 | groupMessagesByApiRound |
| `src/services/compact/apiMicrocompact.ts` | 64-153 | getAPIContextManagement |
| `src/services/api/promptCacheBreakDetection.ts` | 247-430 | recordPromptState (Phase 1) |
| `src/services/api/promptCacheBreakDetection.ts` | 437-666 | checkResponseForCacheBreak (Phase 2) |
| `src/services/api/promptCacheBreakDetection.ts` | 673-698 | notifyCacheDeletion / notifyCompaction |
| `src/services/api/claude.ts` | 3052-3211 | addCacheBreakpoints（cache_edits 注入） |
| `src/services/api/claude.ts` | 1184-1205 | Cached MC 启用判断 |
| `src/utils/context.ts` | 8-26 | 上下文窗口常量与分配 |
| `src/utils/sessionStorage.ts` | 1978-2035 | applySnipRemovals |
