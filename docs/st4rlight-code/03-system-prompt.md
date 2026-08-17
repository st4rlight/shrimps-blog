---
title: 03. System Prompt 工程
tags:
  - st4rlight-code
  - System Prompt
  - 前缀缓存
  - CLAUDE.md
  - "@include"
excerpt: 构建 st4rlight-code 的提示词体系：把 system prompt 拆成静态核心 + 动态上下文为前缀缓存让路，实现 CLAUDE.md 向上递归加载、@include 模块化引用、.claude/rules 自动加载，并注入 agent 第一条用户消息。
createTime: 2026/08/18 15:00:00
permalink: /st4rlight-code/03-system-prompt/
---

# 03. System Prompt 工程

循环能跑了（01），工具也有了（02），但模型"凭什么按我们的规矩干活"？靠的是发给它的那段 system prompt。这一章讲我们怎么组织这段提示词：**拆成静态 + 动态两块**、**把 CLAUDE.md 项目指令做成模块化加载**，以及为什么要这么拆。

## 提示词也分"能缓存"和"不能缓存"

system prompt 不是一坨死文本。用户每次在不同目录跑，环境就不同；项目不同，约定也不同。如果全写死，既浪费 token，也没法针对项目给指令。

我们把 system prompt 按「会不会变」切成两份：

| 块 | 内容 | 会不会变 |
|----|------|---------|
| `STATIC_CORE` | 角色定义、规则、工具说明 | 所有用户/会话完全一样 |
| 动态上下文 | cwd、platform、shell、git 状态、可激活工具 | 因环境/项目而异 |

切分的动机是**前缀缓存**（prefix caching）：静态核心一旦标上 `cache_control`，跨会话字节不变、稳定命中缓存，省 token 也省延迟；而因项目而异的内容不掺进去，免得把缓存搞脏。

```ts
// src/prompt.ts
export function buildSystemPrompt(
  options: SystemContextOptions = {},
): string {
  const dynamic = buildDynamicSystemContext(options);
  return (dynamic.length > 0)
    ? `${STATIC_CORE}\n\n${dynamic}`
    : STATIC_CORE;
}
```

## 静态核心：规则要具体，别给模型留辩解空间

`STATIC_CORE` 是我们精心打磨的那段"宪法"。对比一下两种写法：

```ts
// ❌ 模糊：模型会自我合理化——"加注释让代码更简洁易读"，然后给每个函数补 docstring
"Be concise."

// ✅ 具体：消除了解释余地
"Never propose changes to code you haven't read. Read the relevant files first."
```

我们的静态核心强调了项目里**代码级强制**的硬规则——`read before you write`：

```ts
# Hard rule: read before you write
 - edit_file and write_file require that you first read the target file with
   read_file in this same session, otherwise the write is rejected. Never skip this.
```

> 这不是空话。02 章讲过 read-before-edit + mtime 防护是写在执行器里的：没先 `read_file` 就 `write_file` / `edit_file`，工具直接拒绝。提示词提前讲清楚，能少让模型踩几次硬钉子。

## 动态上下文：让模型知道自己身处何地

动态块跟在静态核心后面，内容因环境而异。我们用 `buildDynamicSystemContext()` 拼出 `# Environment` 一节：

```ts
// src/prompt.ts
export function buildDynamicSystemContext(
  options: SystemContextOptions = {},
): string {
  const lines: string[] = [];
  lines.push("# Environment");
  lines.push(`- Current working directory: ${process.cwd()}`);
  lines.push(`- Platform: ${process.platform}`);
  lines.push(`- Shell: ${process.env.SHELL ?? "unknown"}`);
  // git 状态、可激活的延迟加载工具……
  return lines.join("\n");
}
```

### 它长什么样

实际跑 `npm run dev` 时，拼出来的 system prompt 是静态 + 动态两段：

```
# Environment
- Current working directory: /Users/xxx/st4rlight-code
- Platform: darwin
- Shell: /bin/zsh
- Git status:
   M src/index.ts
  ?? src/prompt.ts
# Lazy-loaded tools
The following tools are not loaded by default. Call tool_search to activate one before using it: mock_plan_mode.
```

延迟加载工具那行是**动态算出来的**——从工具清单里筛出 `deferred` 标记的工具（02 章讲过 `tool_search`），告诉模型"这些要用 `tool_search` 激活"。它跟项目、跟当前加载的工具集有关，所以放动态块。

## CLAUDE.md：把项目指令做成模块

环境信息是"这台机器/这个目录"的事实。但项目**自己的约定**呢？比如"测试放 test/""提交信息用 Conventional Commits"。这些该由项目用 `CLAUDE.md` 声明——类似 `.eslintrc` 但面向 AI。

### 向上递归发现

Claude Code 从 CWD 一路向上找 `CLAUDE.md`。我们的 `loadClaudeMd()` 也这么做，根目录的放最前、子目录的追加在后：

```ts
// src/config/claudeMd.ts
export function loadClaudeMd(): string {
  const parts: string[] = [];
  let dir = process.cwd();
  while (true) {
    const file = join(dir, "CLAUDE.md");
    if (existsSync(file)) {
      const content = resolveIncludes(readFileSync(file, "utf-8"), dir);
      parts.unshift(content);            // 根目录的放最前
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;           // 到文件系统根为止
    dir = parent;
  }
  const rules = loadRulesDir(process.cwd());
  const claudeMd = (parts.length > 0)
    ? "# Project Instructions (CLAUDE.md)\n" + parts.join("\n\n---\n\n")
    : "";
  return claudeMd + rules;
}
```

### @include：模块化引用

项目一大，`CLAUDE.md` 会膨胀。我们支持 `@include` 语法，把规则拆到多个文件：

```
# 顶层 CLAUDE.md
@./shared/global.md        ← 引用共享约定
@./deploy/rules.md         ← 引用部署规则
```

`resolveIncludes()` 做递归展开，支持三种路径写法：

| 写法 | 含义 |
|------|------|
| `@./x` / `@../x` | 相对当前文件所在目录（`./` 和 `../` 都支持） |
| `@~/x` | 家目录，展开为 `$HOME/x` |
| `@/abs/x` | 绝对路径 |

递归是安全的，有两道防环：

```ts
const MAX_INCLUDE_DEPTH = 5;   // 深度上限，防止无限嵌套

function resolveIncludes(content, basePath, visited = new Set(), depth = 0) {
  if (depth >= MAX_INCLUDE_DEPTH) {
    return content;
  }
  return content.replace(INCLUDE_REGEX, (_match, rawPath) => {
    // ……解析成绝对路径
    if (visited.has(resolved)) return `<!-- circular: ${rawPath} -->`;  // 循环检测
    if (!existsSync(resolved))  return `<!-- not found: ${rawPath} -->`;
    visited.add(resolved);
    return resolveIncludes(readFileSync(resolved, "utf-8"), dirname(resolved), visited, depth + 1);
  });
}
```

关键设计：**任何失败都不抛异常**，而是就地替换成 `<!-- not found: ... -->` 这类占位注释，保证整体提示词始终可用——模型看到注释就知道"这个引用没展开"，而不是整个加载崩掉。

### .claude/rules：自动加载的规则目录

除了 `CLAUDE.md`，`loadRulesDir()` 还会加载项目根的 `.claude/rules/*.md`，按文件名排序拼接，追加在所有 `CLAUDE.md` 之后：

```ts
const rulesDir = join(dir, ".claude", "rules");
entries = readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort();
```

### 真实运行效果

用一个临时目录验证向上递归 + @include + rules：

```
proj/
├── CLAUDE.md            @./shared/global.md + 根规则
├── shared/global.md     @./nested.md
├── shared/nested.md
├── sub/CLAUDE.md        @../shared/nested.md + 子规则
└── .claude/rules/01-setup.md
```

在 `sub/` 下跑 `loadClaudeMd()`，能同时展开根 CLAUDE.md、`@./` 相对引用、嵌套引用，以及 `@../` 跨级引用：

```
# Project Instructions (CLAUDE.md)
# Root CLAUDE
## Global conventions
- always read first
nested content line
local root rule
---
## Sub project
nested content line
sub rule
# Additional Rules (.claude/rules)
## Rule One
rule 1 content
```

## 注入到第一条用户消息，而不是塞进 system prompt

CLAUDE.md 和当前日期放哪？我们没塞进 system prompt，而是由 agent 注入到**第一条用户消息**前面，包成 `<system-reminder>`：

```ts
// src/config/claudeMd.ts
export function buildUserContextReminder(): string {
  const date = new Date().toISOString().split("T")[0];
  const claudeMd = loadClaudeMd();
  return `<system-reminder>
${claudeMd}
# currentDate
Today's date is ${date}.
</system-reminder>`;
}
```

agent 侧只对第一条用户消息注入一次（`reminderInjected` 标记），避免重复污染：

```ts
// src/agent.ts
if (!this.reminderInjected && this.options.userContextReminder) {
  userMessage = `${this.options.userContextReminder}\n\n${userMessage}`;
  this.reminderInjected = true;
}
```

为什么注入 user 消息而非 system prompt？两点：
- **不污染前缀缓存块**——CLAUDE.md 因项目而异，塞进静态核心会把缓存搞脏（回到开头那个动机）
- **近因效应**——项目指令紧跟用户真实意图，在上下文里位置更靠后、权重更高

## 和真实 Claude Code 的差距

我们这段提示词"静态核心 + 环境信息"够用了，但 Claude Code 的 System Prompt 是经过大量 A/B 测试和模型行为观察迭代出来的工程产物。它多出来的是**把"让模型稳定照做"做到极致**，核心是四个概念：

| 概念 | 说明 | 我们 |
|------|------|------|
| 7 层递进结构 | Identity → System → Doing Tasks → Actions → Using Tools → Tone & Style → Output Efficiency | 覆盖约一半 |
| 反模式接种 | 明确"不要做什么"比"要做什么"有效，措辞要给具体判断标准 | 未充分使用 |
| 爆炸半径框架 | 用「可逆性 × 影响范围」教模型评估风险，而非穷举"不能做 X" | 未做 |
| 工具偏好映射表 | Use Read instead of cat、Use Edit instead of sed……防止模型默认用 bash | 部分 |

其中**反模式接种**的洞察很关键：正面指令（"be concise"）给模型留了自我合理化空间——它认为"加注释让代码更简洁"，然后给每个函数补 docstring；而负面指令（"don't add docstrings to code you didn't change"）直接消除解释余地。我们的 `STATIC_CORE` 已经用了这个思路（"Never propose..."），后续可以按 7 层结构补全。

## 小结

这一章把提示词从"一坨死文本"升级成了**分层的工程体系**：

- 静态核心 + 动态上下文，为前缀缓存让路
- `CLAUDE.md` 向上递归发现，`@include` 模块化引用 + 防环 + 容错占位
- `.claude/rules` 自动加载
- 项目指令 + 日期注入第一条 user 消息，不污染缓存、吃近因效应

下一章，我们回到 agent 本身，看流式输出和中断处理怎么把循环做得又稳又快。
