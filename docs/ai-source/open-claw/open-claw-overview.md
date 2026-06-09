---
title: OpenClaw 源码分析总览
tags:
  - OpenClaw
  - AI编程工具
  - 源码分析
excerpt: OpenClaw 源码分析系列总览，介绍项目定位、六层架构概览与系列文章阅读导航。
createTime: 2026/06/07 10:00:00
permalink: /ai-source/open-claw-overview/
---

# OpenClaw 源码分析总览

> 源码分析版本：2026-06 · 核心仓库：`open-claw`

## 项目简介

OpenClaw 是一个 **local-first 的 personal AI assistant 网关**——装一个 `openclaw` CLI，启动 Gateway 守护进程，把 IM / 邮件 / 语音 / 屏幕 / 编辑器"串"成一个 agent 统一入口，支持沙箱化、限权、多端配对。

**三个"不是"**：不是 SaaS（数据留在本地）、不是 coding IDE（与 Claude Code / Cursor 能力互补）、不是通用框架（装完就能用的成品助手）。

## 整体架构

六层结构，上层依赖下层，下层不感知上层：

![OpenClaw 六层架构总览](/ai-source/open-claw/openclaw-architecture-overview.svg)

| 层级 | 名称 | 核心模块 | 一句话职责 |
|------|------|----------|-----------|
| Layer 1 | 启动 & CLI 入口 | `src/entry.ts` · `src/cli` | 渐进式加载漏斗，`--version` 零模块加载 |
| Layer 2 | Gateway 控制面 | `src/gateway` · `packages/gateway-protocol` | WS 消息总线 + 协议解释器，不是反向代理 |
| Layer 3 | Agent & Session | `src/agents` · `src/sessions` · `src/routing` | 双重队列驱动的 Agent Loop |
| Layer 4 | Context Engine & 记忆 | `src/context-engine` · `extensions/memory-*` | 可插拔上下文引擎 + 检疫降级 |
| Layer 5 | 插件 / 扩展 / Skill | `src/plugins` · `src/plugin-sdk` · `extensions/` | Manifest-First，60+ Plugin API |
| Layer 6 | Channel & 端侧设备 | `src/channels` · `apps/{ios,macos,android}` | Channel 只做消息翻译，Node 是设备节点 |

## 核心设计理念

1. **Local-first** — 数据留在本地
2. **Plugin-agnostic core** — 核心不依赖特定 SaaS，Channel/Provider 都是插件
3. **身份优先安全** — per-session sandbox，"你是谁比你做什么更重要"
4. **可插拔 Context Engine** — 崩了自动降级到 Legacy
5. **Node 设备模型** — 端侧有本地能力的节点，不是薄客户端
6. **进程稳定元数据** — 运行时冻结插件注册表，热路径不做 freshness polling

## 系列文章导航

本系列共 **8 篇文章**，建议先读第 1 篇建立整体感，再按需跳读各模块：

| 序号 | 文章 | 层级 | 关键词 |
|------|------|------|--------|
| 1 | [架构分层设计深度解析](./openclaw-architecture-analysis.md) | 全局 | 六层架构 · 消息旅程 · 设计权衡 |
| 2 | [启动与 CLI 入口架构深度分析](./openclaw-cli-startup-architecture.md) | Layer 1 | 三层漏斗 · 8 阶段流水线 · Daemon |
| 3 | [插件 / 扩展 / Skill 体系深度解析](./openclaw-plugin-skill-architecture.md) | Layer 5 | Manifest-First · 60+ API · Hook |
| 4 | [Gateway 控制面深度解析](./openclaw-gateway-architecture.md) | Layer 2 | 消息总线 · 四层认证 · 热重载 |
| 5 | [Agent & Session 模型深度解析](./openclaw-agent-session-architecture.md) | Layer 3 | Agent Loop · 双重队列 · Failover |
| 6 | [Context Engine & 记忆系统深度解析](./openclaw-context-engine-architecture.md) | Layer 4 | 可插拔引擎 · 检疫降级 · Dreaming |
| 7 | [Channel 架构深度解析](./openclaw-channel-architecture.md) | Layer 6 | Channel 抽象 · 飞书实现 · 三层可靠性 |
| 8 | [Node & 端侧设备模型深度解析](./openclaw-node-device-architecture.md) | Layer 6 | 设备节点 · system.run · 配对协议 |

**阅读路径**：

- 🏃 快速入门：1 → 按需跳读
- 🔄 对话流程：7（入站）→ 5（Agent 执行）→ 6（上下文）→ 7（出站）
- 🔌 扩展机制：3（插件体系）是理解接入外部系统的关键
