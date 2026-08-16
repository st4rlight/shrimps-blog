---
title: 01. 项目现状总览
tags:
  - st4rlight-code
  - TypeScript
  - Agent
  - 项目盘点
excerpt: 盘点 st4rlight-code 目前已经实现的功能：从技术栈、目录结构、消息模型、LLM 抽象、Agent 循环、内置工具到日志提示，全面梳理当前的项目能力与设计决策。
createTime: 2026/08/16 10:30:00
permalink: /st4rlight-code/01-project-overview/
---

# 01. 项目现状总览

这一篇盘点一下 `st4rlight-code` **目前已经实现的内容**。它不是最终形态，而是记录"现在站在哪里"，方便后续在此基础上持续迭代。

## 项目目标

用 TypeScript 从零构建一个类似于 **Claude Code** 的 AI 编码助手 CLI。核心能力是：

- 通过对话驱动模型
- 让模型能调用工具（读文件、计算等）解决真实问题
- 最终演进为能在终端里执行编码任务的 Agent

## 技术栈

| 项 | 选型 |
|----|------|
| 语言 | TypeScript 5.x（严格模式） |
| 模块 | ESM（`"type": "module"`） |
| 运行 | Node 原生运行 TS（strip-only，无编译步骤） |
| LLM 协议 | openai-like（OpenAI 兼容接口） |
| 当前模型 | `deepseek-v4-flash`（经 tokenhub 网关） |
| 运行时依赖 | 仅 `openai` |

## 目录结构

```
src/
├── config/
│   ├── env.ts         # 轻量 .env 加载器
│   └── logger.ts      # 彩色日志（工具调用/结果/回复提示）
├── llm/
│   ├── provider.ts    # LLMProvider 抽象接口
│   └── openaiLike.ts  # openai-like 协议实现
├── models/
│   ├── message.ts     # Message 可辨识联合（4 种角色）
│   └── tool.ts        # 工具类型（ToolDefinition/ToolCall/ToolResult）
├── tools/
│   └── builtin/
│       ├── index.ts      # 内置工具聚合 + 执行器
│       ├── readFile.ts   # read_file 工具
│       └── basicTools.ts # calculator + get_now 工具
├── agent.ts           # Agent 类：工具调用循环
└── index.ts           # CLI 入口
```

## 已实现的功能模块

### 1. 消息模型（models/message.ts）

用**可辨识联合（Discriminated Union）**建模消息：

- `BaseMessage` 基础接口持有公共字段 `role`、`content`
- 四种角色通过继承扩展，用 `role` 字面量区分：
  - `SystemMessage` / `UserMessage` — 仅公共字段
  - `AssistantMessage` — 可携带 `toolCalls?: ToolCall[]`
  - `ToolMessage` — **组合** `result: ToolResult`（组合优于继承）
- `Role` 用 `as const` 对象 + 联合类型（因为 Node strip-only 不支持 enum）

```ts
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;
```

### 2. 工具类型（models/tool.ts）

- `ToolDefinition`：name / description / parameters（JSON Schema）
- `ToolCall`：id / name / arguments
- `ToolResult`：toolCallId / name / content
- `ToolExecutor`：`(name, args) => Promise<string> | string`

> 设计决策：执行器入参用 `(name, args)` 分开传、返回 `string`。因为采用"一个执行器 + name 分发"的架构，执行器需要靠 `name` 做 switch 分发到具体工具。（与 Vercel AI SDK 的 `(args, options) => RESULT` 不同，详见后文对比）

### 3. LLM 抽象（llm/）

- `LLMProvider` 抽象接口：`chat(messages, options) => Promise<ChatCompletion>`
- `ChatOptions` 支持 `tools`；`ChatCompletion` 支持 `toolCalls`
- `OpenAILLMProvider` 实现内部 `Message` ↔ OpenAI 协议消息的双向转换
- 通过实现 `LLMProvider` 接口可接入其他协议（Anthropic 等），无需改动 agent

### 4. Agent 循环（agent.ts）

`Agent` 类实现工具调用循环：

```
用户消息 → 模型推理
        → 有工具调用？→ 逐个执行 → 结果喂回 → 循环
        → 无工具调用？→ 返回最终文本
```

- `MAX_ITERATIONS = 10` 循环保护，防止死循环
- 自动维护消息历史

> **对比 Claude Code**：真实 Claude Code 的循环有 7 种继续方式（含各类错误/边界恢复），我们当前只实现了最基本的"模型调工具就继续"这一种。其余 6 种已记录在 `PROGRESS.md` 待后续实现。

### 5. 内置工具（tools/builtin/）

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `read_file` | 读取文件，带行号输出 | `file_path` |
| `calculator` | 四则运算 | `op`/`a`/`b` |
| `get_now` | 获取时间，支持格式 | `format` |

### 6. 日志提示（config/logger.ts）

- **青色** `⏱ 调用工具 {name} {args}` — 工具被调用
- **绿色** `✓ 工具结果 {name} {result}` — 工具执行完成
- **品红加粗** `🤖 st4rlight` — 模型最终回复
- 输出到 stderr，避免污染 stdout

### 7. 配置加载（config/env.ts）

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

模型能识别问题、调用多个工具、汇总结果，一个最小可用的编码助手雏形已经跑通。

## 构建过程中沉淀的关键约定

1. **Node strip-only 限制**：不可用 `enum`/`namespace`/带默认值的参数属性，用 `as const` + 联合类型替代
2. **组合优先于继承**：`ToolMessage` 组合 `ToolResult`
3. **`.env` 不入库**，提供 `.env.example` 模板
4. **参数读取**：`process.argv.slice(2).join(" ")` 支持带空格的完整句子

## 下一步迭代方向

当前是最小可用版本，后续主要补齐：

- 交互式终端循环（而非单次消息）
- 流式输出
- 更多内置工具（list_dir、write_file、execute_command 等）
- 循环错误恢复（Claude Code 的 6 种边界情况）
- 流式工具执行（StreamingToolExecutor）

---

> 后续文章会围绕这些模块逐一深入：项目初始化细节、消息模型设计、LLM 抽象、工具调用循环的实现过程与踩坑。
