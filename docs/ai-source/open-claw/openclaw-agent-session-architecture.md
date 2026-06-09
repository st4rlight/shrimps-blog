---
title: OpenClaw Agent & Session 模型深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 拆解 Agent Loop 的核心执行机制、双重队列调度、Failover 策略、Session 路由与 Hook 生命周期。
createTime: 2026/06/08 10:09:18
permalink: /ai-source/openclaw-agent-session-architecture/
---
# OpenClaw Agent & Session 模型深度解析：从执行循环到会话路由

> 📖 **阅读顺序：5 / 共 8 篇** · 🟡 核心 · Agent Loop、Session 模型、Failover、Hook
>
> 基于 `src/agents/`、`src/sessions/`、`src/routing/`、`src/hooks/` 源码分析。本文拆解 Agent Loop 的核心执行机制、双重队列调度、Failover 策略、Compaction 压缩、Session 路由与隔离模型、Hook 生命周期——揭示 OpenClaw 如何让一个 `while(true)` 循环既可靠又可扩展。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| Agent Loop 怎么跑、退出条件是什么 | §1 Agent Loop（3890 行的核心循环） |
| 怎么保证"同 session 不并发 + 跨 session 跑得开" | §2 双重队列（Session 串行 + Global 并发） |
| 怎么选 model、怎么选 harness | §3 Provider/Model/Harness 解析链 |
| 一个 profile 失败了会怎样 | §4 认证 Profile 轮转与 Failover |
| 上下文太长了怎么办 | §5 Compaction（上下文压缩） |
| Agent 跑完了怎么报告"为什么停" | §6 Agent Run Terminal Outcome |
| 同一群聊 / 不同用户怎么隔离 | §7 Session Key + DM Scope |
| 入站消息怎么路由到具体 session | §8 路由解析 |
| 怎么在 Agent 生命周期里塞自己的逻辑 | §9 Hook 系统（39 个 hook） |

**一句话**：Agent Loop = 一个跑在双重队列里的 `while(true)` 循环，每次迭代组装 prompt → 调 LLM → 处理工具 → 决定是否继续/重试/退出。Session Key + DM Scope 决定"谁和谁的对话共享上下文"。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/agents/embedded-agent-runner/run.ts:570-633  ← 双重队列（enqueueSession / enqueueGlobal）
  src/agents/embedded-agent-runner/run.ts:649+     ← while(true) 主循环入口
  src/agents/agent-run-terminal-outcome.ts         ← 7 种终止状态 + 优先级
  src/routing/session-key.ts:222-263                ← 4 种 dmScope 怎么映射到 session key
  src/routing/resolve-route.ts:94                   ← buildAgentSessionKey 入口

深入某个子系统：
  src/agents/failover-policy.ts                     ← 共享冷却探测策略（48 行）
  src/agents/embedded-agent-runner/run/failover-policy.ts  ← runner 内策略（239 行）
  src/agents/compaction.ts                          ← 上下文压缩主流程
  src/sessions/session-key-utils.ts                 ← Session key 解析 / 分类
  src/plugins/hook-types.ts:75-120                  ← 39 个 hook 的联合类型
```

---

## 目录

1. [Agent Loop：3891 行的核心循环](#1-agent-loop3891-行的核心循环)
2. [双重队列：Session 串行 + Global 并发](#2-双重队列session-串行--global-并发)
3. [Provider/Model/Harness 解析链](#3-providermodelharness-解析链)
4. [认证 Profile 轮转与 Failover](#4-认证-profile-轮转与-failover)
5. [Compaction：上下文压缩的工程实践](#5-compaction上下文压缩的工程实践)
6. [Agent Run Terminal Outcome：终止状态的标准化](#6-agent-run-terminal-outcome终止状态的标准化)
7. [Session Key 体系：会话的身份与路由](#7-session-key-体系会话的身份与路由)
8. [路由解析：从消息到 Agent 的映射](#8-路由解析从消息到-agent-的映射)
9. [Hook 系统：Agent 生命周期的可扩展点](#9-hook-系统agent-生命周期的可扩展点)
10. [设计哲学总结](#10-设计哲学总结)

---

## 1. Agent Loop：3891 行的核心循环

### 1.1 整体架构

`src/agents/embedded-agent-runner/run.ts` 是 OpenClaw 对话引擎的心脏。`runEmbeddedAgent` 函数负责一次完整对话 turn 的执行，其结构可以抽象为五个阶段：

```
runEmbeddedAgent(params)
  │
  ├── 阶段 1：Session Key 补填 & 队列初始化
  │     确定 sessionKey，加入 session 队列和 global 队列
  │
  ├── 阶段 2：双重队列调度
  │     等待 session 队列轮到当前请求
  │     等待 global 队列的并发槽位
  │
  ├── 阶段 3：运行时初始化
  │     ├── Workspace/Hooks 解析
  │     ├── Provider/Model 解析 & Harness 选择
  │     ├── Auth Profile 初始化
  │     ├── Context Engine 初始化
  │     └── 循环状态变量初始化
  │
  ├── 阶段 4：while(true) 主循环
  │     ├── 组装 prompt（含重试指令）
  │     ├── 构建 runtime plan（认证、模型、thinking level）
  │     ├── 调度一次 LLM Attempt
  │     ├── 处理 LLM 响应（文本 / 工具调用 / 错误）
  │     ├── 工具执行（bash / browser / message / ...）
  │     ├── Compaction 检查与触发
  │     ├── Failover 决策（错误/超时/限流）
  │     └── 终止路径判断（return 或 continue）
  │
  └── 阶段 5：finally cleanup
        清理队列槽位、释放资源、记录指标
```

### 1.2 阶段 3 的深度：运行时解析的复杂性

阶段 3 是"从配置到运行时"的转换核心，包含以下子步骤：

**Hook 可修改 Provider/Model**：`before_agent_start` Hook 可以根据 prompt 内容将请求路由到不同的模型——例如，将代码相关的请求路由到 coding 模型，将翻译请求路由到更经济的模型。

**Harness 选择**：`ensureSelectedAgentHarnessPlugin` 和 `selectAgentHarness` 决定由哪个运行时执行本次 attempt。OpenClaw 支持 `openclaw`（默认）、`codex`、`copilot` 等 harness，不同 harness 有自己的 transport 和认证机制。

**模型解析的回退链**：先尝试运行时 Provider 解析，再回退到原始 Provider。如果都失败，强制生成 `models.json` 后重试：

```
resolveModelAsync(selectedRuntimeProvider) → 失败
  → resolveModelAsync(originalProvider) → 失败
    → ensureOpenClawModelsJson() → 生成模型目录
      → resolveModelAsync(selectedRuntimeProvider) → 重试
        → resolveModelAsync(originalProvider) → 重试
```

**Cron 触发的特殊路径**：当 `trigger === "cron"` 时，`before_agent_reply` Hook 可以拦截并直接返回结果，完全跳过 LLM 调用。这允许 Hook 实现"定时任务但只在特定条件下才调用 LLM"的逻辑。

> 💡 **Takeaway**：`before_agent_reply` 拦截是**省钱利器**——很多 cron 任务其实只是"检查 X 是否变了，变了才发 LLM"。`trigger === "cron"` + `before_agent_reply` 直接返回，可以让 99% 的 cron tick 不消耗任何 token。

### 1.3 while(true) 主循环的退出条件

主循环不是无限循环，它有明确的退出条件：

| 退出条件 | 触发方式 | 处理函数 |
|----------|----------|----------|
| 正常完成 | LLM 返回无工具调用的文本 | 返回 payload |
| 硬超时 | `MAX_RUN_DURATION_MS` | `handleHardTimeout` |
| 软超时 | `runTimeoutMs` 配置 | `handleTimeoutExceeded` |
| 取消 | `AbortSignal` | `AbortError` |
| 重试耗尽 | `MAX_RUN_LOOP_ITERATIONS` | `handleRetryLimitExhaustion` |
| Failover 抛出 | `FailoverError` | 传播到外层 |
| Liveness 阻塞 | 活性检测连续失败 | `livenessState: "blocked"` |

> 💡 **Takeaway**：写自定义 hook 或集成 OpenClaw Agent 时，**优先用 `MAX_RUN_DURATION_MS` 兜底**——它会强制终止，避免"软超时一直重试"导致的钱包空转。`livenessState: "blocked"` 是最后一道防线，是活性检测连续失败后的硬刹车。

---

## 2. 双重队列：Session 串行 + Global 并发

### 2.1 为什么需要双重队列？

OpenClaw 面临一个独特的并发挑战：同一个 Session 的请求必须串行（避免上下文混乱），但不同 Session 的请求应该并发（提高吞吐）。双重队列优雅地解决了这个问题：

```
入站请求
  │
  ├── 加入 Session 队列（同一 sessionKey 的请求串行化）
  │     等待轮到当前请求
  │
  └── 加入 Global 队列（控制整体并发度）
        等待全局并发槽位
```

### 2.2 Session 队列的语义

![双重队列调度](/ai-source/open-claw/openclaw-agent-dual-queue.svg)

Session 队列保证了**同一会话的请求不会并发执行**。这在以下场景中至关重要：

- 用户在飞书群中快速连续发送多条消息
- Cron 任务触发的同时用户也在对话
- 子 Agent 和父 Agent 共享同一个 Session

### 2.3 Global 队列的语义

Global 队列控制**整体并发度**，防止单个 Gateway 进程同时执行过多的 LLM 调用。这在以下场景中至关重要：

- 多个 Channel 同时有活跃对话
- 多个 Agent 同时运行
- API 速率限制的预算管理

### 2.4 Lane 并发控制

Gateway 通过 `src/gateway/server-lanes.ts` 的 `applyGatewayLaneConcurrency(cfg)` 推导出**按工作类型分 lane**的并发上限，而不是按 Channel 分 lane。`src/process/lanes.ts` 定义了 5 条命名 lane：

```
CommandLane.Main       — 主 agent turn
CommandLane.Cron       — 定时任务
CommandLane.CronNested — Cron 内部嵌套的 LLM 调用
CommandLane.Subagent   — 子 agent turn
CommandLane.Nested     — 嵌套执行
```

每条 lane 的并发数从 `cfg.agents.defaults.maxConcurrent` / `cfg.cron.maxConcurrentRuns` / `cfg.agents.defaults.subagents.maxConcurrent` 派生，由 `setCommandLaneConcurrency` 推入进程级 `CommandQueue`。同一 lane 内的请求串行化，跨 lane 互不阻塞——这与双重队列（同一 session 串行 + 跨 session 并发）是正交的两层并发控制。

> 💡 **Takeaway**：双重队列 + Lane 是**两层正交控制**——前者按"会话身份"分（同 session 串行），后者按"工作类型"分（不同 lane 互不阻塞）。**调并发时先想清楚调哪层**：想限制"单用户连发"调 session 队列（默认 1），想限制"全 Gateway 吞吐"调 Global / Lane 上限。

---

## 3. Provider/Model/Harness 解析链

### 3.1 解析链路

从配置到实际 LLM 调用，Provider/Model 的解析经过以下链路：

```
params.provider + params.model (用户/配置指定的)
  │
  ↓ Hook 可修改
hookRunner.runBeforeAgentStart → 可能修改 provider/modelId
  │
  ↓ Harness 选择
selectAgentHarness → 决定运行时（openclaw/codex/copilot）
  │
  ↓ 运行时 Provider 映射
resolveSelectedOpenAIRuntimeProvider → harness 可能需要不同的 provider
  │
  ↓ 模型解析（带回退链）
resolveModelAsync → 查找模型目录 → 获取模型配置 + 认证信息
  │
  ↓ 有效运行时模型
resolveEffectiveRuntimeModel → 考虑上下文窗口限制等
```

### 3.2 Harness 的意义

Harness 是 Agent 执行的运行时环境。OpenClaw 默认使用自己的 `openclaw` harness（直接调用 LLM API），但也支持 `codex` harness（使用 OpenAI Codex 的 transport 和认证）和 `copilot` harness。

**Harness 与 Provider 的关系**：Harness 决定了**如何调用**，Provider 决定了**调用谁**。同一个 Provider 可以被不同的 Harness 使用，但不同的 Harness 可能需要不同的认证方式。

### 3.3 Auth Profile Store

`attemptAuthProfileStore` 管理了所有可用的认证 Profile：

```typescript
// Profile 包含 provider、type、认证信息等
type AuthProfile = {
  provider: string;
  type: "api_key" | "oauth" | "managed";
  // ... 认证信息
};
```

Profile Store 支持：
- **轮转**：当一个 Profile 失败后，自动尝试下一个
- **冷却**：失败的 Profile 进入冷却期，避免持续重试
- **探测**：冷却期内的 Profile 可以被探测以判断是否恢复

---

## 4. 认证 Profile 轮转与 Failover

### 4.1 Failover 决策树

当 LLM 调用失败时，Agent Loop 根据 `FailoverReason` 做出不同的 Failover 决策：

```
失败
  ├── rate_limit → 冷却当前 Profile + 探测下一个
  ├── overloaded → 冷却当前 Profile + 指数退避重试
  ├── auth → 尝试下一个 Profile（认证失败可能只是 key 过期）
  ├── auth_permanent → 跳过当前 Profile，不冷却（永久性失败）
  ├── model_not_found → 尝试 Fallback 模型
  ├── timeout → 冷却当前 Profile + 重试
  ├── empty_response → 重试（可能是临时问题）
  └── unknown → 冷却当前 Profile + 探测下一个
```

### 4.2 冷却与探测机制

`src/agents/failover-policy.ts`（48 行的共享 helper）和 `src/agents/embedded-agent-runner/run/failover-policy.ts`（239 行的 runner 内策略）共同定义冷却探测行为：

**允许冷却期探测的原因**（`shouldAllowCooldownProbeForReason`）：
- `rate_limit` / `overloaded` / `timeout` — 临时性故障，可能已恢复
- `billing` — 计费类问题（中间层账务恢复后可用）
- `unknown` / `no_error_details` / `unclassified` / `empty_response` — 错误信号不清晰，值得再试一次

**不消耗探测槽位的原因**（`shouldPreserveTransientCooldownProbeSlot`）：
- `model_not_found` — 模型不存在不是临时问题
- `auth` / `auth_permanent` — 认证失败
- `session_expired` — 会话过期（与认证相关）
- `format` — 输出格式错误（说明模型或 prompt 不匹配）

这种分层设计避免了"一次临时错误就永久放弃一个 Profile"的过度反应，同时也不会在永久性错误上浪费探测预算。

> 💡 **Takeaway**：`shouldAllowCooldownProbeForReason` 和 `shouldPreserveTransientCooldownProbeSlot` 是**两套不同的过滤**——前者控制"能不能探测"（临时错误 → 允许），后者控制"这次失败要不要扣探测预算"（永久错误 → 保留预算给真正能恢复的失败）。**两个配合**才避免了"把探测预算浪费在永久错误上"。

### 4.3 Model Fallback

除了 Profile 轮转，Agent Loop 还支持 **Model Fallback**——当一个模型不可用时，自动切换到配置的备用模型：

```
resolveAgentModelFallbackValues → 从配置中读取 fallback 模型列表
  → 主模型失败 → 尝试 fallback-1
    → fallback-1 失败 → 尝试 fallback-2
      → 全部失败 → 返回错误
```

Auto-Fallback 还有**主模型探测机制**——当运行在 fallback 模型上时，定期探测主模型是否恢复：

```typescript
const AUTO_FALLBACK_PRIMARY_PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
```

一旦主模型恢复，自动切回主模型，避免长期运行在成本更高或质量更低的 fallback 模型上。

> 💡 **Takeaway**：Failover + Fallback 是 OpenClaw 的"不断降级但不放弃"哲学——主 Profile 失败 → 下一个 Profile；都失败 → Fallback 模型；Fallback 也不工作 → 5 分钟探测一次主模型。**普通用户根本感知不到**——他们只看到"agent 偶尔慢一下"。

---

## 5. Compaction：上下文压缩的工程实践

### 5.1 为什么需要 Compaction？

LLM 的上下文窗口是有限的。当对话历史超过上下文窗口时，必须进行压缩。OpenClaw 的 Compaction 不是简单的截断，而是一个**多步骤的工程化压缩流程**：

### 5.2 Compaction 流程

```
对话历史达到阈值
  │
  ↓ 触发 Compaction
compaction-planning.ts → 计划阶段
  │
  ├── 估算 token 数（estimateMessagesTokens）
  ├── 清理消息（sanitizeCompactionMessages）
  │     去除 runtime-context 条目（安全：不应进入 LLM 摘要）
  │     去除 toolResult.details（安全：工具结果细节可能包含敏感信息）
  ├── 分块策略（splitMessagesByTokenShare）
  │     按比例分块，但不拆分活跃的工具调用对
  └── 处理超大消息（pruneHistoryForContextShare）
        过大的消息用摘要笔记代替
  │
  ↓ 执行摘要
Context Engine compact()
  │
  ├── 单块摘要或多块摘要 + 合并
  ├── LLM 生成摘要
  └── 失败回退："No prior history."
  │
  ↓ 采纳新 Session
adoptCompactionTranscript()
  │
  Compaction 可能轮转 session file → 更新 activeSessionId
```

### 5.3 分块策略：保护工具调用对

Compaction 分块时有一个关键约束——**不能拆分活跃的工具调用对**：

```
Assistant: [tool_call: bash, id=1]  ─┐ 这些消息必须在同一块中
Tool: [result: id=1]                 ─┘
```

`splitMessagesByTokenShare` 确保工具调用和其结果不会分到不同的块中。如果拆分会破坏模型的上下文理解——模型看到了工具调用但看不到结果，或者看到了结果但不知道是什么调用。

### 5.4 安全考虑

Compaction 有两个关键的安全考虑：

1. **Runtime-context 条目不能进入 LLM 摘要**——这些条目包含内部运行时信息，不应泄露给 LLM
2. **ToolResult.details 必须去除**——工具结果的细节可能包含文件内容、环境变量等敏感信息

`sanitizeCompactionMessages` 函数在 token 估算和摘要之前，先执行这些安全清理。

### 5.5 Compaction 与 Hook 的交互

当 Context Engine 自己拥有 Compaction 能力（`ownsCompaction === true`）时，Agent Loop 需要手动触发 `before_compaction` 和 `after_compaction` Hook——因为此时绕过了默认的 `compactEmbeddedAgentSessionDirect` 流程。

```typescript
const runOwnsCompactionBeforeHook = async (reason: string) => {
  if (contextEngine.info.ownsCompaction !== true) return;
  if (!hookRunner?.hasHooks("before_compaction")) return;
  await hookRunner.runBeforeCompaction(...);
};
```

---

## 6. Agent Run Terminal Outcome：终止状态的标准化

### 6.1 为什么需要标准化？

Agent 的运行可能以多种方式终止——正常完成、超时、取消、错误等。如果每种终止方式都有不同的返回格式，调用方需要处理大量的条件分支。`src/agents/agent-run-terminal-outcome.ts` 通过一个统一的类型解决了这个问题：

```typescript
type AgentRunTerminalReason =
  | "completed"    // 正常完成
  | "hard_timeout" // 硬超时（全局最大运行时间）
  | "timed_out"    // 软超时（配置的运行超时）
  | "cancelled"    // 用户取消
  | "aborted"      // 系统中止
  | "blocked"      // 活性检测阻塞
  | "failed";      // 执行失败
```

### 6.2 优先级规则

当多个终止条件同时满足时，有明确的优先级：

```
cancelled > hard_timeout > timed_out > blocked > failed > completed
```

这保证了：如果用户主动取消了运行，无论是否同时超时，结果都是 `cancelled`——这与用户直觉一致。

### 6.3 设计意图

`AgentRunTerminalOutcome` 的核心价值是**让不可能的状态不可表达**——调用方不需要猜测"返回了 error 是否意味着失败"，只需要 switch on `reason`。这是一个典型的"Make impossible states unrepresentable"设计模式。

---

## 7. Session Key 体系：会话的身份与路由

### 7.1 Session Key 格式

Session Key 是 OpenClaw 会话管理的核心标识符，格式定义在 `src/routing/session-key.ts` 和 `src/sessions/session-key-utils.ts`：

```
agent:<agentId>:main                                       ← 主 session（dmScope=main）
agent:<agentId>:direct:<userId>                            ← DM 独立 session（dmScope=per-peer）
agent:<agentId>:<channel>:direct:<userId>                  ← 通道+对端 session（dmScope=per-channel-peer）
agent:<agentId>:<channel>:<accountId>:direct:<userId>      ← 完整限定 DM session（dmScope=per-account-channel-peer）
agent:<agentId>:<channel>:<peerKind>:<peerId>              ← 群组/频道 session（peerKind ∈ {"group", "channel"}）
```

**设计意图**：Session Key 是**层次化的**——从最简单的 `main` 到完整的通道+账号+对端限定。层次的深度决定了会话的隔离粒度。

> **注意**：群组/频道 session 的第五个段是 **`peerKind`（"group" 或 "channel"）**，由通道插件在路由时根据平台语义映射（例如飞书把 `topic_group` 映射为 `channel`）。这与 DM session 的固定 `:direct:` 段不同。

### 7.2 DM Scope 策略

`dmScope` 配置决定了 DM（私聊）场景下的会话隔离粒度：

| dmScope | 语义 | Session Key 示例 |
|---------|------|-----------------|
| `main` | 所有 DM 路由到主 session | `agent:main:main` |
| `per-peer` | 每个对端独立 session | `agent:main:direct:user123` |
| `per-channel-peer` | 按通道+对端隔离 | `agent:main:telegram:default:direct:user123` |
| `per-account-channel-peer` | 最细粒度隔离 | `agent:main:telegram:acct1:direct:user123` |

**选择指导**：
- 个人使用 → `main`（所有对话共享上下文）
- 多人服务 → `per-peer`（每个人有独立上下文）
- 多通道部署 → `per-channel-peer`（不同通道的同一用户也有独立上下文）
- 多账号部署 → `per-account-channel-peer`（每个账号+通道+用户独立）

### 7.3 Identity Links

Identity Links 允许将不同通道上的同一用户关联起来：

```typescript
type IdentityLinks = Record<string, string[]>;
// 例如：
{
  "user@email.com": ["telegram:user123", "feishu:ou_xxx"]
}
```

当 Identity Links 配置后，不同通道上的同一用户会共享同一个 Session Key，实现跨通道的上下文连续性。

> 💡 **Takeaway**：`dmScope` 的选择**直接决定 UX**：选了 `main`，用户从飞书转到 telegram 跟 bot 对话，bot 会"记得"飞书上的事；选了 `per-channel-peer`，bot 觉得"这是新用户"。**90% 的个人助理场景应该用 `main` 或 `per-peer`**——`per-account-channel-peer` 只在多租户 SaaS 才用得到。

---

## 8. 路由解析：从消息到 Agent 的映射

### 8.1 路由解析流程

`src/routing/resolve-route.ts` 的 `resolveAgentRoute` 函数将入站消息映射到具体的 Agent + Session：

```
入站消息 → resolveAgentRoute()
  │
  ├── 匹配 Binding 规则（按优先级）
  │     ├── binding.peer        — 对端 ID 匹配
  │     ├── binding.peer.parent — 父对端匹配（线程场景）
  │     ├── binding.peer.wildcard — 通配符匹配
  │     ├── binding.guild+roles — 服务器+角色匹配
  │     ├── binding.guild       — 服务器匹配
  │     ├── binding.team        — 团队匹配
  │     ├── binding.account     — 账号匹配
  │     └── binding.channel     — 通道匹配
  │
  └── 默认路由
        → agentId = "main", sessionKey 根据默认策略计算
```

### 8.2 Binding 规则

Binding 是配置中的路由规则，允许将特定的对端/群组/通道路由到特定的 Agent：

```json
{
  "routing": {
    "bindings": [
      {
        "agentId": "coding-agent",
        "peer": { "id": "user@company.com" }
      },
      {
        "agentId": "support-bot",
        "guildId": "discord-server-123",
        "roleIds": ["support-role-id"]
      }
    ]
  }
}
```

**匹配优先级**：越具体的规则优先级越高。`binding.peer` 比 `binding.guild` 更具体，`binding.guild+roles` 比 `binding.guild` 更具体。

### 8.3 ResolvedAgentRoute

路由解析的结果是一个 `ResolvedAgentRoute`：

```typescript
type ResolvedAgentRoute = {
  agentId: string;
  channel: string;
  accountId: string;
  sessionKey: string;          // 内部 session key
  mainSessionKey: string;      // 主 session key（用于 last route 策略）
  lastRoutePolicy: "main" | "session";  // 最后路由策略
  matchedBy: string;           // 匹配方式（调试用）
};
```

**lastRoutePolicy**：决定入站消息的"最后路由"更新到哪个 session。`"main"` 意味着更新到主 session，`"session"` 意味着更新到当前 session。这影响了 Agent 在不同 session 之间的上下文共享行为。

---

## 9. Hook 系统：Agent 生命周期的可扩展点

### 9.1 Hook 类型

`src/plugins/hook-types.ts` 的 `PluginHookName` 联合类型定义了插件可订阅的全部 Hook 点。`PLUGIN_HOOK_NAMES` 数组在源码层强制保持与联合类型一致（`Exclude<PluginHookName, PLUGIN_HOOK_NAMES[number]>` 编译期断言为 `never`）。

当前实际包含 **39 个** Hook，按生命周期阶段分组：

| 阶段 | Hook | 触发时机 |
|------|------|----------|
| **模型解析** | `before_model_resolve` | 模型解析前，可改写 provider/model |
| | `agent_turn_prepare` | Agent turn 准备阶段 |
| | `before_prompt_build` | 提示构建前 |
| **Agent 生命周期** | `before_agent_start` | Agent 启动前，可改 provider/model、注入上下文 |
| | `before_agent_reply` | Agent 回复前，可拦截（如 Cron 场景直接返回） |
| | `before_agent_finalize` | 最终确认前，可审查/修改回复 |
| | `agent_end` | Agent 结束 |
| | `before_agent_run` | Agent run 入口前 |
| **模型调用** | `model_call_started` / `model_call_ended` | 模型调用边界 |
| | `llm_input` / `llm_output` | LLM 输入/输出内容（用于日志/审计/改写） |
| **压缩** | `before_compaction` / `after_compaction` | 上下文压缩前后 |
| | `before_reset` | 会话重置前 |
| **消息流** | `inbound_claim` | 入站消息认领（去重） |
| | `message_received` | 收到消息 |
| | `message_sending` / `message_sent` | 出站消息前后 |
| | `reply_payload_sending` | 回复负载发送前 |
| | `before_message_write` | 消息写入持久化前 |
| **工具调用** | `before_tool_call` / `after_tool_call` | 工具调用前后，可拦截/审批/改写 |
| | `tool_result_persist` | 工具结果持久化 |
| **会话** | `session_start` / `session_end` | 会话生命周期 |
| **子 Agent** | `subagent_spawning` *(deprecated, 2026-08-30)* | 子 agent 启动前 |
| | `subagent_delivery_target` | 子 agent 投递目标 |
| | `subagent_spawned` | 子 agent 已启动 |
| | `subagent_ended` | 子 agent 结束 |
| **Gateway** | `gateway_start` / `gateway_stop` | Gateway 启停 |
| | `deactivate` *(deprecated, 2026-08-16)* | 别名，等价 `gateway_stop` |
| **调度** | `cron_changed` | Cron 变更通知 |
| | `heartbeat_prompt_contribution` | 心跳 prompt 注入 |
| **命令派发** | `before_dispatch` / `reply_dispatch` | 命令派发前后 |
| | `before_install` | 插件安装前 |
| | `resolve_exec_env` | 解析执行环境 |

> **关于废弃 hook**：`subagent_spawning` 被 `subagent_spawned` 替代（核心在 `subagent_spawned` 之前已通过 channel session-binding adapters 准备好线程绑定子 agent 的关系），`deactivate` 被 `gateway_stop` 替代。两个 deprecated hook 都有明确的 `removeAfter` 时间窗。

### 9.2 Hook 的执行合约

Hook 的返回值决定了后续行为：

```typescript
type HookResult = {
  handled?: boolean;    // 是否已处理（跳过默认行为）
  reply?: { text: string };  // 替代回复
  provider?: string;    // 覆盖 provider
  modelId?: string;     // 覆盖 model
  retry?: boolean;      // 是否请求重试
};
```

**Cron Hook 的特殊设计**：`before_agent_reply` Hook 在 Cron 触发时可以设置 `handled: true` 并直接返回回复，完全跳过 LLM 调用。这允许实现"定时检查但只在特定条件下才消耗 LLM token"的逻辑。

### 9.3 Hook 与 Failover 的交互

Hook 可以触发 Failover——例如，`before_tool_call` Hook 可以拒绝一个工具调用并请求重试到另一个模型。Hook 的 `retry: true` 返回值会让 Agent Loop 重新进入下一次迭代，而不是直接返回。

> 💡 **Takeaway**：39 个 Hook 看起来很多，但**大多数场景只需要 2-3 个**：
> - **省钱/重路由**：`before_model_resolve` + `before_agent_start`（按 prompt 内容选便宜/专用的模型）
> - **审批/合规**：`before_tool_call`（高危工具前拦截）
> - **审计/记忆**：`llm_input` / `llm_output` / `message_received`（记录/分析）
> - **状态切换**：`gateway_start` / `gateway_stop`（重置全局状态）
> 其他都是特定子系统才用得到的细节。

---

## 10. 设计哲学总结

### 10.1 身份优先安全观

OpenClaw 的 Sandbox 模式是 per-session 的，不是 per-tool 的。Main session 有全权，non-main session 默认隔离。"你是谁比你做什么更重要"——这是一种身份优先的安全观，与传统的"最小权限原则"（每次操作都检查权限）形成对比。

这种选择的原因是：在 Agent 场景中，**上下文比操作更重要**。一个拥有主 session 上下文的 Agent 执行 `rm -rf` 和一个拥有受限 session 上下文的 Agent 执行 `rm -rf`，风险完全不同。

### 10.2 渐进式回退

从 Provider 解析到 Model Fallback 到 Compaction 回退，Agent Loop 的每一个可能失败的环节都有渐进式回退策略：

```
主 Provider → 运行时 Provider → 强制生成 models.json → Fallback 模型
主 Profile → 下一个 Profile → Fallback 模型的 Profile
摘要 → "No prior history."
```

这种"不断降级但不放弃"的策略，让 Agent 在各种故障场景下都能给出某种响应，而不是完全失败。

### 10.3 状态轮转而非原地修改

Compaction 后，Agent Loop 不修改当前的 session 状态，而是**采纳新的 session**：

```typescript
const adoptCompactionTranscript = (compactResult) => {
  if (nextSessionId && nextSessionId !== activeSessionId) {
    activeSessionId = nextSessionId;
    registerAgentRunContext(params.runId, { sessionId: activeSessionId });
  }
};
```

这种"轮转"模式避免了在活跃的 session 上进行破坏性修改，保证了并发的安全性——其他正在读取旧 session 的进程不会受到影响。

### 10.4 可观测性贯穿始终

Agent Loop 内建了详细的阶段追踪（`startupStages.mark`、`notifyExecutionPhase`），每个重要阶段都有记录。这使得生产环境中的性能分析和故障排查不需要额外的工具——只需查看日志即可了解一次运行在哪个阶段花了多少时间。

### 10.5 循环即架构

`while(true)` 主循环是 OpenClaw Agent 的核心架构决策。它将"一次对话"建模为一个可能需要多次 LLM 调用的循环过程——每次调用可能触发工具执行，工具执行可能改变上下文，改变后的上下文需要再次调用 LLM。这种循环模型比传统的"请求-响应"模型更适合 Agent 场景，因为 Agent 的行为本质上是迭代的。

---

## 🎯 如果只记 3 件事

1. **"双重队列 + 5 Lane = 两层正交并发控制"** —— Session 队列（按身份）保证上下文不乱，Global + Lane 队列（按工作类型）控制吞吐。**调并发时先想清楚调哪层**。
2. **"Failover + Fallback + 5min Probe = 不断降级但不放弃"** —— 主 Profile → 下一个 Profile → Fallback 模型 → 5min 探测主模型。**普通用户感知不到**。
3. **"`while(true)` 循环是 Agent 的本质** —— Agent 行为天然是迭代的：调 LLM → 工具 → 改上下文 → 调 LLM → ...。**7 种 TerminalReason + 优先级**让"为什么停"有了标准答案。

> 📚 **配套阅读**：
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md)
> - Gateway 怎么驱动 Agent Loop：[openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §8 Chat 运行时
> - Compaction 怎么动上下文：[openclaw-context-engine-architecture.md](./openclaw-context-engine-architecture.md) §5
> - Channel 怎么把消息喂给 Agent：[openclaw-channel-architecture.md](./openclaw-channel-architecture.md)
