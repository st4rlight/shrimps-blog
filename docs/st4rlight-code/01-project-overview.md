---
title: 01. 项目现状总览
tags:
  - st4rlight-code
  - Agent
  - 项目盘点
excerpt: st4rlight-code 目前实现的功能清单：消息模型、LLM 抽象、Agent 工具调用循环、内置工具、日志提示、配置加载，以及运行效果演示。
createTime: 2026/08/16 10:30:00
permalink: /st4rlight-code/01-project-overview/
---

# 01. 项目现状总览

## 消息模型

- `BaseMessage` 基础接口持有公共字段 `role`、`content`
- 四种角色通过继承扩展，用 `role` 字面量区分：`SystemMessage`、`UserMessage`、`AssistantMessage`（可携带 `toolCalls`）、`ToolMessage`（组合 `result: ToolResult`）
- `Role` 用 `as const` 对象 + 联合类型

```ts
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;
```

## 工具类型

- `ToolDefinition`：name / description / parameters（JSON Schema）
- `ToolCall`：id / name / arguments
- `ToolResult`：toolCallId / name / content
- `ToolExecutor`：`(name, args) => Promise<string> | string`

## LLM 抽象

- `LLMProvider` 接口：`chat(messages, options) => Promise<ChatCompletion>`
- `ChatOptions` 支持 `tools`；`ChatCompletion` 支持 `toolCalls`
- `OpenAILLMProvider` 实现 `Message` ↔ OpenAI 协议消息的双向转换

## Agent 工具调用循环

```
用户消息 → 模型推理
        → 有工具调用？→ 逐个执行 → 结果喂回 → 循环
        → 无工具调用？→ 返回最终文本
```

- `MAX_ITERATIONS = 10` 循环保护
- 自动维护消息历史

## 内置工具

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `read_file` | 读取文件，带行号输出 | `file_path` |
| `calculator` | 四则运算 | `op`/`a`/`b` |
| `get_now` | 获取时间，支持格式 | `format` |

## 日志提示

- **青色** `⏱ 调用工具 {name} {args}`
- **绿色** `✓ 工具结果 {name} {result}`
- **品红加粗** `🤖 st4rlight`（模型回复）

## 配置加载

- 启动自动读取 `.env`
- 校验 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 缺一不可
- 可选 `MODEL`（默认 `deepseek-v4-flash`）

## 运行效果

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
