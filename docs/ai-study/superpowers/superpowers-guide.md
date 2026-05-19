---
title: Superpowers 使用技巧
tags:
  - Claude Code
  - Superpowers
  - 使用技巧
excerpt: 这篇文章聚焦 Superpowers 本身：它是什么、核心技能有哪些、工作流程如何串起来，以及在什么场景下会触发执行。
createTime: 2026/05/19 10:00:00
permalink: /ai-study/superpowers-guide/
---

# Superpowers 使用技巧

一句话说，`Superpowers` 不是“增强输出”的插件，而是一套让 AI 按工程流程工作的 skill 系统。

用 AI 写代码，爽吗？爽。翻车吗？也翻。

技术社区对 AI 编程的吐槽其实很一致：AI 太急了。需求刚说完，它就开始输出代码；功能勉强能跑，但测试没写；bug 看起来修好了，可根因没找，下次遇到同类问题还是会错。

`Superpowers` 就是冲着这个问题来的。它的核心不是“让 AI 更强”，而是“让 AI 更稳”。

这篇文章不讲安装，只聚焦三件事：

- `Superpowers` 是什么
- 它是怎么把开发流程串起来的
- 遇到不同任务时，哪些 skill 会触发、该怎么理解

## 阅读导航

如果你是第一次接触 `Superpowers`，建议按这个顺序阅读：

1. 先看「先建立整体认知」，知道它解决的到底是什么问题。
2. 再看「工作流全景图」，先把整体链路记住。
3. 接着看「7 步流程拆开看」和「三条铁律」，理解它为什么比普通 AI 编程更稳。
4. 最后看「三种典型场景」和「触发时机」，把它放回真实任务里理解。

---

## 先建立整体认知

### 它到底是什么

`Superpowers` 可以同时理解成两件事：

- 一套可组合的 `skills`
- 一套面向 AI 编程代理的软件开发方法论

普通 AI 编程更像“听到需求就开始写”，`Superpowers` 则会把开发拆成更明确的阶段：先澄清、再设计、再计划、再实现、再验证、再审查、最后收尾。

这个过程通常会比“直接让 AI 开写”更长一些，但前期多花的时间，往往会从后期返工里省回来。

### 它到底在解决什么

`Superpowers` 真正针对的是 AI 编程里几类很常见的问题：

- 需求不清就开工，还没对齐目标就开始写代码
- 功能逐渐跑偏，范围越做越大，偏离原始目标
- 测试后置甚至缺失，写完才补测试，或者直接跳过
- 调试靠猜，改完也不验证是否真的修好
- 上下文失控，任务一复杂就容易混乱

它解决这些问题的方式，不是换一个更强的模型，而是给每个环节配上对应的 skill 和约束。

### 先记住四个原则

如果你只想先抓主线，可以先记住这四个原则：

- `TDD`：先测试，再实现
- `Systematic over Ad-hoc`：用流程替代猜测
- `Complexity Reduction`：优先简单方案
- `Evidence over Claims`：先验证，再说完成

---

## 它是由什么组成的

### 14 个 Skills 的四大类

如果按更完整的视角看，`Superpowers` 常被归纳为 14 个 skills、4 大类：

- 协作类（9 个）：`brainstorming`、`writing-plans`、`executing-plans`、`subagent-driven-development`、`dispatching-parallel-agents`、`requesting-code-review`、`receiving-code-review`、`using-git-worktrees`、`finishing-a-development-branch`
- 测试类（1 个）：`test-driven-development`
- 调试类（2 个）：`systematic-debugging`、`verification-before-completion`
- 元类（2 个）：`writing-skills`、`using-superpowers`

### 最值得先认识的几项技能

第一次接触时，不用一下把所有技能都记全，先抓住这些主干就够了：

- `brainstorming`：澄清需求、收敛设计
- `writing-plans`：把设计拆成可执行任务
- `using-git-worktrees`：在独立工作区里开发
- `subagent-driven-development`：用子代理逐项推进任务
- `test-driven-development`：强调 `RED -> GREEN -> REFACTOR`
- `systematic-debugging`：先定位根因，再修改
- `requesting-code-review`：主动发起审查
- `verification-before-completion`：完成前先证明完成
- `finishing-a-development-branch`：整理分支、准备合并

除此之外，还有一些常见的配套技能：

- `executing-plans`：按计划批量执行
- `dispatching-parallel-agents`：把独立任务并行处理
- `receiving-code-review`：正确处理 review 反馈
- `using-superpowers`：整体调度入口
- `writing-skills`：用于扩展或整理 skill 自身

---

## 工作流全景图

### 先记住一条主线

如果你只记一条主线，可以记成这句：

`先澄清 -> 再计划 -> 再实现 -> 再验证 -> 再审查 -> 再收尾`

### 最容易记住的流程图

安装 `Superpowers` 后，你的开发流程会更接近下面这样：

```text
┌─────────────────┐
│  1. Brainstorm  │  ← 先搞清楚需求，AI 会问你问题
└────────┬────────┘
         ↓
┌─────────────────┐
│  2. Write Plan  │  ← 生成详细的实施计划
└────────┬────────┘
         ↓
┌─────────────────┐
│ 3. Git Worktree │  ← 创建隔离的工作区
└────────┬────────┘
         ↓
┌─────────────────┐
│  4. TDD Cycle   │  ← 红绿重构：先写测试，再写代码
└────────┬────────┘
         ↓
┌─────────────────┐
│    5. Review    │  ← 自动代码审查
└────────┬────────┘
         ↓
┌─────────────────┐
│    6. Merge     │  ← 合并或创建 PR
└─────────────────┘
```

### 从技能视角看完整 7 步

如果按技能链路看，完整主线更接近下面这 7 步：

```text
brainstorming -> using-git-worktrees -> writing-plans -> subagent-driven-development -> test-driven-development -> requesting-code-review -> finishing-a-development-branch
```

可以把它翻译成大白话：

1. `brainstorming`：先聊清楚要做什么
2. `using-git-worktrees`：创建独立工作空间
3. `writing-plans`：把任务拆成 2 到 5 分钟的小块
4. `subagent-driven-development`：每个任务交给独立子代理推进
5. `test-driven-development`：先写失败测试，再写生产代码
6. `requesting-code-review`：自动代码审查
7. `finishing-a-development-branch`：验证通过后收尾

执行过程中，常见还会配合这些技能：

- 按计划逐步推进时，用 `executing-plans`
- 任务可以并行拆分时，用 `dispatching-parallel-agents`
- 出现 bug 或异常时，用 `systematic-debugging`
- 收到 review 反馈时，用 `receiving-code-review`
- 准备宣称完成时，用 `verification-before-completion`

### 强制触发机制

`Superpowers` 能稳定跑起来，关键不只是 skill 多，而是它强调“如果存在适用技能，就应该触发”。

你可以把这理解成一种强约束式调度：

- 权威性：明确告诉 Agent，相关技能不是建议，而是应该执行的流程
- 承诺：让 Agent 在开始时主动说明自己在使用哪个 skill
- 社会证明：用“始终如此”“通常会这样做”这类表述稳定行为模式

说得直白一点，就是尽量用提示词和流程约束，把模型从“想怎么答就怎么答”拉回“该走什么流程就走什么流程”。

---

## 把 7 步流程拆开看

### 1. `brainstorming`（头脑风暴）

Agent 会先探索项目上下文，逐个提问澄清需求，给出 2 到 3 个方案，并把设计文档分段展示给你审阅。

这里有个很重要的细节：它通常不是一次性把所有问题都抛给你，而是逐步提问。这样做的好处是，你更容易认真回答，也更容易在对话中逐渐收敛真正的需求。

你在这一步的角色不是“催它快点写代码”，而是先审阅设计，确认方向正确，再允许进入下一步。

### 2. `using-git-worktrees`（创建隔离空间）

这一阶段会用 Git Worktree 创建一个独立工作目录，与主分支隔离。常见动作包括：选择目录、验证 `.gitignore`、创建 worktree、运行项目配置、确认测试基线。

之所以强调隔离，是因为前期探索最容易改着改着发现方向不对。有了 worktree，就算试错了，也可以直接丢弃，不会把主分支弄脏。

### 3. `writing-plans`（拆任务）

这一步会把已经确认的设计拆成 2 到 5 分钟粒度的小任务。每个任务通常会包含精确文件路径、预期代码内容和验证步骤，而不是只写一个模糊的 TODO。

任务粒度非常关键。太大了，子代理容易跑偏；太小了，又会增加切换成本。把任务拆到“短小但完整”，是这一步最重要的价值。

### 4. `subagent-driven-development`（子代理开发）

这是整个工作流里技术含量很高的一步。系统会为每个任务派发独立子代理，让它只处理当前任务所需的信息，尽量减少上下文污染。

子代理完成后，通常还会经过两层检查：一层看它有没有偏离设计，一层看代码质量、规范和潜在风险。如果不符合要求，就会被打回重做。

### 5. `test-driven-development`（TDD）

这里走的是标准的 `RED -> GREEN -> REFACTOR` 循环：

- `RED`：先写一个会失败的测试
- `GREEN`：写刚好能让测试通过的最小实现
- `REFACTOR`：整理代码，同时保持测试通过

这一步对 AI 编程特别重要。没有 TDD 约束时，AI 很容易顺手加很多“以后可能用得到”的内容；而 TDD 会逼着它每一步都只做当前真正需要的东西。

### 6. `requesting-code-review`（代码审查）

到了这里，系统会主动发起代码审查。常见做法是结合当前改动、提交状态或 git SHA，让审查流程去检查代码质量、规范一致性和潜在风险。

这一步的意义不是挑刺，而是避免“功能看起来做完了，但质量问题被带进下一阶段”。

### 7. `finishing-a-development-branch`（收尾）

当测试和验证都通过后，最后进入收尾阶段。常见选项包括：合并到基础分支、创建 PR、保留分支继续观察，或者直接丢弃分支。

完整流程走到这里，才算真正结束。它关注的不是“代码写完了没有”，而是“这次开发能不能以一种可交付、可回退、可审计的方式结束”。

### 避坑要点

- `brainstorming` 阶段别急，多花点时间在需求澄清上，后面省下来的时间通常远比这里多
- `writing-plans` 阶段重点检查任务粒度，太大或太小都会影响子代理执行效率
- `worktree` 创建后先跑一遍测试基线，确认环境没问题，再开始正式开发

---

## 三条铁律为什么重要

很多文章只讲 `Superpowers` 的流程，但它真正和普通 AI 编程拉开差距的，往往是下面这三条铁律：

1. 没有失败测试，就不写生产代码。
   这条规则对应 `test-driven-development`。先写失败测试，本质上是在先定义行为，再开始实现。

2. 不做根因调查，就不修 bug。
   这条规则对应 `systematic-debugging`。先找原因，再动代码，避免把“修复”变成碰运气。

3. 没有新鲜验证证据，就不宣称完成。
   这条规则对应 `verification-before-completion`。重点不是“我觉得修好了”，而是“我刚刚验证过它真的修好了”。

这三条铁律合在一起，对抗的正是 AI 编程里最常见的三种偷懒：不写测试、不查根因、不验证就收工。

---

## 三种典型场景

并不是所有任务都要走完全相同的流程。更实用的理解方式，是按场景来裁剪流程强度：

1. 从零开始新项目：适合走完整流程，从需求澄清一路走到收尾。
2. 老项目加新功能：通常也走完整流程，但重点是遵循现有代码模式，不做无关重构。
3. 修复 bug：更适合走精简流程，主线通常是 `systematic-debugging -> test-driven-development -> verification-before-completion`。

如果只想记最实用的版本，可以直接这样选：

- 做新东西，无论是新项目还是新功能，优先走完整流程
- 明确是 bug 修复时，优先走“调试 -> TDD -> 验证”的精简流程
- 有多个互不相关的独立任务时，可以优先考虑 `dispatching-parallel-agents`

### 场景 1：从零开始新项目

新项目最怕的不是“写不出来”，而是“写偏了”。

为什么新项目更需要完整流程？因为新项目的风险不在于写不出来，而在于写偏了。让 AI 从零搭一个项目，最常见的问题不是“做不到”，而是架构选错、需求理解偏了、技术方案走歪了。返工成本通常远高于前期设计成本。

在这种场景下，几个步骤特别关键：

- `brainstorming`：不展示设计并获得批准前，不进入实现
- `using-git-worktrees`：先建隔离空间，方向错了可以直接丢弃
- `writing-plans`：把任务拆到 2 到 5 分钟粒度，避免子代理跑偏
- `subagent-driven-development`：每个子代理只处理当前任务，减少上下文污染
- `test-driven-development`：用 `RED -> GREEN -> REFACTOR` 避免过度设计

如果是新项目，前期在需求澄清和计划拆解上花的时间，通常比后面返工要便宜得多。

#### 示例：从零做一个命令行待办事项工具

场景：你想从零做一个命令行待办事项工具。

它更可能这样推进：

1. 在 `brainstorming` 阶段，先问清楚要支持哪些命令、数据存储方式、错误处理和使用方式。
2. 在 `using-git-worktrees` 阶段，创建独立 worktree，避免一开始探索就污染当前目录。
3. 在 `writing-plans` 阶段，把任务拆成初始化项目、实现 `add/list/done/delete`、补测试、整理文档等小步骤。
4. 在 `subagent-driven-development` 阶段，让子代理分别推进命令解析、存储逻辑、测试等任务。
5. 在 `test-driven-development` 阶段，先写命令行为测试，再补最小实现。
6. 在 `requesting-code-review` 阶段，检查命令设计是否清晰、实现是否偏离最初需求。
7. 最后在 `finishing-a-development-branch` 阶段，根据结果决定合并、提 PR 或继续保留分支。

这类场景最怕的不是写不出来，而是方向一开始就错，所以完整流程通常最有价值。

### 场景 2：老项目加新功能

老项目和新项目步骤类似，但重点完全不同。重点不再是“从零设计”，而是“在既有代码约束中安全扩展”。

老项目最大的特点是有历史包袱。现有的代码模式、架构风格、依赖版本、测试框架，都会变成真实约束。`Superpowers` 在这种场景下强调的不是“重新设计一套更现代的方案”，而是先理解现状，再决定怎么安全地往里加东西。

核心原则可以直接理解成三条：

- 遵循现有代码模式和架构
- 不提议无关的重构
- 新代码要和项目风格一致

说白了，就是入乡随俗。比如项目本来用的是 Vue 2 加 Options API，就不要一上来建议迁移到 Vue 3 的 Composition API；项目本来用 Jest 做测试，也不要顺手换成 Vitest，除非新功能确实必须这么做。

这也是为什么在老项目里，`using-git-worktrees` 依然很重要。它不仅是隔离，更是一个可随时丢弃的安全沙箱。

#### 示例：给现有 Node.js 项目增加 PDF 导出功能

场景：你要给现有 Node.js 项目增加一个 PDF 导出功能。

它更可能这样推进：

1. 在 `brainstorming` 阶段，先摸清项目结构、现有导出能力、权限校验和接口风格。
2. 这一步在新项目里更像“梳理需求”，但在老项目里更像“理解现状 + 评估影响范围”。
3. 在 `using-git-worktrees` 阶段，创建隔离空间，避免改坏现有业务逻辑。
4. 在 `writing-plans` 阶段，规划在哪个路由里加导出接口、如何复用已有中间件、如何补回归测试。
5. 在 `subagent-driven-development` 阶段，把接口改造、模板生成、测试补充拆给不同子代理处理。
6. 在 `test-driven-development` 阶段，先补现有行为测试，再补新功能测试，避免破坏老功能。
7. 在 `requesting-code-review` 阶段，重点检查新代码是否符合现有项目风格、有没有引入不必要依赖。
8. 最后在 `finishing-a-development-branch` 阶段，验证通过后整理分支并准备合并。

很多人会觉得“只是加个小功能，不至于专门隔离”。但 worktree 的价值不只是隔离代码，更重要的是给你一个随时可以丢弃的沙箱。改坏了，直接删掉 worktree，主分支仍然是干净的。在老项目里，这种安全网往往比新项目更重要，因为你改动的代码更可能影响现有业务。

老项目的关键不是“做出来”，而是“按现有代码的方式做出来”。

### 场景 3：发现并修复 bug

修 bug 更适合走精简流程，而不是完整流程。核心主线通常是：

```text
systematic-debugging -> test-driven-development -> verification-before-completion
```

其中 `systematic-debugging` 又可以粗略理解成 4 个阶段：

1. 根因调查：先收集信息，不急着改代码。
2. 模式分析：看它是必现、偶发，还是与输入或环境相关。
3. 假设与测试：形成修复假设，并用自动化测试验证。
4. 实施修复：确认方向后再改，并跑完整验证。

为什么要先写失败测试？因为失败测试本身就是一个诊断证明。

- 它证明 bug 确实存在
- 它证明你找到的不是表象，而是可以稳定复现的问题
- 它会留在测试套件里，防止同类问题再次出现

修复后的验证也不能只停留在“我觉得好了”，而要拿出新鲜证据。更实际的要求通常包括：

- 所有测试通过，包括新写的和原有的
- 手动验证 bug 已经修复
- 相关功能没有出现回归

这里最关键的不是“修得快”，而是“修得准”。

#### 示例：点击导出按钮没反应

场景：用户反馈“点击导出按钮没反应”。

它更可能这样推进：

1. 在 `systematic-debugging` 阶段，先查日志、复现问题，确认到底是前端按钮、接口返回还是权限链路出了问题。
2. 在 `test-driven-development` 阶段，先写一个能稳定复现 bug 的失败测试，再补修复代码。
3. 在 `verification-before-completion` 阶段，跑完整测试，手动验证导出恢复正常，并确认没有引入回归。

这类场景通常不需要完整 7 步流程，重点是先找准问题，再证明修复真的有效。

---

## 它通常会在什么情况下触发

`Superpowers` 的触发方式可以分成两类：自动触发和手动触发。

### 自动触发

下面这些场景，更容易触发对应技能：

- 需求模糊、目标不完整：更可能触发 `brainstorming`
- 功能较复杂、需要拆步骤：更可能触发 `writing-plans`
- 明确强调 TDD、先写测试：更可能触发 `test-driven-development`
- 出现 bug、报错、偶发异常：更可能触发 `systematic-debugging`
- 请求质量检查或 review：更可能触发 `requesting-code-review`
- 任务可并行拆分：更可能触发 `dispatching-parallel-agents`
- 大任务需要连续推进：更可能触发 `subagent-driven-development` 或 `executing-plans`

### 手动触发

如果你明确点名 skill，触发会更稳定。例如：

- “用 `test-driven-development` 的方式来做”
- “先按 `systematic-debugging` 帮我定位问题”
- “先 `brainstorming`，不要直接写代码”

手动触发的好处很简单：预期更稳定。

---

## 看一个完整使用示例

场景：你想给项目添加一个用户登录功能。

### 没有 Superpowers

```text
你：帮我添加用户登录功能
AI：直接开始写代码...（可能写错，可能跑偏）
```

### 有 Superpowers

```text
你：帮我添加用户登录功能
AI：好的，在开始之前，我需要澄清几个问题：
    1. 登录方式：邮箱密码、手机验证码、还是第三方登录？
    2. 是否需要"记住我"功能？
    3. 登录失败要如何处理？
    ...

（你回答完后）

AI：明白了，让我为这个功能制定实施计划...
    （生成详细的步骤清单）

AI：计划已生成，要开始执行吗？
你：Yes

AI：正在创建隔离工作区...（Git worktree）
    开始 TDD 循环...
    先写一个失败的测试...
    现在写代码让测试通过...
    运行测试...全部通过！
    进行代码审查...
    准备合并...
```

这就是 `Superpowers` 的核心价值：把人类工程师长期积累的软件工程方法，变成 AI 可以稳定执行的工作流程。

---
