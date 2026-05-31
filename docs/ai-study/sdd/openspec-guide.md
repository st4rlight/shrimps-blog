---
title: OpenSpec 实战指南
tags:
  - OpenSpec
  - SDD
  - 规范驱动开发
  - Claude Code
excerpt: OpenSpec 是面向 AI 编码助手的轻量级规范驱动开发（SDD）框架，核心理念是"先对齐，再构建"。这篇文章系统介绍 OpenSpec 的核心理念、工作流、目录结构、命令体系和实战用法。
createTime: 2026/05/31 10:00:00
permalink: /ai-study/openspec-guide/
---

# OpenSpec 实战指南

用 AI 写代码，最怕的不是写不出来，而是写出来的和你想的不一样。

需求散落在聊天记录里，AI 的理解和你的意图总有偏差，功能越做越偏，返工越来越频繁——这是很多人用 AI 编程时的真实体验。

`OpenSpec` 就是冲着这个问题来的。它不是另一个代码生成工具，而是一套让你和 AI 在写代码之前先对齐的规范框架。

这篇文章聚焦四件事：

- `OpenSpec` 是什么，它在解决什么问题
- 核心理念与关键概念
- 完整工作流怎么走
- 实战中的典型用法和避坑经验

## 它到底是什么

`OpenSpec` 是面向 AI 编程助手的开源 SDD 框架，核心理念：**先对齐，再构建（Agree before you build）**。

### 它在解决什么问题

用 AI 编程助手开发时，有几类非常常见的问题：

- **需求模糊就开工**：需求只存在于聊天记录里，AI 的理解和你的意图经常对不上
- **上下文中毒**：无关信息污染上下文，模型误把噪声当作重要信息
- **注意力漂移**：长对话中逐渐偏离原始需求，产生幻觉或跑偏
- **结果不可预测**：同样的提示词，每次可能生成不同的代码
- **变更难以追溯**：改了什么、为什么改，缺乏结构化记录

`OpenSpec` 解决这些问题的方式，不是换一个更强的模型，而是在你和 AI 之间加一层**规范层**。让 AI 不是从你的口头描述出发，而是从一份结构化的规范文档出发。

### 和其他方案的对比

| 方案 | 特点 | 擅长场景 |
|------|------|----------|
| GitHub Spec Kit | 功能全面但重量级，有僵化的阶段关卡 | 新项目从零开始（Greenfield） |
| Kiro（AWS） | 功能强大但锁定在特定 IDE 和 Claude 模型 | 快速原型开发 |
| 不用任何规范 | 提示词模糊，结果不可预测 | — |
| **OpenSpec** | **轻量、灵活、工具无关** | **已有代码库增量开发（Brownfield）** |

`OpenSpec` 最大的差异化优势：它面向存量项目而非全新项目。对于大多数公司来说，项目早已存在，需要的是在既有代码库上安全扩展，而不是从零搭建。

---

## 核心理念

| 原则 | 英文 | 含义 |
|------|------|------|
| 灵活而非僵化 | Fluid, not rigid | 没有僵化的阶段关卡，可随时更新任何工件 |
| 迭代而非瀑布 | Iterative, not waterfall | 不要求一次写完美，支持逐步澄清和细化 |
| 简单而非复杂 | Easy, not complex | 工作流只有四步：探索 → 提案 → 实施 → 归档 |
| 面向存量项目 | Built for brownfield | 优先支持已有代码库的增量开发，而非从零搭建 |
| 可扩展 | Scalable | 从个人项目到企业级都适用，支持 25+ 种 AI 编码助手 |

---

## 关键概念

在深入工作流之前，先理解几个核心概念。

### Spec（规范）

Spec 是当前系统的行为描述，是项目的"唯一真相源"（Single Source of Truth）。它用 Markdown 文件记录系统应该做什么、怎么运作。

Spec 不是一次性写完的，它会随着每次变更不断演进。每完成一次变更，新的规范会合并到主 `specs/` 目录中。

### Change（变更）

Change 是一次待实施的变更提案，每个变更都有自己独立的文件夹，里面包含四类核心文件：

| 文件 | 作用 | 回答的问题 |
|------|------|------------|
| `proposal.md` | 变更提案 | 为什么改？改什么？ |
| `spec.md` | 规范增量 | 改完后的行为是什么？ |
| `design.md` | 技术设计 | 怎么改？用什么方案？ |
| `tasks.md` | 任务清单 | 具体分几步做？ |

### 双文件夹模型

`OpenSpec` 使用两个主要目录来组织项目：

```text
openspec/
├── specs/              # 当前真理源规范
│   └── auth/
│       └── spec.md     # 正式规范文档
├── changes/            # 变更提案
│   └── add-2fa/
│       ├── proposal.md # 变更提案
│       ├── specs/
│       │   └── auth/
│       │       └── spec.md  # 规范增量
│       ├── design.md   # 技术设计
│       └── tasks.md    # 实施任务
└── config.yaml         # 配置文件
```

- `specs/`：当前系统的规范，代表系统"应该"的行为
- `changes/`：正在进行的变更提案，完成后归档到 `changes/archive/`

这个模型的关键在于：**变更和规范分离**。每个变更都是独立的，不会互相干扰；变更完成后，规范才合并到主目录，确保 `specs/` 始终是可靠的真相源。

---

## 四步工作流

`OpenSpec` 的核心工作流可以简化为四步：

```text
┌─────────────────┐
│  1. Explore     │  ← 探索项目，理解现状
└────────┬────────┘
         ↓
┌─────────────────┐
│  2. Propose     │  ← 创建变更提案，生成四类文件
└────────┬────────┘
         ↓
┌─────────────────┐
│  3. Apply       │  ← AI 根据任务清单逐步实施
└────────┬────────┘
         ↓
┌─────────────────┐
│  4. Archive     │  ← 归档变更，更新主规范
└─────────────────┘
```

### 第一步：Explore（探索）

在提出任何变更之前，先探索项目上下文。这一步的目的是理解现状：项目结构、技术栈、现有规范、依赖关系等。

你可以用 `/opsx:explore` 命令触发，也可以在对话中让 AI 先梳理项目结构再提出方案。

### 第二步：Propose（提案）

这是最关键的一步。用自然语言描述你想要做什么，AI 会生成一份完整的变更提案，包含：

- `proposal.md`：变更意图、范围和方法
- `spec.md`：变更后的行为描述（规范增量）
- `design.md`：技术方案和架构决策
- `tasks.md`：带复选框的实施任务清单

你在这个阶段的角色是**审阅者**，确认方向正确后再进入实施。

用 `/opsx:propose` 或 `/opsx:new` 命令触发。

### 第三步：Apply（实施）

确认提案后，AI 会根据 `tasks.md` 中的任务清单逐步实现功能。每完成一个任务，就在清单中标记为完成。

用 `/opsx:apply` 或 `/opsx:continue` 命令触发。

### 第四步：Archive（归档）

所有任务完成后，归档这次变更。关键动作：

- 把 `changes/<id>` 目录移动到 `changes/archive/<id>`
- 把该变更中 `spec.md` 的内容合并到 `openspec/specs/` 目录
- 确保主规范文档始终反映系统当前的真实行为

用 `/opsx:archive` 命令触发。

---

## 安装与初始化

### 环境要求

- Node.js 版本 ≥ 20.19.0
- npm 或其他包管理器

### 安装

```bash
# npm
npm install -g @fission-ai/openspec@latest

# pnpm
pnpm add -g @fission-ai/openspec@latest

# yarn
yarn global add @fission-ai/openspec@latest

# bun
bun add -g @fission-ai/openspec@latest
```

验证安装：

```bash
openspec --version
```

### 初始化项目

```bash
cd your-project
openspec init
```

初始化时 CLI 会问你使用哪些 AI 工具（Claude Code、Cursor、Copilot 等），然后自动往对应目录写入 Skill 和斜杠命令文件。

初始化完成后，项目里多出以下结构：

```text
your-project/
├── openspec/
│   ├── config.yaml       # 核心配置
│   ├── specs/            # 规范目录
│   └── changes/          # 变更目录
└── .claude/              # Claude Code 配置（如果选择了 Claude Code）
    ├── commands/         # 斜杠命令
    └── skills/           # AI 技能模块
```

### 配置语言为中文

如果你希望 Spec 都使用中文，需要修改 `config.yaml`：

```yaml
language: zh-CN
```

### 更新

当 `OpenSpec` 包升级后，可以在项目根目录执行：

```bash
openspec update
```

这会更新配置和 Agent 文档，确保 AI 的提示词是最新的。

::: tip
`OpenSpec` 是基于项目目录工作的（spec / changes 都在这里）。每次关闭终端后，重新使用需要：重新打开终端 → 进入项目目录 → 启动 AI 工具 → 继续用 `OpenSpec`。
:::

---

## 命令体系

`OpenSpec` 提供两类触发方式：斜杠命令和 CLI 命令。

### 斜杠命令（在 AI 编码工具中使用）

| 命令 | 作用 | 何时使用 |
|------|------|----------|
| `/opsx:explore` | 探索项目，理解现状 | 开始新任务前 |
| `/opsx:propose` 或 `/opsx:new` | 创建变更提案 | 明确需求后 |
| `/opsx:apply` 或 `/opsx:continue` | 实施任务 | 提案审阅通过后 |
| `/opsx:archive` | 归档变更 | 任务全部完成后 |

这些命令的本质是让 AI 调用对应的 Skill 模块，而不是直接开始写代码。

### CLI 命令（在终端中使用）

| 命令 | 作用 |
|------|------|
| `openspec init` | 初始化项目 |
| `openspec update` | 更新配置和 Agent 文档 |
| `openspec list` | 列出所有进行中的变更（Active Changes） |
| `openspec list --specs` | 列出已归档的规范 |
| `openspec show <change-id>` | 查看某个变更的详细信息 |
| `openspec validate <change-id>` | 验证规范格式是否正确 |
| `openspec validate <change-id> --strict` | 严格模式验证（推荐 AI 使用） |
| `openspec archive <change-id>` | 归档变更 |
| `openspec archive <change-id> -y` | 自动确认归档 |
| `openspec view` | 交互式仪表盘 |

其中 `openspec show` 和 `openspec validate` 主要是给 AI 看的，AI 在执行任务时会在后台调用这些命令来读取信息和校验格式。

---

## 四类文件详解

理解变更提案中的四类文件，是用好 `OpenSpec` 的关键。

### proposal.md（变更提案）

回答三个问题：**为什么改？改什么？大致思路是什么？**

```markdown
---
change_id: add-user-login
status: proposed
created: 2026-05-31
---

# 添加用户登录功能

## 动机
当前系统没有用户认证机制，任何人都可以访问所有接口。

## 范围
- 添加 JWT 认证
- 添加登录 / 登出接口
- 添加权限中间件

## 方法
使用 JSON Web Token 实现无状态认证。
```

### spec.md（规范增量）

描述变更完成后的系统行为，是**可验证的行为描述**。

```markdown
# 用户认证规范

## 登录
- POST /api/auth/login
- 请求体：{ email, password }
- 成功返回：{ token, expiresIn }
- 失败返回：401 Unauthorized

## 权限校验
- 所有 /api/* 接口需携带 Authorization: Bearer <token>
- 无效或过期 token 返回 401
- 权限不足返回 403
```

### design.md（技术设计）

描述**怎么实现**，包括技术选型、架构决策、影响范围等。

```markdown
# 用户登录技术设计

## 技术选型
- JWT 库：jsonwebtoken
- 密码哈希：bcrypt

## 架构变更
- 新增 middleware/auth.js
- 修改 routes/*.js 添加认证中间件

## 影响范围
- 所有现有 API 接口需添加认证
- 需要数据库新增 users 表
```

### tasks.md（任务清单）

带复选框的实施步骤，AI 会按顺序逐项完成。

```markdown
# 实施任务

- [ ] 创建 users 数据模型
- [ ] 实现 POST /api/auth/register 接口
- [ ] 实现 POST /api/auth/login 接口
- [ ] 添加 JWT 认证中间件
- [ ] 给所有 /api/* 路由添加认证中间件
- [ ] 补充单元测试
- [ ] 补充集成测试
```

---

## 实战场景

不同类型的任务，`OpenSpec` 的使用方式会有差异。

### 场景一：给现有项目添加新功能

这是 `OpenSpec` 最擅长的场景。存量项目有历史包袱，代码模式、架构风格、依赖版本都是真实约束。`OpenSpec` 在这类场景下的核心原则是：**入乡随俗**。

典型流程：

1. 用 `/opsx:explore` 先摸清项目结构、现有代码模式
2. 用 `/opsx:propose` 提出变更，提案中明确遵循现有架构风格
3. 审阅提案时重点检查：是否遵循了现有代码模式？有没有引入不必要的依赖？
4. 用 `/opsx:apply` 逐步实施，AI 会参照 `design.md` 中的方案
5. 完成后用 `/opsx:archive` 归档

**示例：给现有 Node.js 项目增加 PDF 导出功能**

```text
你：/opsx:new 给项目增加 PDF 导出功能

AI：好的，我先了解一下项目现状...
    （探索项目结构，识别技术栈、现有导出能力、接口风格）

AI：我已经了解了项目情况，现在生成变更提案...
    → proposal.md：为什么加、加什么
    → spec.md：导出接口的行为描述
    → design.md：用 pdfkit 还是 puppeteer，怎么复用中间件
    → tasks.md：拆成路由改造、模板生成、测试补充等小步骤

你：（审阅提案，确认方向正确）

你：/opsx:apply

AI：正在逐项实施...
    ✓ 创建 PDF 生成服务
    ✓ 添加导出路由
    ✓ 补充测试
    所有任务完成！

你：/opsx:archive

AI：变更已归档，规范已更新到 specs/ 目录。
```

### 场景二：从零开始新项目

新项目最怕的不是"写不出来"，而是"写偏了"。`OpenSpec` 在新项目场景下同样适用，重点是前期多花时间在提案审阅上。

- `proposal.md` 中的架构选型和技术栈决策，一定要仔细审阅
- `spec.md` 中的行为描述，要覆盖所有核心场景
- `tasks.md` 中的任务粒度，建议拆到每个任务 2 到 5 分钟可完成的程度

### 场景三：修复 Bug

修复 Bug 时，可以走精简流程：

```text
/opsx:new 修复用户登录失败的问题
```

AI 会生成对应的提案，`spec.md` 中会描述修复后的预期行为，`tasks.md` 中会包含定位根因、添加复现测试、实施修复等步骤。

关键点：修复 Bug 时，`spec.md` 中的行为描述要明确"修复后应该是什么行为"，而不仅仅是"修了什么"。

---

## OpenSpec 与 Superpowers 的关系

如果你同时在用 `Superpowers`，可以这样理解两者的关系：

- `OpenSpec` 是**需求层**，解决"做什么"的问题——把需求变成结构化的制品（proposal / spec / design / tasks）
- `Superpowers` 是**工程层**，解决"怎么做好"的问题——隔离工作区、子代理执行、TDD、代码审查、分支收尾

两者可以联合使用：

```text
┌──────────────────────────────────────────────────────────┐
│  OpenSpec（需求层）                                        │
│                                                          │
│  explore → propose → continue → apply → verify → archive │
│                                                          │
│  制品 = 持久化的需求记忆                                    │
│  tasks.md = 进度跟踪                                      │
└──────────────┬───────────────────────────────────────────┘
               │
               ↓
┌──────────────────────────────────────────────────────────┐
│  Superpowers（工程层）                                     │
│                                                          │
│  brainstorming → git-worktree → writing-plans             │
│  → subagent-driven-dev → TDD → code-review               │
│  → verification → finishing-branch                       │
└──────────────────────────────────────────────────────────┘
```

联合使用时，`OpenSpec` 的提案和任务可以作为 `Superpowers` 的输入，让工程流程有据可依。

---

## 最佳实践

### 提案阶段多花时间

在 `/opsx:propose` 阶段，不要急着进入实施。多花时间审阅提案，确认方向正确。前期多花的每一分钟，通常都能从后期返工里省回来。

### 任务粒度要适中

`tasks.md` 中的任务粒度非常关键：

- 太大了：AI 容易跑偏，一个任务可能包含多个不相关的改动
- 太小了：增加切换成本，AI 需要频繁重新加载上下文
- 建议：每个任务 2 到 5 分钟可完成，短小但完整

### Spec 写行为，不写实现

`spec.md` 应该描述系统"应该做什么"，而不是"怎么做"。实现细节放在 `design.md` 里。

好的 Spec：

```markdown
## 登录
- POST /api/auth/login
- 成功返回 200 和 token
- 失败返回 401
```

不好的 Spec：

```markdown
## 登录
- 用 bcrypt 验证密码
- 用 jsonwebtoken 生成 token
- 把 token 存到 Redis 里
```

后者是实现细节，属于 `design.md` 的内容。

### 定期归档

完成变更后及时用 `/opsx:archive` 归档。不要让 `changes/` 目录堆满已完成的变更，这会让 AI 上下文变长，影响效率。

### 验证规范格式

在关键节点使用 `openspec validate <change-id> --strict` 验证规范格式。格式错误可能导致 AI 读取规范时解析异常。

### 利用 Explore 先理解再动手

在提出任何变更之前，先 `/opsx:explore`。尤其是在存量项目中，先理解现有代码模式、架构风格和技术栈，才能提出合理的变更方案。

---
