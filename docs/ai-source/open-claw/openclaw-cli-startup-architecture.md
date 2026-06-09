---
title: OpenClaw 启动与 CLI 入口架构深度分析
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: 深度解析 CLI 入口的多层快速路径、进程重派生、Daemon 服务管理与优雅关闭机制。
createTime: 2026/06/08 10:23:52
permalink: /ai-source/openclaw-cli-startup-architecture/
---
# OpenClaw 启动与 CLI 入口架构深度分析

> 📖 **阅读顺序：2 / 共 8 篇** · 🟢 入门 · CLI 入口的渐进式加载漏斗
>
> 基于 openclaw/openclaw v2026.6.2 源码快照，深度解析 CLI 入口的多层快速路径、进程重派生、Daemon 服务管理与优雅关闭机制。

---

## 🎯 30 秒 TL;DR

| 你想知道 | 看这一节 |
|---------|---------|
| 入口设计的根本原则 | §1 设计定位：克制的入口哲学（三层入口漏斗） |
| 怎么防 import 副作用 | §2 进程引导（isMainModule / 编译缓存 / 重派生） |
| `--version` 为什么快 | §3 多层快速路径（5 类） |
| 完整 CLI 怎么分阶段 | §4 run-main.ts 8 阶段流水线 |
| Gateway 怎么被装成系统服务 | §5 Daemon 服务管理（macOS/Linux/Windows） |
| 启动慢在哪、怎么追 | §6 启动追踪（`OPENCLAW_GATEWAY_STARTUP_TRACE=1`） |
| 退出时怎么清理 | §7 优雅关闭 |
| 安全/防御设计 | §8 环境标记与安全 |
| 整体设计哲学 | §9 设计哲学总结（4 条） |
| 关键文件索引 | §10 关键源码索引 |

**一句话**：CLI 入口是一个**渐进式加载漏斗**——`--version` / 预计算帮助文本走"零模块加载"路径，5-6 模块走 Gateway Run 快速路径，20+ 模块才走完整 Commander 程序。`isMainModule` 守卫防重复执行，编译缓存 respawner 防循环重派生。

---

## 0. 读源码路径

```
30 分钟建立整体感：
  src/entry.ts:109-116                     ← isMainModule 守卫（"防误触发"核心）
  src/entry.ts:67-100                      ← 启动追踪器
  src/entry.compile-cache.ts:103-137       ← 编译缓存 respawner
  src/entry.respawn.ts:73-155              ← buildCliRespawnPlan（Win/macOS/Linux 差异）
  src/cli/run-main.ts:651-1149             ← 8 阶段 runCli 主编排
  src/infra/is-main.ts:41-77               ← isMainModule 三场景检测
  src/daemon/service.ts:75-87              ← GatewayService 抽象

深入某个子系统：
  src/cli/profile.ts                        ← --profile / --dev 多环境机制
  src/cli/container-target.ts               ← --container 容器执行
  src/cli/run-main-policy.ts                ← 启动策略
  src/process/child-process-bridge.ts      ← 信号桥接
  src/daemon/launchd.ts                     ← macOS 守护进程
  src/daemon/systemd.ts                     ← Linux 守护进程
  src/daemon/schtasks.ts                    ← Windows 计划任务
```

---

## 1. 设计定位：克制的入口哲学

OpenClaw 的 CLI 入口设计遵循一个核心原则：**能不加载的代码就不加载，能不执行的路径就不执行**。

这不是过早优化，而是一种架构态度。当你的 CLI 被数百万人每天执行、其中 90% 的调用只需要一行版本号或一段帮助文本时，入口的克制直接决定了用户感知。

### 1.1 三层入口架构

```
用户执行 openclaw <args>
        │
        ▼
┌─────────────────────────────┐
│   openclaw.mjs (薄包装)      │ ← bin 入口，仅 import entry.js
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│   entry.ts (守卫 + 快速路径)  │ ← 主模块守卫、编译缓存、版本/帮助快速路径
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│   run-main.ts (完整编排)     │ ← 8 阶段流水线、Commander 程序、插件注册
└─────────────────────────────┘
```

这个三层结构不是随意分层，而是一个精心设计的**漏斗模型**：

![三层入口漏斗](/ai-source/open-claw/openclaw-cli-funnel.svg)

- **第一层**（openclaw.mjs）：极薄包装，仅 `import "./dist/entry.js"`，确保 npm bin 入口可寻址
- **第二层**（entry.ts）：在模块顶层用 `isMainModule` 守卫，只处理最轻量的路径（版本、帮助），避免重复执行
- **第三层**（run-main.ts）：延迟动态 `import`，只有确实需要完整 CLI 功能时才加载

### 1.2 为什么不在 entry.ts 里直接做所有事？

`entry.ts` 的模块顶层代码在**被其他模块 import 时也会执行**。打包器可能将 entry.js 作为共享依赖引入（如 dist/index.js 才是真正的入口点）。如果入口逻辑不加守卫，会导致：

1. 重复调用 `runCli`，启动双重 Gateway 进程
2. 端口/锁冲突而崩溃
3. 编译缓存的 respawner 陷入循环

因此 `isMainModule` 守卫是安全底线：

```typescript
// src/entry.ts:109-116
if (!isMainModule({
  currentFile: fileURLToPath(import.meta.url),
  wrapperEntryPairs: [...ENTRY_WRAPPER_PAIRS],
})) {
  // 被作为依赖引入 — 跳过所有入口点副作用
} else {
  // 主模块入口：执行 CLI 启动流程
}
```

---

## 2. 进程引导：从 `node openclaw.mjs` 到就绪

### 2.1 主模块检测

`isMainModule`（`src/infra/is-main.ts`）不是简单的 `process.argv[1]` 比较，它处理了三种真实场景：

| 场景 | 检测方式 |
|------|----------|
| 直接执行 `node entry.js` | `argv[1]` 与 `currentFile` 的 realpath 匹配 |
| PM2 启动 | `env.pm_exec_path` 与 `currentFile` 匹配 |
| 通过包装脚本启动 | `wrapperEntryPairs` 映射 `openclaw.mjs → entry.js` |

```typescript
// src/infra/is-main.ts:41-77
export function isMainModule({...}: IsMainModuleOptions): boolean {
  const normalizedCurrent = normalizePathCandidate(currentFile, resolvedCwd);
  const normalizedArgv1 = normalizePathCandidate(argv[1], resolvedCwd);

  if (normalizedCurrent && normalizedArgv1 && normalizedCurrent === normalizedArgv1) {
    return true;
  }

  // PM2 特殊处理
  const normalizedPmExecPath = normalizePathCandidate(env.pm_exec_path, resolvedCwd);
  if (normalizedCurrent && normalizedPmExecPath && normalizedCurrent === normalizedPmExecPath) {
    return true;
  }

  // 包装脚本映射
  if (wrapperEntryPairs.length > 0) {
    const matched = wrapperEntryPairs.some(
      ({ wrapperBasename, entryBasename }) =>
        currentBase === entryBasename && argvBase === wrapperBasename,
    );
    if (matched) return true;
  }

  return false;
}
```

### 2.2 编译缓存管理

Node.js 22+ 引入了 `module.enableCompileCache()`，OpenClaw 利用了这个能力但做了**更精细的控制**：

```typescript
// src/entry.compile-cache.ts:34-42
export function shouldEnableOpenClawCompileCache(params: {...}): boolean {
  if (isNodeCompileCacheDisabled(params.env)) {
    return false;
  }
  // 源码检出环境不启用编译缓存（避免与 tsx 等工具冲突）
  return !isSourceCheckoutInstallRoot(params.installRoot);
}
```

**关键设计决策**：源码检出环境下编译缓存可能导致与 TypeScript 运行时工具的冲突，因此需要**重派生**一个不带编译缓存的新进程：

```typescript
// src/entry.compile-cache.ts:103-137
export function buildOpenClawCompileCacheRespawnPlan(params: {...}):
  OpenClawCompileCacheRespawnPlan | undefined {
  // 非源码检出 → 不需要重派生
  if (!isSourceCheckoutInstallRoot(params.installRoot)) return undefined;
  // 已重派生过 → 避免循环
  if (env.OPENCLAW_SOURCE_COMPILE_CACHE_RESPAWNED === "1") return undefined;
  // 无编译缓存需求 → 不需要重派生
  if (!params.compileCacheDir && !isNodeCompileCacheRequested(env)) return undefined;

  // 构建重派生计划：禁用编译缓存，标记已重派生
  const nextEnv = {
    ...env,
    NODE_DISABLE_COMPILE_CACHE: "1",
    OPENCLAW_SOURCE_COMPILE_CACHE_RESPAWNED: "1",
  };
  delete nextEnv.NODE_COMPILE_CACHE;
  return { command: params.execPath ?? process.execPath, args: [...], env: nextEnv };
}
```

编译缓存路径也做了版本化隔离：

```
$TMPDIR/node-compile-cache/openclaw/<version>/<mtimeMs>-<size>/
```

这样不同版本的 OpenClaw 不会共享编译缓存，避免 V8 字节码版本不兼容。

### 2.3 CLI 重派生

`entry.respawn.ts` 负责在特定条件下重新启动 CLI 进程，调整 Node.js 运行时参数：

| 平台 | 重派生原因 | 调整内容 |
|------|-----------|---------|
| Windows | 默认栈大小不足 | 添加 `--stack-size=8192` |
| macOS/Linux | 抑制实验性 API 警告 | 添加 `--disable-warning=ExperimentalWarning` |
| macOS/Linux | TLS 根证书 | 添加 `NODE_EXTRA_CA_CERTS` |

```typescript
// src/entry.respawn.ts:73-155
export function buildCliRespawnPlan(params: {...} = {}): CliRespawnPlan | null {
  // 快速路径命令不需要重派生
  if (shouldSkipStartupEnvironmentRespawnForArgv(normalizedArgv)) return null;
  // 环境变量禁用重派生
  if (isTruthyEnvValue(env.OPENCLAW_NO_RESPAWN)) return null;

  let needsRespawn = false;

  // Windows: 添加栈大小标志
  if (platform === "win32" && !hasStackSizeConfigured(childExecArgv)) {
    childExecArgv.unshift(WINDOWS_STACK_SIZE_FLAG);
    needsRespawn = true;
  }

  // macOS/Linux: 添加实验性警告抑制
  if (!hasExperimentalWarningSuppressed({ env, execArgv })) {
    childExecArgv.unshift(EXPERIMENTAL_WARNING_FLAG);
    needsRespawn = true;
  }

  // macOS/Linux: 自动检测并添加 TLS 根证书
  if (autoNodeExtraCaCerts && !env.NODE_EXTRA_CA_CERTS) {
    childEnv.NODE_EXTRA_CA_CERTS = autoNodeExtraCaCerts;
    needsRespawn = true;
  }

  return needsRespawn ? { command, argv: [...childExecArgv, ...argv.slice(1)], env: childEnv }
                      : null;
}
```

### 2.4 信号桥接

重派生后，父进程必须将收到的信号转发给子进程，否则 Ctrl+C 无法终止子进程：

```typescript
// src/process/child-process-bridge.ts:17-50
export function attachChildProcessBridge(
  child: ChildProcess,
  { signals = defaultSignals, onSignal }: ChildProcessBridgeOptions = {},
): { detach: () => void } {
  const listeners = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const listener = (): void => {
      onSignal?.(signal);
      try { child.kill(signal); } catch { /* ignore */ }
    };
    process.on(signal, listener);
    listeners.set(signal, listener);
  }
  // 子进程退出时自动拆卸信号监听器
  child.once("exit", detach);
  child.once("error", detach);
  return { detach };
}
```

`respawn-child-runner.ts` 还实现了**分级终止策略**：

```
收到信号 → 等待 1s → SIGTERM → 等待 1s → SIGKILL → 等待 1s → process.exit(1)
```

这确保了子进程有机会优雅关闭，同时不会让父进程无限挂起。

---

## 3. 多层快速路径：漏斗的核心

快速路径是 OpenClaw CLI 启动优化的灵魂。它的设计理念是：**在最短时间内判断用户意图，跳过不必要的模块加载**。

### 3.1 快速路径层级

```
openclaw <args>
    │
    ├─ openclaw --version / -V / -v ──→ 版本快速路径 (entry.ts)
    │                                    仅加载 version.js + git-commit.js
    │
    ├─ openclaw / openclaw --help ──→ 根帮助快速路径 (entry.ts)
    │                                  优先预计算文本，其次动态渲染
    │
    ├─ openclaw <browser|secrets|nodes> --help ──→ 子命令帮助快速路径 (entry.ts)
    │
    └─ 其他 ──→ run-main.ts 的 8 阶段流水线
                    │
                    ├─ 根帮助快速路径 (重复检测)
                    ├─ Browser/Secrets/Setup/Nodes 帮助快速路径
                    ├─ 子命令帮助快速路径 (doctor/gateway/models/plugins)
                    ├─ 无主命令拒绝
                    ├─ Crestodian 引导
                    ├─ Gateway Run 快速路径
                    ├─ 路由分派
                    └─ 完整 Commander 程序
```

### 3.2 版本快速路径

最简单的快速路径，在 `entry.ts` 中拦截 `--version`/`-V`/`-v`：

```typescript
// src/entry.version-fast-path.ts:5-54
export function tryHandleRootVersionFastPath(argv: string[], deps = {}): boolean {
  if (resolveCliContainerTarget(argv, deps.env)) return false;
  if (!isRootVersionInvocation(argv)) return false;

  // 异步加载版本和 commit hash
  resolveVersion()
    .then(({ VERSION, resolveCommitHash }) => {
      const commit = resolveCommitHash({ moduleUrl: deps.moduleUrl ?? import.meta.url });
      output(commit ? `OpenClaw ${VERSION} (${commit})` : `OpenClaw ${VERSION}`);
      exit(0);
    })
    .catch(onError);
  return true; // 告诉调用方已处理
}
```

注意返回 `true` 后进程会异步退出——这是唯一一个异步退出的快速路径，因为版本号需要读取文件。

### 3.3 预计算帮助文本

这是最精巧的优化。帮助文本在**构建时**预生成为 JS 模块，运行时直接输出，零模块加载：

```typescript
// src/entry.ts:247-259
const liveRootHelpOptions = await loadRootHelpRenderOptionsForConfigSensitivePlugins(deps.env);
if (!liveRootHelpOptions) {
  // 没有配置敏感插件 — 使用预计算文本（零模块加载）
  const { outputPrecomputedRootHelpText } = await loadRootHelpMetadataModule();
  if (outputPrecomputedRootHelpText()) {
    return true;
  }
}
// 有配置敏感插件 — 动态渲染帮助文本
const { outputRootHelp } = await import("./cli/program/root-help.js");
await outputRootHelp(liveRootHelpOptions ?? undefined);
```

**"配置敏感插件"**是关键概念。某些插件会向 CLI 注册新命令，其命令列表和描述取决于运行时配置（如是否启用）。对于这类插件，预计算文本会过时，必须动态渲染。

哪些命令支持预计算帮助？

| 命令 | 预计算可用 | 条件 |
|------|-----------|------|
| `openclaw` (根帮助) | ✅ | 无配置敏感插件时 |
| `openclaw browser --help` | ✅ | 无条件 |
| `openclaw secrets --help` | ✅ | 无条件 |
| `openclaw nodes --help` | ⚠️ | 无配置敏感插件时 |
| `openclaw doctor --help` | ✅ | 构建时预计算 |
| `openclaw gateway --help` | ✅ | 构建时预计算 |
| `openclaw models --help` | ✅ | 构建时预计算 |
| `openclaw plugins --help` | ✅ | 构建时预计算 |

### 3.4 Gateway Run 快速路径

`openclaw gateway run` 是最高频的命令（启动 Gateway 守护进程），因此有专属快速路径：

```typescript
// src/cli/run-main.ts:157-197
export function isGatewayRunFastPathArgv(argv: string[]): boolean {
  const invocation = resolveCliArgvInvocation(argv);
  if (invocation.hasHelpOrVersion) return false;

  const args = argv.slice(2);
  let sawGateway = false;
  let sawRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "--") return false;  // 遇到终止符不走快速路径

    if (!sawGateway) {
      const consumed = consumeGatewayFastPathRootOptionToken(args, index);
      if (consumed > 0) { index += consumed - 1; continue; }
      if (arg !== "gateway") return false;
      sawGateway = true;
      continue;
    }

    const consumed = consumeGatewayRunOptionToken(args, index);
    if (consumed > 0) { index += consumed - 1; continue; }
    if (!sawRun && arg === "run") { sawRun = true; continue; }
    return false;
  }
  return sawGateway;
}
```

快速路径只加载**最少的模块**：commander + gateway run 命令定义 + 版本号 + banner + 日志，而不是加载整个 CLI 程序（包含所有命令和插件注册）。

---

## 4. run-main.ts：8 阶段流水线

当所有快速路径都未命中时，进入 `run-main.ts` 的完整执行流水线。这个函数的注释本身就是一个架构文档：

```
─── 第一阶段：参数解析 ───
─── 第二阶段：环境初始化 ───
─── 第三阶段：代理管理 ───
─── 第四阶段：快速路径分派 ───
─── 第五阶段：Crestodian 引导 ───
─── 第六阶段：Gateway Run 快速路径 ───
─── 第七阶段：路由分派 ───
─── 第八阶段：完整 Commander 程序 ───
─── 清理阶段（finally） ───
```

### 4.1 第一阶段：参数解析

```typescript
// src/cli/run-main.ts:652-685
export async function runCli(argv: string[] = process.argv) {
  const originalArgv = normalizeWindowsArgv(argv);
  const parsedContainer = parseCliContainerArgs(originalArgv);
  if (!parsedContainer.ok) throw new Error(parsedContainer.error);

  const parsedProfile = parseCliProfileArgs(parsedContainer.argv);
  if (!parsedProfile.ok) throw new Error(parsedProfile.error);

  if (parsedProfile.profile) {
    applyCliProfileEnv({ profile: parsedProfile.profile });
  }

  // --container 和 --profile 互斥
  if (containerTargetName && parsedProfile.profile) {
    throw new Error("--container cannot be combined with --profile/--dev");
  }
}
```

**Profile** 是 OpenClaw 的多环境机制。`--profile work` 会将状态目录切换到 `~/.openclaw-work/`，实现同一台机器上运行多个独立的 OpenClaw 实例：

```typescript
// src/cli/profile.ts — 简化
export function parseCliProfileArgs(argv: string[]): CliProfileParseResult {
  // --dev 是 --profile dev 的快捷方式
  if (arg === "--dev") {
    if (profile && profile !== "dev") {
      return { kind: "error", error: "Cannot combine --dev with --profile" };
    }
    sawDev = true;
    profile = "dev";
    return { kind: "handled" };
  }

  if (arg === "--profile" || arg.startsWith("--profile=")) {
    // gateway 子命令的 --profile 是命令本地参数，不剥离
    if (isCommandLocalProfileOption(out)) {
      out.push(arg);  // 保留给 Commander 处理
      return { kind: "handled" };
    }
    // 验证 profile 名称合法性
    if (!isValidProfileName(value)) {
      return { kind: "error", error: `Invalid profile name: ${value}` };
    }
  }
}
```

### 4.2 第二阶段：环境初始化

```typescript
// src/cli/run-main.ts:687-707
// 加载 .env 文件（区分远程 Agent 调度和本地模式）
if (!isHelpOrVersionInvocation && shouldLoadCliDotEnv()) {
  if (isRemoteAgentDispatchInvocation(normalizedArgv, normalizedInvocation.primary)) {
    // 远程 Agent 调度使用 gateway dispatch 的 .env 加载逻辑
    const { loadGatewayDispatchCliDotEnv } = await import("./gateway-dispatch-dotenv.js");
    await loadGatewayDispatchCliDotEnv({ quiet: true });
  } else {
    const { loadCliDotEnv } = await import("./dotenv.js");
    loadCliDotEnv({ quiet: true });
  }
}
normalizeEnv();
ensureOpenClawCliOnPath();
assertSupportedRuntime();
```

`.env` 文件的加载有两条路径：

- **本地模式**：从 `cwd` 和状态目录加载 `.env`
- **远程 Agent 调度**：通过 Gateway 的 dispatch 接口加载 `.env`（因为远程调度时当前工作目录可能不是用户的 OpenClaw 工作区）

### 4.3 第三阶段：代理管理

OpenClaw 的网络流量代理管理是一个精细的分层系统：

```typescript
// src/cli/run-main.ts:709-774
let proxyHandle: ProxyHandle | null = null;

// 延迟加载并缓存配置
const readBestEffortCliConfig = async (): Promise<OpenClawConfig> => {
  if (!bestEffortConfigPromise) {
    bestEffortConfigPromise = import("../config/io.js").then(({ readBestEffortConfig }) =>
      readBestEffortConfig(),
    );
  }
  return await bestEffortConfigPromise;
};

// 对需要网络的命令，启动代理管理器
if (!isHelpOrVersionInvocation && shouldStartProxyForCli(normalizedArgv)) {
  const config = await readBestEffortCliConfig();
  // 先检查无主命令再启动代理
  const unownedPrimary = await resolveUnownedCliPrimary({ argv: normalizedArgv, config });
  if (unownedPrimary) {
    throw new Error(await resolveUnownedCliPrimaryMessage({ primary: unownedPrimary, config }));
  }
  const { startProxy } = await loadProxyLifecycleModule();
  proxyHandle = await startProxy(config?.proxy ?? undefined);
}
```

**信号处理**确保代理在进程被中断时正确清理：

```typescript
if (proxyHandle) {
  const shutdown = (exitCode: number) => {
    if (onSigterm) process.off("SIGTERM", onSigterm);
    if (onSigint) process.off("SIGINT", onSigint);
    void stopStartedProxy().finally(() => process.exit(exitCode));
  };
  onSigterm = () => shutdown(143); // 128 + 15 (SIGTERM)
  onSigint = () => shutdown(130);  // 128 + 2  (SIGINT)
  onExit = () => killStartedProxy();
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  process.once("exit", onExit);
}
```

退出码遵循 Unix 信号约定：`128 + signal_number`。

### 4.4 无主命令检测

无主命令（Unowned Command）是指 argv 中出现的命令既不是内置命令，也不是任何插件注册的命令。OpenClaw 不简单报 "unknown command"，而是尝试给出有用的建议：

```typescript
// src/cli/run-main.ts:536-570
async function resolveUnownedCliPrimary(params: {...}): Promise<string | null> {
  const primary = resolveUnownedCliPrimaryCandidate(params.argv);
  if (!primary) return null;

  // 查询插件注册表验证
  const pluginRoot = await isPluginCliRoot({ primary, config: params.config });
  if (pluginRoot !== false) return null;  // 插件拥有或无法确定
  return primary;  // 确认无主
}

async function resolveUnownedCliPrimaryMessage(params: {...}): Promise<string> {
  // 依次查询：命令别名 → 工具归属 → CLI 界面归属
  const cliCommandSurfaceOwner = await resolveCliCommandSurfaceOwner(params);
  return resolveMissingPluginCommandMessageFromPolicy(params.primary, params.config, {
    resolveCommandAliasOwner: resolveManifestCommandAliasOwner,
    resolveToolOwner: resolveManifestToolOwner,
    resolveCliCommandSurfaceOwner: () => cliCommandSurfaceOwner,
  }) ?? `Unknown command: openclaw ${params.primary}...`;
}
```

这意味着如果你输入 `openclaw whatsapp --help`，系统会告诉你这是 telegram 插件提供的命令（需要安装），而不是简单的 "command not found"。

### 4.5 第五阶段：Crestodian 引导

Crestodian 是 OpenClaw 的交互式助手，在两种场景下自动启动：

1. **裸根调用 + 全新安装**：`openclaw` 命令 + 空配置 → 启动 Onboard 向导
2. **裸根调用 + 已有配置**：`openclaw` 命令 + 有配置 → 启动交互式 Crestodian

```typescript
// src/cli/run-main.ts:866-930
if (shouldRunBareRootCrestodian) {
  if (await shouldStartOnboardingForFreshInstall(normalizedArgv)) {
    // 全新安装：必须 TTY 交互
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error("Onboarding needs an interactive TTY. Use `openclaw onboard --non-interactive`...");
      process.exitCode = 1;
      return;
    }
    const { setupWizardCommand } = await import("../commands/onboard.js");
    await setupWizardCommand({});
    return;
  }
  // 非全新安装：启动交互式 Crestodian
  const { runCrestodian } = await loadCrestodianModule();
  await runCrestodian({ onReady: stopProgress });
  return;
}
```

"全新安装"的判断很精确：

```typescript
// src/cli/run-main.ts:312-337
function isUnconfiguredConfigSnapshot(snapshot: Pick<ConfigFileSnapshot, "exists" | "valid" | "sourceConfig">): boolean {
  if (!snapshot.exists) return true;
  if (!snapshot.valid) return false;  // 损坏的配置不算"未配置"
  return Object.keys(snapshot.sourceConfig).every((key) =>
    UNCONFIGURED_CONFIG_IGNORED_KEYS.has(key),  // 仅包含 $schema/meta → 未配置
  );
}
```

### 4.6 第八阶段：完整 Commander 程序

所有快速路径和路由都未命中时，构建完整的 Commander 程序：

```typescript
// src/cli/run-main.ts:989-1117
const program = await startupTrace.measure("build-program", () => buildProgram());

// 安装全局错误处理器
installUnhandledRejectionHandler();
process.on("uncaughtException", (error) => {
  if (isUncaughtExceptionHandled(error)) return;      // 已处理
  if (isBenignUncaughtExceptionError(error)) {         // 良性
    console.warn("[openclaw] Non-fatal uncaught exception (continuing):", ...);
    return;
  }
  // 严重异常：格式化输出、运行致命错误钩子、恢复终端状态后退出
  for (const line of formatCliFailureLines({...})) console.error(line);
  for (const message of runFatalErrorHooks({ reason: "uncaught_exception", error })) {
    console.error("[openclaw]", message);
  }
  restoreTerminalState("uncaught exception", { resumeStdinIfPaused: false });
  process.exit(1);
});

// 惰性注册主命令
if (primary && shouldRegisterPrimaryCommandOnly(parseArgv)) {
  const { getProgramContext } = await import("./program/program-context.js");
  const ctx = getProgramContext(program);
  if (ctx) {
    const { registerCoreCliByName } = await import("./program/command-registry.js");
    await registerCoreCliByName(program, ctx, primary, parseArgv);
  }
}

// 惰性注册插件命令
if (!shouldSkipPluginRegistration) {
  const config = await registerPluginCliCommandsFromValidatedConfig(program, ..., {
    mode: "lazy",   // 仅注册命令定义，不加载实现
    primary,
  });
}
```

**惰性注册**（Lazy Registration）是另一个性能优化：只注册用户实际请求的命令及其可能需要的插件命令，而不是注册所有 50+ 个命令。

---

## 5. Daemon 服务管理

### 5.1 跨平台服务抽象

OpenClaw 的 Daemon 管理层（`src/daemon/`）抽象了三大平台的服务管理：

| 平台 | 服务管理器 | 服务标签 |
|------|-----------|---------|
| macOS | launchd | `ai.openclaw.gateway` |
| Linux | systemd | `openclaw-gateway.service` |
| Windows | schtasks | `OpenClaw Gateway` |

统一的服务接口：

```typescript
// src/daemon/service.ts:75-87
export type GatewayService = {
  label: string;
  loadedText: string;
  notLoadedText: string;
  stage: (args: GatewayServiceStageArgs) => Promise<void>;
  install: (args: GatewayServiceInstallArgs) => Promise<void>;
  uninstall: (args: GatewayServiceManageArgs) => Promise<void>;
  stop: (args: GatewayServiceControlArgs) => Promise<void>;
  restart: (args: GatewayServiceControlArgs) => Promise<GatewayServiceRestartResult>;
  isLoaded: (args: GatewayServiceEnvArgs) => Promise<boolean>;
  readCommand: (env: GatewayServiceEnv) => Promise<GatewayServiceCommandConfig | null>;
  readRuntime: (env: GatewayServiceEnv) => Promise<GatewayServiceRuntime>;
};
```

### 5.2 macOS LaunchAgent

LaunchAgent 是 macOS 上用户级守护进程的标准方式。OpenClaw 生成 plist 文件到 `~/Library/LaunchAgents/`：

```typescript
// src/daemon/launchd.ts — 关键常量
const LAUNCH_AGENT_DIR_MODE = 0o755;       // 目录权限
const LAUNCH_AGENT_PLIST_MODE = 0o600;      // plist 文件权限（仅用户可读写）
const LAUNCH_AGENT_PRIVATE_DIR_MODE = 0o700; // 私有目录权限
const LAUNCH_AGENT_ENV_FILE_MODE = 0o600;    // 环境文件权限
```

权限设置遵循最小权限原则：plist 和环境文件仅用户可读写，防止其他用户读取可能包含的 API Key。

### 5.3 Linux systemd

systemd 服务单元安装在 `~/.config/systemd/user/`：

```typescript
// src/daemon/systemd.ts:61-75
const SYSTEMD_GATEWAY_DOTENV_FILENAME = "gateway.systemd.env";
const SYSTEMD_NODE_DOTENV_FILENAME = "node.systemd.env";

function resolveSystemdUnitPathForName(env: GatewayServiceEnv, name: string): string {
  const home = toPosixPath(resolveHomeDir(env));
  return path.posix.join(home, ".config", "systemd", "user", `${name}.service`);
}
```

OpenClaw 还处理了 systemd 的 linger 状态——确保用户未登录时服务仍然运行：

```typescript
// src/daemon/systemd-linger.ts
export async function enableSystemdUserLinger(...): Promise<void> { ... }
export async function readSystemdUserLingerStatus(...): Promise<boolean> { ... }
```

### 5.4 Windows Task Scheduler

Windows 使用 `schtasks` 创建计划任务，并实现了**Startup 文件夹回退**机制——当 schtasks 因权限不足失败时，将启动脚本放入用户的 Startup 文件夹：

```typescript
// src/daemon/schtasks.ts:46-56
function shouldFallbackToStartupEntry(params: { code: number; detail: string }): boolean {
  return (
    params.code === 1 ||                                    // 通用失败
    /(?:access is denied|acceso denegado)/i.test(params.detail) ||  // 权限拒绝
    params.code === 124 ||                                  // 超时
    /schtasks timed out/i.test(params.detail) ||
    /schtasks produced no output/i.test(params.detail)
  );
}
```

### 5.5 Profile 感知的多实例支持

所有服务标签都支持 Profile 后缀，实现同一用户运行多个 Gateway 实例：

```typescript
// src/daemon/constants.ts:33-60
export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) return GATEWAY_LAUNCH_AGENT_LABEL;  // ai.openclaw.gateway
  return `ai.openclaw.${normalized}`;                   // ai.openclaw.work
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) return GATEWAY_SYSTEMD_SERVICE_NAME;     // openclaw-gateway
  return `openclaw-gateway${suffix}`;                    // openclaw-gateway-work
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) return GATEWAY_WINDOWS_TASK_NAME;     // OpenClaw Gateway
  return `OpenClaw Gateway (${normalized})`;              // OpenClaw Gateway (work)
}
```

---

## 6. 启动追踪：可观测性

OpenClaw 实现了一个轻量的启动追踪器，用于调试 Gateway 启动各阶段耗时：

```typescript
// src/entry.ts:67-100
function createGatewayEntryStartupTrace(argv: string[]) {
  const enabled =
    isTruthyEnvValue(process.env.OPENCLAW_GATEWAY_STARTUP_TRACE) &&
    argv.slice(2).includes("gateway");
  const started = performance.now();
  let last = started;

  return {
    mark(name: string) {
      const now = performance.now();
      emit(name, now - last, now - started);
      last = now;
    },
    async measure<T>(name: string, run: () => Promise<T>): Promise<T> {
      const before = performance.now();
      try { return await run(); }
      finally {
        const now = performance.now();
        emit(name, now - before, now - started);
        last = now;
      }
    },
  };
}
```

启用后输出格式：

```
[gateway] startup trace: entry.bootstrap 2.3ms total=2.3ms
[gateway] startup trace: entry.argv 0.1ms total=2.4ms
[gateway] startup trace: entry.run-main-import 45.2ms total=47.6ms
[gateway] startup trace: cli.main.argv 0.1ms total=47.7ms
[gateway] startup trace: cli.main.dotenv 3.1ms total=50.8ms
[gateway] startup trace: cli.main.core-imports 120.5ms total=171.3ms
[gateway] startup trace: cli.main.build-program 89.2ms total=260.5ms
[gateway] startup trace: cli.main.parse 12.1ms total=272.6ms
```

这个追踪器只在 Gateway 命令时启用，避免对其他 CLI 操作产生 stderr 噪声。

---

## 7. 优雅关闭

### 7.1 清理阶段

`run-main.ts` 的 `try/finally` 结构确保了无论命令执行成功与否，所有资源都会被正确释放：

```typescript
// src/cli/run-main.ts:1133-1149
} finally {
  if (onSigterm) process.off("SIGTERM", onSigterm);
  if (onSigint) process.off("SIGINT", onSigint);
  if (onExit) process.off("exit", onExit);
  await stopStartedProxy();            // 优雅停止代理管理器
  await disposeCliAgentHarnesses();    // 释放 Agent Harness 实例
  await closeCliMemoryManagers();      // 关闭内存搜索管理器
  pauseNonTtyStdinForCliExit();        // 非 TTY 下暂停 stdin
}
```

每个清理函数都是**尽力而为**（best-effort），不会让清理失败掩盖命令的真实退出状态：

```typescript
// src/cli/run-main.ts:270-300
async function closeCliMemoryManagers(): Promise<void> {
  try {
    const { hasMemoryRuntime } = await import("../plugins/memory-state.js");
    if (!hasMemoryRuntime()) return;
    const { closeActiveMemorySearchManagers } = await import("../plugins/memory-runtime.js");
    await closeActiveMemorySearchManagers();
  } catch {
    // Best-effort teardown for short-lived CLI processes.
  }
}

async function disposeCliAgentHarnesses(): Promise<void> {
  try {
    const { listAgentHarnessIds, disposeRegisteredAgentHarnesses } =
      await import("../agents/harness/registry.js");
    if (listAgentHarnessIds().length === 0) return;
    await disposeRegisteredAgentHarnesses();
  } catch {
    // Best-effort teardown. Harness plugins may own subprocesses,
    // but cleanup must not hide the command's real outcome.
  }
}
```

### 7.2 终端状态恢复

未捕获异常发生时，需要恢复终端状态（如光标位置、回显模式）：

```typescript
// src/cli/run-main.ts:1043
restoreTerminalState("uncaught exception", { resumeStdinIfPaused: false });
process.exit(1);
```

### 7.3 非 TTY stdin 暂停

管道模式下，stdin 未被完全消费会导致进程挂起：

```typescript
// src/cli/run-main.ts:343-353
function pauseNonTtyStdinForCliExit(): void {
  if (process.stdin.isTTY) return;
  try { process.stdin.pause(); } catch { /* 尽力清理 */ }
}
```

---

## 8. 环境标记与安全

### 8.1 进程标记

OpenClaw 在进程环境变量中设置标记，供子进程和插件检测：

```typescript
// src/infra/openclaw-exec-env.ts
export const OPENCLAW_CLI_ENV_VAR = "OPENCLAW_CLI";
export const OPENCLAW_CLI_ENV_VALUE = "1";

export function ensureOpenClawExecMarkerOnProcess(env = process.env): NodeJS.ProcessEnv {
  env[OPENCLAW_CLI_ENV_VAR] = OPENCLAW_CLI_ENV_VALUE;
  return env;
}
```

子进程可以通过 `process.env.OPENCLAW_CLI === "1"` 判断自己是否由 OpenClaw CLI 启动。

### 8.2 警告过滤器

Node.js 会为实验性 API 和废弃 API 发出警告，但这些警告对普通用户是噪音。OpenClaw 安装了一个全局过滤器：

```typescript
// src/infra/warning-filter.ts:18-32
export function shouldIgnoreWarning(warning: ProcessWarning): boolean {
  // punycode 废弃警告（几乎所有 Node.js 项目都会遇到）
  if (warning.code === "DEP0040" && warning.message?.includes("punycode")) return true;
  // util._extend 废弃警告
  if (warning.code === "DEP0060" && warning.message?.includes("util._extend")) return true;
  // SQLite 实验性特性警告
  if (warning.name === "ExperimentalWarning" &&
      warning.message?.includes("SQLite is an experimental feature")) return true;
  return false;
}
```

过滤器使用 `Symbol.for` 确保全局单例，避免在多 realm 场景下重复安装。

### 8.3 只读凭据存储

`openclaw secrets audit` 命令需要访问凭据存储，但审计操作不应修改凭据：

```typescript
// src/entry.ts:53-62
function shouldForceReadOnlyAuthStore(argv: string[]): boolean {
  const tokens = argv.slice(2).filter((token) => token.length > 0 && !token.startsWith("-"));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === "secrets" && tokens[index + 1] === "audit") return true;
  }
  return false;
}

if (shouldForceReadOnlyAuthStore(process.argv)) {
  process.env.OPENCLAW_AUTH_STORE_READONLY = "1";
}
```

---

## 9. 设计哲学总结

### 9.1 渐进式加载

OpenClaw CLI 的启动路径是一个**渐进式加载**的漏斗：

```
零模块加载        → 版本号/预计算帮助文本
1-2 模块加载      → 动态帮助文本
5-6 模块加载      → Gateway Run 快速路径
20+ 模块加载      → 完整 Commander 程序
```

每一层都精心计算了模块加载量，确保最常用的路径最快。

### 9.2 防御性编程

入口代码中充满了防御性设计：

- `isMainModule` 守卫防止重复执行
- 编译缓存 respawner 防止循环重派生
- 清理函数全部 best-effort，不掩盖真实退出状态
- 未捕获异常分级处理（良性/已处理/严重）
- 非 TTY stdin 暂停防止管道挂起

### 9.3 平台差异内化

三个平台的 Daemon 管理被统一到 `GatewayService` 接口下，但每个实现都处理了平台特有的边缘情况：

- macOS：LaunchAgent plist 权限、重启 handoff
- Linux：systemd linger、环境文件源
- Windows：schtasks 权限回退、Startup 文件夹、CMD 脚本路径

### 9.4 可观测性嵌入

启动追踪器（`createGatewayEntryStartupTrace`/`createGatewayCliMainStartupTrace`）以零开销方式嵌入启动流程，在不需要时完全不产生输出，在需要时提供精确的毫秒级阶段耗时。

---

## 10. 关键源码索引

| 关注点 | 文件路径 |
|-------|---------|
| 入口守卫 + 快速路径 | `src/entry.ts` |
| 完整 CLI 编排 | `src/cli/run-main.ts` |
| 编译缓存管理 | `src/entry.compile-cache.ts` |
| 进程重派生 | `src/entry.respawn.ts` |
| 版本快速路径 | `src/entry.version-fast-path.ts` |
| argv 解析工具 | `src/cli/argv.ts` |
| Profile 解析 | `src/cli/profile.ts` |
| 容器目标 | `src/cli/container-target.ts` |
| 启动策略 | `src/cli/run-main-policy.ts` |
| 主模块检测 | `src/infra/is-main.ts` |
| 环境规范化 | `src/infra/env.ts` |
| 进程标记 | `src/infra/openclaw-exec-env.ts` |
| 警告过滤器 | `src/infra/warning-filter.ts` |
| 信号桥接 | `src/process/child-process-bridge.ts` |
| 子进程运行器 | `src/process/respawn-child-runner.ts` |
| macOS LaunchAgent | `src/daemon/launchd.ts` |
| Linux systemd | `src/daemon/systemd.ts` |
| Windows schtasks | `src/daemon/schtasks.ts` |
| 服务常量 | `src/daemon/constants.ts` |
| 服务抽象 | `src/daemon/service.ts` |

---

## 🎯 如果只记 3 件事

1. **"三层入口漏斗 = 渐进式模块加载"** —— `openclaw.mjs`（薄包装）→ `entry.ts`（守卫 + 快速路径）→ `run-main.ts`（8 阶段完整流水线）。`--version` / 预计算帮助文本走"零模块加载"路径，**最快**；Gateway Run 走 5-6 模块；只有完整命令才走 20+ 模块。**99% 的 CLI 调用走不到第三层**。
2. **"`isMainModule` 守卫是安全底线，不是优化"** —— 打包器可能把 `entry.js` 当共享依赖 import，不加守卫会触发**双重 runCli**——端口/锁冲突直接崩。**`isMainModule` 还处理 PM2 启动和 `openclaw.mjs` 包装脚本两种特殊场景**。
3. **"Windows / macOS / Linux 各有自己的 respawn 原因"** —— **Windows 默认栈不够大**（加 `--stack-size=8192`），**macOS/Linux 抑制实验性 API 警告**（加 `--disable-warning=ExperimentalWarning`），**macOS/Linux 自动注入 TLS 根证书**（`NODE_EXTRA_CA_CERTS`）。**不重新派生一次就跑不对**。

> 📚 **配套阅读**：
> - 总体入口：[openclaw-architecture-analysis.md](./openclaw-architecture-analysis.md) §3
> - Gateway 启动的"主体"流程：[openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §2 启动生命周期
> - Daemon 怎么管理 Gateway：[openclaw-gateway-architecture.md](./openclaw-gateway-architecture.md) §10 Daemon 管理

> **总结**：OpenClaw 的启动与 CLI 入口架构展现了一种"克制而精确"的设计哲学。三层入口漏斗、多层快速路径、渐进式模块加载、防御性编程、跨平台 Daemon 管理——每一个设计选择都服务于同一个目标：**让最常见的操作最快，让最罕见的情况不崩溃**。这不是过度工程，而是一个日活百万级 CLI 工具的必备修养。
