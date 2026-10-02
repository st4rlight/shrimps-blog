---
title: AI源码分析
createTime: 2026/06/07 16:30:00
permalink: /ai-source/
---

# AI源码分析

这里用来整理我在阅读和分析 AI 编程工具源码过程中的系统性拆解笔记。

和 AI 学习中的实践类内容不同，这里专注于源码级别的深度分析，从架构设计、核心模块到关键机制，帮助深入理解工具的内部工作原理。

## 当前专题

### Claude Code 源码分析

这一部分主要记录 `Claude Code` 的工作机制、源码行为和上下文管理相关内容。

- [上下文压缩机制与缓存命中率深度分析](./claude-code/context-compression-and-cache-analysis.md)
- [System Prompt 内容与注入机制深度分析](./claude-code/system-prompt-and-injection-analysis.md)

### DeepAgents源码分析

这一部分主要记录 `DeepAgents` 多 Agent 协作框架的源码分析，从架构设计、核心模块到关键机制的系统性拆解。

- [DeepAgents 源码分析总览](./deep-agents/deep-agents-overview.md)

### OpenClaw源码分析

这一部分主要记录 `OpenClaw` 开源 AI 编程工具的源码分析，从架构设计、核心模块到关键机制的系统性拆解。

- [OpenClaw 源码分析总览](./open-claw/open-claw-overview.md)
- [架构分层设计深度解析](./open-claw/openclaw-architecture-analysis.md) — 六层架构全局观、一条消息的完整旅程、六个关键设计权衡
- [启动与 CLI 入口架构深度分析](./open-claw/openclaw-cli-startup-architecture.md) — 三层入口漏斗、8 阶段流水线、Daemon 服务管理
- [插件 / 扩展 / Skill 体系深度解析](./open-claw/openclaw-plugin-skill-architecture.md) — Manifest-First 设计、60+ Plugin API、Skill 与 Hook 系统
- [Gateway 控制面深度解析](./open-claw/openclaw-gateway-architecture.md) — 消息总线、WS 线协议、四层认证、配置热重载
- [Agent & Session 模型深度解析](./open-claw/openclaw-agent-session-architecture.md) — Agent Loop、双重队列、Failover、Session 路由
- [Context Engine & 记忆系统深度解析](./open-claw/openclaw-context-engine-architecture.md) — 可插拔上下文引擎、记忆插件、Dreaming 机制
- [Channel 架构深度解析](./open-claw/openclaw-channel-architecture.md) — Channel 抽象、Feishu 插件实现、入站三层可靠性防御
- [Node & 端侧设备模型深度解析](./open-claw/openclaw-node-device-architecture.md) — 设备节点模型、system.run 审批策略、设备配对协议

## 后续计划

后面如果继续新增 AI 源码分析内容，我会按专题继续往下整理，比如：

- `Claude Code` 的更多机制分析
- `DeepAgents` 的更多源码分析
- 其他 AI 编程工具的源码分析
