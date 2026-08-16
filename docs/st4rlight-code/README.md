---
title: st4rlight-code 构建笔记
createTime: 2026/08/16 10:00:00
permalink: /st4rlight-code/
---

# st4rlight-code 构建笔记

这是我从零开始用 TypeScript 构建一个类似于 **Claude Code** 的 AI 编码助手 CLI 的完整记录。

我把整个构建过程拆成一篇篇文章，记录每一步的设计决策、代码实现、踩过的坑，以及和真实 Claude Code 的对比思考。

## 文章目录

### 一、Agent 循环
- [01. Agent 循环](./01-agent-loop.md)

### 二、起步与基础
- [02. 项目初始化](./02-project-init.md)
- [03. 工具调用循环](./03-tool-calling-loop.md)

### 三、模型与消息模型
- [04. 模型抽象与消息模型设计](./04-model-and-message.md)

## 关于这个项目

- **项目地址**: [st4rlight-code](https://github.com/st4rlight/st4rlight-code)
- **技术栈**: TypeScript + OpenAI 兼容协议
- **运行方式**: Node 原生运行 TS（无编译步骤）
- **当前进度**: 已实现消息模型、LLM 抽象、工具调用循环、3 个内置工具、日志提示

## 构建思路

和真实的 Claude Code 相比，我采用"**先跑通最小可用版本，再逐步补齐高级机制**"的策略：

1. 先用最简单的方式跑通 `用户消息 → 模型回复` 的闭环
2. 再抽象模型层，支持适配不同协议
3. 然后加工具能力，实现"模型能调用工具解决真实问题"
4. 最后对比真实 Claude Code，逐步补齐循环恢复、流式执行等高级机制

这种从简到繁的构建路径，能让每一步都有可运行、可验证的结果。
