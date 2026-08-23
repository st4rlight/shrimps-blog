---
title: 08. Extended Thinking：让模型先想后答
tags:
  - st4rlight-code
  - Extended Thinking
  - ThinkingMode
  - 模型能力注册表
  - 思考模式
excerpt: 让模型在输出前用一段私有"草稿纸"做推理规划，对多步决策的 coding 任务有明显帮助。这一章实现 Extended Thinking 的双后端支持，顺带把模型能力从硬编码名字判断重构为数据驱动的注册表。
createTime: 2026/08/23 14:00:00
permalink: /st4rlight-code/08-thinking-models/
---

# 08. Extended Thinking：让模型先想后答

对需要多步决策的 coding 任务，模型「想完再答」通常比「边想边答」效果更好。Extended Thinking 给模型一段**私有的"草稿纸"**做推理规划——推理内容对用户不可见，只影响最终输出质量。

这一章实现 Extended Thinking 的双后端支持，并顺带解决一个架构问题：**模型能力不该靠硬编码名字判断**。

## 三种思考模式

先定义抽象。思考模式有三种：

| 模式 | 含义 | 典型场景 |
|------|------|---------|
| `adaptive` | 模型自动开启，自行决定是否使用推理 | Claude 4.x 默认 |
| `enabled` | 显式开启，推理强度拉满 | `--thinking` flag |
| `disabled` | 不支持推理的模型 | Claude 3.x、gpt-4o 等 |

项目用 `as const` 对象 + 联合类型替代 enum（Node strip-only 模式限制）：

```ts
// llm/provider.ts
export const ThinkingMode = {
  Adaptive: "adaptive",
  Enabled: "enabled",
  Disabled: "disabled",
} as const;

export type ThinkingMode = (typeof ThinkingMode)[keyof typeof ThinkingMode];
```

## 模型能力注册表：别硬编码名字判断

一开始，我按模型名硬编码判断——`isClaude4()`、`isOpenAIReasoningModel()`。很快发现这是坏味道：**加一个新模型就要改逻辑代码**，而且判断散落在 provider.ts 里。

重构：把"模型是否支持推理"变成**数据**，建一个注册表：

```ts
// llm/models.ts
export interface ModelCapabilities {
  supportsThinking?: boolean;        // 是否支持推理
  supportsAdaptiveThinking?: boolean; // 是否默认自适应
}

const MODEL_CAPABILITIES = [
  { prefixes: ["claude-4", "claude-opus-4", "claude-sonnet-4", "claude-haiku-4"],
    capabilities: { supportsThinking: true, supportsAdaptiveThinking: true } },
  { prefixes: ["o1", "o3", "o4", "gpt-5"],
    capabilities: { supportsThinking: true, supportsAdaptiveThinking: true } },
];

export function getModelCapabilities(model: string): ModelCapabilities {
  const m = model.toLowerCase();
  for (const entry of MODEL_CAPABILITIES) {
    if (entry.prefixes.some((p) => m.startsWith(p))) {
      return entry.capabilities;
    }
  }
  return {};   // 未命中 = 默认不支持（fail-safe）
}
```

**好处**：
- 新增模型只需在表里加一行，不碰逻辑
- 未知模型返回空能力（fail-safe，默认不支持推理）
- 对齐 Claude Code `/model` 的能力标记思路

## 解析思考模式

`resolveThinkingMode` 接收**能力对象**（而非模型名），逻辑纯粹：

```ts
// llm/provider.ts
export function resolveThinkingMode(
  capabilities: ModelCapabilities,
  thinkingFlag: boolean,
): ThinkingMode {
  if (!capabilities.supportsThinking) {
    return ThinkingMode.Disabled;
  }
  if (thinkingFlag) {
    return ThinkingMode.Enabled;
  }
  if (capabilities.supportsAdaptiveThinking) {
    return ThinkingMode.Adaptive;
  }
  return ThinkingMode.Disabled;
}
```

CLI 里组装：`resolveThinkingMode(getModelCapabilities(args.model), args.thinking)`。

## 双后端各自翻译

思考模式是抽象层，两个后端参数完全不同。`ChatOptions.thinkingMode` 透传给各 provider，各自翻译：

### Anthropic：`thinking` 参数（token 预算）

```ts
// llm/anthropic.ts
function toThinkingConfig(mode, maxTokens): Anthropic.ThinkingConfigParam | undefined {
  if (mode === ThinkingMode.Enabled) {
    return { type: "enabled", budget_tokens: Math.max((maxTokens ?? 4096) - 1, 1024) };
  }
  if (mode === ThinkingMode.Adaptive) {
    return { type: "enabled", budget_tokens: 10000 };
  }
  return undefined;   // disabled / 默认
}
```

- `enabled`：预算取 `maxTokens - 1`（留 1 token 给实际输出），推理强度最大化
- `adaptive`：预算固定 10000，模型自行决定

**thinking blocks 不存历史**。Anthropic 的 `Message.content` 里会混入 `thinking` 块，可能长达数千 token，对后续对话无参考价值——存进去纯浪费上下文窗口。我们的 `fromAnthropicMessage` 逐块提取 `text`/`tool_use` 时**天然忽略 thinking 块**，无需额外过滤。

### OpenAI：`reasoning_effort`（推理强度）

```ts
// llm/openaiLike.ts
function toReasoningEffort(mode): "low" | "medium" | "high" | undefined {
  if (mode === ThinkingMode.Enabled) {
    return "high";
  }
  return undefined;
}
```

**关键差异**：OpenAI 侧只有显式 `enabled` 才传 `"high"`。因为：
- `adaptive` 不传——o 系列默认就自适应推理
- `disabled` 不传——**对非推理模型（gpt-4o）传 `reasoning_effort` 会直接报错**

| `ThinkingMode` | Anthropic | OpenAI |
|----------------|-----------|--------|
| `enabled` | `thinking: {type:"enabled", budget:max-1}` | `reasoning_effort: "high"` |
| `adaptive` | `thinking: {type:"enabled", budget:10000}` | 不传（默认自适应） |
| `disabled` | 不传 | 不传 |

两种协议的语义本质不同：Anthropic 用 `budget_tokens` 控制**推理 token 预算**，OpenAI 用 `reasoning_effort` 控制**推理努力程度**。抽象层统一成 `ThinkingMode`，各自翻译——这正是 `LLMProvider` 抽象的价值。

## 运行效果

默认模型走 OpenAI 路径（deepseek 不支持推理 → `disabled`，不传 reasoning_effort），行为无变化。切换到 claude-4.x 或 o 系列，推理自动开启；`--thinking` 显式拉满。

验证 `resolveThinkingMode` 逻辑：

| 模型 | flag | 结果 |
|------|------|------|
| claude-4-5 | false | `adaptive` |
| claude-4-5 | true | `enabled` |
| o3-mini | true | `enabled` |
| gpt-4o | false | `disabled` |
| deepseek | 任意 | `disabled` |

## 小结

- 三种思考模式 `adaptive`/`enabled`/`disabled`（as const + 联合类型）
- **模型能力注册表**替代硬编码名字判断：新增模型只改数据
- `resolveThinkingMode(capabilities, flag)` 纯粹解析
- 双后端各自翻译：Anthropic `thinking`（预算）、OpenAI `reasoning_effort`（强度）
- thinking blocks 不存历史（逐块提取天然忽略）

下一章，我们让工具执行也"流式"起来——模型还在生成时，工具已经开始跑了。
