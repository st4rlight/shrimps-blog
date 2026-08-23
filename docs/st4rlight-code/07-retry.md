---
title: 07. 网络层重试：指数退避与"重试风暴"
tags:
  - st4rlight-code
  - 重试机制
  - withRetry
  - 指数退避
  - 错误处理
excerpt: 模型 API 不是总可靠的——429/503/529、网络瞬断都会发生。这一章给 LLM 调用加上重试：只重试可恢复的错误、指数退避加随机抖动防"重试风暴"、用户中断绝不重试。
createTime: 2026/08/23 13:00:00
permalink: /st4rlight-code/07-retry/
---

# 07. 网络层重试：指数退避与"重试风暴"

上一章把模型调用换成流式后，agent 体验好了，但暴露了一个更基础的问题：**模型 API 不是总可靠的**。服务过载、网络抖动随时可能让一次调用失败。如果失败就抛错终止，用户只能重来。

这一章给 LLM 调用加一个**网络层重试机制**：失败时自动退避重试，把瞬态错误消化掉。

## 不是所有错误都值得重试

先回答一个问题：**什么该重试，什么不该？**

| 类型 | 状态码 / 错误 | 值得重试？ |
|------|--------------|-----------|
| 服务过载 | `429`（限流）、`503`（不可用）、`529`（过载） | ✅ 是，过一会可能就好 |
| 网络瞬断 | `ECONNRESET`、`ETIMEDOUT` | ✅ 是，重连可能成功 |
| 服务过载（文案） | message 含 `overloaded` | ✅ 是 |
| 请求/鉴权/配置错误 | `400`、`401`、`404` | ❌ 否，重试没意义 |

关键洞察：**400/401/404 反映的是代码或配置问题，重试一万次结果一样**。只有瞬态错误才值得重试。所以判断逻辑是第一道关卡：

```ts
// support/retry.ts
function isRetryable(error: unknown): boolean {
  const status = getStatus(error);
  if (status !== undefined && [429, 503, 529].includes(status)) {
    return true;
  }
  const code = getCode(error);
  if (code === "ECONNRESET" || code === "ETIMEDOUT") {
    return true;
  }
  const message = getMessage(error);
  if (message.includes("overloaded")) {
    return true;
  }
  return false;
}
```

注意错误对象是 `unknown`，不能直接 `error.status`——要写类型守卫安全读取（`getStatus`/`getCode`/`getMessage`），否则 `any` 满天飞且容易运行时崩溃。

## 核心：withRetry

```ts
// support/retry.ts
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(signal);
    } catch (e) {
      // 用户中断：立即抛出，不做无谓重试
      if (signal?.aborted) {
        throw e;
      }
      if (attempt >= maxRetries || !isRetryable(e)) {
        throw e;
      }
      const delay = retryDelay(attempt);
      logger.info(`(retrying ${attempt + 1}/${maxRetries}: ${retryReason(e)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

三个关键决策：

1. **`signal?.aborted` 立即抛出**——用户已经按了 Ctrl+C，绝不能因为重试又等几秒
2. **达到重试上限或不可重试错误直接抛**——不无限重试
3. **打印重试提示**——用户能看到"正在重试（HTTP 429）"，而不是干等

## 为什么指数退避 + 抖动

如果所有客户端失败后都固定等 1 秒再重试，会发生什么？**"重试风暴"**——大量客户端同时重试，反而把已经过载的服务再压垮一次。

指数退避让间隔逐轮翻倍（1s → 2s → 4s），服务有喘息空间；再加随机抖动打破多客户端同步：

```ts
// support/retry.ts
function retryDelay(attempt: number): number {
  const exponential = Math.min(1000 * Math.pow(2, attempt), 30000);
  return exponential + Math.random() * 1000;   // 30s 上限 + 随机抖动
}
```

- **指数部分** `1000 * 2^attempt`：间隔逐轮翻倍，控制退避速度
- **30s 上限**：防止等待过久
- **随机抖动** `+ random(0, 1000)`：打破多客户端同步，避免"重试风暴"

## 接入：包住模型调用

重试放在哪一层？答案是**包住 provider 的模型调用**——这是唯一的网络边界。两个后端都包：

```ts
// llm/anthropic.ts
async chat(messages: Message[], options: ChatOptions): Promise<ChatCompletion> {
  return withRetry(async (signal) => {
    const response = (await this.client.messages.create(
      this.toRequest(messages, options),
      { signal: signal ?? options.signal },
    )) as Anthropic.Message;
    return fromAnthropicMessage(response);
  }, options.signal);
}
```

流式也一样，但有个**关键陷阱**：

```ts
// llm/anthropic.ts chatStream（节选）
const stream = (await withRetry(async (signal) => {
  return this.client.messages.stream(
    this.toRequest(messages, options),
    { signal: signal ?? options.signal },
  );
}, options.signal)) as unknown as AnthropicStream;
```

**只重试"建立连接"的 create 调用，流开始后绝不重试**。为什么？因为流一旦开始，文本可能已经打印了一部分——如果中途失败重试，用户会看到**重复的内容**。所以重试只在连接建立前，流内部错误直接抛。

## 运行效果

正常情况下用户无感知；只有真遇到瞬态错误时，会看到一条提示然后自动重试：

```
(retrying 1/3: HTTP 429)
(retrying 2/3: HTTP 503)
```

## 设计取舍

| 决策 | 理由 |
|------|------|
| 只重试瞬态错误 | 4xx/5xx 固定错误重试无意义，浪费时间 |
| 指数退避 + 抖动 | 标准分布式容错，防"重试风暴" |
| 用户中断不重试 | 尊重用户意图，不因重试拖时间 |
| 流内不重试 | 避免已打印内容重复 |
| `support/retry.ts` 独立模块 | 与工具/agent 解耦，纯网络层关心 |

## 小结

- `isRetryable` 判定：只重试 429/503/529、网络瞬断、overloaded
- `withRetry`：指数退避 + 抖动，用户中断/不可重试/超上限立即抛
- 接入点：包住两个 provider 的模型调用，**只重试建连不重试流内**

下一章，我们给 agent 加上 Extended Thinking——让模型在输出前用一段"私有草稿"做推理规划。
