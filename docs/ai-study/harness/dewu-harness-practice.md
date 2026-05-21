---
title: 得物数仓Harness实战
tags:
  - Claude Code
  - Harness
  - Hooks
  - Subagent
  - 数仓
excerpt: 得物数仓场景下 Claude Code Harness 体系实战，从核心痛点出发，系统梳理五层防御体系、Hooks 机制、Subagent 隔离与 8 步骤数仓需求开发工作流。
createTime: 2026/05/21 10:00:00
permalink: /ai-study/dewu-harness-practice/
---

# 得物数仓Harness实战

> 原文链接：[得物数仓Harness实战](https://mp.weixin.qq.com/s/KmQJU7nXmYh5qgWPj4ajlw)

## 核心痛点

- **AI不记得上下文约束**：开发过程中反复失忆，由于上下文压缩导致的一些临时约束被丢弃
- **规范执行不稳定**：
  - AI和人工通过记忆对于规范的遵守程度都不是很高
  - 把规范从"LLM 记忆中的指导性内容"变成"每次执行时强制检查的护栏"
- **大型需求中，context被撑满后，约到后期AI越不可靠**
  - 越是复杂的需求，越依赖 AI；但越复杂的需求，context 越容易撑满，AI 越容易"失忆"

## 解决方案

- 把规范写进 **hooks**，不再靠 AI 记忆，每次写 SQL 文件后自动触发检查
- 把迭代约束写进 **持久化文件**，compact 后自动重新注入，不再靠临时口头说
- 把高 token 操作隔离到 **subagent**，主 context 只接收摘要，不被过程数据撑满

## ClaudeCode机制

| 机制 | 执行者 | 特性 |
|------|--------|------|
| CLAUDE.md/Skill内容 | Claude（LLM） | 指导性，可能被忽略 |
| settings.json hooks | Harness（运行时） | 确定性，强制执行 |
| subagents | 独立context窗口 | 隔离型，结果摘要返回 |

## 核心问题：压缩后丢失了什么

看起来对于各种约束规范的使用也是有规矩的，不是随便用用。

| 内容 | compact后状态 |
|------|--------------|
| ~/.claude/CLAUDE.md (全局) | 不丢，从磁盘重新注入 |
| 项目 .claude/CLAUDE.md | 不丢，从磁盘重新注入 |
| Auto Memory (MEMORY.md) | 不丢，从磁盘重新注入 (前200行/25KB) |
| 本次对话临时口头指令 | **全部丢失** |
| 当前迭代的表名、node id、版本号 | **丢失** (除非写进CLAUDE.md) |
| 已加载的 Skill文件内容 | **可能丢失** (最早调用的优先被清除) |
| path-scoped rules (带 paths:字段的规则) | **丢失**，等下次读取匹配文件时才重新加载 |
| hooks配置 | **不受影响** (hooks是代码，不是 context) |

## 五层防御体系

### 1、写进Claude.md

**机制**：项目根目录 `.claude/CLAUDE.md` 每次 compact 后从磁盘重新注入，是最可靠的持久化位置。

**建议**：将当前需求的关键信息写入。

**操作规则**：

- 进入新迭代时，更新"正在开发"和"本次迭代约束"两节；
- 上线后清空"本次迭代约束"；
- 全局规范长期保留，控制在 100 行以内。

### 2、AutoMemory自动积累

**机制**：Claude 自动将跨会话发现写入 `~/.claude/projects/<project>/memory/MEMORY.md`，每次 compact 后重新注入。

**建议**：一些关键机制和约束在对话过程中主要要求写入，Claude 会自动写入 MEMORY.md，下次会话或 compact 后自动恢复。

### 3、hooks自动验证（核心防御）

这是解决"每次写完 SQL 自动检查"的关键机制。

**目录结构**：

```text
数仓项目根目录/
└── .claude/
    ├── settings.json          ← hooks 在这里配置
    ├── CLAUDE.md              ← 数仓规范上下文
    └── hooks/
        ├── validate_sql.sh          ← SQL 规范自动检查
        ├── block_dangerous_ddl.sh   ← 危险 DDL 拦截
        └── inject_context.sh        ← compact 后重注入上下文
```

**settings.json 配置**：

```json
{
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "Write|Edit",
                "hooks": [
                    {
                        "type": "command",
                        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/validate_sql.sh",
                        "timeout": 60,
                        "statusMessage": "检查 SQL 规范..."
                    }
                ]
            }
        ],
        "PreToolUse": [
            {
                "matcher": "Bash",
                "hooks": [
                    {
                        "type": "command",
                        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block_dangerous_ddl.sh"
                    }
                ]
            }
        ],
        "SessionStart": [
            {
                "matcher": "compact",
                "hooks": [
                    {
                        "type": "command",
                        "command": "cat \"$CLAUDE_PROJECT_DIR\"/.claude/context/dw_conventions.md",
                        "statusMessage": "重注入数仓规范..."
                    }
                ]
            }
        ],
        "Stop": [
            {
                "hooks": [
                    {
                        "type": "prompt",
                        "prompt": "检查用户要求的所有任务是否都已完成。如果还有未完成项，返回提示但不要重新开始。检查 stop_hook_active 是否为 true，如是则直接 exit。",
                        "model": "claude-haiku-4-5-20251001"
                    }
                ]
            }
        ]
    }
}
```

**SQL 规范自动检查脚本 validate_sql.sh**：

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)

# 只处理 .sql 文件
[[ "$FILE_PATH" != *.sql ]] && exit 0
[[ -z "$FILE_PATH" ]] && exit 0

SQL=$(cat "$FILE_PATH" 2>/dev/null)
[[ -z "$SQL" ]] && exit 0

ERRORS=()

# 规范1：禁止 SELECT *
echo "$SQL" | grep -iqE 'SELECT\s+\*' && ERRORS+=("CRITICAL: 发现 SELECT *，必须明确列名")

# 规范2：INSERT 必须带 PARTITION
if echo "$SQL" | grep -iqE 'INSERT\s+(INTO|OVERWRITE)'; then
    echo "$SQL" | grep -iqE 'PARTITION\s*\(' || ERRORS+=("CRITICAL: INSERT 缺少 PARTITION 子句")
fi

# 规范3：DOUBLE 类型金额
echo "$SQL" | grep -iqE '\bDOUBLE\b' && ERRORS+=("WARNING: 金额字段建议用 DECIMAL(20,4)，不用 DOUBLE")

# 规范4：UPDATE/DELETE 必须有 WHERE
if echo "$SQL" | grep -iqE '\b(UPDATE|DELETE)\b'; then
    echo "$SQL" | grep -iqE '\bWHERE\b' || ERRORS+=("CRITICAL: UPDATE/DELETE 缺少 WHERE 条件")
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo "=== SQL 规范检查失败：$FILE_PATH ===" >&2
    for err in "${ERRORS[@]}"; do
        echo "  $err" >&2
    done
    exit 2
fi

echo "SQL 规范检查通过: $(basename $FILE_PATH)" >&2
exit 0
```

**危险 DDL 拦截脚本 block_dangerous_ddl.sh**：

```bash
#!/bin/bash
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# 拦截生产表 DROP/TRUNCATE（放行 _dev/_test/_stg 后缀）
if echo "$CMD" | grep -iqE '\b(DROP\s+TABLE|TRUNCATE\s+TABLE)\b'; then
    if ! echo "$CMD" | grep -qiE '(_dev|_test|_stg)\b'; then
        echo "BLOCKED: 检测到生产表 DROP/TRUNCATE 操作，请确认表名是否正确" >&2
        exit 2
    fi
fi

exit 0
```

**hook 通信协议关键规则**：

| exit code | 含义 | 数仓场景用途 |
|-----------|------|-------------|
| 0 | 通过，继续 | 检查无问题 |
| 1 | 阻断，stderr内容反馈给Claude | SQL违规、危险操作 |
| 2 | 非阻断，仅记录日志 | 警告但不影响流程 |

### 4、subagents做上下文隔离

**核心原则**：把"高 token 消耗但结果只需要摘要"的操作放到 subagent 的独立 context 中执行。

### 5、SKILL 文件改造（减少 context 消耗）

- **当前的问题**
  - 每次调用 SKILL 文件（01~08.md），内容全部加载进主 context，加速 compact 触发。
- **改造方向**
  - 把 SKILL 文件的"执行步骤"提炼成 subagent 指令，subagent 内部读完整 SKILL 文件
  - 主 context 只接收结果摘要；
  - 用 path-scoped rules 替代 SKILL 文件中的规范章节，按需加载

## 数仓Harness架构

不同类型的工作交给最合适的机制去做，而不是全部压在 Claude 的推理循环里。

- **持久化层**：解决的是"失忆"问题
  - 任何临时口头说的约束，compact 后都会消失；
  - 但写进 `.claude/CLAUDE.md` 的内容，每次会话启动和 compact 后都会从磁盘重新注入——这是整套方案里最简单也最可靠的一层。

- **Harness 层（Hooks）**：解决的是"规范靠记忆"的问题
  - PostToolUse hook 在每次写 .sql 文件后确定性触发，不依赖 Claude 有没有记住规范要求；
  - 违规时 exit 2 强制阻断，Claude 必须修正后才能继续，规范遵守率从 70%~80% 提升到 95%+

- **Subagent 层**：解决的是"context 被撑满"的问题
  - 血缘查询、23 项自测、数据比对这类操作会产生大量 token，放到独立 context 的 subagent 里执行
  - 主会话只接收一份摘要，compact 触发频率预计降低 50%~70%

## 8步骤数仓需求开发

从 Harness 架构的视角来看，8 个步骤可以按"对 context 的影响"分成两类：

- **一类是直接在主会话处理**（内容量有限，context 压力低）：
  - 需求分析（读 PRD）
  - 技术设计（写规范说明）
  - SR 导入（生成配置）
  - SLA/DQC（生成规则）

- **另一类必须通过 Harness 机制处理**（否则会加速 compact 或规范失控）：
  - ETL 开发每次写 .sql 文件 → PostToolUse hook 自动触发规范检查，不依赖人工提醒；
  - 自测时 23 条 SQL 的执行结果体量大 → 交给 data-quality-checker subagent 隔离，主会话只收 PASS/FAIL 摘要；
  - 数据比对时两表样本数据量大 → 交给 data-comparator subagent 隔离；
  - 性能优化时血缘 + 多层 DDL 每次 500~3000 tokens → 交给 dw-explorer subagent 隔离。

这种分工不是把步骤拆开独立执行，而是在同一个工作流里，让每个步骤以最合适的方式运行——context 压力小的步骤留在主会话保持流畅，context 压力大的步骤通过 subagent 隔离保持干净，规范检查通过 hook 自动执行不需要人工干预。

## 各步骤推荐提示词与工作流

### Step 1：需求分析

用 dw-explorer subagent 先读取上游表结构（只返回摘要），然后按需求分析规范生成：

1. 需求摘要（≤5行）
2. 表字段口径草稿
3. 待确认问题清单（按优先级排序）

需求文档 URL：[粘贴PRD链接]

**Hook 配合**：SessionStart 注入当前迭代约束（版本号/表名/禁止修改的表）。

### Step 2：技术设计

基于上一步确认的需求，按 OneData 规范完成技术设计：

- 表名：[按 层级_域_主题_粒度_周期 格式命名]
- 粒度：[描述]
- 分区：partition_dt string（格式 yyyyMMdd）
- 禁止：任何与上游不一致的字段命名

输出 OneData 建模说明，不超过 60 行

**CLAUDE.md 写入**（设计完成后手动更新）：

```text
## 当前迭代技术设计决策
- 表名：db_a.dws_table_a
- 主键：order_no + partition_dt
- 特殊约束：amount 字段继承上游千元单位，不做转换
```

### Step 3：ETL 开发

这是 Harness 工程价值最高的步骤，PostToolUse hook 在每次 SQL 文件保存时自动触发。

按 ETL 开发规范生成建表 DDL + Insert SQL：

- 建表文件：ddl_[表名].sql
- 插入文件：insert_[表名].sql
- 要求：INSERT 用 OVERWRITE 模式，PARTITION 子句必须包含 partition_dt
- 金额字段：DECIMAL(20,4)，单位继承上游（千元）

生成完毕后，用 sql-validator subagent 验证两个文件

**Hook 自动执行**（无需手动触发）：每次写入 .sql 文件 → PostToolUse hook 自动运行规范检查。若发现 SELECT * 或缺少 PARTITION → 返回 exit 2，Claude 收到错误自动修正。

### Step 4：自测

用 data-quality-checker subagent 对 [表名] 执行 23 项标准自测，bizdate = [日期]

补充口径约束：[如"is_perform=1 只取履约订单"]

只返回：PASS/FAIL 汇总 + FAIL 项详情（≤50行），不返回原始 SQL 执行结果

**效果**：23 条 SQL 的执行结果全在 subagent context 里，主对话只收到一份摘要报告。

### Step 5：数据比对

用 data-comparator subagent 对比：

- 新表：[新表名] partition_dt = [日期]
- 参考表：[旧表名/线上表]
- 比对字段：[核心金额字段列表]
- 容差：≤ 0.01%（金额类）

只返回：差异超过容差的字段列表 + 差值，不返回全量对比数据

### Step 6：SR数据库导入

用 dw-sr SKILL 生成建表任务，先查以下表的 DDL 和一层上下游血缘（只返回摘要）：

- 源表：[ODPS表名]
- 目标表：[SR表名]

然后基于 DDL 摘要，分析当前 SR 同步任务的配置风险：

1. 字段类型是否有精度丢失风险（DECIMAL/DOUBLE → DECIMAL(38,18)）
2. Key 字段选择是否合理（重复率是否过高导致 DUPLICATE KEY 膨胀）
3. 分区数量是否合理（partition_live_number 与下游查询窗口是否匹配）
4. DISTRIBUTED BY HASH 的 bucket 数与数据量是否匹配
5. 是否有 DATETIME 字段在 SR 侧用了 VARCHAR 存储（会导致时间过滤走全表扫描）

输出同步任务配置建议（按风险高低排序），不超过 20 行。每条格式：`[风险等级 高/中/低] 问题描述 → 建议修改方式`

### Step 7：性能优化

用 dw-explorer subagent 先查 [表名] 的一层上下游血缘和 DDL（只返回摘要），然后分析当前 Insert SQL 的性能瓶颈：

1. 是否有全表扫描
2. 是否有笛卡尔积风险
3. 是否可以用 MAP JOIN 替代 HASH JOIN

输出优化建议（按收益排序），不超过 30 行

### Step 8：SLA/DQC

（待补充）
