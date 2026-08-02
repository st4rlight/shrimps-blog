---
title: CodeGraph 介绍
tags:
  - CodeGraph
  - MCP
  - 代码智能
  - AI Agent
  - tree-sitter
excerpt: CodeGraph 是一款开源的本地 MCP 服务器，用 tree-sitter 解析 21 种语言构建代码知识图谱存入 SQLite，通过 10 个 MCP 工具暴露给 AI Agent，让 Agent 直接查询图谱而非逐文件 grep。本文系统梳理 CodeGraph 的定位、架构设计、工具体系、基准测试、实战用法与设计洞察。
createTime: 2026/08/02 15:00:00
permalink: /ai-study/codegraph-introduction/
---

# CodeGraph 介绍

> 当 AI Agent 面对一个陌生代码库时，它最常做的事情是什么？grep。一个个文件打开，全文搜索关键词，猜测函数调用关系。作者 Colby McHenry 在自己的项目上计时——**60 次工具调用、157,800 tokens、近 2 分钟的探索**，Claude 才真正开始处理他的请求。

MCP（Model Context Protocol）让 AI Agent 获得了调用工具的能力，但"调用什么工具"同样重要。一个只会 `grep` 和 `Read` 的 Agent，就像一个只有记事本和搜索框的程序员——能干活，但效率堪忧。

**CodeGraph** 就是为解决这个问题而生的：它用 tree-sitter 解析整个代码库，构建一张包含函数、类、导入、调用链的知识图谱存入本地 SQLite，然后通过 MCP 工具暴露给 AI Agent。Agent 不再需要盲目 grep，而是直接查询图谱，一步到位。

![CodeGraph 工作示意](/ai-study/ai-ecosystem/codegraph-introduction/codegraph-banner.jpg)

---

## 背景与动机

### AI Agent 的"探索税"

当前的 AI 编程助手（Claude Code、Cursor、Copilot、Windsurf 等）在理解代码库时面临一个根本性矛盾：**LLM 的上下文窗口有限，但代码库是巨大的**。

当你在 Claude Code 里问"这个项目的认证流程是怎样的"，它会：

1. 启动 Explore 子 Agent
2. 子 Agent 用 `find` 扫目录结构
3. 用 `grep` 搜关键词
4. 用 `Read` 逐个读文件
5. **每一步都消耗 token 和时间**

![CodeGraph vs 传统方式对比](/ai-study/ai-ecosystem/codegraph-introduction/codegraph-vs-grep.svg)

在大型项目里，这个过程可能需要 20-80 次工具调用。这就是**"探索税"**（Explore Tax）——Agent 花大量预算在**找代码**上，而不是**理解和改代码**。

| 传统方式 | 痛点 |
|---------|------|
| **全文搜索（grep）** | 只能匹配字符串，不理解语义。搜 `getUser` 会匹配到注释、字符串、变量名，却找不到实际调用关系 |
| **逐文件读取** | 为了理解一个函数的上下文，Agent 需要逐个打开文件读取，大量消耗 token 和时间 |
| **人工提供上下文** | 用户需要手动告诉 Agent 代码结构，违背了"自动化"的初衷 |
| **缺少调用链追踪** | Agent 不知道改一个函数会影响哪些地方，容易引入回归 Bug |

核心问题在于：**文件之间的调用、import、继承关系是确定性的、AST 可推导的**，没有任何理由每次会话都让 Agent 用 grep 重新发现。提前算一次、放在本地 SQLite 里、通过 MCP 直接喂给 Agent，就够了。

### CodeGraph 的解法

CodeGraph 的核心立论是：这种探索本质上是把"静态结构信息"用 LLM 的工作记忆反复重算。它的思路很直接——**如果代码本身就是图，那就先把图建好，然后让 Agent 查询这张图**。

具体来说：

1. 用 tree-sitter 解析 21 种编程语言，提取函数、类、导入、调用关系
2. 构建一个代码知识图谱，存入本地 SQLite 数据库（`.codegraph/codegraph.db`）
3. 通过 MCP 协议暴露 10 个工具，让 AI Agent 直接查询图谱
4. 用 FTS5 全文搜索辅助符号查找，无需向量数据库

这样，Agent 的问题从"grep 关键词然后读一堆文件"变成了"调用一个 MCP 工具，直接拿到结构化结果"。

---

## 核心概念与定位

### 什么是 CodeGraph

一句话：**CodeGraph 是一款给 AI 编程助手做"前置索引"的本地 MCP 服务器。**

| 属性 | 说明 |
|------|------|
| **仓库** | `colbymchenry/codegraph` |
| **作者** | Colby McHenry（15+ 年经验的自学软件工程师） |
| **技术栈** | TypeScript 94.8% / JavaScript 5.2% |
| **存储** | SQLite + FTS5（无 Neo4j、无向量数据库、无外部 LLM API） |
| **许可证** | MIT |
| **支持平台** | Windows / macOS / Linux，Node ≥18 <25（0.9+ 捆绑自带 Node 运行时） |
| **Stars** | ~29.1k（截至 2026 年 5 月，GitHub Trending #2） |

### 在 AI 生态中的定位

![CodeGraph 生态定位](/ai-study/ai-ecosystem/codegraph-introduction/codegraph-ecosystem.svg)

CodeGraph 处于 AI 编程工具链的**代码智能层**——它不替代 LLM，也不替代 IDE，而是给 Agent 做前置索引：

- **向下**：用 tree-sitter 解析代码，构建图谱存入 SQLite
- **向上**：通过 MCP 协议为 AI Agent 提供结构化查询能力
- **横向**：自动检测已安装的 Agent（Claude Code、Cursor、Codex CLI、OpenCode、Gemini CLI、Antigravity、Kiro、Hermes Agent），自动写入 MCP 配置

| 协议/工具 | 定位 | 与 CodeGraph 的关系 |
|----------|------|-------------------|
| MCP | Agent 调用工具的标准协议 | CodeGraph 通过 MCP 暴露工具，是 MCP 生态中的代码智能工具 |
| Claude Code / Cursor | AI 编程助手 | CodeGraph 的主要服务对象，通过 MCP 集成 |
| tree-sitter | 增量解析库 | CodeGraph 的解析引擎基础，支持 21 种语言 |
| SQLite + FTS5 | 嵌入式数据库 + 全文搜索 | CodeGraph 的存储引擎，零外部依赖 |

### 核心设计原则

| 原则 | 含义 |
|------|------|
| **图优先** | 所有代码查询基于知识图谱，而非文本搜索 |
| **本地优先** | 索引文件不离开你的机器，零 API key、零外部服务 |
| **零配置** | `codegraph init` 一条命令完成，无 embedding 模型选型、无向量库、无 API key |
| **确定性提取** | 索引源自 AST，完全可复现，无 LLM 调用成本 |
| **Agent 原生** | 工具设计面向 AI Agent 的使用模式，让 Agent "没有理由 fallback 去 Read" |

---

## 架构设计

### 整体架构

![CodeGraph 架构总览](/ai-study/ai-ecosystem/codegraph-introduction/codegraph-architecture.svg)

CodeGraph 是一个 TypeScript 编写的 MCP 服务器，核心是一个本地 SQLite 数据库。整个系统没有 Neo4j、没有向量数据库、没有外部 LLM API。

### 四阶段工作流程

```text
1. 提取（Extraction）   → tree-sitter 解析源码成 AST，提取节点和边
2. 存储（Storage）       → 所有数据存入本地 SQLite（.codegraph/codegraph.db），使用 FTS5
3. 解析（Resolution）    → 解析引用关系：调用→定义、导入→源文件、类继承、框架路由
4. 自动同步（Auto-Sync） → OS 原生文件事件监控，2 秒防抖，增量 reparse
```

**自动同步**使用操作系统原生文件事件（macOS FSEvents、Linux inotify、Windows ReadDirectoryChangesW），2 秒静默窗口 debounce，只过滤源码文件。结果是：你 Cmd-S 保存代码，再问 Agent 时图已经更新。

### 数据模型

CodeGraph 的 SQLite schema 非常精简：

```sql
-- 节点：函数、类、方法等
nodes(id, kind, name, qualified_name, file_path, start_line, end_line,
      language, signature, docstring, code_snippet, code_hash, metadata)

-- 边：调用、导入、继承等关系
edges(source_id, target_id, kind, resolved, target_name, line_number)

-- 文件索引
files(path, content_hash, language, last_indexed, node_count)

-- 未解析的引用
unresolved_refs(...)

-- 全文搜索虚拟表
nodes_fts USING fts5(...)
```

节点 ID 是字符串路径如 `"func:src/auth.ts:validateToken:45"`。SQLite 在 WAL 模式下并发读写不阻塞，BFS/DFS 在 10 万节点级别仍然亚毫秒。

**节点类型（NodeKind）**：

`file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`, `function`, `method`, `property`, `field`, `variable`, `constant`, `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`, `import`, `export`, `route`, `component`

**边类型（EdgeKind）**：

`contains`, `calls`, `imports`, `exports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`

### tree-sitter vs LSP：为什么选择语法解析而非语义分析

一个常见疑问是：既然 LSP（Language Server Protocol）能提供精确的跳转定义、查找引用、类型推断，为什么不直接用 LSP 而要选择 tree-sitter？

**tree-sitter** 是 GitHub 在 2018 年开源的增量解析器，核心能力是把源代码字符串变成一棵语法树（AST）。你给它一段 Python：

```python
def add(a, b):
    return a + b
```

它返回一棵结构化的树：

```text
function_definition
├── name: "add"
├── parameters: [a, b]
└── body
    └── return_statement
        └── binary_expression (+)
            ├── left: a
            └── right: b
```

**LSP** 是微软在 2016 年为 VS Code 设计的语言服务器协议。语言服务器（如 rust-analyzer、pyright、tsserver）通常基于编译器本身，能回答语义级问题——"谁调用了这个函数"、"这个变量是什么类型"、"重命名所有引用"。LSP 跑得更准，因为它在脑子里维护了一份能编译的代码模型。

两者的关键差异：

| 维度 | tree-sitter | LSP（语言服务器） |
|------|------------|------------------|
| 回答的问题 | 语法："这是个函数吗？" | 语义："这个函数定义在哪？" |
| 需要编译吗 | 不需要，代码错了也能解析 | 通常需要项目能编译/类型检查 |
| 跨文件理解 | 没有 | 有 |
| 每种语言 | 一份 grammar（小、统一） | 一个独立的服务器进程（重、各家实现差异大） |
| 速度 | 毫秒级，编辑器实时用 | 大项目首次加载几秒到几十秒 |
| 容错 | 语法错了也能给出尽量正确的树 | 通常要求代码可编译 |
| 典型用途 | 语法高亮、代码折叠、批量符号抽取 | IDE 跳转、重命名、补全、类型检查 |

CodeGraph 选 tree-sitter 而不是 LSP，是一个明确的工程权衡：**它放弃了"真正理解类型"的精度**（比如 `obj.foo()` 里 `obj` 到底是什么类的实例，tree-sitter 答不上来），**换来了三件事**：

1. **不需要项目能编译**——Agent 在写到一半的代码上也能工作
2. **一份 grammar 覆盖所有平台**——部署极简，无需安装各种语言服务器
3. **增量解析快到毫秒级响应文件保存**——文件保存后即刻更新图谱

对一个面向 Agent 的"探索性查询"工具，这个折中是合理的。Agent 不需要编译器级别的精确性——它需要的是"谁调用了这个函数"这类结构性关系的快速回答，tree-sitter + 跨文件解析已经能覆盖 95% 的场景。

::: tip 动态分发桥接（Synthesizers）
tree-sitter 不做语义分析，但 CodeGraph 通过启发式规则桥接了动态分发的边界：识别 callback/observer 注册、EventEmitter、React setState → render、JSX render → child component、Django ORM descriptors 等模式，给图加上 `provenance: 'heuristic'` 的合成边。这让 trace 工具能穿过"事件分发、回调、运行时绑定"这些 grep 永远穿不过的边界。
:::

### 引用解析

`resolution/` 模块做三件事：

| 解析类型 | 做什么 | 方法 |
|---------|-------|------|
| **Imports → 文件** | 识别 tsconfig path alias、Cargo workspace、Python package | 配置文件解析 |
| **Calls → 定义** | 函数调用链接到函数定义 | 先用 import 表过滤候选，再做 name matching |
| **Inheritance** | extends / implements 双向边 | 语法树直接提取 |

### 为什么没有向量数据库

这是 CodeGraph 和同类工具最大的体系差异之一。仓库早期的设计里有 `vectors/` 模块——基于 `@xenova/transformers` 跑 ONNX，存 384 维 `nomic-embed-text-v1.5` embeddings，SQLite vss 索引。但在某次提交中**整个向量搜索和 embedding 模块被移除了**。

作者用实测发现：对"找调用链、找定义、找路由"这类问题，**符号名 + FTS5 + 图遍历就足够了**，向量检索引入的延迟和不确定性反而是负担。这个设计决策的深层含义，后文[设计洞察](#设计洞察-code-rag-≠-document-rag)章节会详细展开。

---

## MCP 工具体系

CodeGraph 作为 MCP Server 暴露 10 个工具，按使用场景分为重型和轻型两类。

### 工具分类总览

![CodeGraph 工具分类](/ai-study/ai-ecosystem/codegraph-introduction/codegraph-tool-categories.svg)

### 重型工具（Explore 子 Agent 主力）

主会话应避免直接调用这些工具，它们返回的数据量较大：

| 工具 | 功能 | 典型场景 |
|------|------|---------|
| `codegraph_context` | 给定任务/特性描述，组合 search + node + callers + callees，一次返回"涉及到的入口和上下文" | Agent 需要理解某个功能的完整上下文 |
| `codegraph_trace` | "X 是怎么调到 Y 的"，每一跳的函数体内联返回，跨动态分发 | 追踪完整调用链路 |
| `codegraph_explore` | 一次返回若干相关符号的源码（按文件分组）+ 关系图 | 探索性了解某个模块 |

### 轻型工具（主会话直接用）

用于做改动前的精准查询，返回数据量小：

| 工具 | 功能 |
|------|------|
| `codegraph_search` | 按名称搜索符号，只返回位置 |
| `codegraph_callers` | 查找谁调用了某个函数 |
| `codegraph_callees` | 查找某个函数调用了谁 |
| `codegraph_impact` | 分析修改某个符号的影响范围 |
| `codegraph_node` | 获取单个符号的详细信息 |
| `codegraph_files` | 获取索引文件结构（比文件系统扫描快） |
| `codegraph_status` | 检查索引健康状态和统计 |

### 工具使用模式

CodeGraph 的影响 Agent 行为的渠道是**低显著性的**——只有 MCP initialize instructions 和 tool descriptions。作者在 CLAUDE.md 中写道：

> "改 wording 并不能可靠地改变 Agent 的 tool 选择风格。真正起作用的是让工具本身一次性给够，让 Agent 没有理由 fallback 去 Read。"

这不是靠提示词工程让 Agent "更聪明地搜索"，而是靠工具能力让 Agent "不需要搜索"。前者不可靠，后者确定性。

---

## 基准测试：7 个真实项目

作者在 7 个开源项目上做了对比测试（Claude Opus 4.7，每个项目每个配置跑 4 次取中位数）：

| 项目 | 语言 | 文件数 | 费用节省 | Token 减少 | 速度提升 | 工具调用减少 |
|------|------|-------|---------|-----------|---------|------------|
| **VS Code** | TypeScript | ~10k | 35% | 73% | 41% | 72% |
| **Excalidraw** | TypeScript | ~600 | 47% | 73% | 60% | 86% |
| **Django** | Python | ~2.7k | 34% | 64% | 59% | 81% |
| **Tokio** | Rust | ~700 | 52% | 81% | 63% | 89% |
| **OkHttp** | Java | ~640 | 17% | 41% | 36% | 64% |
| **Gin** | Go | ~150 | 22% | 23% | 34% | 19% |
| **Alamofire** | Swift | ~100 | 38% | 59% | 51% | 77% |
| **平均** | — | — | **35%** | **57%** | **46%** | **71%** |

一个关键发现：**项目越大，收益越明显**。VS Code 上工具调用从 23 次降到 7 次，Token 从 140 万降到 39 万。小项目（Gin ~150 文件）本身搜索就快，差距不大。

原理很直接：有 CodeGraph 时，Agent 用 `codegraph_context` 定位区域，一次 `codegraph_explore` 获取相关源码，然后直接回答——通常零文件读取。没有 CodeGraph 时，Agent（以及它启动的子 Agent）把大部分预算花在发现（`find`/`ls`/`grep`）上。

---

## 核心能力详解

### 消除"探索税"

CodeGraph 最核心的价值是消除了 Agent 的"探索税"。传统方式和 CodeGraph 的对比：

```text
传统方式：
  Agent → grep "auth" → 匹配 50+ 结果 → 逐个 Read → 猜测调用关系
  20-80 次工具调用，大量 token 消耗

CodeGraph 方式：
  Agent → codegraph_context "用户认证流程" → 一次返回入口 + 上下文
  通常 3-7 次工具调用，token 节省 57%
```

### 框架感知路由

CodeGraph 不只理解代码结构，还理解 Web 框架的路由。它能识别路由声明文件，把 URL 模式链接到对应的处理函数。查询某个 Controller 的调用者时，会同时显示绑定了它的 URL 路径。

支持 14 类框架的路由识别：

| 类别 | 框架 |
|------|------|
| **Python** | Django（`path`/`re_path`/`url`/`include`）、Flask、FastAPI |
| **TypeScript** | Express、NestJS（含 GraphQL/WebSocket） |
| **PHP** | Laravel |
| **PHP (CMS)** | Drupal（`*.routing.yml` + `hook_*`） |
| **Ruby** | Rails |
| **Java** | Spring（`@GetMapping` 等） |
| **Go** | Gin / chi / gorilla / mux |
| **Rust** | Axum / actix / Rocket |
| **C#** | ASP.NET（`[HttpGet]`） |
| **Swift** | Vapor |
| **前端路由** | React Router / SvelteKit |

这意味着你可以让 Agent 问"POST `/api/users` 这个接口的实现在哪？影响哪些下游？"——一次 `codegraph_impact` 直接出结果。

### CI 集成：只跑受影响的测试

`codegraph affected` 命令基于图反向追踪"我改了 `src/auth.ts`，哪些测试文件会被影响"，可以塞进 CI 只跑相关测试：

```bash
# 只运行受变更影响的测试
git diff --name-only HEAD | codegraph affected --stdin --quiet | xargs vitest run
```

### 作为库使用

CodeGraph 也可以作为 TypeScript 库嵌入到其他工具中：

```typescript
import CodeGraph from '@colbymchenry/codegraph';

const cg = await CodeGraph.init('/path/to/project');

// 全量索引（带进度回调）
await cg.indexAll({
  onProgress: (p) => console.log(`${p.phase}: ${p.current}/${p.total}`)
});

// 按名称搜索符号
const results = cg.searchNodes('UserService');

// 查询调用方
const callers = cg.getCallers(results[0].node.id);

// 为任务构建上下文
const context = await cg.buildContext('fix login bug', {
  maxNodes: 20,
  includeCode: true,
  format: 'markdown'
});

// 影响范围分析
const impact = cg.getImpactRadius(results[0].node.id, 2);

// 自动同步文件变化
cg.watch();
```

---

## 实战：如何使用 CodeGraph

### 一行安装

不需要 Node.js，安装脚本自带运行时：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh

# Windows PowerShell
irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex

# 如果有 Node.js
npx @colbymchenry/codegraph
```

安装器会交互式引导你选择要配置的 Agent（自动检测已安装的 Claude Code、Cursor、Codex CLI、OpenCode、Hermes Agent），自动写入 MCP 配置和指令文件。

### 初始化项目

```bash
cd your-project
codegraph init -i
```

这一步构建项目知识图谱索引。完成后 `.codegraph/` 目录出现在项目根目录。

### 重启 Agent

重启 Claude Code / Cursor / Codex 即可。Agent 检测到 `.codegraph/` 目录会自动使用 CodeGraph 工具。

### CLI 命令一览

| 命令 | 功能 |
|------|------|
| `codegraph init -i` | 初始化项目 + 全量索引 |
| `codegraph serve --mcp` | 启动 MCP 服务（Agent 会自动拉起，通常不用手动跑） |
| `codegraph index` | 重新索引 |
| `codegraph sync` | 增量更新 |
| `codegraph query <name>` | 按名称查询符号 |
| `codegraph context <task>` | 为任务构建上下文 |
| `codegraph impact <symbol>` | 分析影响范围 |
| `codegraph affected` | CI 用：找出受变更影响的测试文件 |
| `codegraph uninstall` | 从所有 Agent 中移除 CodeGraph |

---

## 语言支持

CodeGraph 通过 tree-sitter 支持 21 种编程语言，覆盖主流开发场景：

| 类别 | 语言 |
|------|------|
| **Web/脚本** | TypeScript、JavaScript、Python、Ruby、PHP、Lua |
| **系统语言** | C、C++、Rust、Go |
| **JVM 生态** | Java、Kotlin、Scala |
| **移动端** | Swift、Dart |
| **企业级** | C# |
| **前端框架** | Svelte（含 Svelte 5 runes 和 SvelteKit 路由）、Vue（含 Nuxt） |
| **模板引擎** | Liquid（Shopify 主题） |
| **其他** | Pascal-Delphi（含 DFM/FMX 表单文件）、Luau（Roblox） |

零配置——自动根据文件扩展名识别语言，自动遵循 `.gitignore` 规则。

---

## 设计洞察：code RAG ≠ document RAG

CodeGraph 的演化过程本身比代码更有启发性。项目早期曾设计了完整的向量搜索模块——基于 ONNX 跑 384 维 `nomic-embed-text-v1.5` 嵌入，存入 SQLite vss 向量索引。但在生产实测后，**整个向量搜索和 embedding 模块被移除了**。

作者的理由很简单：对 Agent 的探索性查询，**"符号名 + FTS5 全文搜索 + 图遍历"已经把 95% 的问题解决了**，引入 embedding 增加的延迟和不确定性反而把好不容易省下的 tool call 又花了回去。

这给所有 AI Agent 工程师一个重要的提醒：

> **code RAG ≠ document RAG。**

代码有 AST，有调用图，有静态可推导的关系——这些结构化信息是确定性的、一次计算即可复用的。应该**先把这些吃掉，再考虑用 embedding 补语义层**。普通文档没有 AST、没有调用关系，只能靠向量语义近似——但代码不一样。把代码当作普通文档来做 RAG，等于放弃了代码最宝贵的结构信息。

这个洞察可以总结为一条优先级原则：

```text
1. 精确结构关系（调用图、import、继承）   ← 先吃掉，确定性、可复现
2. 符号名全文搜索（FTS5/BM25）              ← 再用，精确匹配标识符
3. 语义向量检索（embedding）                ← 最后补，处理模糊语义查询
```

---

## 适用场景与建议

### 适合用 CodeGraph 的情况

- 主力 Agent 是 Claude Code / Codex CLI / Cursor agent 模式，且经常在 **1 万文件以上**的项目里工作
- 不能或不想把源码上传到 SaaS（合规、隐私、纯偏好均算）
- 看重"调用链、影响分析、impact radius"这类**精确结构化问题**胜过"语义模糊匹配"
- 想要零配置——`codegraph init` 一条命令就完事，没有 embedding 模型选型、没有向量库、没有 API key

### 不建议用 CodeGraph 的情况

- 需要跨多仓推理——CodeGraph 是**单仓本地索引**，不做 cross-repo
- 主要场景是"我不记得这段逻辑在哪、按语义找一下"——纯 embedding 工具（Cursor 内建、Continue）在这类查询上更稳
- 是企业，需要 SOC 2 / 单租户 / BYOK / 跨百仓——Sourcegraph、Augment、Potpie 是更合适的天花板
- 需要真正的类型推断和泛型解析做安全分析——SCIP/CodeQL 路线更准

---

## 附录：Code RAG 赛道全景对比

面向 AI Agent 做代码上下文的工具，按"如何表示代码"可以分为五派：

| 派别 | 工具 | 核心表示 | 索引位置 | 给 Agent 的接口 | 主要场景 |
|------|------|---------|---------|---------------|--------|
| **图派** | **CodeGraph** | tree-sitter AST → SQLite 图 + FTS5 | 本地 | MCP（10 个工具） | Claude Code/Cursor 等 Agent 的探索加速 |
| **图派（重）** | Potpie.ai | Neo4j 属性图 + LLM 生成 docstring | 服务端 | FastAPI + 专用 Agent | 企业 spec-driven 大代码库 |
| **Tag 派** | Aider repo map | tree-sitter tags + PageRank | 本地 | 拼到 prompt 里 | Aider 终端 pair programming |
| **Embedding 派** | Cursor 内建索引 | 文件分块 → embedding | 远端 Turbopuffer + Merkle 树 | @Codebase | Cursor IDE 内 |
| **Embedding 派** | Continue.dev | tree-sitter 分块 + embedding + FTS | 本地 ~/.continue/index | @Codebase / @Folder | Continue IDE 插件 |
| **SCIP 派** | Sourcegraph Cody | SCIP（编译器级精确抽取） + embedding | 远端 Sourcegraph 实例 | 内建 + MCP server | 企业代码搜索 |
| **专有引擎派** | Augment Code | 语义索引（专有 Context Engine） | 远端 | MCP（远端 HTTPS） | 企业级 Agent，跨仓 |
| **全文拼接派** | Repomix / Code2Prompt / yek | 整库拼成大文本 | 本地 | 复制粘贴 / MCP | 给长上下文 LLM 做一次性 dump |
| **安全分析派** | CodeQL | 数据流 + 控制流 facts → Datalog | 本地 | QL 查询 | 安全分析 / variant analysis |

### 各派关键差异

**图派 vs Embedding 派**：这是最核心的路线分歧。图派的调用关系是**精确的**——`codegraph_callers(validateToken)` 返回的每个函数都真正调用了它。Embedding 派的调用关系靠语义近似，`validateToken` 和 `checkAuth` 语义相近但可能毫无调用关系。反过来，问"日志系统在哪里实现"这类模糊语义查询，图派不一定胜过 embedding。两条路线各有擅场。

**图派 vs Tag 派**：Aider 用 PageRank 给整个 repo 的符号排序，在一个 token budget 里塞最重要的 N 个 tags 进 prompt。这是"**预算化的静态摘要**"。CodeGraph 是"**按需图查询**"——Agent 自己决定问哪一片，每次只取相关子图。对 Aider 这种"一次会话改几个文件"的 pair programming 模式，PageRank 摘要足够好；对 Claude Code 这种"先 explore subagent 摸清架构"的 Agent 流水线，按需查询更省 token。

**图派 vs SCIP 派**：Sourcegraph Cody 用 SCIP（LSIF 后继）通过编译器/类型检查器精确抽取符号，比 tree-sitter 更准（懂泛型实例化、懂 import resolution 的所有边角），代价是每种语言都要一个专门的 indexer 且要能编译。CodeGraph 用 tree-sitter 牺牲了类型精度，但换来了零编译依赖和统一部署。

**本地 vs 远端**：CodeGraph 和 Aider/Continue 是本地优先——索引文件不离开你的机器，零 API key、零外部服务。Cursor/Cody/Augment 是远端优先——需要上传代码到服务器，但有更强的算力和跨仓能力。对个人开发者和不愿外传源码的团队，本地优先是硬性优势；对需要跨百仓导航的大型组织，远端是天花板。

**精确定义查询 vs 模糊语义查询**

| 查询类型 | 图派（CodeGraph） | Embedding 派（Cursor） |
|---------|-----------------|---------------------|
| "`Session.request()` 调到 `URLSession.dataTask()` 经过哪几个函数？" | ✅ 精确返回完整调用链 | ❌ 语义近似无法保证链路完整性 |
| "改这个函数会影响哪些测试？" | ✅ 精确影响范围分析 | ❌ 无法区分"名字相似"和"真正调用" |
| "日志系统在哪里实现？" | ⚠️ 靠符号名+FTS5，可能不够语义化 | ✅ 语义近似效果好 |
| "限流逻辑在哪个模块？" | ⚠️ 靠图遍历+名称匹配 | ✅ 模糊语义查询更稳 |
