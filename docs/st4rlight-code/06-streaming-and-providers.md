---
title: 06. 流式输出与双后端：让文字边生成边出现
tags:
  - st4rlight-code
  - 流式输出
  - Streaming
  - LLMProvider
  - Anthropic
  - OpenAI 兼容
excerpt: 把一次等完的模型调用换成流式，文字边生成边显示；顺带把后端做成两套——Anthropic 与任意 OpenAI 兼容接口，换个模型只要换个 base URL。两套后端的流式协议差异正好一起讲。
createTime: 2026/08/23 11:00:00
permalink: /st4rlight-code/06-streaming-and-providers/
---

# 06. 流式输出与双后端：让文字边生成边出现

到了这一步，agent 已经能跑完整轮对话了，但有个体验上的坎：模型想半天，然后「啪」地把一大段答案一次性吐出来，中间那几秒只能干等。这一章让输出**逐字显示**——模型每生成一小块就立刻打印，同时把后端做成两套：除了 Anthropic，也接上任何 OpenAI 兼容的接口，换个模型只要换个 base URL。

## 现状：一次等完，一次吐完

改之前，agent 调模型是**一次性等完**：整个响应收齐了才把文字一次打出来。

```ts
// agent.ts（改之前）
const response = await this.provider.chat(this.messages, request);
// ...response.content 等模型全部生成完才拿到
```

这背后其实是两件事叠在一起：

1. **传输上是流式还是非流式**——模型生成完才发，还是一条条增量发
2. **UI 上是一次性打印还是增量打印**——拿到的文字是整段给用户，还是一块块刷出来

之前我们两件都选了「一次」。这一章把传输层换成流式，UI 层跟着增量打印。

## 抽象层：给 LLMProvider 加一个流式方法

为了不动 agent 的循环结构，我们把「流式」抽象成一个**句柄**：订阅文本增量，最终还能拿回完整结果。

```ts
// llm/provider.ts
export interface ChatStream {
  // 订阅文本增量（模型每生成一小块回调一次，供即时打印）
  onText(listener: (text: string) => void): () => void;
  // 等流结束，返回最终完整结果（与一次性调用同形状）
  finalMessage(): Promise<ChatCompletion>;
}

export interface LLMProvider {
  chat(messages, options): Promise<ChatCompletion>;        // 一次性
  chatStream(messages, options): Promise<ChatStream>;     // 流式
}
```

关键设计：`finalMessage()` 返回的 `ChatCompletion` 和一次性 `chat()` 完全同形状。**agent 循环根本不用感知自己在流式**——它订阅了增量用于显示，拿回的最终结果用于写消息历史，两不耽误。

## Agent 循环里换掉这一处

相对上一章，agent 循环里只换了模型调用这一处：

```ts
// agent.ts：把一次性 chat 换成 chatStream
const stream = await this.provider.chatStream(this.messages, request);
const display = logger.assistantStream();          // 首块前打印 🤖 前缀
stream.onText((t) => display.write(t));            // 每生成一小块就打印
const response = await stream.finalMessage();      // 拿回完整结果（形状不变）
display.end();
```

`logger.assistantStream()` 是新增的流式打印器：首块文本前打出 `🤖 st4rlight` 前缀，随后逐字追加，`end()` 负责收尾换行。它和原来的 `logger.assistant` 长一个样，只是从「整段打印」变成「增量打印」。

> 注意：`end()` 只在有内容时补换行，否则工具轮（模型没吐文字、直接调工具）会打出一行多余空行。

## 双后端：OpenAI 兼容 + Anthropic

流式做完了，顺带把后端做成两套。为什么值得做？因为**模型供应商的 API 千篇一律地长得像 OpenAI，或者就是 Anthropic**。抽象出 `LLMProvider` 后，换后端只差一个实现类。

### 分发：按 base URL 选后端

CLI 里加一个工厂，根据 `--api-base` 自动选：

```ts
// cli.ts
function createProvider(apiKey: string, apiBase?: string): LLMProvider {
  const isAnthropic =
    apiBase !== undefined && apiBase.toLowerCase().includes("anthropic");
  if (isAnthropic) {
    return createAnthropicLLMProvider({ apiKey, baseURL: apiBase });
  }
  return createOpenAILLMProvider({ apiKey, baseURL: apiBase });
}
```

一句话：**apiBase 里含 `anthropic` 就走 Anthropic，否则走 OpenAI 兼容**。换个模型 = 换个 base URL + 改 `--model`，agent 一行不用动。

### 两套协议的根本差异

| 维度 | OpenAI 兼容 | Anthropic |
|------|------------|-----------|
| system | 混在 messages 里（role: system） | 单独字段传（不在 messages） |
| 工具调用 | 独立字段 `tool_calls` | content block：`tool_use` / `tool_result` |
| 流式文本增量 | chunk 里的 `delta.content` | 事件流里的 `text` 事件 |
| 工具参数增量 | 按 index 分块累加 `delta.tool_calls` | `content_block_delta` 里的 `partial_json` |

最麻烦的是**协议转换**：同样的内部 `Message`，要翻译成两套完全不同的请求体。

### OpenAI 兼容后端的流式实现

OpenAI 兼容接口开 `stream: true`，返回一个异步迭代器，逐块回调。文本增量在 `delta.content`，工具调用则**按 index 分块**——同一个工具的参数 JSON 被切成好几块，要自己拼：

```ts
// llm/openaiLike.ts（节选）
const stream = await this.client.chat.completions.create(
  { ...this.toRequest(messages, options), stream: true },
  { signal: options.signal },
);

let fullText = "";
const toolCallParts = new Map<number, { id: string; name: string; args: string }>();

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (!delta) continue;
  if (delta.content) {
    fullText += delta.content;
    for (const l of listeners) l(delta.content);      // 即时回调
  }
  for (const tc of delta.tool_calls ?? []) {          // 工具参数分片累加
    if (tc.index === undefined || tc.index === null) continue;
    let part = toolCallParts.get(tc.index);
    if (!part) { part = { id: tc.id ?? "", name: "", args: "" }; toolCallParts.set(tc.index, part); }
    if (tc.id) part.id = tc.id;
    if (tc.function?.name) part.name += tc.function.name;
    if (tc.function?.arguments) part.args += tc.function.arguments;
  }
}
// 流结束后按 index 排序，把分片组装回完整 ToolCall
```

注意那个 `if (!tc.index)` 的坑：index 为 0 的第一个工具会被误跳过，所以要判 `tc.index === undefined || tc.index === null` 而不是取反。

### Anthropic 后端的流式实现

Anthropic 的流式用 SDK 自带的 `messages.stream`，文本增量在 `text` 事件里，拿最终结果用 `finalMessage()`——比 OpenAI 的异步迭代器更「开箱即用」：

```ts
// llm/anthropic.ts（节选）
const stream = this.client.messages.stream(this.toRequest(messages, options));

const listeners = new Set<(text: string) => void>();
stream.on("text", (delta: string) => {
  for (const l of listeners) l(delta);
});

return {
  onText(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  finalMessage: async () => {
    const message = await stream.finalMessage();
    return fromAnthropicMessage(message);   // content blocks → 内部 ChatCompletion
  },
};
```

Anthropic 的 `finalMessage()` 返回的 `Message.content` 是一个 **blocks 数组**，里面混着 `text` 块和 `tool_use` 块，要自己拆：

```ts
for (const block of message.content) {
  if (block.type === "text") text += block.text;
  else if (block.type === "tool_use") {
    toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
  }
}
```

再加上 `system` 单独拆出来、`tool_use`/`tool_result` 用 content block 表达，一套内部 `Message` 就这么翻译成了 Anthropic 协议。

## 运行效果

换后端前，跑起来和上一章行为一致，只是文字边生成边出现：

```bash
npm run dev "计算 123 加 456，然后告诉我结果"
```

```
  🧮 calculator 123 add 456
  579
🤖 st4rlight 123 加 456 的结果是 **579**。
```

中间那几秒不再干等——模型每生成一小块，`🤖` 后面就多一小截字。

## 设计取舍：为什么流式句柄而不是返回生成器

我们把流式抽象成「`onText` 订阅 + `finalMessage()` 拿结果」，而不是让 agent 直接 `for await` 消费：

| 方案 | 优点 | 缺点 |
|------|------|------|
| `for await` 生成器 | 表达直观 | agent 要自己拼 content、管 toolCalls 累加，循环变复杂 |
| **`onText` + `finalMessage`** | agent 只管订阅显示、拿现成结果 | 多一层回调封装 |

关键在于：**agent 的循环逻辑（判断工具调用、写消息历史）完全不受流式影响**——它拿到的 `ChatCompletion` 和原来一模一样。流式只是「显示层」多接了一根线。

## 小结

- 抽象 `LLMProvider.chatStream`，返回 `ChatStream`：`onText` 订阅增量、`finalMessage()` 拿完整结果
- agent 循环只换模型调用一处，UI 用 `logger.assistantStream()` 增量打印
- 双后端：`createProvider` 按 base URL 分发 OpenAI 兼容 / Anthropic
- 两套协议差异集中在 system 位置、工具调用表达、流式增量格式，靠两个 provider 类各自翻译
- 换个模型只要换个 base URL + 改 `--model`

下一章，我们把会话存储从 JSON 全量覆盖升级到 JSONL 追加式，跨过「崩溃安全 + O(1) 写入」这道线。
