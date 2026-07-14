---
title: 报表中台技术体系
tags:
  - 报表中台
  - Calcite
  - 数据中台
  - 物化视图
  - 语义层
excerpt: 报表中台是一套统一管理物理表、视图与 API 的系统。本文从元数据表设计（DDL）落地，到视图层如何接入 Apache Calcite 完成 SQL 解析、校验、RBO/CBO 优化与物化视图改写，再到 API 层的参数映射与 SQL 生成，给出可照着实现的全链路技术细节。
createTime: 2026/07/13 13:30:00
updateTime: 2026/07/14 10:31:00
permalink: /commercial-tech/report-tech/report-middle-platform/
---

# 报表中台技术体系

> 当业务方第 N 次说"这个报表加个字段""那个指标口径不对""能不能给个接口让前端直接拉"，而你每次都要改 SQL、发版、等上线——你就会意识到：报表不该是一个个散落各处的查询，而是一套**可管理的体系**。

本文不停留在概念，而是一路给到落地细节：**元数据怎么建表、视图怎么接进 Calcite、优化器（RBO/CBO）怎么真正跑起来、物化视图怎么改写、API 怎么从视图生成**。

## 一、什么是报表中台

### 1.1 它要解决什么问题

传统报表开发里，三样东西通常是割裂的：

- **物理表**：落在数仓 / HBase / MySQL 里的真实表，谁建的、字段啥含义、血缘从哪来，往往没人说得清；
- **视图**：业务真正想要的"虚拟表"，是物理表之上的一层语义抽象，但大多只存在于某个 BI 工具的临时查询里，不可复用；
- **API**：前端 / 其他系统要消费数据，最后又得单独写接口把 SQL 包一层。

这三层各管各的，改一处牵全身。报表中台要做的，就是把这三样**统一管理**起来。

### 1.2 核心定位

一句话：

> **报表中台是一个能够统一「管理物理表、视图、以及 API」的系统。**

它把"数据在什么表里"（物理表）、"业务怎么看这些数据"（视图）、"外部怎么取这些数据"（API）这三层，收拢到一个平台里，用一致的**元数据**驱动。下面先把这套元数据的表结构立起来——它是整个中台的骨架。

## 二、元数据模型：从建表开始

中台的一切能力都建立在一套元数据之上。下面给出核心元数据表的 MySQL DDL（生产可按需拆库分表、加审计字段）。

### 2.1 元数据表总览

| 表名 | 职责 |
| --- | --- |
| `meta_datasource` | 数据源登记（连接信息、类型、方言） |
| `meta_physical_table` | 物理表登记（属于哪个数据源、表名、类型） |
| `meta_column` | 物理表/视图的字段元数据 |
| `meta_lineage` | 血缘关系（表级 / 字段级） |
| `meta_view` | 视图定义（SQL、状态、缓存的优化计划） |
| `meta_view_field` | 视图对外暴露的字段（含指标/维度语义） |
| `meta_api` | API 定义（绑定视图、路径、方法） |
| `meta_api_param` | API 入参与视图字段的映射 |

### 2.2 数据源表

```sql
CREATE TABLE `meta_datasource` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(64) NOT NULL COMMENT '数据源唯一标识',
  `name`        VARCHAR(128) NOT NULL COMMENT '展示名',
  `type`        VARCHAR(32) NOT NULL COMMENT 'MYSQL/HIVE/CLICKHOUSE/DORIS...',
  `jdbc_url`    VARCHAR(512) NOT NULL,
  `username`    VARCHAR(128) NOT NULL,
  `password`    VARCHAR(512) NOT NULL COMMENT '加密存储',
  `dialect`     VARCHAR(32) NOT NULL COMMENT 'Calcite SqlDialect: MYSQL/HIVE/...',
  `props`       JSON        NULL COMMENT '连接池/超时等扩展参数',
  `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='数据源登记';
```

`dialect` 字段很关键——它决定后面 Calcite 把优化后的计划**回写成哪种 SQL 方言**（见 4.7）。

### 2.3 物理表与字段登记

```sql
CREATE TABLE `meta_physical_table` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `datasource_id` BIGINT      NOT NULL,
  `table_name`    VARCHAR(128) NOT NULL COMMENT '物理表名',
  `table_type`    VARCHAR(32) NOT NULL DEFAULT 'TABLE' COMMENT 'TABLE/PARTITIONED',
  `row_count`     BIGINT      NULL COMMENT '统计信息:估算行数(供CBO)',
  `owner`         VARCHAR(64) NULL,
  `update_freq`   VARCHAR(32) NULL COMMENT '更新频率:REALTIME/HOURLY/DAILY',
  `status`        TINYINT     NOT NULL DEFAULT 1,
  `create_time`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ds_table` (`datasource_id`, `table_name`),
  KEY `idx_ds` (`datasource_id`)
) COMMENT='物理表登记';

CREATE TABLE `meta_column` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `owner_type`  VARCHAR(16) NOT NULL COMMENT 'TABLE/VIEW',
  `owner_id`    BIGINT      NOT NULL COMMENT '物理表id或视图id',
  `col_name`    VARCHAR(128) NOT NULL,
  `col_type`    VARCHAR(32) NOT NULL COMMENT 'Calcite SqlTypeName: VARCHAR/BIGINT/DECIMAL...',
  `col_comment` VARCHAR(255) NULL,
  `nullable`    TINYINT     NOT NULL DEFAULT 1,
  `ordinal`     INT         NOT NULL COMMENT '列序',
  `ndv`         BIGINT      NULL COMMENT '不同值个数(distinct),供CBO选择性估算',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_owner_col` (`owner_type`, `owner_id`, `col_name`),
  KEY `idx_owner` (`owner_type`, `owner_id`)
) COMMENT='字段元数据(物理表与视图共用)';
```

注意 `row_count` 与 `ndv` 两个统计字段——它们不是给人看的，而是喂给 Calcite 的 **CBO（基于代价的优化器）**做选择性估算用的（见 4.4）。

### 2.4 血缘

```sql
CREATE TABLE `meta_lineage` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `level`       VARCHAR(16) NOT NULL COMMENT 'TABLE/COLUMN',
  `src_type`    VARCHAR(16) NOT NULL COMMENT 'TABLE/VIEW',
  `src_id`      BIGINT      NOT NULL,
  `src_col`     VARCHAR(128) NULL,
  `dst_type`    VARCHAR(16) NOT NULL,
  `dst_id`      BIGINT      NOT NULL,
  `dst_col`     VARCHAR(128) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_src` (`src_type`, `src_id`),
  KEY `idx_dst` (`dst_type`, `dst_id`)
) COMMENT='血缘关系(表级+字段级)';
```

血缘不需要人工维护——视图注册时用 Calcite 的 `RelMetadataQuery.getColumnOrigins()` 自动抽取（见 4.5），写入这张表。

### 2.5 视图定义

```sql
CREATE TABLE `meta_view` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `code`          VARCHAR(64)  NOT NULL COMMENT '视图唯一标识',
  `name`          VARCHAR(128) NOT NULL,
  `datasource_id` BIGINT       NOT NULL COMMENT '默认数据源(跨源时以FROM为准)',
  `sql_text`      TEXT         NOT NULL COMMENT '视图定义SQL',
  `plan_cache`    MEDIUMTEXT   NULL COMMENT '缓存的优化后RelNode(序列化,如RelJson)',
  `materialized`  TINYINT      NOT NULL DEFAULT 0 COMMENT '是否物化',
  `mv_table`      VARCHAR(128) NULL COMMENT '物化落库的物理表名',
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1已发布 0草稿',
  `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='视图定义';

CREATE TABLE `meta_view_field` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `view_id`     BIGINT      NOT NULL,
  `field_name`  VARCHAR(128) NOT NULL,
  `field_type`  VARCHAR(32) NOT NULL,
  `semantic`    VARCHAR(16) NOT NULL DEFAULT 'DIM' COMMENT 'DIM维度/METRIC指标',
  `agg`         VARCHAR(16) NULL COMMENT '指标默认聚合:SUM/COUNT/AVG',
  `caliber`     VARCHAR(512) NULL COMMENT '口径说明(治理用)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_view_field` (`view_id`, `field_name`)
) COMMENT='视图对外字段(区分维度/指标)';
```

`semantic` + `agg` + `caliber` 三个字段，是把视图从"一段 SQL"升级成"**语义层**"的关键——它明确定义了每个指标怎么算、口径是什么（见第六节）。

### 2.6 API 定义

```sql
CREATE TABLE `meta_api` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `path`        VARCHAR(256) NOT NULL COMMENT '如 /api/report/gmv',
  `method`      VARCHAR(8)   NOT NULL DEFAULT 'POST',
  `view_id`     BIGINT       NOT NULL COMMENT '绑定的视图',
  `select_cols` JSON         NOT NULL COMMENT '输出字段列表',
  `page_enable` TINYINT      NOT NULL DEFAULT 1,
  `status`      TINYINT      NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_path_method` (`path`, `method`)
) COMMENT='API定义';

CREATE TABLE `meta_api_param` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `api_id`     BIGINT      NOT NULL,
  `param_name` VARCHAR(64) NOT NULL COMMENT '接口入参名',
  `map_field`  VARCHAR(128) NOT NULL COMMENT '映射到视图哪个字段',
  `operator`   VARCHAR(16) NOT NULL DEFAULT 'EQ' COMMENT 'EQ/IN/GE/LE/BETWEEN',
  `required`   TINYINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_api` (`api_id`)
) COMMENT='API入参映射到视图字段';
```

有了这套表，"新增一个取数接口"就等价于：**注册视图 → 配 API → 配参数映射**，全程无需写新服务代码（见第五节）。

## 三、物理表管理：多引擎注册与元数据同步

报表中台的物理表层要对接的往往不止一种数据库，而是**多种分析引擎并存**：明细与宽表放 ClickHouse/Doris，检索与全文放 Elasticsearch，维表/配置放 MySQL。它们的建表语义、类型系统、统计采集方式天差地别。中台要做的，是把这些差异**收敛到一套统一的元数据模型**，让上层视图/API 无感知。

### 3.1 引擎注册：type 枚举与引擎插件

`meta_datasource.type` 枚举出所有受支持的引擎，每种引擎对应一个"引擎插件"（处理连接、元数据抽取、类型映射、统计采集）：

```
MYSQL        —— 维表 / 配置 / 小事务表
HIVE         —— 离线数仓 ODS / DWD
CLICKHOUSE   —— 大宽表 / 实时明细 / 预聚合
DORIS        —— 高并发即席 / 多维分析
ELASTICSEARCH—— 日志 / 全文检索 / 标签倒排
```

中台内部维护一张 `EnginePlugin` 注册表，按 `type` 路由到具体实现——见 3.6 的统一同步抽象。

### 3.2 建表语义差异（核心难点）

不同引擎的"建一张表"语义完全不同，这是元数据同步最大的坑：

| 维度 | ClickHouse | Elasticsearch | Doris |
| --- | --- | --- | --- |
| 表/数据集单位 | `MergeTree` 家族表 | `index` + `mapping` | `table`（三种 Key 模型） |
| 主键/排序 | `ORDER BY`（排序键，非唯一） | `_id` + `routing` | `Duplicate/Unique/Aggregate KEY` |
| 分区 | `PARTITION BY toYYYYMM(date)` | 无原生分区，靠 `date`+ILM | `PARTITION BY` |
| 分桶/分片 | 单节点 MergeTree 不分片；分布式靠 `Distributed` 表 | `number_of_shards` | `DISTRIBUTED BY HASH(col) BUCKETS n` |
| 副本 | `ReplicatedMergeTree`（依赖 Keeper） | `number_of_replicas` | BE Tablet 三副本（FE 调度） |
| 预聚合 | `AggregatingMergeTree` / 物化视图 | `date_histogram` 等聚合 | `Rollup` / 物化视图 |
| 索引 | 跳数索引（`skip index`）/ 主键稀疏索引 | 倒排索引（analyzed text）+ `keyword` 不分词 | 前缀索引 / 倒排（BITMAP） |
| 时间清理 | `TTL` | ILM `delete` phase | `dynamic_partition` |

可以看到：CK 的 `ORDER BY` 承担排序+稀疏主键；ES 没有"主键"概念而是 `_id`+倒排；Doris 的 `Unique Key` 模型才提供更新能力。**同一份"物理表"元数据，落在不同引擎上要翻译成完全不同的建表语句**——这正是中台需要抽象的原因。

### 3.3 逻辑类型 → 各引擎类型的映射

中台内部以 Calcite 的 `SqlTypeName` 作为"逻辑类型"，落库时再翻译成各引擎原生类型。关键差异举例：

| 逻辑类型 | MySQL | ClickHouse | Doris | Elasticsearch |
| --- | --- | --- | --- | --- |
| `VARCHAR` | `VARCHAR(n)` | `String` | `VARCHAR(n)` | `text`（分词）+ `keyword` 子字段 |
| `BIGINT` | `BIGINT` | `Int64` / `UInt64` | `BIGINT` | `long` |
| `DECIMAL` | `DECIMAL(38,4)` | `Decimal(38,4)` | `DECIMAL(38,4)` | `scaled_float` / `keyword` |
| `DATE` | `DATE` | `Date` / `Date32` | `DATE` | `date`（带 format） |
| `TIMESTAMP` | `DATETIME` | `DateTime64(3)` | `DATETIME` | `date`（`epoch_millis`） |
| `BOOLEAN` | `TINYINT(1)` | `UInt8` | `BOOLEAN` | `boolean` |

注意 ES 对字符串必须区分 `text`（分词，用于全文检索）与 `keyword`（不分词，用于聚合/精确匹配）——这是很多团队建 ES 索引的第一处踩坑。中台在 `meta_column` 上用 `col_type=VARCHAR` 登记，但落 ES 时主动生成 `text` + `.keyword` 多字段，避免丢失聚合能力。

### 3.4 引擎特定元数据扩展

通用 `meta_physical_table` 装不下各引擎的专属属性（分区键、排序键、分桶键、副本数、表模型……）。用一个 `meta_table_engine_attr` 键值表挂载：

```sql
CREATE TABLE `meta_table_engine_attr` (
  `id`          BIGINT      NOT NULL AUTO_INCREMENT,
  `table_id`    BIGINT      NOT NULL,
  `attr_key`    VARCHAR(64) NOT NULL COMMENT 'partition_by/sort_by/distribute_by/table_model/replicas/ttl/analyzer...',
  `attr_value`  VARCHAR(512) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_table` (`table_id`)
) COMMENT='引擎特定建表属性(键值对)';
```

这样视图层在把视图 SQL 物化落库时，能拼出正确引擎的原生建表语句：

```java
// 视图物化落库：根据引擎拼建表 DDL
String ddl = switch (ds.getType()) {
  case CLICKHOUSE    -> buildCkDdl(view, attrs);        // ENGINE=AggregatingMergeTree ORDER BY ...
  case DORIS         -> buildDorisDdl(view, attrs);     // DUPLICATE KEY(...) DISTRIBUTED BY ...
  case ELASTICSEARCH -> buildEsMapping(view, attrs);    // PUT index + mapping + analyzer
  default -> throw new UnsupportedEngine();
};
engineExec.execute(ds, ddl);
```

### 3.5 统计采集差异（CBO 燃料各不相同）

`row_count` / `ndv` 是 CBO 的燃料，但每种引擎"怎么拿到这些数"完全不同：

- **MySQL**：`information_schema.tables.TABLE_ROWS`（估算）、`information_schema.statistics.CARDINALITY`；
- **ClickHouse**：`system.parts`（`sum(rows)` 按分区聚合得行数）、`system.columns`（结合 `uniqExact` 采样估算 NDV）、`system.table_settings` 拿 TTL/引擎参数；
- **Elasticsearch**：`_stats`（`_all.total.docs.count`）、cardinality 聚合近似 NDV、`_mapping` 拿字段类型；
- **Doris**：`information_schema.table_stats`、`SHOW DATA`（含副本行数）、`ANALYZE TABLE` 主动收集直方图。

采集逻辑同样按引擎插件隔离，统一回写到 `meta_physical_table.row_count` / `meta_column.ndv`。

### 3.6 统一注册与同步抽象

屏蔽差异的核心是"引擎插件"——上层只调用统一接口，差异下沉到各引擎实现：

```java
public interface EngineMetadataSyncer {
    List<PhysicalTable> listTables(EngineCtx ctx);    // 列出物理表
    List<ColumnMeta>    listColumns(EngineCtx ctx, String table); // 列(逻辑类型+原生类型)
    TableStat           collectStats(EngineCtx ctx, String table); // 行数/NDV
    void                materialize(EngineCtx ctx, MetaView view, List<EngineAttr> attrs); // 物化落库
}

@Component @Engine("CLICKHOUSE")
public class ClickHouseSyncer implements EngineMetadataSyncer { /* 走 system.parts / system.columns */ }

@Component @Engine("ELASTICSEARCH")
public class ElasticsearchSyncer implements EngineMetadataSyncer { /* 走 REST _mapping / _stats */ }
```

> 注意：Elasticsearch **没有 JDBC 元数据**，必须用 REST（`GET /{index}/_mapping`、`GET /{index}/_stats`）拉取；而 ClickHouse/Doris/MySQL 可走 JDBC `DatabaseMetaData`。中台把"连接差异"也收敛进插件，上层注册流程对三种引擎完全一致：

```java
// 统一注册入口：与引擎无关
void registerTables(long datasourceId) {
    EngineCtx ctx = buildCtx(datasourceId);              // 按 type 取连接
    EngineMetadataSyncer syncer = pluginRegistry.get(ctx.type());
    for (PhysicalTable pt : syncer.listTables(ctx)) {
        long tid = metaTableMapper.insert(pt);
        for (ColumnMeta c : syncer.listColumns(ctx, pt.getName())) {
            metaColumnMapper.insert(c.withOwner(tid));
        }
        TableStat stat = syncer.collectStats(ctx, pt.getName());
        metaTableMapper.updateStat(tid, stat);           // 回填 CBO 燃料
    }
}
```

### 3.7 变更感知

定时 diff 引擎侧实时 schema 与中台元数据：字段增删自动同步到 `meta_column`，并触发依赖该表的视图重新校验（防止视图引用了已删除的列，避免运行时报错）。引擎侧表被删除时，标记 `meta_physical_table.status=0` 并告警。

## 四、视图层：Apache Calcite 深度集成

视图层是中台最有价值、也最需要"算得聪明"的一层。它的任务是：**把用户定义的视图 SQL，翻译成对物理数据源最高效的执行计划**。这件事交给 Apache Calcite。

![Calcite 查询优化流水线](/commercial-tech/report-tech/report-middle-platform/calcite-pipeline-mechanism.svg)

### 4.1 Calcite 在中台里扮演什么角色

Apache Calcite 是一个**动态数据管理框架**，本身不存储数据，只负责"查询的大脑"：

- SQL 解析（Parser）→ `SqlNode`（AST）
- SQL 校验（Validator）→ 绑定元数据、校验类型
- 转关系代数 → `RelNode`
- 优化（Planner）→ RBO（`HepPlanner`）/ CBO（`VolcanoPlanner`）
- 适配层（Adapter）→ 把计划下推/转换为具体数据源

关键前提：**Calcite 要优化，必须先"认识"你的物理表**。所以第一步是把 `meta_physical_table` / `meta_column` 喂进 Calcite 的 Schema。

### 4.2 第一步：把元数据接入 Calcite Schema

Calcite 通过 `Schema` + `Table` 抽象来"认识"数据。我们基于元数据表实现一个自定义 Schema：

```java
// 自定义 Schema：从中台元数据构造 Calcite 可识别的表
public class MetaSchema extends AbstractSchema {
    private final long datasourceId;
    private final MetaTableService metaService;

    @Override
    protected Map<String, Table> getTableMap() {
        Map<String, Table> tables = new HashMap<>();
        for (MetaPhysicalTable pt : metaService.listTables(datasourceId)) {
            tables.put(pt.getTableName(), new MetaTable(pt, metaService));
        }
        return tables;
    }
}

// 自定义 Table：暴露列结构 + 统计信息（供 CBO）
public class MetaTable extends AbstractTable {
    private final MetaPhysicalTable pt;
    private final MetaTableService metaService;

    // 列结构：中台元数据 → Calcite RelDataType
    @Override
    public RelDataType getRowType(RelDataTypeFactory typeFactory) {
        RelDataTypeFactory.Builder b = typeFactory.builder();
        for (MetaColumn c : metaService.listColumns("TABLE", pt.getId())) {
            RelDataType type = typeFactory.createSqlType(
                SqlTypeName.valueOf(c.getColType()));
            b.add(c.getColName(), typeFactory.createTypeWithNullability(
                type, c.getNullable() == 1));
        }
        return b.build();
    }

    // 统计信息：把 row_count / ndv 交给优化器
    @Override
    public Statistic getStatistic() {
        return Statistics.of(
            pt.getRowCount() == null ? 1000d : pt.getRowCount(),  // 行数
            ImmutableList.of());                                    // 可扩展唯一键
    }
}
```

把 `getStatistic()` 里的行数/NDV 填准，CBO 的 join 顺序选择才靠谱——这是很多人接 Calcite 只做 RBO、CBO 却"不生效"的根因：**没喂统计信息**。

### 4.3 解析与校验

视图定义本质是一段 SQL。Calcite 先解析成 AST，再结合上面注册的 Schema 做**语义校验**——字段存不存在、类型匹不匹配、函数合不合法，在执行之前就兜住错误：

```java
// 构建 FrameworkConfig，挂上自定义 Schema
SchemaPlus root = Frameworks.createRootSchema(true);
root.add("mydb", new MetaSchema(datasourceId, metaService));

FrameworkConfig config = Frameworks.newConfigBuilder()
    .defaultSchema(root.getSubSchema("mydb"))
    .parserConfig(SqlParser.config().withCaseSensitive(false))
    // programs 用于 CBO transform（见 4.4）
    .programs(Programs.standard())
    .build();

Planner planner = Frameworks.getPlanner(config);
SqlNode parsed    = planner.parse(view.getSqlText()); // 解析→AST
SqlNode validated = planner.validate(parsed);          // 校验(绑定元数据)
RelNode logical   = planner.rel(validated).rel;        // 转关系代数(逻辑计划,未优化)
```

⚠️ 关键点：`planner.rel(...)` 产出的是**逻辑计划，尚未优化**。真正的优化在下一步。

### 4.4 关系代数与优化器：RBO + CBO

Calcite 有两套优化器，中台通常**两段式**使用：先 RBO 做确定性规则改写，再 CBO 做代价择优。

**① RBO：`HepPlanner`** —— 按既定顺序确定性地应用规则（过滤下推、列裁剪、投影合并等）：

```java
// RBO：用 HepPlanner 显式应用规则（planner.rel 不会自动优化）
HepProgram hepProgram = HepProgram.builder()
    .addRuleInstance(CoreRules.FILTER_INTO_JOIN)  // 过滤下推到 Join 下方
    .addRuleInstance(CoreRules.PROJECT_MERGE)     // 合并相邻 Project
    .addRuleInstance(CoreRules.FILTER_MERGE)      // 合并相邻 Filter
    .addRuleInstance(CoreRules.AGGREGATE_PROJECT_MERGE)
    .build();
HepPlanner hep = new HepPlanner(hepProgram);
hep.setRoot(logical);
RelNode afterRbo = hep.findBestExp();
```

**② CBO：`VolcanoPlanner`** —— 结合 4.2 里的统计信息，枚举等价计划、按代价（`RelOptCost`）选 join 顺序与访问路径。用 Frameworks 时通过 `planner.transform` 触发（内部即 VolcanoPlanner）：

```java
// CBO：转成期望的物理约定(EnumerableConvention)，交给 VolcanoPlanner 择优
RelTraitSet desired = afterRbo.getTraitSet()
    .replace(EnumerableConvention.INSTANCE);
RelNode optimized = planner.transform(0, desired, afterRbo);
// programIndex=0 对应 config.programs 里的第一个 program(Programs.standard())
```

CBO 的核心是**代价模型**：Calcite 用 `{rowCount, cpu, io}` 三元组估算每个计划的代价，`VolcanoPlanner.findBestExp()` 用动态规划在等价集合（RelSet/RelSubset）里挑最低代价的那棵树。统计信息越准，择优越靠谱。

### 4.5 顺带白拿：字段血缘

优化过程中，Calcite 已经算清楚了每个输出列来自哪张物理表的哪一列。注册视图时直接抽血缘写库：

```java
RelMetadataQuery mq = optimized.getCluster().getMetadataQuery();
for (int i = 0; i < optimized.getRowType().getFieldCount(); i++) {
    Set<RelColumnOrigin> origins = mq.getColumnOrigins(optimized, i);
    // origins 里含 originTable + originColumnOrdinal → 写入 meta_lineage
}
```

这就是 2.4 里血缘表"不用人工维护"的来源。

### 4.6 视图物化：从"即时计算"到"预计算"

当视图被高频查询、底层表又很大时，每次现算很重。业界（如 Cube）成熟做法是**物化视图 / 预聚合**：把常用视图结果提前算好落盘，查询时直接命中。

Calcite 原生支持**物化视图自动改写**：把物化视图注册进 planner 后，`MaterializedViewRule`（及 `SubstitutionVisitor` 系列）能识别"当前查询可被某个物化视图覆盖"，自动把查询改写为读物化表，而不是重算底层大表。

```java
// 注册物化视图：把 mv 的定义 SQL 与其落库表告诉 Calcite
schema.add("mv_gmv_daily", mvTable);       // 物化后的物理表
calciteSchema.add("mv_gmv_daily",
    new MaterializationService(...)...);   // 关联 mv 定义 → 参与改写
```

中台据此可提供"视图定义 → 自动选物化策略"的能力（Calcite 的 `Lattice` 还能做多维物化的自动推荐），这是视图层优化的进阶形态。

![物化视图：即时计算 vs 预计算权衡](/commercial-tech/report-tech/report-middle-platform/materialization-tradeoff.svg)

### 4.7 多数据源与方言下推

同一份视图可能 join 多个数据源。Calcite 通过 Adapter（如 JDBC Adapter）屏蔽差异，并借 `RelToSqlConverter` 把优化后的 `RelNode` **回写成对应方言 SQL** 下推给数据源执行：

```java
// 把优化后的计划下推为目标数据源方言 SQL（下推,减少数据搬运）
SqlDialect dialect = SqlDialect.DatabaseProduct.CLICKHOUSE.getDialect();
RelToSqlConverter converter = new RelToSqlConverter(dialect);
SqlNode sqlNode = converter.visitRoot(optimized).asStatement();
String pushDownSql = sqlNode.toSqlString(dialect).getSql();
// pushDownSql 交给 ClickHouse 执行；跨源部分由 Calcite Enumerable 引擎在内存 join
```

`dialect` 正是 2.2 里 `meta_datasource.dialect` 存的值——元数据在这里闭环。

## 五、API 管理层：从视图到 HTTP 接口

API 层做的事：**把"某视图 + 入参映射"翻译成一次带条件的查询，再包成 HTTP 接口**。核心是运行时按 `meta_api` / `meta_api_param` 动态拼查询。

```java
// 运行时：根据 API 配置 + 请求参数，基于视图动态构造查询
public PageResult query(String path, Map<String, Object> params) {
    MetaApi api = apiService.getByPath(path);
    MetaView view = viewService.get(api.getViewId());

    // 1. 复用视图缓存的优化计划(RelNode)，在其上加 Filter/Project
    RelNode viewPlan = planCache.get(view.getId());  // 4.4 缓存的 optimized
    RelBuilder builder = RelBuilder.create(frameworkConfig);
    builder.push(viewPlan);

    // 2. 入参 → 视图字段条件（按 meta_api_param 的 operator 映射）
    for (MetaApiParam p : apiService.listParams(api.getId())) {
        Object val = params.get(p.getParamName());
        if (val == null && p.getRequired() == 0) continue;
        builder.filter(toCondition(builder, p, val)); // EQ/IN/GE/LE/BETWEEN
    }

    // 3. 投影输出字段 + 分页
    builder.project(builder.fields(api.getSelectCols()));
    RelNode finalPlan = builder.build();

    // 4. 优化→下推方言 SQL→执行（复用第四章链路）
    String sql = toPushDownSql(finalPlan, view);
    return execute(view.getDatasourceId(), sql, params);
}
```

于是"新增取数接口"真正做到：**配置一个视图 + 一条 API 规则**，零新增服务代码。参数校验、分页、字段裁剪全部由元数据驱动。

## 六、整体架构与业界坐标

### 6.1 架构示意

```
                ┌─────────────────────────────┐
   业务方/前端 ──▶│         API 管理层           │  meta_api / meta_api_param
                │  (视图 → HTTP 接口配置化)     │  运行时按入参拼 Filter/Project
                └──────────────┬──────────────┘
                               │ 引用视图
                ┌──────────────▼──────────────┐
                │        视图层（逻辑表）        │  meta_view / meta_view_field
                │  Calcite: 解析→校验→RBO→CBO   │  缓存优化后 RelNode + 物化改写
                └──────────────┬──────────────┘
                               │ 映射物理表
                ┌──────────────▼──────────────┐
                │       物理表管理层           │  meta_physical_table / meta_column
                │  多源元数据 / 血缘 / 统计     │  meta_lineage(自动抽取) / row_count·ndv
                └──────────────┬──────────────┘
                               │ Adapter + RelToSql 方言下推
                ┌──────────────▼──────────────┐
                │  MySQL / Hive / ClickHouse … │  meta_datasource(含 dialect)
                └─────────────────────────────┘
```

三层各司其职，Calcite 串起视图层的"算"，API 层解决"取"，物理表层解决"存与管"，元数据表把三层缝在一起。

![报表中台三层架构总览](/commercial-tech/report-tech/report-middle-platform/report-platform-overview.svg)

### 6.2 业界参考：这其实就是"语义层（Semantic Layer）"

把这套体系放到业界坐标系里看，它本质就是近年火热的**数据语义层（Semantic Layer）**——位于数仓与消费方（BI / API / AI）之间、用一致方式定义指标、维度、关联与口径的治理层。

- **dbt Semantic Layer（MetricFlow）**、**Cube**、**LookML（Looker）**、**AtScale** 都是这一模式：把业务语义（"营收""活跃用户"怎么算）定义在代码/配置里、纳入版本管理，统一对外暴露为可查询 API。对应到本文，就是 `meta_view_field` 的 `semantic/agg/caliber`。
- 现代语义层强调 **Headless（无头）**：定义一次、处处消费——同一份口径既喂 BI 看板，也喂前端嵌入分析，还能喂 AI 助手做可信的 text-to-SQL。
- 核心价值是解决**口径漂移（metric drift）**：全公司问"Q3 营收"只会有一种答案，而不是每个仪表盘各算各的。

区别只在于：我们把"视图层用 Calcite 做优化建设"作为中台**自己可控的技术选型**，而不是完全依赖某个商业语义层产品——建表、优化器、下推都握在自己手里。

## 七、集群容灾方案

> 报表中台一旦挂掉，业务方的看板与取数 API 全部失灵。而中台依赖的"物理表"往往跑在单集群上——集群故障 = 全公司断数。因此容灾不是可选项，是基线能力。容灾要分层设计：中台自身、元数据层、数据层，各管各的高可用。

### 7.1 分层容灾策略

- **查询/计算层（中台服务 + Calcite）**：无状态，多实例 + 负载均衡。挂一个实例不影响整体，天然容灾。
- **元数据层（中台 MySQL）**：主从复制（或 MGR 组复制），定时备份，配置中心兜底。
- **数据层（物理表所在集群）**：依赖各引擎原生的多副本 / 多集群复制能力（见 7.3）。

前两层中台自己能搞定；难点在数据层——它跨多个异构引擎，每个引擎的复制机制都不一样。

### 7.2 各引擎原生复制能力

| 引擎 | 复制机制 | 跨 AZ | 读写分离 |
| --- | --- | --- | --- |
| ClickHouse | `ReplicatedMergeTree` + ClickHouse Keeper（ZK 替代）；数据多副本 | 副本可跨机架/AZ | 分布式表读本地表，读写分离 |
| Elasticsearch | `number_of_replicas` 副本分片；跨集群复制 CCR | 副本跨节点/跨集群 | 副本可承接读 |
| Doris | FE（Leader+Follower，Raft）+ BE Tablet 三副本 | BE 副本跨 AZ 分布 | 多 BE 副本均衡读 |

要点：这些复制都是**引擎内置**的，中台不需要自己写同步逻辑，只需要在"数据源登记"里正确声明主备拓扑（见 7.4）。

### 7.3 跨可用区（AZ）部署

推荐**同城双 AZ + 异地灾备**两层：

- **同城双 AZ（RPO≈0）**：主副本在 AZ1，备副本在 AZ2，同步/近同步复制，单 AZ 故障 RPO≈0、RTO 秒级。
- **异地灾备（RPO>0）**：跨城市异步复制，应对城市级灾难，RPO 取决于同步间隔（分钟级）。

### 7.4 中台侧故障切换（Failover）设计

这是中台把"引擎原生复制"用起来的关键。核心是在数据源元数据里登记主备，并在查询路由时感知健康度：

```sql
-- 扩展 meta_datasource：登记主备与优先级
ALTER TABLE meta_datasource
  ADD COLUMN `role`       VARCHAR(16) NOT NULL DEFAULT 'PRIMARY' COMMENT 'PRIMARY/STANDBY',
  ADD COLUMN `priority`   INT         NOT NULL DEFAULT 1 COMMENT '同组优先级,越小越优先',
  ADD COLUMN `group_code` VARCHAR(64) NULL COMMENT '主备同组标识',
  ADD COLUMN `healthy`    TINYINT     NOT NULL DEFAULT 1 COMMENT '探活结果:1健康 0异常';
```

中台查询路由层据此把请求导向健康副本，主挂了自动切备：

```java
// 查询路由：优先主，主不健康则按 priority 选备
public EngineCtx route(String groupCode) {
    List<MetaDatasource> group = dsMapper.listByGroup(groupCode);
    group.sort(Comparator.comparingInt(MetaDatasource::getPriority));
    for (MetaDatasource ds : group) {
        if (ds.getHealthy() == 1) return buildCtx(ds);   // 命中健康副本
    }
    throw new AllReplicaDown();                            // 全组不可用
}

// 探活：定时 ping 各副本，回写 healthy；主异常则自动切备
@Scheduled(fixedDelay = 10_000)
void healthCheck() {
    for (MetaDatasource ds : dsMapper.listAll()) {
        boolean ok = probe(ds);                            // 轻量 SELECT 1 / GET _cluster/health
        dsMapper.updateHealthy(ds.getId(), ok ? 1 : 0);
    }
}
```

Calcite 这一层不受影响——它只关心 `Schema` 里"当前该连哪个数据源"，`route()` 返回的 `EngineCtx` 直接喂给 4.2 的 `MetaSchema` 即可，优化与下推逻辑完全复用。

### 7.5 一致性权衡（RPO / RTO）

- **RPO（数据丢失量）**：同城同步复制 RPO≈0；异地异步 RPO>0（接受分钟级丢失）。
- **RTO（恢复时间）**：无状态查询层 RTO 秒级；数据层取决于故障切换是否自动——中台自动探活+路由可达秒级，人工介入则分钟到小时级。
- 实际选型：**核心报表走同城双 AZ 同步复制**，非核心/离线走异地异步，兼顾成本与可用性。

![报表中台集群容灾架构](/commercial-tech/report-tech/report-middle-platform/cluster-dr-overview.svg)

## 八、小结

报表中台的本质，是把"报表"从**一次性的 SQL 查询**，升级为**可治理的数据资产**：

- **元数据层**（8 张表）——把物理表、视图、API 全部结构化，一切能力的地基；
- **物理表管理**——注册/发现/统计采集，喂饱 CBO；
- **视图层（Calcite）**——解析→校验→RBO(`HepPlanner`)→CBO(`VolcanoPlanner`)→物化改写→方言下推，把视图变成可复用的优化计划；
- **API 层**——按元数据运行时拼查询，新增接口=配置视图+API。
- **集群容灾**——分层高可用（查询层无状态、元数据主从、数据层引擎原生多副本），数据源主备登记 + 探活路由实现自动 Failover。

三者统一在一个平台里，报表的需求变更，从"改代码发版"变成"配视图、配接口"。而这套设计，与业界主流语义层同构——只是把技术底座牢牢握在自己手里。
