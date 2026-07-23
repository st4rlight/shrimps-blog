---
title: OpenCode 分析
createTime: 2026/07/23 10:00:00
permalink: /opencode/
---

# OpenCode 分析

这里用来整理我在阅读和分析 OpenCode 源码过程中的系统性拆解笔记。

OpenCode 是一个基于 Bun + TypeScript + Effect 框架构建的开源 Coding Agent，支持 15+ 个 LLM Provider，采用严格分层的 Monorepo 架构。

## 当前专题

### OpenCode 源码学习路径

从零开始，逐层拆解 OpenCode 的架构设计、核心循环、工具系统与会话管理——不仅告诉你"源码是什么"，更讲清楚"为什么这样设计、设计者在思考什么、做了哪些取舍"。

- [Coding Agent 设计思路全解析](./opencode-learning-guide.md) — 11 个阶段循序渐进，涵盖架构全景、Schema 层、Agent 系统、工具系统、核心循环、LLM Provider、Plugin/MCP 生态、Server 通信、配置系统与定制化开发
