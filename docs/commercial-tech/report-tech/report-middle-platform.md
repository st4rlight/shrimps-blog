---
title: 报表中台技术体系
tags:
  - 报表中台
  - Calcite
  - 数据中台
  - 元数据
  - 物化视图
  - SQL优化
  - 语义层
excerpt: 报表中台是一套统一管理物理表、视图与 API 的系统。本文从元数据表设计（DDL）落地，到视图层如何接入 Apache Calcite 完成 SQL 解析、校验、RBO/CBO 优化与物化视图改写，再到 API 层的参数映射与 SQL 生成，给出可照着实现的全链路技术细节。
createTime: 2026/07/13 13:30:00
updateTime: 2026/07/13 16:00:00
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

## 三、物理表管理：注册与元数据同步

物理表管理的核心是**注册 + 发现 + 统计采集**：

1. **注册**：录入数据源后，通过 JDBC `DatabaseMetaData` 拉取库表结构，写入 `meta_physical_table` / `meta_column`。
2. **统计采集**：定时对物理表跑 `SELECT COUNT(*)`、`approx_count_distinct(col)`（或采样），回填 `row_count` / `ndv`——这是 CBO 的"燃料"。
3. **变更感知**：定时 diff 库表 schema，字段增删自动同步，并触发依赖它的视图重新校验（防止视图引用了已删除的字段）。

```java
// 通过 JDBC 元数据自动登记物理表字段
try (Connection conn = dataSource.getConnection()) {
    DatabaseMetaData md = conn.getMetaData();
    try (ResultSet cols = md.getColumns(null, schema, tableName, "%")) {
        int ordinal = 0;
        while (cols.next()) {
            MetaColumn c = new MetaColumn();
            c.setColName(cols.getString("COLUMN_NAME"));
            c.setColType(toCalciteType(cols.getInt("DATA_TYPE"))); // JDBC类型→SqlTypeName
            c.setNullable(cols.getInt("NULLABLE") == 1);
            c.setOrdinal(ordinal++);
            metaColumnMapper.insert(c);
        }
    }
}
```

## 四、视图层：Apache Calcite 深度集成

视图层是中台最有价值、也最需要"算得聪明"的一层。它的任务是：**把用户定义的视图 SQL，翻译成对物理数据源最高效的执行计划**。这件事交给 Apache Calcite。

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

### 6.2 业界参考：这其实就是"语义层（Semantic Layer）"

把这套体系放到业界坐标系里看，它本质就是近年火热的**数据语义层（Semantic Layer）**——位于数仓与消费方（BI / API / AI）之间、用一致方式定义指标、维度、关联与口径的治理层。

- **dbt Semantic Layer（MetricFlow）**、**Cube**、**LookML（Looker）**、**AtScale** 都是这一模式：把业务语义（"营收""活跃用户"怎么算）定义在代码/配置里、纳入版本管理，统一对外暴露为可查询 API。对应到本文，就是 `meta_view_field` 的 `semantic/agg/caliber`。
- 现代语义层强调 **Headless（无头）**：定义一次、处处消费——同一份口径既喂 BI 看板，也喂前端嵌入分析，还能喂 AI 助手做可信的 text-to-SQL。
- 核心价值是解决**口径漂移（metric drift）**：全公司问"Q3 营收"只会有一种答案，而不是每个仪表盘各算各的。

区别只在于：我们把"视图层用 Calcite 做优化建设"作为中台**自己可控的技术选型**，而不是完全依赖某个商业语义层产品——建表、优化器、下推都握在自己手里。

## 七、小结

报表中台的本质，是把"报表"从**一次性的 SQL 查询**，升级为**可治理的数据资产**：

- **元数据层**（8 张表）——把物理表、视图、API 全部结构化，一切能力的地基；
- **物理表管理**——注册/发现/统计采集，喂饱 CBO；
- **视图层（Calcite）**——解析→校验→RBO(`HepPlanner`)→CBO(`VolcanoPlanner`)→物化改写→方言下推，把视图变成可复用的优化计划；
- **API 层**——按元数据运行时拼查询，新增接口=配置视图+API。

三者统一在一个平台里，报表的需求变更，从"改代码发版"变成"配视图、配接口"。而这套设计，与业界主流语义层同构——只是把技术底座牢牢握在自己手里。
