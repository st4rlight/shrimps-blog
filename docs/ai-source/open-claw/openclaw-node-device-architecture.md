---
title: OpenClaw Node & 端侧设备模型深度解析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 拆解 Node Host 运行时架构、命令分发、system.run 审批策略、设备配对协议与端侧应用结构。
createTime: 2026/06/08 10:21:55
permalink: /ai-source/openclaw-node-device-architecture/
---
# OpenClaw Node & 端侧设备模型深度解析：设备节点而非 RPC 客户端

> 📖 **阅读顺序：8 / 共 8 篇** · 🔵 深入 · 端侧设备模型（iOS/Android/macOS）— 按需读
>
> 基于 `src/node-host/`、`src/pairing/`、`apps/` 源码分析。本文拆解 Node Host 的运行时架构、命令分发机制、执行策略与审批策略、插件命令桥接、设备配对协议、端侧应用的结构——揭示 OpenClaw 为何将 iOS/Android/macOS 建模为"设备节点"而非"RPC 客户端"。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| Node 跟薄客户端有什么区别 | §1 设备节点 vs RPC 客户端 |
| Node Host 怎么启动、怎么连 Gateway | §2 Node Host 运行时架构 |
| Gateway 怎么调用 Node 的命令 | §3 命令分发（系统命令 + 插件命令） |
| system.run 怎么审批、怎么限权 | §4 执行策略与审批策略 |
| 插件怎么注册 Node 端的能力 | §5 插件命令桥接 |
| 新设备怎么被信任 | §6 设备配对协议 |
| iOS/Android/macOS App 长什么样 | §7 端侧应用架构 |
| 整体设计哲学 | §8 设计哲学（5 条） |

**一句话**：Node = 跑在端侧设备上的 Gateway 客户端，**不是薄客户端**——它有设备身份、能声明能力（`caps: [camera.*, screen.*, ...]`）、能执行 Gateway 派发的命令。`system.run` 是核心命令（远程执行 shell），有 3 套审批策略（`allowlist` / `ask on-miss` / `ask always`）保护。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/node-host/runner.ts                ← CLI 入口，通过 WS 连 Gateway
  src/node-host/invoke.ts:54-55          ← OUTPUT_CAP 200KB / OUTPUT_EVENT_TAIL 20KB
  src/node-host/invoke.ts                ← handleInvoke 命令分发
  src/node-host/exec-policy.ts:6         ← SystemRunPolicyDecision
  src/pairing/pairing-challenge.ts       ← 配对挑战
  src/pairing/pairing-store.ts           ← 配对持久化

深入某个子系统：
  src/node-host/plugin-node-host.ts      ← 插件注册 Node Host 命令
  src/node-host/invoke-system-run.ts     ← system.run 实现
  src/pairing/setup-code.ts              ← 配对码生成
  src/pairing/allow-from-store-file.ts   ← 设备来源持久化
  apps/shared/OpenClawKit/               ← iOS + macOS 共享 Swift Kit
```

---

## 目录

1. [核心定位：设备节点而非 RPC 客户端](#1-核心定位设备节点而非-rpc-客户端)
2. [Node Host 运行时架构](#2-node-host-运行时架构)
3. [命令分发：系统命令与插件命令](#3-命令分发系统命令与插件命令)
4. [执行策略与审批策略](#4-执行策略与审批策略)
5. [插件命令桥接](#5-插件命令桥接)
6. [设备配对协议](#6-设备配对协议)
7. [端侧应用架构](#7-端侧应用架构)
8. [设计哲学总结](#8-设计哲学总结)

---

## 1. 核心定位：设备节点而非 RPC 客户端

![设备节点 vs 薄客户端](/ai-source/open-claw/openclaw-node-vs-thinclient.svg)

很多多端应用将移动端建模为"薄客户端"——它们只负责 UI 展示和用户输入，所有业务逻辑在服务端完成。但 OpenClaw 的端侧模型完全不同：

**薄客户端模式**：

```
Mobile App → HTTP API → Server
  （只做 UI 展示）
```

**OpenClaw 设备节点模式**：

```
Node Host → WS 连接 → Gateway
  │
  ├── 声明 role: node
  ├── 声明 caps: [camera.*, screen.*, location.*]
  ├── 声明 commands: [system.run, system.which, ...]
  ├── 暴露本地能力（摄像头/屏幕/麦克风/GPS）
  └── 执行远程命令（Gateway 调用 Node 的命令）
```

关键区别：

| 维度 | 薄客户端 | OpenClaw Node |
|------|----------|---------------|
| 身份 | 匿名请求者 | 有设备身份的节点 |
| 能力 | 无本地能力 | 暴露本地能力（摄像头等） |
| 通信 | 请求-响应 | 双向（事件订阅 + 命令执行） |
| 安全 | Cookie/Token | 设备配对 + challenge 签名 |
| 生命周期 | 每次请求独立 | 长连接 + 在线状态 |

---

## 2. Node Host 运行时架构

### 2.1 启动流程

`src/node-host/runner.ts` 是 Node Host 的 CLI 入口，启动流程：

```
openclaw node-host
  │
  ├── 加载设备身份（loadOrCreateDeviceIdentity）
  │     如果不存在 → 创建新的设备身份
  │
  ├── 解析 Gateway 连接配置
  │     gatewayHost / gatewayPort / gatewayTls
  │
  ├── 创建 GatewayClient（WS 客户端）
  │     role: "node"
  │     caps: [camera.*, screen.record, location.get, ...]
  │     commands: [system.run, system.which, ...]
  │
  ├── 连接 Gateway
  │     发送 connect 帧，包含设备身份和 challenge 签名
  │
  └── 等待命令分发
        Gateway 通过 WS 发送 node.invoke 请求
        Node Host 执行命令并返回结果
```

### 2.2 平台映射

```typescript
function resolveNodeHostGatewayPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":  return "macos";
    case "win32":   return "windows";
    case "linux":   return "linux";
    default:        return "unknown";
  }
}
```

### 2.3 重连策略

Node Host 在与 Gateway 断线后自动重连，但某些认证错误会导致**立即退出**：

```typescript
const NODE_HOST_EXIT_ON_RECONNECT_PAUSE_CODES = new Set([
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_MISMATCH",
  "AUTH_BOOTSTRAP_TOKEN_INVALID",
  "AUTH_PASSWORD_MISSING",
  "AUTH_PASSWORD_MISMATCH",
]);
```

这些错误意味着认证配置有问题，重连不会解决——需要用户修改配置。

---

## 3. 命令分发：系统命令与插件命令

### 3.1 命令类型

Node Host 支持两类命令：

| 类型 | 来源 | 示例 |
|------|------|------|
| **系统命令** | 核心内建 | `system.run`、`system.which`、`system.exec-approvals.set` |
| **插件命令** | 插件注册 | `camera.*`、`canvas.*`、`screen.record` |

### 3.2 命令分发流程

`src/node-host/invoke.ts` 的 `handleInvoke` 函数是命令分发的核心：

```
Gateway → node.invoke { command, params }
  │
  ├── 检查是否为系统命令
  │     ├── system.run → 执行系统命令
  │     ├── system.which → 查找可执行文件
  │     ├── system.exec-approvals.set → 设置审批规则
  │     └── system.run.prepare → 预检命令安全性
  │
  ├── 检查是否为插件命令
  │     → invokeRegisteredNodeHostCommand(command, params)
  │
  └── 未知命令 → 返回错误
```

### 3.3 system.run 的执行

`system.run` 是最核心的系统命令，它允许 Gateway 远程在 Node 设备上执行命令：

```
system.run { command, cwd, env }
  │
  ├── 分析命令安全性（analyzeShellCommand）
  ├── 检查执行策略（evaluateSystemRunPolicy）
  │     ├── allowlist 模式 → 检查命令是否在白名单中
  │     └── ask 模式 → 请求用户审批
  ├── 审批通过后 → spawn 子进程执行
  ├── 实时输出 → 通过 WS 事件推送回 Gateway
  └── 命令完成 → 返回结果（exit code, stdout, stderr）
```

### 3.4 输出限制

Node Host 对命令输出有硬性限制，防止内存溢出：

```typescript
const OUTPUT_CAP = 200_000;       // 总输出上限 200KB
const OUTPUT_EVENT_TAIL = 20_000; // 事件尾部 20KB
```

超过上限的输出会被截断，但保留尾部——因为尾部通常包含错误信息和退出码。

---

## 4. 执行策略与审批策略

### 4.1 执行策略

`src/node-host/exec-policy.ts` 的 `evaluateSystemRunPolicy` 组合了多个安全维度：

```typescript
type SystemRunPolicyDecision = {
  analysisOk: boolean;           // 命令分析是否通过
  allowlistSatisfied: boolean;   // 白名单是否满足
  shellWrapperBlocked: boolean;  // Shell 包装器是否被阻止
  requiresAsk: boolean;          // 是否需要用户审批
  approvalDecision: ExecApprovalDecision;  // 审批决定
} & (
  | { allowed: true }
  | { allowed: false; eventReason: string; errorMessage: string }
);
```

### 4.2 审批模式

| 模式 | 行为 |
|------|------|
| `allowlist` | 只执行白名单中的命令 |
| `ask on-miss` | 白名单外的命令请求审批 |
| `ask always` | 所有命令都请求审批 |

### 4.3 Shell 包装器安全

Node Host 特殊处理了 Shell 包装器（`sh -c`、`bash -c`、`cmd.exe /c`）：

- **POSIX**：`/bin/sh -lc` 作为传输包装器，安全分析基于内部的实际命令
- **Windows**：`cmd.exe /c` 包装器需要显式审批，因为执行语义不同

### 4.4 Exec Host 架构

macOS 上，Node Host 支持 **Exec Host** 模式——命令执行通过 macOS App 的进程完成：

```typescript
const execHostEnforced = process.env.OPENCLAW_NODE_EXEC_HOST === "app";
const preferMacAppExecHost = process.platform === "darwin" && execHostEnforced;
```

这允许 macOS App 对命令执行有更精细的控制——例如，TCC（Transparency, Consent, and Control）权限只授予签名的 App 进程，不授予 Node Host 子进程。

---

## 5. 插件命令桥接

### 5.1 插件注册 Node Host 命令

插件通过 `api.registerNodeHostCommand` 注册 Node Host 命令：

```typescript
api.registerNodeHostCommand({
  command: "camera.photo",
  cap: "camera",
  handler: async (params) => {
    // 调用本地摄像头拍照
    return { photo: base64EncodedPhoto };
  },
});
```

### 5.2 命令桥接流程

```
插件注册 Node Host 命令
  │
  ↓ Gateway 获取注册信息
Gateway 知道哪些 Node 有哪些能力
  │
  ↓ Agent 需要使用本地能力
Agent 调用 camera.photo 工具
  │
  ↓ Gateway 路由到具体 Node
Gateway 选择有 camera 能力的 Node
  │
  ↓ 发送 node.invoke 请求
Gateway → Node: { command: "camera.photo", params: {...} }
  │
  ↓ Node 执行插件命令
invokeRegisteredNodeHostCommand("camera.photo", params)
  │
  ↓ 返回结果
Node → Gateway: { result: { photo: base64EncodedPhoto } }
```

### 5.3 能力声明

Node 在连接时声明自己的能力（caps）：

```
caps: ["camera", "canvas", "screen", "location"]
```

Gateway 维护 Node 能力注册表，当 Agent 需要某个能力时，Gateway 选择拥有该能力的 Node 来执行。这实现了**能力的动态发现和路由**——Gateway 不需要预先知道每个 Node 有什么能力。

---

## 6. 设备配对协议

### 6.1 配对流程

`src/pairing/` 管理新设备的配对流程：

```
新设备连接 Gateway
  │
  ├── 发送 connect 帧（含设备身份）
  │     deviceId, platform, deviceFamily
  │
  ├── Gateway 检查配对状态
  │     ├── 已配对 → 验证 challenge 签名 → 允许连接
  │     └── 未配对 → 进入配对流程
  │
  ├── 配对流程
  │     ├── Gateway 生成配对码
  │     ├── 通知 operator（CLI/WebChat/其他 Node）
  │     ├── operator 审批配对请求
  │     └── Gateway 签发 device token
  │
  └── 本地 loopback 自动审批
        同一台机器上的连接可以自动配对（保持 UX 流畅）
```

### 6.2 配对挑战

`src/pairing/pairing-challenge.ts` 的 `issuePairingChallenge` 实现了配对挑战的发放：

```typescript
async function issuePairingChallenge(params) {
  const { code, created } = await params.upsertPairingRequest({
    id: params.senderId,
    meta: params.meta,
  });
  if (!created) {
    return { created: false };  // 已有配对请求，不重复发放
  }
  const replyText = buildPairingReply({ channel, idLine, code });
  await params.sendPairingReply(replyText);
  return { created: true, code };
}
```

### 6.3 签名验证

配对验证使用 challenge-response 模式：

1. Gateway 在 `connect` 响应中包含 `challenge` nonce
2. 设备使用私钥对 `challenge` + `platform` + `deviceFamily` 签名
3. Gateway 验证签名是否与配对时记录的公钥匹配
4. 签名不匹配 → 拒绝连接（可能设备被冒充）

### 6.4 配对元数据绑定

Gateway 在重连时 pin 住配对的元数据（`platform`、`deviceFamily`）。如果元数据变更，需要重新配对。这防止了"同一设备身份在不同平台上使用"的攻击。

---

## 7. 端侧应用架构

### 7.1 iOS 应用

`apps/ios/Sources/` 结构：

```
Sources/
  ├── Assets.xcassets/        — 资源文件
  ├── OpenClawApp.swift       — App 入口
  ├── RootTabs.swift / RootView.swift — 顶层 UI
  ├── SessionKey.swift        — 与核心 session-key-utils.ts 共享的表达
  ├── Gateway/                — Gateway WS 连接管理（连接、重连、认证、配对）
  ├── Chat/                   — 聊天 UI（消息列表、输入框、流式输出）
  ├── Voice/                  — 语音交互（VoiceWake、TTS、VoiceCapture）
  ├── Camera/                 — 摄像头能力（拍照、录像、图像选择）
  ├── Onboarding/             — 引导流程（首次使用、配对、权限请求）
  ├── Push/                   — 推送通知（APNs 注册、通知处理）
  ├── Device/                 — 设备能力（传感器、电池、网络状态）
  ├── Calendar/               — 日历能力
  ├── Contacts/               — 通讯录能力
  ├── Location/               — 位置能力
  ├── Screen/                 — 屏幕能力
  ├── Media/                  — 媒体能力
  ├── Services/               — 后台服务
  ├── Settings/               — 设置界面
  ├── Capabilities/           — iOS 系统能力抽象层
  ├── Design/                 — 设计系统
  ├── EventKit/  Reminders/   — 提醒事项
  ├── LiveActivity/            — 灵动岛 / 实时活动
  ├── Model/  Motion/  Permissions/  Status/  — 状态/权限/数据模型
```

iOS App 通过 OpenClawKit（`apps/shared/OpenClawKit/`）与 Gateway 通信：

```
OpenClawKit
  ├── Sources/OpenClawProtocol/   — WS 协议类型（从 gateway-protocol 自动生成）
  ├── Sources/OpenClawChatUI/     — 聊天 UI 组件
  └── Sources/OpenClawKit/        — 核心 Kit
```

### 7.2 macOS 应用

`apps/macos/Sources/` 结构：

```
Sources/
  ├── OpenClaw/
  │     ├── Logging/         — 日志系统
  │     ├── NodeMode/        — Node Host 模式
  │     │     内嵌 Node Host 运行时
  │     └── Resources/       — 资源文件
  │           DeviceModels/  — 设备型号数据库
  ├── OpenClawDiscovery/     — Bonjour 服务发现
  ├── OpenClawIPC/           — 进程间通信
  └── OpenClawMacCLI/        — macOS CLI 工具
```

macOS App 的独特之处在于它可以**内嵌 Node Host 运行时**——这意味着 macOS App 本身就是一个 Node，可以暴露本地的摄像头、屏幕、麦克风等能力。

### 7.3 Android 应用

`apps/android/app/src/main/java/ai/openclaw/app/` 结构：

```
java/ai/openclaw/app/
  ├── MainActivity.kt / MainViewModel.kt — Activity 入口
  ├── NodeApp.kt / NodeRuntime.kt / NodeForegroundService.kt — Node Host 运行时
  ├── gateway/            — Gateway 连接管理
  ├── node/               — Node 命令分发、能力声明
  ├── chat/               — 聊天 UI
  ├── AppearanceThemeMode.kt / CameraHudState.kt / DeviceNames.kt / LocationMode.kt
  ├── NotificationForwardingPolicy.kt / PermissionRequester.kt / SecurePrefs.kt
  ├── VoiceCaptureMode.kt / VoiceWakeMode.kt / WakeWords.kt / AssistantLaunch.kt
  └── SessionKey.kt       — 与核心 session-key-utils.ts 共享的表达
```

注：GLM 早期描述中的 `ui/chat/` 和 `ui/design/` 实际在 `apps/android/app/src/main/java/ai/openclaw/app/ui/...` 之外没有统一 `ui/` 目录——大部分 UI/状态代码直接平铺在 `ai/openclaw/app/` 顶层，与上面列出的 kt 文件混编。

### 7.4 共享 Kit

`apps/shared/OpenClawKit/` 是 iOS 和 macOS 共享的 Swift Package：

- `OpenClawProtocol`：WS 协议类型（从 `packages/gateway-protocol` 自动生成 Swift 模型）
- `OpenClawChatUI`：聊天 UI 组件（消息列表、输入框、流式输出）
- `OpenClawKit`：核心 Kit（连接管理、认证、配对）

---

## 8. 设计哲学总结

### 8.1 设备节点而非薄客户端

iOS/Android 不是 RPC 客户端，而是"设备节点"——它们有设备身份、声明能力、执行命令、维护在线状态。这种模型让端侧设备从"被动的 UI 容器"变成了"主动的能力提供者"。

### 8.2 能力驱动路由

Gateway 不预先知道每个 Node 有什么能力——Node 在连接时声明自己的 caps，Gateway 据此路由 Agent 的工具调用。这实现了**能力的动态发现和路由**，支持异构设备集群。

### 8.3 身份优先安全

设备配对是独立于 Gateway 认证的另一层安全。新设备需要配对审批，签名绑定 challenge + platform + deviceFamily，元数据变更需要重新配对。这是一种"身份优先"的安全观——设备的身份比它做的事情更重要。

### 8.4 渐进式权限

执行策略从 `allowlist`（最严格）到 `ask on-miss`（渐进式）到 `ask always`（最宽松），允许用户根据信任程度选择不同的安全级别。Shell 包装器（`sh -c`、`cmd.exe /c`）有特殊的安全处理，因为它们的执行语义与直接执行不同。

### 8.5 跨平台统一协议

iOS、macOS、Android、Headless Node 都使用同一个 WS 协议与 Gateway 通信。协议类型从 `packages/gateway-protocol` 的 TypeBox Schema 自动生成 Swift/Kotlin 模型，确保多端协议一致性。

---

## 🎯 如果只记 3 件事

1. **"Node 是设备节点，不是 RPC 客户端"** —— 它有设备身份（key pair）、声明能力（`caps`）、执行命令、维护在线状态。**与薄客户端的 4 个核心区别**：身份、能力、双向通讯、长连接。
2. **"`system.run` 是 Node 最危险的命令"** —— 它让 Gateway 远程在设备上执行 shell。**3 套审批策略**（`allowlist` / `ask on-miss` / `ask always`）保护，**Windows `cmd.exe /c` 永远需要显式审批**（执行语义不同）。**macOS 上推荐用 App 进程执行**（`OPENCLAW_NODE_EXEC_HOST=app`）—— TCC 权限只授予签名 App，不给 Node Host 子进程。
3. **"设备配对是独立于 Gateway 认证的安全层"** —— 新设备连接必须 `challenge` 签名 + `platform` + `deviceFamily` 绑定，**签名不匹配 → 重连失败**。**本地 loopback 自动审批**，**远程必须显式审批**。这是"身份优先安全"的体现。

> 📚 **配套阅读**：
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md) §6.4 Node Host
> - Node 怎么连 Gateway：[openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §4.4 设备配对认证
> - Plugin 怎么注册 Node 端命令：[openclaw-plugin-skill-architecture.md](./openclaw-plugin-skill-architecture.md) §5.3 `registerNodeHostCommand`
