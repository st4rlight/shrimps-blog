---
title: 05. 终端 UI：真实 Claude Code 比这多做了什么
tags:
  - st4rlight-code
  - 终端 UI
  - React Ink
  - JSONL
  - 可观察的自主性
excerpt: 对比我们的 readline + 几行打印和真实 Claude Code 的终端 UI 框架：React/Ink 组件模型、可观察的自主性、工具 4 态渲染、JSONL 追加式会话存储，以及为什么终端原生是主动选择。
createTime: 2026/08/23 10:00:00
permalink: /st4rlight-code/05-terminal-ui/
---

# 05. 终端 UI：真实 Claude Code 比这多做了什么

前四章我们一路把 agent 循环、工具、提示词、会话都跑通了。但停下来看一眼终端：**我们的界面是一个 readline 加几行打印**。真实 Claude Code 的界面是一整套跑在终端里的 UI 框架——差距全在「让它在真实终端里稳、好用、崩不坏」这些地方。这一章拆开看差距，也看看我们已做的一小步。

## 先看看我们做了什么：ui.ts

上一轮我们把输出从散落的 `console.log` 收拢成统一的 `src/config/ui.ts`。三个设计点：

### 工具图标 + 摘要

每个工具一个 emoji，参数里挑关键字段做一行摘要，而不是整段 JSON：

```ts
// src/config/ui.ts
const TOOL_ICONS: Record<string, string> = {
  read_file: "📖",
  write_file: "✍️",
  run_shell: "💻",
  grep_search: "🔍",
  // ...
};

export function printToolCall(name: string, input: Record<string, unknown>): void {
  const icon = TOOL_ICONS[name] ?? "🔧";
  const summary = getToolSummary(name, input);   // 按工具挑关键字段
  console.error(`\n  ${icon} ${name} ${summary}`);
}
```

实际效果：

```
📖 read_file src/app.ts
💻 run_shell npm test
🧮 calculator 100 add 456
```

### UI 层截断，不动消息历史

工具结果在展示层截断到 500 字符——**这是给人看的显示**，完整结果仍在消息历史里，发给模型的上下文不受影响：

```ts
export function printToolResult(result: string): void {
  const maxLen = 500;
  const truncated = result.length > maxLen
    ? result.slice(0, maxLen) + `\n  ... (${result.length} chars total)`
    : result;
  console.error(truncated.split("\n").map((l) => `  ${l}`).join("\n"));
}
```

这是我们向"可观察的自主性"迈出的一小步——但和真实 Claude Code 比，只是冰山一角。

## 终端原生 vs GUI：一个主动选择

Claude Code 选择跑在终端里，不是技术妥协，而是**主动的产品决策**。开发者的工作流本来就在终端里，打开浏览器意味着一次上下文切换。终端原生的含义是：它就是一个命令行工具，跟 `git`、`grep` 一样嵌进你已有的工作流。

具体好处：

| 好处 | 说明 |
|------|------|
| **SSH 环境可用** | 服务器上没有浏览器，但有终端；远程开发是硬场景 |
| **可接管道** | `echo "fix this" \| claude` —— 和其他 CLI 组合成流水线 |
| **tmux 多实例并行** | 多个会话并行跑，互不干扰 |
| **内存开销接近零** | 没有 Electron/浏览器进程，轻量启动 |

这个决策也反过来约束了 UI 的上限：**所有交互都发生在 ANSI 字符流里**。于是有了下一个问题——怎么在字符终端里做出复杂交互。

## React/Ink：把组件模型搬进终端

Claude Code 的入口是 `src/entrypoints/cli.tsx`——用 **React/Ink** 把组件模型搬进终端。

为什么需要它？因为终端限制多：没有 DOM、没有布局引擎、光标控制全靠 ANSI 序列。想在终端里做流式 Markdown 渲染、Vim 模式、多 Tab、键盘自定义，靠"往 stdout 打印字符串"会迅速失控。

React 组件模型的价值在于**声明式地描述 UI 状态**：

- 流式输出时，一个 `<StreamingMarkdown>` 组件反复重渲染，追加 token
- diff 视图、工具执行状态、权限弹窗都是独立组件
- 状态变更驱动重渲染，而不是手动拼 ANSI

我们呢？`readline` 读一行 + `printXxx` 打印几行。能跑，但**没有组件模型，复杂交互无从谈起**。这不是"再加几行代码"的差距，是**架构层**的差距。

## 可观察的自主性：UX 的核心理念

Claude Code 的 UX 核心理念一句话：**Agent 自由行动，但让用户实时看到每一步**。

```
📖 read_file src/app.ts
  1 | import express from ...
  ... (1234 chars total)

✏️ edit_file src/app.ts
  - const port = 3000
  + const port = process.env.PORT
```

为什么"看得见"这么重要？因为**中断成本远低于撤销成本**：

- 用户在 Agent 走错方向前 **3 秒**就能按 Ctrl+C 打断
- 而不是等 **20 秒**执行完，再花更多时间撤销

这和我们 04 章做的 Ctrl+C 双语义是同一个动机——处理中按一下中断，空闲按两下退出。但真实 Claude Code 的"可观察"比我们细得多：

| 渲染维度 | 我们 | Claude Code |
|---------|------|-------------|
| 工具调用 | 一行图标 + 摘要 | 每个工具 **4 种渲染方法**（开始/完成/被拒/报错） |
| 执行过程 | 等执行完才展示结果 | 长时间运行的工具**实时流式输出 stdout** |
| 输出格式 | 纯文本截断 | 文件带行号、diff 带 `-`/`+` 着色 |

关键点是 **4 种渲染方法**：工具不是"开始 → 结束"两个状态，而是有"被拒"（权限拦截）、"报错"（执行失败）这些独立视觉状态，用户一眼能看出 Agent 卡在哪、被什么拦住了。

## JSONL 会话存储：崩溃安全 + O(1) 写入

04 章我们用的是**整体 JSON 覆盖写入**：每轮把整个消息数组 `JSON.stringify` 写回一个文件。这个方案有两个真实问题：

1. **写入中途崩溃会损坏整个文件**——写了一半断电，整份会话废了
2. **对话越长每次保存越慢**——几千条消息每次全量序列化

Claude Code 用 **JSONL**（每行一个 JSON 对象）解决：

| 维度 | 我们的 JSON 覆盖 | Claude Code JSONL |
|------|-----------------|-------------------|
| 写入方式 | 整份重写 | 每轮追加一行 |
| 写入成本 | O(消息数) | **O(1)** |
| 崩溃安全 | 写一半毁整份 | 最多丢最后一行 |
| 恢复 | 解析整个文件 | 逐行解析，**跳过末尾不完整的行** |

原理很简单：**文件系统的 append 操作通常是原子的**。追加一行要么成功要么失败，不会出现"半个文件"。恢复时逐行 `JSON.parse`，遇到最后一行解析失败就跳过——崩溃最多丢最后一条消息，而不是一整份会话。

> 这也提醒我们 04 章的简化代价：全量覆盖 + 单文件，在"教程跑通"的规模下没问题，但离"崩不坏"还差一个设计。

## 差距总结

| 维度 | 我们 | Claude Code | 差距本质 |
|------|------|-------------|---------|
| UI 层 | readline + 打印 | React/Ink 组件模型 | 架构层，不是加代码 |
| 工具渲染 | 1 种（一行打印） | 4 种状态渲染 + 流式 stdout | 可观察粒度 |
| 会话存储 | JSON 全量覆盖 | JSONL 追加式 | 崩溃安全 + O(1) |
| 中断 | Ctrl+C 双语义 | 同样理念 + 更细的状态 | 理念已对齐，实现待补 |
| 交互 | 单行输入 | Vim 模式 / 多 Tab / 键盘自定义 | 终端 UI 天花板 |

**一句话**：我们证明了"最小可用"能跑通，Claude Code 证明了"在真实终端里稳、好用、崩不坏"需要一套完整的 UI 工程。差距不在某个功能点，而在**是否把终端 UI 当成一等公民来设计**。

## 小结

- 我们的 `ui.ts` 是"可观察的自主性"的第一小步：图标、摘要、展示层截断
- 终端原生是主动选择（SSH/管道/tmux/轻量），约束了 UI 的形态
- React/Ink 用组件模型解决终端交互复杂度，我们缺这一层
- JSONL 追加式存储解决崩溃安全 + O(1) 写入，我们的 JSON 覆盖是简化代价

下一章，我们把会话存储从 JSON 覆盖升级到 JSONL 追加式，真正跨过"崩不坏"这道线。
