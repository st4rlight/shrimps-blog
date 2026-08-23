---
title: 09. 工具并行执行：把执行时间藏进流式窗口
tags:
  - st4rlight-code
  - 流式工具执行
  - 并行执行
  - onToolCall
  - Promise.all
excerpt: 模型生成时工具不该干等。这一章实现流式工具执行——工具参数一拼完整就开跑，不等整个响应；再实现并行分批——连续的安全工具 Promise.all 并行，非安全工具串行屏障。
createTime: 2026/08/23 15:00:00
permalink: /st4rlight-code/09-streaming-tools-parallel/
---

# 09. 工具并行执行：把执行时间藏进流式窗口

流式输出解决了"等待文字"的问题，但**工具执行**还在干等：串行方式下，所有工具要等整个 API 响应结束后才开始逐个跑。

这一章做两件事：
1. **流式工具执行**——工具参数一拼完整就开跑，不等整个响应结束
2. **并行工具执行**——同一批安全工具 `Promise.all` 并行，写操作作为串行屏障

## 为什么工具执行也能并行

一个典型响应有 **5~30 秒的流式窗口**。模型返回多个工具调用时，串行方式下这些工具的执行时间**全部排在响应之后**：

```
串行： [======= 响应 =======][read][read][write][read]
                            └── 全部串行，逐个等
```

流式并行的思路：**第一个 tool_use 参数拼完整时就立即执行**，工具执行时间和模型生成后续内容**重叠**：

```
流式并行： [==== 响应 =====] [read][read][write][read]
              ↑read 拼完立即执行
                    ↑ 后续工具边生成边执行
```

文件读取这类工具 < 100ms 就能跑完——在 5~30 秒的流式窗口里**几乎全被覆盖**，流结束时结果往往已经就绪。

## 并发安全：工具的自身属性

不是所有工具都能提前/并行执行。**写操作和命令执行有副作用**，绝不能和别的工具重叠。所以"是否并发安全"是**工具的自身属性**，而非 agent 硬编码：

```ts
// models/tool.ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  deferred?: boolean;
  /**
   * 是否并发安全（默认 false）。并发安全 = 只读、无副作用。
   * 写操作/命令执行必须为 false（fail-closed）。
   */
  isConcurrencySafe?: boolean;
}
```

4 个只读工具标 `true`：`read_file`、`list_files`、`grep_search`、`web_fetch`。

**fail-closed 设计**：默认 `false`（不可并发）。把可并发的标成不可并发只是少点优化；反过来（把写操作标成可并发）是危险的。默认只能选安全方向。

## 抽象层：ChatStream 加 onToolCall

让流式能"提前"通知工具调用，`ChatStream` 新增 `onToolCall` 订阅——**参数拼完整时立即回调**，不等流结束：

```ts
// llm/provider.ts
export interface ChatStream {
  onText(listener: (text: string) => void): () => void;
  /** 订阅工具调用完成（tool_use block 参数拼完整时立即回调） */
  onToolCall(listener: (call: ToolCall) => void): () => void;
  finalMessage(): Promise<ChatCompletion>;
}
```

`createChatStream` 加一个 `emit.toolCall()` 发射器，provider 把"工具完成"喂给它。

## Anthropic：content_block_stop 精确信号

Anthropic 的流式协议有**块级事件**——这是流式工具执行能成立的关键。模型可能一次返回多个 tool_use，第一个 block 完整时第二个还在传输，我们用 `streamEvent` 精确跟踪：

```ts
// llm/anthropic.ts（chatStream 节选）
const toolBlocks = new Map<number, { id: string; name: string; inputJson: string }>();
stream.on("streamEvent", event => {
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    toolBlocks.set(event.index ?? 0, {
      id: event.content_block.id ?? "", name: event.content_block.name ?? "", inputJson: "",
    });
    return;
  }
  if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    const tracked = toolBlocks.get(event.index ?? 0);
    if (tracked && event.delta?.partial_json) {
      tracked.inputJson += event.delta.partial_json;   // 拼参数
    }
    return;
  }
  if (event.type === "content_block_stop") {            // 参数拼完整！
    const tracked = toolBlocks.get(event.index ?? 0);
    if (tracked && tracked.name) {
      emit.toolCall({
        id: tracked.id, name: tracked.name,
        arguments: parseArguments(tracked.inputJson),
      });
    }
  }
});
```

三态跟踪：`content_block_start` 记 index → `content_block_delta` 累加 `partial_json` → `content_block_stop` 参数完整，立即回调。

## agent：提前执行，结果存 Promise

agent 订阅 `onToolCall`，对并发安全工具**立即开跑**，结果存进 Map（不阻塞流式继续接收）：

```ts
// agent.ts（chatOnce 节选）
const earlyExecutions = new Map<string, Promise<string>>();
stream.onToolCall(call => {
  if (this.isConcurrencySafeTool(call.name)) {
    printToolCall(call.name, call.arguments);
    earlyExecutions.set(call.id, this.runTool(call.name, call.arguments, context));
  }
});
const response = await stream.finalMessage();
```

## 处理结果：优先复用提前执行

流结束后，处理工具结果时**优先复用**提前执行的 Promise：

```ts
// agent.ts executeToolCalls（节选）
for (const call of calls) {
  const early = earlyExecutions.get(call.id);
  if (early) {
    const result = await early;   // 已执行完或即将完成
    // 直接使用结果，不重复执行
  }
}
```

关键：提前执行过的工具**绝不重复执行**——否则一次工具调用跑两遍。

## OpenAI 后端：没有块级事件怎么办

OpenAI 的流式协议**没有 `content_block_stop`**——`delta.tool_calls` 按 index 分片到达，你永远不知道某个 tool_call 是否还会再来一个 chunk。所以没法在流中提前执行。

退而求其次：**响应结束后显式分批并行**。把连续并发安全工具归入同一批 `Promise.all`，写操作作为串行屏障：

```ts
// agent.ts groupToolCalls
// [read, read, write, read] → [[read,read], [write], [read]]
for (const call of calls) {
  if (earlyExecutions.has(call.id)) { flush(); batches.push([call]); }
  else if (this.isConcurrencySafeTool(call.name)) { batch.push(call); }  // 汇聚并批
  else { flush(); batches.push([call]); }                                 // 串行屏障
}
flush();
```

**混合序列保持安全**：`[read, read, write, read]` 分成三个批次——写操作前后的工具各自独立，**不会跨越写操作并行**。

消费批次时 `Promise.all` 并行，结果按工具顺序返回：

```ts
const done = await Promise.all(
  batch.map(async call => ({
    call,
    result: await this.runTool(call.name, call.arguments, context),
  })),
);
```

## 两种后端策略对比

| | Anthropic | OpenAI |
|---|-----------|--------|
| 并行触发 | 流式阶段 `content_block_stop` | 响应结束后分批 |
| 机制 | `onToolCall` 提前执行（天然重叠） | 显式 `Promise.all` 分批 |
| 提前性 | ✅ 执行时间藏进流式窗口 | ❌ 执行在响应之后 |
| 写操作安全 | 提前执行只选并发安全工具 | 串行屏障分组 |

**两种策略在 agent 里共存**：`earlyExecutions` 处理 Anthropic 的提前执行，`groupToolCalls` + `Promise.all` 处理 OpenAI 的分批并行。接口 `onToolCall` 一致，OpenAI 侧订阅者不触发，靠 `finalMessage` 收尾。

## 运行效果

mock 验证 `[read, read, write, read]` 的时间线：

```
read_file@0       ← 第一批 [read,read] 并行启动
read_file@0
write_file@53     ← 写操作串行屏障（等第一批结束）
read_file@104     ← 最后一批单独
```

**加速效果**：模型一次读取 3~5 个文件时，并行通常带来 **2~3 倍**速度提升。

## 设计取舍

| 决策 | 理由 |
|------|------|
| 并发安全是工具属性 | 数据驱动，新增工具只改定义；fail-closed 默认 false |
| Anthropic 提前执行 | 块级事件精确，执行时间藏进流式窗口 |
| OpenAI 分批并行 | 无块级事件，退而求其次但仍有加速 |
| 写操作串行屏障 | 绝不跨越写操作并行 |
| 提前执行不重复 | 结果存 Promise 复用，一次调用只跑一遍 |

## 小结

- 并发安全是 `ToolDefinition.isConcurrencySafe` 属性（fail-closed 默认 false）
- `ChatStream.onToolCall`：Anthropic `content_block_stop` 精确回调
- agent 提前执行并发安全工具，结果存 `earlyExecutions` Map，后续复用不重复
- OpenAI 无块级事件 → 响应后分批 `Promise.all`，写操作串行屏障
- `[read,read,write,read]` → `[[read,read],[write],[read]]`

至此，流式输出、双后端、重试、思考模式、工具并行都已打通。下一章，我们把会话存储从 JSON 全量覆盖升级到 JSONL 追加式。
