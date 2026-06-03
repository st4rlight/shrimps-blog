---
title: MySQL2Hive 工作原理
tags:
  - 数据仓库
  - MySQL
  - Hive
  - Binlog
  - 数据同步
  - 离线数仓
excerpt: 系统梳理 MySQL 数据同步到 Hive 的两种核心方案——全量同步与增量同步，从传统 Select+Load 方案的瓶颈出发，深入剖析基于 CDC（Binlog 采集 + 离线 Merge 还原）的增量同步架构原理、关键机制与工程实践。
createTime: 2026/06/03 10:00:00
permalink: /notes/mysql2hive-sync-principle/
---

# MySQL2Hive 工作原理

> 在离线数仓建设中，将 MySQL 业务数据准确、高效地同步到 Hive 是 ODS 层数据接入的核心环节。本文从传统全量同步方案的瓶颈出发，深入剖析基于 Binlog 的 CDC + Merge 增量同步架构，厘清全量与增量两种方案的原理、优劣及适用场景。

[[TOC]]

---

## 一、背景与问题

在数据仓库建模中，未经任何加工处理的原始业务层数据，我们称之为 **ODS（Operational Data Store）** 数据。在互联网企业中，常见的 ODS 数据有两类：

- **业务日志数据（Log）**：如用户行为日志、访问日志、点击日志等
- **业务 DB 数据（DB）**：如 MySQL 中的订单、用户、商品等业务数据

对于业务 DB 数据来说，从 MySQL 等关系型数据库中采集数据并导入 Hive，是数仓生产的重要环节。核心问题是：**如何准确、高效地把 MySQL 数据同步到 Hive 中？**

---

## 二、全量同步方案

### 2.1 基本原理

全量同步是最直观的方案：**每次同步时，将 MySQL 源表的所有数据完整抽取并覆盖写入 Hive 表**。

**数据流：**

```
MySQL (SELECT *) → 本地文件 / HDFS 临时文件 → LOAD INTO Hive 表
```

**典型流程：**

1. 通过 Sqoop/DataX 等工具，直连 MySQL 执行 `SELECT * FROM table`
2. 将查询结果写入 HDFS 临时目录
3. 覆盖写入 Hive 对应分区（通常按天分区）

![全量同步流程](/notes/data-warehouse/mysql2hive-sync-principle/full-sync-pipeline.svg)

### 2.2 全量同步的适用场景

| 场景 | 说明 |
|------|------|
| 首次数据初始化 | 数仓刚建设时，需要将 MySQL 历史全量数据一次性导入 |
| 数据量较小的表 | 表数据量在百万级以下，全量同步耗时可控 |
| 无主键/无更新时间的表 | 无法识别增量变化，只能全量覆盖 |
| 维表全量快照 | 每日保留完整快照，用于缓慢变化维处理 |

### 2.3 全量同步的痛点

随着业务规模的增长，全量同步方案的缺点逐渐暴露：

- **性能瓶颈**：`SELECT * FROM MySQL → Save to File → LOAD to Hive` 这条数据流花费的时间越来越长，无法满足下游数仓生产的时效要求
- **对源库影响大**：直接从 MySQL 中 Select 大量数据，容易造成慢查询，影响业务线上的正常服务
- **无法处理 Update/Delete**：Hive 本身不支持 UPDATE 和 DELETE 语法，对于 MySQL 中发生变更或删除的数据无法准确反映
- **存储浪费**：每天存储一份全量快照，数据冗余度极高，HDFS 存储压力巨大

> **核心矛盾**：全量同步对于**小表、维度表**依然是最简单可靠的方案，但对于**大事实表**，性能瓶颈和存储浪费不可接受。

### 2.4 全量与增量的分界线

全量同步和增量同步之间并没有一个绝对的、物理上的"分界线"，它们的界限主要体现在**技术实现、业务逻辑、数据特征**三个维度上。

![全量与增量的分界线](/notes/data-warehouse/mysql2hive-sync-principle/boundary-line-between-full-and-incremental.svg)

#### 技术分界线：是否存在可靠的变更标识

这是技术上最本质的区别——**如果无法获取可靠的变更标识，就只能做全量；反之则可做增量**。

|| 维度 | 全量同步 | 增量同步 | 分界点判定 |
||------|---------|---------|-----------|
|| **变更标识** | 无，或不信任现有标识 | 有自增 ID、update_time、Binlog 位点等 | 能否唯一且有序地定位新数据 |
|| **数据抽取 SQL** | `SELECT * FROM table` | `WHERE id > last_max_id` 或 Binlog 解析 | WHERE 条件的依赖性 |
|| **Hive 写入模式** | `INSERT OVERWRITE`（覆盖分区/表） | `INSERT INTO` / Merge Into / Upsert | 是否允许覆盖历史数据 |
|| **幂等性** | 天然幂等（重跑结果一致） | 需严格保证顺序和断点续传 | 重试机制的复杂度 |

#### 业务分界线：量级、时效与变更特征

在实际工程中，选择全量还是增量通常取决于以下业务阈值：

**数据量级阈值：**

- **< 500 万行 / < 10GB**：通常建议直接全量。现代引擎（如 Spark/Doris）处理这个量级的全量覆盖成本极低，且避免了增量带来的数据一致性风险和维护成本
- **> 1000 万行 / > 50GB**：必须考虑增量。全量抽取对源库压力过大，且同步窗口可能无法满足 SLA

**数据时效性要求：**

- **T+1 离线报表**：全量同步是首选，简单可靠
- **准实时 / 小时级 / 分钟级**：必须使用增量同步（通常基于 CDC/Binlog）

**数据变更特征：**

- **只增不改（Append Only）**：日志流、流水表——增量同步的最佳场景，基于自增 ID 即可
- **频繁更新**：订单状态变更、用户信息修改——必须基于 Binlog CDC 才能精确捕获
- **存在物理删除**：必须使用 CDC 方案捕获 DELETE 事件，仅靠 `update_time` 无法感知

#### 核心原则：重叠覆盖 > 精确切分

不要试图让全量和增量在某个时间点"完美对接"，这在分布式系统中几乎不可能实现。**正确的做法是故意制造"重叠区间"，通过下游的幂等写入来消除重复，从而保证不丢失。**

> ❌ **错误做法**：全量同步到 2026-06-02 23:59:59，增量从 2026-06-03 00:00:00 开始。（极易因时钟漂移或事务未提交导致丢数）
>
> ✅ **正确做法**：全量同步快照点为 T，增量回溯到 T - N（N 为安全缓冲期，如 1 小时或 1 天）。重叠的数据通过 Hive 的主键去重或 Upsert 机制自动合并。

### 2.5 为何记录"结束位点"而非"起始位点"

在 §2.4 中我们提到，分界线是一个 Binlog 位点。但一个关键问题是：**应该记录全量快照开始时的位点，还是结束时的位点？**

答案是**必须记录结束位点**。这背后的根本原因在于 MySQL 的 MVCC 机制与 Binlog 产生时机之间的"时间差"。

#### 为什么不能用"起始位点"

假设全量快照在 `T_start` 时刻开始读取，记录下此时的 Binlog 位点 `P_start`，然后全量读取持续到 `T_end` 结束。增量从 `P_start` 开始消费。

**灾难场景**：在 `T_start` 之后、`T_end` 之前，源表发生了一条 UPDATE/INSERT 操作（事务 Tx_A）。

- **全量快照**：由于 MySQL InnoDB 的 MVCC 机制，快照读看到的是 `T_start` 时刻的一致性视图。Tx_A 在 `T_start` 之后提交，因此全量快照**读不到**这条数据
- **增量 Binlog**：Tx_A 的 Binlog 位点 `P_A` 必然大于 `P_start`。如果从 `P_start` 开始消费，理论上能读到 Tx_A

看起来没问题？但实际工程中有一个**隐藏陷阱**：很多 CDC 工具在执行全量快照时，并不是真正的"瞬间快照"，而是分批 SELECT。如果工具在 `T_start` 记录了 `P_start`，但在实际读取某张表时已经过去了很久，这期间可能有大量 DDL 或长事务干扰。更关键的是，某些工具的实现中，全量读取和 Binlog 消费是两个独立线程，如果以 `P_start` 为起点，在全量尚未读完时，Binlog 消费可能已经追上了当前写入点，导致状态管理混乱而丢数。

> ⚠️ **核心矛盾**：全量快照是一个"时间段"内的 MVCC 视图，而 Binlog 是一个严格的"时间点"序列。用一个时间段的起点去对齐一个时间点的序列，必然产生缝隙。

#### 为什么"结束位点"是安全的

现代 CDC 工具（如 Flink CDC、Debezium）采用的标准做法：

1. **获取一致性读视图**：在 `T_start` 通过 `START TRANSACTION WITH CONSISTENT SNAPSHOT` 获取全局一致性视图
2. **执行全量读取**：在整个读取过程中，所有 SELECT 都基于这个 `T_start` 的 MVCC 视图，保证全量数据内部一致
3. **记录结束位点 P_end**：全量读取全部完成后，记录当前最新的 Binlog 位点
4. **增量从 P_end 开始消费**

那么中间地带 `(T_start, P_end]` 的数据怎么办？

这正是精妙之处——现代 CDC 工具在内部做了 **Chunk 级别的 Binlog 补偿**：

- 在无锁快照模式下，工具将表按主键分片（Chunk）
- 每读完一个 Chunk，就记录该 Chunk 读取期间的 Binlog 位点区间
- 全量完成后，工具会回放每个 Chunk 对应的 Binlog 片段，将 `(T_start, P_end]` 期间对该 Chunk 的变更应用上去
- 最终对外暴露的"增量起点" `P_end`，实际上是全量数据 + Chunk 补偿后的等效位点

|| 策略 | 全量数据范围 | 增量起点 | 中间地带处理 | 结果 |
||------|------------|---------|------------|------|
|| ❌ 记录起始位点 | MVCC(T_start) | P_start | 无人负责 | 全量读不到 + 增量可能漏掉 = **丢数** |
|| ✅ 记录结束位点 | MVCC(T_start) + Chunk 补偿 | P_end（补偿后） | 工具内部自动回填 | 全量+补偿 = 完整截止 P_end 的数据集，增量无缝衔接 = **不丢不重** |

> **总结**：起始位点代表"快照开始看世界的那一刻"，但快照看完整个世界需要时间，这段时间里世界的变化没有被快照捕获。结束位点代表"快照 + 补偿共同构建出的完整世界的时间戳"，从这个点往后看，才是真正安全的增量起点。

### 2.6 三种衔接方案

根据使用的技术栈，选择最适合的全量→增量衔接策略：

#### 方案 A：基于 Binlog CDC 的无缝衔接 ⭐⭐⭐⭐⭐

这是目前最可靠的方案，利用 Binlog 位点作为全局唯一的"接力棒"。

- **全量阶段**：使用支持 Snapshot + Binlog 自动切换的工具（如 Flink CDC、DataX+Canal、CloudCanal）。工具先做无锁快照读取历史数据，并记录快照结束时的 Binlog 位点（GTID / File+Position）
- **增量阶段**：直接从记录的 Binlog 位点继续消费，无需人工指定时间戳

**优势**：工具内部保证了 Snapshot 和 Binlog 之间的连续性（通过 Chunk 补偿机制），不会丢也不会重。

![全量→增量切换流程](/notes/data-warehouse/mysql2hive-sync-principle/switch-flow.svg)

#### 方案 B：基于时间戳 / 自增 ID 的重叠衔接

适用于不支持 CDC 或仅需 T+1 同步的场景。

1. **确定安全边界**：全量同步完成后，记录完成时间 `T_end`。增量任务的起始点设为 `T_start = T_end - Buffer`
2. **Buffer 的设定**：必须大于 MySQL 最长事务执行时间 + 主从延迟 + 作业调度误差。通常建议 1~24 小时（视业务容忍度而定）
3. **Hive 侧去重**：由于存在重叠，Hive 目标表必须设计为可去重模型：
   - **Hudi / Iceberg / Paimon**：原生支持 Upsert/Merge，直接按主键写入即可
   - **传统 Hive 分区表**：增量数据写入临时分区，再通过 `ROW_NUMBER() OVER(PARTITION BY id ORDER BY update_time DESC)` 去重后覆盖目标分区

#### 方案 C：双写比对切换法

适用于金融级数据迁移或首次初始化，对数据一致性要求极高的场景。

1. 全量同步期间，**同时开启增量 Binlog 采集**（写入 Kafka/临时表）
2. 全量完成后，回放积压的增量数据
3. 当增量追平全量快照点时，进行**行数校验 + 抽样字段比对**
4. 校验通过后，才将下游读取指针切换到新链路

### 2.7 数据一致性校验

无论衔接方案设计得多完美，都必须有独立的校验环节作为最终防线：

| 校验方式 | 说明 | 适用场景 |
|---------|------|---------|
| **行数校验** | `SELECT COUNT(*)` 对比源端和目标端（注意过滤同步范围内的数据） | 快速发现大批量丢数 |
| **聚合校验** | 对关键金额/数量字段做 `SUM` / `COUNT DISTINCT` 比对 | 发现数值型数据偏移 |
| **抽样哈希** | 对主键做 MD5 采样比对 | 精确发现单行数据不一致 |

> ⚠️ **关键实践**：校验任务应集成到调度流中，校验不通过则**阻断下游任务**，而非仅发告警。校验不是可选的，它是数据不丢的最后一条底线。

---

## 三、增量同步方案

### 3.1 增量同步的核心思路

增量同步的核心思想是：**只同步 MySQL 中发生变化的数据（Insert/Update/Delete），然后在 Hive 侧将增量数据与存量数据合并（Merge），还原出最新的业务数据全貌**。

**整体架构：**

```
MySQL (Binlog) → Canal (实时采集) → Kafka (消息缓冲) → Kafka2Hive (离线同步) → Hive (Binlog 表) → Merge (合并还原) → Hive (业务全量表)
```

这就是业界常说的 **CDC（Change Data Capture）+ Merge** 方案：

![CDC + Merge 增量同步整体架构](/notes/data-warehouse/mysql2hive-sync-principle/cdc-merge-architecture.svg)

- **CDC 层**：实时捕获 MySQL 的数据变更（Binlog）
- **Merge 层**：离线将增量变更与存量数据合并，还原业务表最新状态

### 3.2 Binlog 基础

#### 3.2.1 什么是 Binlog

Binlog 是 MySQL 的二进制日志，**记录了 MySQL 中发生的所有数据变更**（DDL 和 DML），MySQL 集群自身的主从复制就是基于 Binlog 实现的。

**Binlog 的三种记录模式：**

| 模式 | 说明 | 特点 |
|------|------|------|
| **ROW**（行级） | 记录每一行数据的变更前后值 | 数据最完整，能精确还原变更，但日志量较大 |
| **STATEMENT**（语句级） | 记录执行的 SQL 语句 | 日志量小，但非确定性函数（如 NOW()）可能导致主从不一致 |
| **MIXED**（混合） | 默认 STATEMENT，遇到不确定语句切换 ROW | 折中方案，但仍有潜在一致性问题 |

> **数仓场景推荐使用 ROW 模式**，因为 ROW 模式记录了每行数据的变更前后值，能够精确还原业务数据，不存在语义歧义。

#### 3.2.2 Binlog 事件类型

在 ROW 模式下，Binlog 的核心事件类型包括：

| 事件类型 | 说明 |
|---------|------|
| `TABLE_MAP_EVENT` | 表结构映射，标识即将操作的表 |
| `WRITE_ROWS_EVENT` | INSERT 操作，包含插入行的完整数据 |
| `UPDATE_ROWS_EVENT` | UPDATE 操作，包含变更前和变更后的行数据 |
| `DELETE_ROWS_EVENT` | DELETE 操作，包含被删除行的数据 |

**关键特性：** ROW 模式的 Binlog 中，Update 事件同时包含了 **变更前（Before）** 和 **变更后（After）** 的完整行数据，这对于精确还原业务数据至关重要。

### 3.3 Binlog 实时采集

#### 3.3.1 Canal 采集架构

业界最成熟的 MySQL Binlog 实时采集方案是阿里巴巴开源的 **Canal**，其核心原理是**伪装成 MySQL 的从库（Slave），接收 MySQL 主库推送的 Binlog 事件**。

**Canal 工作原理：**

```
MySQL Master
    │
    │ 1. 主库将变更写入 Binlog
    ▼
  Binlog
    │
    │ 2. Canal 伪装成 Slave，发送 DUMP 协议
    ▼
 Canal Server
    │
    │ 3. 解析 Binlog 事件，提取数据变更
    ▼
 Canal Client
    │
    │ 4. 按 DB 粒度分发到 Kafka
    ▼
  Kafka Topic
```

**Canal 的核心组件：**

| 组件 | 职责 |
|------|------|
| CanalManager | 采集任务分配、监控报警、元数据管理、与外部系统对接 |
| Canal Server | 伪装成 MySQL Slave，拉取并解析 Binlog |
| Canal Client | 接收解析后的 Binlog 事件，按 DB 粒度分发到 Kafka |

#### 3.3.2 采集流程

1. **注册采集任务**：用户提交某个 DB 的 Binlog 采集请求
2. **获取 MySQL 实例信息**：CanalManager 调用 DBA 平台接口，获取 MySQL 实例的连接信息和 Binlog 位点
3. **启动 Canal 实例**：CanalManager 分配 Canal Server 实例，伪装成 Slave 连接 MySQL
4. **拉取并解析 Binlog**：Canal 实时拉取 Binlog 并完成解析，将二进制日志转换为结构化的变更事件
5. **分发到 Kafka**：CanalClient 将解析后的 Binlog 按 DB 粒度分发到对应的 Kafka Topic

**关键设计：**

- **按 DB 粒度分发**：同一个 MySQL 实例上的不同 DB 数据分发到不同的 Kafka Topic，避免数据交叉
- **位点管理**：Canal 定期将消费到的 Binlog 位点持久化到 ZooKeeper，支持断点续传
- **HA 高可用**：Canal Server 支持主备切换，单点故障不影响采集

### 3.4 Kafka2Hive：Binlog 落地 Hive

完成 Binlog 的实时采集后，下一步是将 Binlog 从 Kafka 同步到 Hive，供离线 Merge 使用。

#### 3.4.1 同步方案

美团对 LinkedIn 开源的 **Camus** 进行了二次开发，实现了 Kafka 数据到 Hive 的定时同步：

```
Kafka Topic (Binlog 数据)
    │
    │ Camus 定时拉取（如每10分钟）
    ▼
  HDFS 临时目录
    │
    │ 按分区规则组织
    ▼
  Hive Binlog 表（按天分区）
```

**核心流程：**

1. **Camus 定时任务**：每隔固定时间（如 10 分钟），从 Kafka 拉取 Binlog 数据
2. **写入 HDFS**：将 Binlog 数据按时间分区写入 HDFS
3. **添加分区**：将新的 HDFS 目录挂载到 Hive Binlog 表的对应分区
4. **Checkdone 检测**：确认当天所有 Binlog 数据已经完整写入 Hive

#### 3.4.2 Checkdone 机制

Checkdone 是保证数据完整性的关键机制，其核心逻辑：

1. **判断 Binlog 流是否结束**：比对当前采集到的 Binlog 位点与 MySQL 主库最新的 Binlog 位点
2. **判断 Kafka 数据是否消费完**：确认 Kafka 中对应分区的数据已被 Camus 完整拉取
3. **输出完成标记**：所有条件满足后，在 HDFS 上写入 `_SUCCESS` 标记文件
4. **下游任务依赖**：Merge 任务只有检测到 `_SUCCESS` 标记后才会启动

```
Checkdone 检测逻辑：
┌─────────────────────────────────┐
│ 1. MySQL Binlog 位点是否对齐？   │
│    ├─ 否 → 等待                 │
│    └─ 是 ↓                      │
│ 2. Kafka 消费是否完成？          │
│    ├─ 否 → 等待                 │
│    └─ 是 ↓                      │
│ 3. 输出 _SUCCESS 标记           │
│    └─ 通知下游 Merge 任务启动    │
└─────────────────────────────────┘
```

### 3.5 Merge：还原业务数据

#### 3.5.1 Merge 的核心逻辑

Merge 是整个增量同步方案中最核心的环节，其目的是：**将增量 Binlog 数据与 Hive 中的存量数据合并，还原出 MySQL 业务表的最新全量状态**。

![Merge 还原机制](/notes/data-warehouse/mysql2hive-sync-principle/merge-reduction-mechanism.svg)

**基本思路：**

```
Hive 存量全量表（T-1 日）
        +
Hive Binlog 增量表（T 日）
        ↓
      Merge
        ↓
Hive 最新全量表（T 日）
```

**Merge 的核心规则：**

| Binlog 事件类型 | Merge 处理方式 |
|----------------|---------------|
| INSERT | 将新行直接插入全量表 |
| UPDATE | 用变更后的值覆盖全量表中对应行 |
| DELETE | 从全量表中删除对应行 |

#### 3.5.2 Merge 的 SQL 实现

由于 Hive 不支持原生的 UPDATE/DELETE，Merge 操作需要通过 **全表关联 + 重写** 的方式实现：

```sql
-- Step 1: 获取每个主键的最新变更（去重，保留最新一条 Binlog）
WITH latest_binlog AS (
  SELECT
    id,          -- 主键
    after_cols,  -- 变更后的值（INSERT/UPDATE）
    before_cols, -- 变更前的值（DELETE 时使用）
    op_type,     -- 操作类型：I/U/D
    ts           -- 事件时间戳
  FROM ods_binlog_table
  WHERE dt = '${T}'
    AND db_name = 'trade_db'
    AND table_name = 'order_info'
  DISTRIBUTE BY id
  SORT BY ts DESC
),

deduplicated_binlog AS (
  SELECT
    id,
    after_cols,
    op_type
  FROM (
    SELECT
      id,
      after_cols,
      op_type,
      ROW_NUMBER() OVER (PARTITION BY id ORDER BY ts DESC) AS rn
    FROM latest_binlog
  ) t
  WHERE rn = 1
)

-- Step 2: 与存量全量表 LEFT JOIN，合并得到最新数据
SELECT
  COALESCE(b.id, a.id) AS id,
  CASE
    WHEN b.op_type = 'D' THEN NULL           -- 删除事件：丢弃该行
    WHEN b.op_type = 'I' THEN b.after_cols   -- 插入事件：取新值
    WHEN b.op_type = 'U' THEN b.after_cols   -- 更新事件：取变更后值
    ELSE a.*                                   -- 无变更：保留存量值
  END AS *
FROM hive_full_table a
FULL OUTER JOIN deduplicated_binlog b
  ON a.id = b.id
WHERE b.op_type IS NULL OR b.op_type != 'D'
```

#### 3.5.3 Merge 流程举例

以订单表 `order_info` 为例，假设 T-1 日的全量数据为：

| id | user_id | amount | status |
|----|---------|--------|--------|
| 1 | 1001 | 99.00 | 已支付 |
| 2 | 1002 | 199.00 | 待支付 |
| 3 | 1003 | 50.00 | 已发货 |

T 日的 Binlog 增量事件为：

| op_type | id | before | after |
|---------|-----|--------|-------|
| U | 2 | (1002, 199.00, 待支付) | (1002, 199.00, 已支付) |
| I | 4 | - | (1004, 88.00, 待支付) |
| D | 3 | (1003, 50.00, 已发货) | - |

Merge 后 T 日全量数据为：

| id | user_id | amount | status |
|----|---------|--------|--------|
| 1 | 1001 | 99.00 | 已支付 |
| 2 | 1002 | 199.00 | 已支付 |
| 4 | 1004 | 88.00 | 待支付 |

> **注意**：id=2 的记录 status 从"待支付"变为"已支付"（UPDATE），id=4 是新增订单（INSERT），id=3 被删除（DELETE）。

---

## 四、全量同步 vs 增量同步对比

![全量同步与增量同步对比](/notes/data-warehouse/mysql2hive-sync-principle/full-vs-incremental-sync.svg)

| 对比维度 | 全量同步 | 增量同步（CDC + Merge） |
|---------|---------|----------------------|
| **变更标识** | 无，或不信任现有标识 | 有自增 ID、update_time、Binlog 位点等 |
| **同步方式** | 每次抽取源表全部数据 | 只捕获变更数据，与存量合并 |
| **对 MySQL 的影响** | 大（全表扫描） | 小（读取 Binlog，不影响业务） |
| **同步时效性** | 天级（T+1） | 近实时采集 + 天级 Merge |
| **Update/Delete 支持** | 不支持（覆盖写） | 完全支持 |
| **存储开销** | 高（每天一份全量快照） | 低（只存增量 Binlog） |
| **实现复杂度** | 低（Sqoop 一行命令） | 高（Canal + Kafka + Merge 链路） |
| **数据准确性** | 依赖同步时间点，可能丢失当天变更 | 基于 Binlog 精确还原，数据一致性好 |
| **适用表类型** | 维表、小表 | 大事实表、频繁变更的表 |
| **首次初始化** | 天然支持 | 需要先做一次全量同步作为基线 |

---

## 五、工程实践要点

### 5.1 全量 + 增量结合的混合策略

在实际数仓建设中，全量同步和增量同步并非二选一，而是**混合使用**：

| 表类型 | 同步策略 | 原因 |
|--------|---------|------|
| 小维度表（< 百万行） | 每日全量同步 | 简单可靠，开销可控 |
| 大事实表（> 千万行） | 增量同步（Binlog + Merge） | 全量同步性能不可接受 |
| 缓慢变化维表 | 全量快照 / 拉链表 | 需要保留历史变更 |
| 无主键表 | 全量同步 | 无法做增量 Merge |
| 分库分表 | 增量同步 | 全量同步多库多表代价太高 |

### 5.2 分库分表的支持

互联网业务中常见的分库分表场景（如 `order_info_0000` ~ `order_info_1023`），增量同步方案的优势更加明显：

- **Binlog 采集**：Canal 按实例采集，分库分表的 Binlog 统一进入 Kafka
- **Binlog 合并**：在 Merge 阶段，将同一逻辑表的不同物理分表的 Binlog 统一处理
- **逻辑表名映射**：在 Binlog 解析时，将 `order_info_0000` ~ `order_info_1023` 统一映射为逻辑表名 `order_info`

```
MySQL 实例 1: order_info_0000 ~ order_info_0255
MySQL 实例 2: order_info_0256 ~ order_info_0511
MySQL 实例 3: order_info_0512 ~ order_info_0767
MySQL 实例 4: order_info_0768 ~ order_info_1023
        │
        │ Canal 采集 + 逻辑表名映射
        ▼
Kafka Topic: binlog_trade_order_info
        │
        │ Kafka2Hive
        ▼
Hive: ods_binlog.ods_binlog_trade_order_info
        │
        │ Merge（合并 1024 张分表数据）
        ▼
Hive: ods.ods_trade_order_info_full
```

### 5.3 删除事件的处理

在增量同步方案中，**DELETE 事件的处理是一个容易被忽略但至关重要的环节**：

1. **Binlog ROW 模式下**：DELETE 事件包含被删除行的完整 Before 值，可以通过主键定位需要删除的行
2. **Merge 逻辑中**：检测到 DELETE 事件时，在全量数据中过滤掉对应主键的行
3. **软删除场景**：业务上经常使用逻辑删除（如 `is_deleted = 1`），此时 Binlog 中是 UPDATE 事件而非 DELETE 事件，Merge 逻辑需要正确处理

### 5.4 数据回溯与重跑

增量同步方案下的数据回溯比全量同步更复杂：

| 场景 | 全量同步 | 增量同步 |
|------|---------|---------|
| 回溯某天数据 | 重新执行全量抽取即可 | 需要找到对应日期的 Binlog，重新 Merge |
| 回溯多天数据 | 逐天执行全量抽取 | 从基线开始，逐天重做 Merge |
| 基线丢失 | 无此问题 | 需要先做一次全量同步重建基线 |

### 5.5 数据质量保障

增量同步链路长、组件多，数据质量保障至关重要。以下是工业界实践中总结的关键风险点与防范措施：

| 风险点 | 说明 | 防范措施 |
|--------|------|----------|
| **长事务未提交** | 全量快照读的是 MVCC 视图，可能不包含已开启但未提交的事务；增量 Binlog 在 commit 后才产生。若 Buffer 太短，该事务既不在全量中，也不在增量范围内 | 增量回溯 Buffer 必须覆盖最大事务时长 |
| **软删除丢失** | 仅靠 `update_time` 无法感知物理删除，增量必须捕获 DELETE 事件 | 使用 CDC 或在源表增加 `is_deleted` 标记并配合触发器 |
| **DDL 变更** | 全量和增量切换期间若发生加列/改类型，需确保 Hive 表结构同步更新，否则增量写入会静默失败或错位 | Schema Evolution 支持，DDL 变更时同步更新 Hive 表结构 |
| **时区不一致** | MySQL 服务器、ETL 服务器、Hive 服务器时区不一致导致时间条件错位 | 统一使用 UTC 或 Unix 时间戳，WHERE 条件中使用 `UNIX_TIMESTAMP()` 而非字符串时间比较 |
| **断点续传失效** | 增量作业的 Offset/Watermark 仅存在内存中，宕机后丢失 | Checkpoint 持久化到外部存储（ZK/HDFS/RDBMS），严禁依赖内存状态 |
| **Binlog 被清理** | MySQL 定期清理旧 Binlog，导致位点失效 | 确保全量同步完成前 Binlog 未被清理，或提前备份 |
| **位点丢失** | Canal 宕机后无法记住上次消费到哪个位点 | 位点持久化到 ZooKeeper / Kafka committed offset |

此外，日常运维监控也不可或缺：

- **Binlog 采集延迟监控**：监控 Canal 采集位点与 MySQL 最新位点的差距
- **Kafka 消费积压监控**：确保 Kafka 中的 Binlog 数据及时被 Camus 消费
- **Checkdone 完整性检测**：确保当天 Binlog 数据完整后才启动 Merge
- **数据一致性校验**：定期比对 Hive 全量表与 MySQL 源表的行数和关键指标（详见 §2.7）
- **异常告警**：Binlog 采集中断、Merge 失败等异常及时告警

---

## 六、架构演进趋势

![架构演进趋势](/notes/data-warehouse/mysql2hive-sync-principle/architecture-evolution.svg)

### 6.1 从离线到近实时

传统的 CDC + Merge 方案是**天级 Merge**（T+1），而业界正在向**小时级甚至分钟级**演进：

| 方案 | 时效性 | 实现方式 |
|------|--------|---------|
| 天级 Merge | T+1 | Camus + 每天一次 Merge |
| 小时级 Merge | 小时级 | 提高同步频率 + 多次增量 Merge |
| Flink 实时入仓 | 分钟级 | Flink CDC 实时消费 Binlog + 数据湖（Hudi/Iceberg） |

### 6.2 数据湖加速增量处理

Hive 的核心限制是不支持 UPDATE/DELETE，导致增量 Merge 只能全表重写。新一代数据湖技术（如 **Apache Hudi**、**Apache Iceberg**）原生支持 Upsert 和增量查询，大幅简化了增量同步的实现：

```
方案一：传统 Hive 增量同步
MySQL → Canal → Kafka → Hive Binlog → Merge（全表重写）→ Hive 全量表

方案二：Hudi 增量同步
MySQL → Flink CDC → Hudi 表（原生 Upsert，无需全表重写）
```

**Hudi 的核心优势：**

- **原生 Upsert**：通过主键索引，只更新变化的 Parquet 文件，无需全表重写
- **增量查询**：支持查询自某个时间点以来的增量数据
- **Mor（Merge on Read）**：增量数据先写入 Log 文件，读取时合并，兼顾写入和查询性能
- **自动 Compaction**：后台自动将 Log 文件与 Base 文件合并，优化查询性能

### 6.3 Flink CDC 一体化

**Flink CDC** 是目前最流行的增量同步方案之一，它将全量读取和增量读取统一在一套框架中：

```
Flink CDC 同步流程：
┌──────────────────────────────────────────┐
│ 1. 全量阶段：Snapshot Reading            │
│    - 对 MySQL 表做全量扫描               │
│    - 记录全局一致性位点                   │
│                                          │
│ 2. 增量阶段：Binlog Reading              │
│    - 从全量位点开始消费 Binlog            │
│    - 保证全量 + 增量的数据一致性          │
│                                          │
│ 3. 下游写入：                            │
│    - 写入 Hudi / Iceberg / Kafka 等       │
│    - 支持精确一次语义                     │
└──────────────────────────────────────────┘
```

**Flink CDC 的优势：**

- **全增量一体化**：无需手动管理全量基线 + 增量合并，一个 Job 自动完成
- **精确一次语义**：基于 Flink 的 Checkpoint 机制，保证数据不丢不重
- **无侵入采集**：无需在 MySQL 上安装 Agent，只需开启 Binlog
- **多源支持**：支持 MySQL、PostgreSQL、Oracle、SQL Server 等多种数据源

---

## 七、总结

| 方案 | 核心原理 | 优势 | 劣势 | 适用场景 |
|------|---------|------|------|---------|
| **全量同步** | 每次抽取源表全部数据覆盖写入 | 实现简单、无需额外组件 | 性能瓶颈、对源库影响大、不支持变更 | 小表、维表、初始化 |
| **增量同步（CDC + Merge）** | 实时采集 Binlog + 离线 Merge 还原 | 对源库无影响、支持变更、存储高效 | 实现复杂、链路长 | 大事实表、频繁变更的表 |
| **数据湖（Hudi）** | 原生 Upsert + 增量查询 | 无需全表重写、性能好 | 生态成熟度不如 Hive | 增量数仓演进方向 |
| **Flink CDC** | 全增量一体化采集 | 全自动、精确一次、无侵入 | 依赖 Flink 集群 | 近实时同步场景 |

> **实践建议：** 在离线数仓建设的初期，建议**全量同步和增量同步并用**——小表用全量、大表用增量，用最简单可靠的方式把数据先跑通。随着业务规模和时效要求的提升，再逐步向 Flink CDC + 数据湖的架构演进。

---

> **参考资料：**
> - [美团DB数据同步到数据仓库的架构与实践](https://tech.meituan.com/2018/12/06/binlog-dw.html)
> - [Canal 官方文档](https://github.com/alibaba/canal)
> - [Apache Hudi 官方文档](https://hudi.apache.org/)
> - [Flink CDC 官方文档](https://ververica.github.io/flink-cdc-connectors/)
