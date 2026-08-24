---
title: Grill Me 技能详解
tags:
  - Grill Me
  - SDD
  - 规范驱动开发
  - Claude Code
  - Matt Pocock
excerpt: Grill Me 是 Matt Pocock 最火的 AI Skill，用 7 行 markdown 让 AI 在写代码前连续拷问你的计划、设计和边界条件，直到双方对同一个 design concept 达成共识。这篇文章拆解它的工作原理、Skill 全文逐句解读、与 Plan Mode 的差异，以及怎么扩展到非编程场景。
createTime: 2026/08/24 15:30:00
permalink: /ai-study/grill-me-guide/
---

# Grill Me 技能详解

用 AI 写代码，最怕的不是写不出来，而是写出来的和你想的不一样。

你脑子里以为很清楚的需求，让 AI 一写出来——完全不是那回事。Matt Pocock 在演讲里描述过这种体感：让 AI 写个功能，跑起来一看不对，改一下更差，再改直接变成垃圾代码。问题不在 AI 不会写代码，而在 **需求还没对齐，AI 已经把代码写完了**。

`Grill Me` 就是冲着这个问题来的：它让 Claude Code 在动手前先拷问你 20~100 个问题，把脑子里的模糊需求逼清楚，直到你和 AI 对同一个设计概念达成共识。

这篇文章聚焦四件事：

- `Grill Me` 是什么，它背后的理论依据
- 7 行 Skill 全文逐句拆解
- 怎么装、怎么用、配合哪些 skill 更佳
- 和 Plan Mode 的差异、使用边界与我的判断

## 它是什么

**Grill Me 是一个用于需求澄清和方案拷问的 AI Skill**：它让 Claude Code 在写代码前连续追问你的计划、设计和边界条件，直到你和 AI 对同一个 design concept 达成共识。

它解决的不是「AI 代码写得不够快」，而是另一个更常见的问题：**需求还没对齐，AI 已经把代码写完了**。

> 没有人确切知道自己想要什么。
>
> —— David Thomas & Andrew Hunt《程序员修炼之道》

### 为什么会这样：design concept 跑偏

Matt 引用 Frederick P. Brooks 在《The Design of Design》里的 **design concept**（设计概念）：

> 当多人合作设计一个东西时，你们之间会有一个**正在被造出来的东西**——它在脑子里飘着，是个隐形的「关于这个东西的理论」。它不是 asset，不是塞进 markdown 文件的资产，而是看不见的共识。

AI 一上来就动手写代码，意味着它根本没和你共享同一个 design concept。代码写出来错的不是语法，是**前提**。

要修这个问题，得在动手前先做 design concept 对齐。Brooks 给的工具叫 **design tree**——把一个决策拆成多分支，每个分支再拆。你不能跳过上游决策直接做下游决策，否则上游一变下游全要重做。

## Skill 全文逐句拆解

Matt 在 [`mattpocock/skills`](https://github.com/mattpocock/skills) 里给这套理论的实现是 `productivity/grill-me/SKILL.md`，整个文件加 frontmatter 也不到 15 行：

```markdown
---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach
a shared understanding. Walk down each branch of the design tree,
resolving dependencies between decisions one-by-one. For each question,
provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the
codebase instead.
```

逐句解读：

- **"interview me relentlessly"** —— 关键词是 *relentlessly*（不放过）。LLM 默认有个倾向是问 1~2 个问题就觉得「差不多了」开始动手。这个词强行压住这个倾向。
- **"walk down each branch of the design tree"** —— Brooks 的 design tree 概念。强迫 Claude 把你的需求当作树，先解上游再解下游。如果你说「做登录」，它会先问「鉴权方式」（树根），再根据你的回答展开「session 怎么管」/「token 怎么存」（子节点）。
- **"resolving dependencies between decisions one-by-one"** —— 显式禁止打包提问。决策之间常有依赖（选了 SSO，下游就不需要密码策略问题），先确定上游能砍掉一堆下游问题。
- **"for each question, provide your recommended answer"** —— 关键加分项。AI 不只是问，还要给推荐答案。你只要点头/否决，省下 80% 输入时间。
- **"ask the questions one at a time"** —— 防止 AI 一次甩 10 个问题让你头大。
- **"if a question can be answered by exploring the codebase, explore the codebase instead"** —— 如果是项目内已有的事实（比如「项目用的什么测试框架」），让 Claude 自己看，不要问你。

7 行内容，但每一句都对应一个具体的 LLM 行为偏差。

## 怎么装、怎么用

**安装**：

```bash
npx skills@latest add mattpocock/skills
```

勾选 `grill-me` 和 `setup-matt-pocock-skills`（grill-me 不依赖后者，但其他 skill 依赖，建议一起装）。

**调用**：在 Claude Code 对话里输入 `/grill-me`。

**典型流程**：

1. 你描述一个想做的事，可以很模糊（「我想给博客加个评论功能」）
2. 输入 `/grill-me`
3. Claude 开始一题一题问，每题都给推荐答案
4. 你逐题回答（点头 / 否 / 改）
5. 一般 20~50 个问题之后达成共识，Claude 给你一个总结
6. 总结可以直接喂给 `/to-prd` 变成 PRD，或者直接交给 `/tdd` 开始写

### 真实案例：一个问题能值几百行代码

Matt 在《5 Agent Skills I Use Every Day》里给了几个具体数字：

- **新增视频编辑器功能** —— 16 个问题就达成共识
- **复杂功能** —— 30~50 个问题
- **极端复杂的** —— 100 个问题，session 长达 45 分钟

问题样例（从 Matt 的视频/博文还原）：

- "Should video clips be reorderable, or only added/removed in sequence?"
- "When a clip is deleted, do we keep its source file, or delete the file too?"
- "Does the editor need undo/redo? How many steps deep?"
- "Should we render previews in the browser, or rely on a backend service?"

这些问题没有一个是技术问题——全是产品决策。但**每一个决策都决定了几百行代码的形态**。如果你跳过这些问题让 AI 直接写，它会自己脑补一套答案，写完你再回来一个个驳回。

## 和 Plan Mode 的差异

Claude Code 自带 `plan mode`（按 Shift+Tab 进入）。表面看上去和 grill-me 类似——都是先讨论再动手。但 Matt 在演讲里直接说他更喜欢 grill-me：

> 别杠我，但我个人认为这比我用的工具（Claude Code）自带的 plan mode 更好。Plan mode 太急着产出 asset 了。它真的就是想赶紧出一个 plan 然后开干。我觉得先达成共享设计概念会舒服得多。

| 维度 | Plan Mode | Grill Me |
|---|---|---|
| 默认目标 | 尽快产出可执行 plan | 先达成共识，plan 是副产物 |
| 提问数量 | 0~5 个 | 20~100 个 |
| 提问形式 | 一次问一段 | 一次问一题 |
| 是否给推荐答案 | 否 | 是 |
| 是否探索代码库 | 偶尔 | 主动（明确指令） |
| 适合场景 | 已经想清楚，想确认实现方案 | 还没想清楚，需要被逼着想清楚 |

最大的实际差异是「**急不急**」。Plan mode 急着开干，grill-me 不急——它把「想清楚」当作主任务而不是序章。

## 进阶用法

### 1. 非编程场景

`grill-me` 不绑定代码，纯产品决策对话也能用。Matt 自己用它做：

- 课程大纲设计
- 文章写作
- 内部沟通文档

只要你脑子里有个模糊的想法、想被逼着想清楚，就能用。

### 2. 配合 `/to-prd`

grill-me session 结束后，直接说 `/to-prd`，Claude 会把整段对话浓缩成结构化 PRD（含 user story、模块拆分、测试策略），并提交到你的 issue tracker。**关键点：不要在中间清 context**——to-prd 是从对话上下文里直接提取，不会再问你一遍。

### 3. 配合 `/grill-with-docs`

如果项目已经有 `CONTEXT.md`（领域语言）和 `docs/adr/`（架构决策），用 `/grill-with-docs` 替代 `/grill-me`。它会在拷问的同时**同步更新 CONTEXT.md**——决策一边做、文档一边更，不再有「文档永远过时」问题。

### 4. 自定义提问深度

如果你时间紧，可以在 `/grill-me` 之后直接补一句：「Limit to 10 questions, focus only on architecture decisions.」 它会按你的限制收敛。但 Matt 不推荐——他认为「问得多」恰恰是这个 skill 的价值，砍掉就和 plan mode 差不多了。

## 使用边界

Grill Me 的价值来自「提前暴露决策树」，所以它并不是越多用越好。判断标准很简单：**如果这个任务失败后的返工成本很低，就不要用；如果失败后会牵连产品逻辑、数据模型、权限边界或用户流程，就应该先被拷问。**

| 任务类型 | 是否建议用 Grill Me | 原因 |
|---|---|---|
| 改 typo、调文案、删 console.log | 不建议 | 决策空间太小，提问成本高于返工成本 |
| 加一个独立 UI 小组件 | 看情况 | 如果只影响局部，可以直接做；如果涉及状态、权限、埋点，建议先问 |
| 新增评论、登录、支付、导入导出功能 | 建议 | 上游决策会影响数据库、权限、错误处理和测试策略 |
| 重构已有模块 | 强烈建议 | 需要先确认行为兼容性、迁移路径和回滚方案 |
| 写 PRD、课程大纲、内部方案 | 建议 | 它能把隐含假设问出来，再交给后续写作或 PRD skill 沉淀 |

第一次跑会觉得烦。习惯了「一句话生成 500 行」的人，第一次被 AI 反问 30 次会觉得在浪费时间。Matt 的建议是**忍住前 5 题**——前 5 题往往会暴露你自己都没想清楚的事。

如果 AI 问到你不在乎的技术细节，直接回「your call」「你定」即可。Grill Me 的目的不是逼你亲自决定所有事，而是把真正重要的上游决策暴露出来。

## 我的使用判断

我会把 Grill Me 当成 AI 编程里的「刹车系统」，不是「加速器」。它表面上让你慢下来，多花 20~45 分钟回答问题；但真正节省的是后面 review、返工和推倒重来的时间。

我不建议把它包装成万能 prompt。它真正厉害的地方不是"问很多问题"，而是让 AI 承认：**在共享设计概念没有形成之前，马上写代码是一种过早行动。**

## 这个 Skill 为什么火

`/grill-me` 是 Matt 整套 skill 里**最常被截图转发**的一个。原因不复杂：

1. **极度极简**：7 行 markdown，复制粘贴就用
2. **效果立竿见影**：第一次跑就能感受到 AI 的「问题密度」变化
3. **可移植**：不依赖 Claude Code，Codex、Cursor、Aider 都能用
4. **自带反 LLM 默认行为**：每个词都在反一个具体的 LLM 偏差，工程审美高

它的成功也成了「**skill 不一定要长**」这件事的最佳论据。

## 参考资源

- [My Grill Me Skill Has Gone Viral](https://www.aihero.dev/my-grill-me-skill-has-gone-viral) —— Matt 本人写的爆火原因复盘，讲了它和 rubber-duck debugging 的渊源
- [grill-me Skill 源文件](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) —— 真实的 SKILL.md，7 行 markdown
- [我试了 grill-me 替代 plan mode，效果惊艳](https://www.youtube.com/watch?v=rLNLa2dcjG8) —— 第三方开发者用真实功能对比实测
