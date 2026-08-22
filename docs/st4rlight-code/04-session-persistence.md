---
title: 04. CLI 与会话：从一次性到能记住、能中断
tags:
  - st4rlight-code
  - 会话持久化
  - REPL
  - commander
  - Ctrl+C
  - resume
excerpt: 给 st4rlight-code 补上完整 CLI：commander 参数解析、两种运行模式、resolveApiKey 安全读 key、REPL 的 rl.once 串行与 Ctrl+C 双语义、多会话持久化 + agent 自动保存，让对话跨进程保留、随时续聊、可随时中断。
createTime: 2026/08/22 14:00:00
permalink: /st4rlight-code/04-session-persistence/
---

# 04. CLI 与会话：从一次性到能记住、能中断

前几章每次 `npm run dev "消息"` 都是一次性的：agent 跑完就退，消息历史只活在进程内存里，关掉就没了。这一章把 CLI 整个补起来：**commander 解析参数、两种运行模式、API key 安全读取、交互式 REPL 与 Ctrl+C 中断、多会话持久化**。核心目标一句话：让对话能记住（持久化）、能续聊（resume）、能随时打断（中断）。

## CLI 参数解析：从手写到 commander

最早参数是靠 `argv.includes("--resume")` 这种手写判断拼的，参数一多就散。换成 commander 声明式定义，`--help` 还自动生成：

```ts
// src/config/args.ts
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const program = new Command();
  program
    .name("st4rlight")
    .usage("[options] [prompt...]")
    .argument("[prompt...]", "用户消息")   // 位置参数拼成消息
    .option("-y, --yolo", "跳过所有权限确认")
    .option("--plan", "只出方案，不执行工具")
    .option("--accept-edits", "自动接受文件编辑")
    .option("--thinking", "开启思考模式")
    .option("-m, --model <model>", "指定模型")
    .option("--api-base <url>", "OpenAI 兼容 API 地址")
    .option("--resume", "恢复最近会话")
    .option("--max-cost <number>", "单轮最大费用")
    .option("--max-turns <number>", "单轮最大循环次数");
  // ...
}
```

支持参数一览：

| 参数 | 功能 |
|------|------|
| `-y, --yolo` | 跳过所有权限确认（bypassPermissions） |
| `--plan` / `--accept-edits` / `--dont-ask` | 权限模式（互斥，yolo 优先级最高） |
| `--thinking` | 思考模式 |
| `-m, --model <model>` | 指定模型（默认 `MODEL` 环境变量 → `deepseek-v4-flash`） |
| `--api-base <url>` | 覆盖 API 地址 |
| `--resume` | 恢复最近会话 |
| `--max-cost` / `--max-turns` | 预算控制（非法数字静默忽略） |
| `[prompt...]` | 位置参数拼成用户消息（支持多词） |

两个实现细节：

- **数字选项**不在 commander 层做 parse 函数——因为返回 `undefined` 会触发 commander 的 invalid 报错，改为返回后过滤，保留"非法值静默忽略"的语义
- **权限模式** `PermissionMode` 用 `as const` 对象 + 联合类型（而非 enum），兼容 Node strip-only

## 两种运行模式 + API key 安全读取

`runCli` 按解析结果分流：有 prompt 走单次模式，没 prompt 进 REPL：

```ts
// src/cli.ts
export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  loadEnvFile();
  const args = parseArgs(argv);

  // API key 只从环境变量读取，不支持命令行传参
  const apiKey = resolveApiKey(args.apiBase);
  if (!apiKey) {
    logger.error("缺少 API key。请设置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 环境变量。");
    process.exit(1);
  }

  const agent = new Agent(provider, { model: args.model, /* … */ });

  if (args.resume) {
    const sessionId = getLatestSessionId(process.cwd());
    if (sessionId) {
      const session = loadSession(sessionId);
      if (session) agent.restoreSession(session);
    }
  }

  if (args.prompt) { await runOnce(agent, args.prompt); return; }  // 单次
  await runRepl(agent);                                            // REPL
}
```

### resolveApiKey：为什么 key 只走环境变量

API key 是敏感信息。如果支持 `--api-key xxx` 传参，它会**出现在 shell history 里**，泄漏风险极高。所以 key 只从环境变量读：

```ts
// src/config/apiKey.ts
export function resolveApiKey(apiBase?: string): string | undefined {
  const isAnthropic = apiBase !== undefined && apiBase.toLowerCase().includes("anthropic");
  if (isAnthropic) {
    return process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
  }
  return process.env.OPENAI_API_KEY;
}
```

优先级：apiBase 指向 Anthropic 端点 → `ANTHROPIC_API_KEY`（兜底 `OPENAI_API_KEY`）；否则 → `OPENAI_API_KEY`。

## REPL：rl.once 串行 + Ctrl+C 双语义

REPL 不是"读一行答一行"那么简单，有两个隐蔽的坑。

### rl.once 而非 rl.on：严格串行

`rl.on("line")` 注册的 handler 不会等 `await agent.chat()` 完成就响应下一行输入——如果用户在 agent 处理时又输入，**多个 chat 会并发修改消息历史**，直接写坏上下文。

用 `rl.once("line")` 每次只监听一行，处理完再递归注册，天然串行：

```ts
// src/cli.ts
const ask = (): void => {
  printPrompt();
  rl.once("line", async (line) => {
    const input = line.trim();
    // …处理命令…
    await runOnce(agent, input);
    ask();   // 处理完才监听下一行
  });
};
ask();
```

> Python 的 `while True: input() + await` 天然没有这个问题——`input()` 阻塞等待，天然串行。JS 的事件驱动模型需要主动用 `once` 保证。

### Ctrl+C 双语义：中断操作 / 退出

处理中按 Ctrl+C 和空闲时按 Ctrl+C 意义完全不同：

```ts
process.on("SIGINT", () => {
  if (agent.isProcessing) {
    agent.abort();                       // 处理中：中断当前请求
    logger.info("(interrupted)");
    printPrompt();
  } else {
    sigintCount += 1;                    // 空闲：连按两次退出
    if (sigintCount >= 2) { process.exit(0); }
    logger.info("Press Ctrl+C again to exit.");
    printPrompt();
  }
});
```

这避免了两种意外：
- **手滑 Ctrl+C 导致整个会话丢失**——空闲时第一次按只是提醒，不会退出
- **Agent 跑偏时只能眼睁睁等它跑完**——处理中按下立刻中断

agent 侧用 `AbortController` 接线，`chatOnce` 里 `try/finally` 保证状态复位：

```ts
// src/agent.ts
async chatOnce(userMessage: string): Promise<string> {
  const startLength = this.messages.length;
  this.messages.push({ role: Role.User, content: userMessage });

  this.processing = true;
  this.abortController = new AbortController();
  try {
    // …循环调 provider.chat，传入 signal…
  } catch (e) {
    // 中断时回滚本轮消息，保证"中断 = 本轮作废"
    if (this.abortController?.signal.aborted) {
      this.messages.length = startLength;
    }
    throw e;
  } finally {
    this.processing = false;
    this.abortController = null;
    this.autoSave();
  }
}
```

关键细节：**中断回滚**——`chatOnce` 记录本轮起始消息数，abort 时回滚。否则被打断的那条 user 消息会残留在历史里（没有对应回复），下一轮被原样发给模型，污染上下文。

## 多会话持久化：从单文件到 metadata + autoSave

最早的做法是"一张 JSON 存整个消息数组，按 cwd 哈希命名一个文件"。这有局限：每项目只能存一份，没有任何元信息，还得 CLI 手动保存。升级为**多会话**：

```ts
// src/session.ts
export interface SessionMetadata {
  id: string; model: string; cwd: string;
  startTime: string; messageCount: number;
}
export interface SessionData {
  metadata: SessionMetadata;
  messages: Message[];
}

export function saveSession(id: string, data: SessionData): void {
  ensureDir();
  writeFileSync(sessionFile(id), JSON.stringify(data, null, 2), "utf-8");
}

export function getLatestSessionId(cwd?: string): string | null {
  const sessions = listSessions(cwd);
  sessions.sort((a, b) => new Date(b.metadata.startTime).getTime() - new Date(a.metadata.startTime).getTime());
  return sessions[0]?.metadata.id ?? null;
}
```

### 三个关键设计

| 设计 | 为什么 |
|------|--------|
| **uuid 命名 + metadata** | 每会话一个文件，可记录 model/cwd/startTime/messageCount，支持按时间取最近、按目录隔离 |
| **agent 内部 autoSave** | `chatOnce` 每轮结束自动保存，保存失败静默忽略——不能因为磁盘满让整个对话崩溃 |
| **restoreSession 沿用身份** | 恢复时不仅载入消息，还沿用原 sessionId/startTime，续聊仍算同一个会话 |

agent 的 autoSave（保存失败静默）：

```ts
// src/agent.ts
private autoSave(): void {
  try {
    const metadata: SessionMetadata = {
      id: this.sessionId, model: this.options.model,
      cwd: process.cwd(), startTime: this.sessionStartTime,
      messageCount: this.messages.length,
    };
    saveSession(this.sessionId, { metadata, messages: this.messages });
  } catch {
    // 静默忽略：保存失败不影响对话继续
  }
}
```

恢复时按目录找最近会话：

```ts
// src/agent.ts
restoreSession(data: SessionData): void {
  this.sessionId = data.metadata.id;
  this.sessionStartTime = data.metadata.startTime;
  this.messages = data.messages;
  this.reminderInjected = data.messages.some((m) => m.role === Role.User);
}
```

`loadSession` 还做了**结构校验**（metadata + messages 双检查），旧格式文件自动跳过，不会因残留旧文件崩溃。

## 运行效果

```
$ npm run dev -- --yolo -m gpt-4o "帮我看看 src/agent.ts"
📖 read_file src/agent.ts
🤖 st4rlight
  src/agent.ts 目前有 120 行。
```

再开一个会话，`--resume` 接着聊：

```
$ npm run dev -- --resume
> 上一步我看过哪个文件？
🤖 st4rlight
  你刚才用 read_file 看过 src/agent.ts。
> /clear
(history cleared)
> exit
```

## 和真实 Claude Code 的差距

我们的会话是"每会话一个 JSON 全量覆盖"，足够用；真实 Claude Code 的会话系统要重得多：

| 维度 | 我们 | Claude Code |
|------|------|-------------|
| 存储 | 每会话一个 JSON，整份覆盖 | 每会话 append-only `.jsonl`，逐条追加 |
| 写入成本 | O(消息数) | **O(1)** |
| 崩溃安全 | 写一半毁整份 | 最多丢最后一行 |
| 恢复 | `--resume` 读最近会话 | `--continue` 最近、`--resume` 打开 picker 选、可 fork |
| 其他 | `/clear` | `/cost`、`/compact` 等会话内命令 |

> 差距最大的就是 **JSONL vs JSON 覆盖**：整体 JSON 写入中途崩溃会损坏整个文件，且对话越长每次保存越慢；JSONL 每轮追加一行，文件系统 append 通常是原子的，崩溃最多丢最后一行，恢复时逐行解析、跳过末尾不完整的行即可。这个 05 章会展开讲。

## 小结

这一章把 CLI 从"一次性"升级成完整形态：

- commander 声明式参数解析，`--help` 自动生成
- 两种运行模式（单次 / REPL）+ `resolveApiKey` 安全读 key
- REPL 用 `rl.once` 严格串行，Ctrl+C 双语义（中断 / 两次退出）
- 多会话持久化 + agent autoSave，`--resume` 恢复最近会话

下一章，我们看终端 UI 和真实 Claude Code 的差距。
