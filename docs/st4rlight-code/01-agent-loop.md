---
title: 01. Agent 循环
tags:
  - st4rlight-code
  - Agent Loop
  - 工具调用
excerpt: 讲 st4rlight-code 的 Agent 核心循环：已经实现的「调模型→看是否用工具→执行→喂回→再调」，以及文章里提到的、我们要补充的流式输出、中断处理、循环恢复等能力。
createTime: 2026/08/16 11:00:00
permalink: /st4rlight-code/01-agent-loop/
---

# 01. Agent 循环

Agent 的心脏是一个循环：**调模型 → 看它要不要用工具 → 用完把结果喂回去 → 再调模型**，直到模型说任务做完了。

这一篇讲两件事：现在**已经实现**的最小循环，以及**要补充**的（流式、中断、循环恢复）。

## 已经实现的：最小循环 + 工具回路

起点是最笨的版本——只会聊天，读不了文件：

```ts
async function chatOnce(messages, userMessage) {
  messages.push({ role: "user", content: userMessage });
  const response = await client.messages.create({ model, max_tokens: 4096, messages });
  const text = response.content.find(b => b.type === "text")?.text ?? "";
  console.log(text);
  messages.push({ role: "assistant", content: response.content });
}
```

它只能吐文本，模型想读文件也没手。缺两件事：请求里没告诉模型有哪些工具，也没有接住工具调用、真去执行、把结果递回去的那一环。

### 补上工具回路

我们的 `Agent.chatOnce` 实现，核心就三处：

```ts
async chatOnce(userMessage: string): Promise<string> {
  this.messages.push({ role: Role.User, content: userMessage });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await this.provider.chat(this.messages, {
      model, maxTokens, tools: this.options.tools,   // ← 带工具清单，模型才知道有哪些可调
    });

    this.messages.push({ role: Role.Assistant, content: response.content, toolCalls: response.toolCalls });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response.content;   // ← 没调工具 → 任务完成，退出
    }

    const toolMessages: Message[] = [];
    for (const call of response.toolCalls) {          // ← 逐个执行
      const result = await this.runTool(call.name, call.arguments);
      toolMessages.push({ role: Role.Tool, result: { toolCallId: call.id, name: call.name, content: result } });
    }
    this.messages.push(...toolMessages);              // ← 结果喂回，进入下一轮
  }
  throw new Error(`工具调用循环超过 ${MAX_ITERATIONS} 轮`);
}
```

**决定循环转不转的，从头到尾是模型，不是代码。** 我们没有写"如果是读文件请求就……"的分支——是模型自己决定要不要动手、够不够、要不要再来一轮。这就是 agent 和聊天机器人的分界线。

### 消息数组怎么长大

带工具的那几轮，数组通常多两条：一条 assistant（模型要调的工具），一条 tool（工具结果）；收尾那轮模型不再调工具，只多一条 assistant 文本。模型每次都能看到完整历史，所以能"记得"自己做过什么——所谓记忆，此刻不过是一个不断变长的数组。

```ts
第 1 轮: [user, assistant(tool_use), tool(result)]
第 2 轮: [..., assistant(tool_use), tool(result)]
第 3 轮: [..., assistant(text)]  ← 无 tool_call → 结束
```

### 运行效果

```bash
npm run dev "计算 100 乘以 456，并告诉我当前时间"
```

```
⏱ 调用工具 calculator {"op":"multiply","a":100,"b":456}
✓ 工具结果 calculator 45600
⏱ 调用工具 get_now {"format":"YYYY-MM-DD HH:mm:ss"}
✓ 工具结果 get_now 2026-08-16 01:41:35
🤖 st4rlight
  100 × 456 = 45600
  当前时间：2026-08-16 01:41:35
```

## 要补充的

真实 Claude Code 的循环比我们多得多。它把"继续循环"这件事分了 **7 种情况**，我们只实现第 1 种，其余 6 种都是错误和边界的恢复策略：

| # | 名称 | 什么时候 | 怎么办 |
|---|------|---------|-------|
| 1 | `next_turn` | 模型调了工具 | 执行工具，结果推回，继续 ✅（已实现） |
| 2 | `collapse_drain_retry` | PTL 错误，有暂存的折叠操作 | 提交折叠腾空间，重试 |
| 3 | `reactive_compact_retry` | PTL 错误，折叠空间还不够 | 强制全量摘要压缩，重试 |
| 4 | `max_output_tokens_escalate` | 输出被截断，第一次 | 升到更高 Token 上限，重试 |
| 5 | `max_output_tokens_recovery` | 输出被截断，升级已用尽 | 注入续写提示，最多重试 3 次 |
| 6 | `stop_hook_blocking` | 任务做完但 Stop Hook 拦下了 | 接着执行循环 |
| 7 | `token_budget_continuation` | API 侧 Token 预算耗尽 | 继续生成 |

还要补的：

- **中断处理**：用 `AbortController` 贯穿循环，Ctrl+C 能优雅停下，连正在飞的网络请求也一起取消
- **流式输出**：模型回复边生成边显示，而不是等完整响应再一次性输出
- **流式工具执行**（StreamingToolExecutor）：某个工具的参数 JSON 一旦拼完整就立刻执行，不等整个响应收完

```
串行（我们现在）：[===== 响应 =====][tool1][tool2][tool3]
并行（Claude Code）：[===== 响应 =====]
                        ↑ tool1 拼完 → 立即执行
                                ↑ tool2 拼完 → 立即执行
```

这些都是"把同一个循环做得又稳又快"的工程，地基却是同一个——上面那个最小循环。
