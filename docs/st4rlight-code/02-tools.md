---
title: 02. 工具系统
tags:
  - st4rlight-code
  - 工具系统
  - 内置工具
  - read_file
  - edit_file
excerpt: 构建 agent 的工具系统：从 read_file 到 12 个内置工具，讲工具的本质三要素、edit_file 的防错设计、read-before-edit 安全机制、50K 结果截断、ToolSearch 延迟加载。
createTime: 2026/08/16 14:00:00
permalink: /st4rlight-code/02-tools/
---

# 02. 工具系统

上一章的循环已经能在模型要调用工具时接住它、执行、把结果喂回去——但手上一个工具都还没有。这一章从最小的 `read_file` 开始，构建完整的内置工具系统。

## 工具的本质：三要素

一个工具就是三样东西：

1. **名字**（`name`）
2. **给模型看的说明**（`description` + `parameters`）——让模型知道这个工具能干什么、参数怎么填
3. **干活的函数**——真正执行的逻辑

```ts
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "读取指定路径的文件内容，返回带行号的文本...",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "要读取的文件路径" },
    },
    required: ["file_path"],
  },
};
```

> 为什么用静态数组 + switch 分发而非类？Claude Code 用类体系是因为 66+ 工具需要继承、多态。12 个工具用数组 + switch 就够了——**简单性本身就是价值**。

## 当前内置工具（12 个）

```
src/tools/builtin/
├── readFile.ts        # read_file    读取文件（带行号）
├── fileEditTools.ts   # write_file   写入文件（自动建目录）
│                      # edit_file    精确字符串替换
├── searchTools.ts     # list_files   按 glob 列文件
│                      # grep_search  正则搜索
├── shellTools.ts      # run_shell    执行 Shell 命令
├── webFetch.ts        # web_fetch    抓取 URL 内容
├── toolSearch.ts      # tool_search  激活延迟加载工具
├── basicTools.ts      # calculator / get_now
├── testTools.ts       # mock_plan_mode（deferred 测试工具）
└── index.ts           # 统一注册 + switch 分发
```

## 六个核心文件工具

### read_file — 读文件

```ts
const content = readFileSync(input.file_path, "utf-8");
const numbered = content
  .split("\n")
  .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
  .join("\n");
return numbered;
```

**设计点**：加行号让 LLM 定位代码位置。但注意——`edit_file` 匹配时用的是实际内容字符串，不是行号。

### write_file — 写文件

```ts
const dir = dirname(input.file_path);
if (dir && !existsSync(dir)) {
  mkdirSync(dir, { recursive: true });  // mkdir -p 效果
}
writeFileSync(input.file_path, input.content);
```

**设计点**：自动创建父目录，避免模型额外调用 shell 建目录。System Prompt 会告诉模型：**优先用 `edit_file`，只对新文件用 `write_file`**。

### edit_file — 最关键的工具（唯一有坑的工具）

```ts
const actual = findActualString(content, input.old_string);
if (actual === null) {
  return `Error: old_string not found in ${input.file_path}`;
}
const count = content.split(actual).length - 1;
if (count > 1) {
  return `Error: old_string found ${count} times. Must be unique.`;
}
const updated = content.split(actual).join(input.new_string);
writeFileSync(input.file_path, updated);
```

**两个核心防护**：

| 情况 | 含义 | 处理 |
|------|------|------|
| 匹配 0 次 | 模型对文件内容记忆有误（**幻觉检测**） | 返回错误，模型重新读取 |
| 匹配 > 1 次 | 模型提供的上下文不够 | 要求提供更多上下文唯一标识 |

> **核心哲学："宁可失败也不猜测"**——静默替换第一个匹配远比告知失败危险。

### list_files — 列文件

用 `glob` 库按模式匹配，忽略 `node_modules`、`.git`，截断 200 条。

### grep_search — 搜文件

优先系统 `grep`，不可用时回退 JS 遍历：

```ts
const args = ["--line-number", "--color=never", "-r"];
if (input.include) {
  args.push(`--include=${input.include}`);
}
args.push("--", input.pattern, input.path || ".");
```

**设计点**：
- `--color=never` 禁用 ANSI 颜色码（输出给模型看的，不需要颜色）
- `--` 分隔符确保以 `-` 开头的 pattern 不被误解析为选项
- **grep 退出码 1 表示"无匹配"不是错误**，2+ 才是真错误
- 结果截断前 100 条，附加 `... and N more matches` 提示

> Claude Code 用 ripgrep（`rg`），我们用系统 `grep`——功能够用，少一个依赖。

### run_shell — 执行命令

```ts
execSync(input.command, {
  timeout: input.timeout ?? 30000,   // timeout 保护
  stdio: ["pipe", "pipe", "pipe"],
  shell: "/bin/sh",
}) || "(no output)";
```

**设计点**：
- 失败时**同时返回 stdout 和 stderr**——很多编译器在 stderr 报错的同时，stdout 可能有有用的部分输出
- `"(no output)"` 避免模型对无输出的成功命令（`mkdir`、`touch`）困惑
- 支持调用方传入 `timeout`

## 工具分发器与结果截断

### switch 分发器

```ts
export const builtinToolExecutor: ToolExecutor = (name, args, context) => {
  switch (name) {
    case "read_file": ...
    case "write_file": ...
    case "edit_file": ...
    default: return `未知内置工具: ${name}`;
  }
};
```

**设计点**：`default` 分支返回字符串而非抛异常——体现 **"错误是数据"**，让模型自我纠正幻觉出的工具名。

### 结果截断（50K 保护）

```ts
export function truncateResult(result: string): string {
  if (result.length <= MAX_RESULT_CHARS) return result;
  const keepEach = Math.floor((MAX_RESULT_CHARS - 60) / 2);
  return (
    result.slice(0, keepEach) +
    `\n\n[... truncated ${result.length - keepEach * 2} chars ...]\n\n` +
    result.slice(-keepEach)
  );
}
```

**设计点**：保留头尾而非只留头部——很多命令的关键输出在末尾（编译错误摘要、测试统计）。截断提示告知模型，模型可据此决定是否用 `grep_search` 或 `read_file` 获取完整内容。

## 进阶防护机制

### 引号容错

LLM 的 tokenization 可能把直引号映射成弯引号（`"` → `"`），没有容错这类编辑会 100% 失败：

```ts
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u2032]/g, "'")   // 弯单引号 → 直单引号
    .replace(/[\u201C\u201D\u2033]/g, '"');  // 弯双引号 → 直双引号
}

function findActualString(fileContent, searchString): string | null {
  if (fileContent.includes(searchString)) return searchString;
  const normSearch = normalizeQuotes(searchString);
  const normFile = normalizeQuotes(fileContent);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) return fileContent.substring(idx, idx + searchString.length);
  return null;
}
```

**关键细节**：匹配成功后返回**文件中的原始字符串**而非标准化版本，保持文件原始字符风格。编辑成功还生成简易 diff。

### Read-before-edit + mtime 防护

Claude Code 的重要安全机制：**编辑文件前必须先读取**，防止基于过时记忆盲目修改，同时用 mtime 检测外部修改。

```ts
// readFileState Map 在 Agent 实例中维护：filepath → mtimeMs
case "write_file": {
  const guard = checkBeforeWrite(context, String(args.file_path));
  if (guard !== null) {
    return guard;   // 拦截错误/警告
  }
  ...
}
```

**三个关键点**：
1. **新文件跳过检查**：`existsSync` 为 false 时不强制先读
2. **mtime 比较**：读取时记录，写入前比较。不一致说明文件被外部修改，返回警告而非静默覆盖
3. 对齐 Claude Code 的 `readFileTimestamps`——**编辑必须基于已知状态，不能"盲写"**

## 网络访问：web_fetch

让 Agent 能访问 URL——查文档、读 API 响应、抓网页：

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);  // 30s
const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "st4rlight-code" } });
```

**设计选择**：
- **30 秒超时**：防止模型访问慢速 URL 阻塞整个循环
- **HTML 去标签**：去掉 script/style、标签转空格、处理实体——LLM 不需要看 HTML 标签，纯文本更高效
- **50KB 上限**：避免网页内容挤占上下文窗口

## ToolSearch 延迟加载

工具多了以后，把所有 schema 发给 API **浪费大量 token**。做法：不常用工具只发名称，模型需要时通过 `tool_search` 按需激活。

```ts
// 标记延迟加载
{ name: "mock_plan_mode", ..., deferred: true }

// 过滤未激活的 deferred 工具
export function getActiveToolDefinitions(tools, activated): ToolDefinition[] {
  return tools
    .filter(t => !t.deferred || activated.has(t.name))
    .map(({ deferred, ...rest }) => rest);
}

// tool_search 执行：匹配 → 激活 → 返回 schema
case "tool_search": {
  const matches = deferred.filter(t => ...匹配...);
  for (const m of matches) activateTool(m.name);
  return JSON.stringify(matches.map(t => ({ name, description, parameters })), null, 2);
}
```

**工作流程**：
1. API 调用时过滤掉未激活的 deferred 工具（只发名称，不发 schema）
2. System prompt 用 `getDeferredToolNames()` 告知模型哪些工具可激活
3. 模型调用 `tool_search`，匹配的工具被加入 `activatedTools` Set
4. 下一次 API 调用自动包含已激活工具的完整 schema

**实测效果**（模型实际运行）：
```
⏱ 调用工具 tool_search {"query":"mock_plan_mode"}
✓ 工具结果 tool_search [ 返回 mock_plan_mode 的完整 schema ]
⏱ 调用工具 mock_plan_mode {}
✓ 工具结果 mock_plan_mode Mock plan mode activated.
```

## 与真实 Claude Code 的对比

### 简化决策对比表

| 维度 | Claude Code | 我们的实现 |
|------|------------|------------|
| 工具数量 | 66+，每工具独立目录 | 12 个，1 个 tools 目录 + switch |
| 执行模式 | 并发执行 + streaming 早期启动 | 串行逐个执行 |
| 搜索引擎 | ripgrep（rg） | 系统 grep |
| 编辑验证 | 14 步流水线 + readFileTimestamps | 引号容错 + 唯一性 + diff + read-before-edit + mtime |
| Shell 安全 | AST 解析 + 沙箱 | timeout 保护 |
| 结果截断 | 选择性裁剪 + 磁盘持久化 | 保留头尾 50K |
| 延迟加载 | deferred tools + ToolSearch | deferred 标记 + tool_search |
| 网络访问 | WebFetch（去标签 + 超时） | web_fetch（去标签 + 30s 超时 + 50KB 上限） |

### 为什么用 search-and-replace

| 方案 | 致命缺陷 |
|------|---------|
| 行号编辑 | 位置相关：插入 3 行后所有行号偏移，多步编辑需复杂重算 |
| AST 编辑 | 语法错误的文件恰恰最需要编辑，而 AST 解析器遇语法错误会直接报错 |
| Unified diff | LLM 生成严格格式表现差：行号、前缀任一出错则 patch 无法应用 |
| 全文件重写 | 大文件浪费 Token；模型可能遗漏未修改代码；用户无法快速 review |
| **字符串替换** | ✅ 无上述缺陷，且**幻觉安全**：模型提供不存在的字符串直接失败 |

## 本章总结

1. **工具三要素**：名字、给模型看的说明、干活的函数——用静态数组 + switch 分发即可
2. **`edit_file` 是最关键的工具**：唯一性检查（幻觉检测）+ 引号容错 + 生成 diff
3. **Read-before-edit + mtime 防护**：防止盲写和覆盖外部修改
4. **错误是数据，不是异常**：所有失败都返回字符串让模型自我纠正
5. **50K 截断**：保留头尾，防止上下文爆炸
6. **延迟加载**：不常用的工具只发名称，按需激活省 token

> **下一章预告**：工具定义了 agent 的能力，但 System Prompt 定义了它的行为——怎么用这些工具、什么时候该小心。
