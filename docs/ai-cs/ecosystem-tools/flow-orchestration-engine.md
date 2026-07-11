---
title: 流程编排引擎Flow
tags:
  - LiteFlow
  - CompileFlow
  - 流程编排
  - 规则引擎
  - 工作流
  - 客服系统
excerpt: 当业务逻辑从简单的条件判断走向多步骤、多分支、甚至需要并行和循环编排时，表达式引擎就显得力不从心了——你需要的是一个流程编排引擎。本文系统介绍 LiteFlow 和 CompileFlow 两大主流流程编排引擎的设计理念、核心能力与实战用法，并结合 AI 客服系统场景探讨其落地实践。
createTime: 2026/07/11 16:00:00
permalink: /ai-cs/flow-orchestration-engine/
---

# 流程编排引擎Flow

> 当你的业务逻辑从单条 `if-else` 演变成一张包含串行、并行、选择、循环的"流程图"时——比如一个客服工单从创建到关闭需要经过意图识别、情绪判断、路由分配、自动回复、满意度回访等多个步骤，而且这些步骤之间的编排关系还在频繁变化——你需要的不再是一个表达式引擎，而是一个**流程编排引擎**。

[[TOC]]

---

## 一、什么是流程编排引擎

### 1.1 问题背景

假设你在构建一个 AI 客服系统的会话处理流程，涉及多个步骤的协调编排：

```java
// 硬编码方式：流程逻辑散落在代码里，变更需要改代码、测试、上线
public SessionResult processSession(Session session) {
    // 步骤1：预处理消息
    Message preprocessed = preprocessService.clean(session.getMessage());

    // 步骤2：意图识别
    Intent intent = nlpService.detectIntent(preprocessed);

    // 步骤3：根据意图路由
    if (intent == Intent.REFUND) {
        RefundResult result = refundService.process(session);
        if (result.needApproval()) {
            result = approvalService.approve(result);
        }
        return buildResult(result);
    } else if (intent == Intent.CONSULT) {
        // 知识库检索 + LLM 生成
        List<Knowledge> docs = knowledgeService.search(preprocessed);
        String reply = llmService.generate(preprocessed, docs);
        return buildResult(reply);
    } else if (intent == Intent.COMPLAINT) {
        // 投诉处理：情绪判断 + 升级路由
        Emotion emotion = emotionService.analyze(preprocessed);
        if (emotion == Emotion.ANGRY) {
            escalationService.escalate(session);
        }
        return buildResult(complaintService.handle(session));
    }

    return buildResult(defaultService.handle(session));
}
```

这段代码的问题不仅在于 `if-else` 多，更在于**流程逻辑和业务逻辑耦合在一起**：

| 问题 | 说明 |
|------|------|
| **流程不可视** | 流程的全貌隐藏在代码调用链中，非技术人员无法理解 |
| **变更成本高** | 新增一个步骤（如"敏感词检测"）需要改代码、走发布流程 |
| **并行困难** | 如果想并行执行意图识别和情绪分析，需要手动管理线程 |
| **无法动态调整** | 运营想临时调整流程顺序？等下次发版吧 |
| **复用困难** | 不同场景的流程逻辑无法复用，重复代码泛滥 |

### 1.2 流程编排引擎的解决思路

流程编排引擎的核心思想是：**把流程的编排关系从代码中抽离出来，用规则文件描述步骤之间的执行顺序，由引擎在运行时动态解析和执行**。

```xml
<!-- LiteFlow 方式：流程是规则，不是代码 -->
<chain name="sessionProcess">
    THEN(
        preprocessNode,
        SWITCH(intentSwitch).TO(
            refundChain,
            consultChain,
            complaintChain
        )
    );
</chain>

<chain name="consultChain">
    WHEN(
        knowledgeSearchNode,
        emotionAnalysisNode
    ),
    llmGenerateNode;
</chain>
```

这样带来的好处：

- **流程可视化**：规则文件即流程图，非技术人员也能理解
- **动态编排**：流程存储在配置中心，修改不需要重新发版
- **并行编排**：一行 `WHEN` 语法即可实现并行执行
- **组件复用**：每个步骤是独立组件，可在不同流程中复用
- **热刷新**：规则变化即时生效，无需重启应用

### 1.3 表达式引擎 vs 流程编排引擎 vs 工作流引擎

流程编排引擎在技术栈中处于承上启下的位置——比表达式引擎更复杂（多步骤编排），比工作流引擎更轻量（无持久化、无人工审批）。

![流程编排引擎在技术栈中的定位](/ai-cs/ecosystem-tools/flow-orchestration-engine/flow-engine-overview.svg)

三者处理的问题域不同，经常被混为一谈：

| 维度 | 表达式引擎 | 流程编排引擎 | 工作流引擎 |
|------|----------|------------|-----------|
| **核心能力** | 单条表达式求值 | 多步骤编排与调度 | 长周期流程管理与持久化 |
| **状态管理** | 无状态 | 通常无状态或轻量状态 | 持久化状态，支持人工任务 |
| **典型代表** | QLExpress、Aviator | **LiteFlow**、**CompileFlow** | Activiti、Flowable |
| **流程描述** | 表达式字符串 | DSL 规则文件（XML/JSON/YML） | BPMN 2.0 XML |
| **人工审批** | 不支持 | 不支持（或轻量支持） | 核心能力 |
| **持久化** | 无 | 通常无 | 数据库持久化 |
| **性能** | 极高（纳秒级） | 高（毫秒级） | 中（数据库 I/O） |
| **适用场景** | 条件判断、计算 | 业务步骤编排 | 审批流、订单履约 |

::: tip 定位差异
**表达式引擎**解决的是"一个条件怎么判断"的问题；**流程编排引擎**解决的是"多个步骤怎么协调"的问题；**工作流引擎**解决的是"一个长周期流程怎么管理"的问题。三者互补，不是替代关系。
:::

![三种引擎核心差异对比](/ai-cs/ecosystem-tools/flow-orchestration-engine/engine-type-comparison.svg)

### 1.4 主流流程编排引擎对比

| 引擎 | 出品方 | 执行模式 | 流程描述 | 特点 |
|------|--------|---------|---------|------|
| **LiteFlow** | dromara 社区 | 解释执行 | DSL（XML/JSON/YML） | 轻量灵活，支持脚本语言和 AI Agent 编排 |
| **CompileFlow** | 阿里巴巴 | 编译执行 | BPMN 2.0 / TBBPM | 编译为 Java 字节码，极致性能 |
| **Activiti** | Alfresco | 解释执行 | BPMN 2.0 | 完整的工作流引擎，支持人工审批和持久化 |
| **Flowable** | Flowable | 解释执行 | BPMN 2.0 | Activiti 分支，功能更丰富 |
| **Camunda** | Camunda | 解释执行 | BPMN 2.0 | 企业级流程引擎，监控能力强 |

本文聚焦于 **LiteFlow** 和 **CompileFlow**——前者代表了轻量灵活的 DSL 驱动编排范式，后者代表了编译执行的极致性能范式。两者都是阿里生态的重要组成（LiteFlow 虽由社区开源，但与阿里生态深度结合，支持 QLExpress 脚本节点）。

---

## 二、LiteFlow

### 2.1 项目背景

LiteFlow 于 2020 年正式开源，是 dromara 社区旗下的轻量级规则编排引擎。它融合了编排特性和规则引擎特性，专注于**组件化业务编排**领域——用轻量的 DSL 规则驱动整个复杂业务，实现平滑热部署，并支持多种脚本语言的嵌入。

LiteFlow 的设计理念是：**所有的逻辑都是组件，用规则文件编排组件之间的关系**。它不关心组件内部怎么实现，只关心组件之间怎么协作。

从 v2.16.0 起，LiteFlow 更是把 AI Agent 变成了可以被直接编排进规则的"一等公民"——一个 ReAct Agent 就是一个标准的 LiteFlow 组件，可以与现有的业务节点自由编排。

### 2.2 核心特性

| 特性 | 说明 |
|------|------|
| **组件定义统一** | 所有的逻辑都是组件，提供统一化的组件实现方式 |
| **规则轻量** | 基于规则文件编排流程，5 分钟入门，一看即懂 |
| **规则多样化** | 支持 XML、JSON、YML 三种规则文件格式 |
| **任意编排** | 支持串行、并行、选择、循环、嵌套等复杂编排 |
| **规则持久化** | 原生支持数据库、Nacos、Etcd、Zookeeper、Apollo、Redis |
| **优雅热刷新** | 规则变化即时生效，高并发下不会导致执行错乱 |
| **脚本语言支持** | 支持 Groovy、Java、Kotlin、JavaScript、QLExpress、Python、Lua、Aviator |
| **脚本与 Java 全打通** | 脚本可调用 Java 方法、引用实例、发起 RPC 调用 |
| **AI Agent 编排** | 将 ReAct Agent 封装为标准组件，支持主流大模型 |
| **组件重试** | 每个组件可自定义重试配置和指定异常 |
| **上下文隔离** | 可靠的上下文隔离机制，无需担心高并发数据串流 |
| **声明式组件** | 任意类秒变组件，注解驱动 |
| **详细步骤信息** | 链路执行详情、组件耗时、错误信息一目了然 |
| **JDK 支持广泛** | JDK 8 ~ JDK 25，JDK 21+ 支持虚拟线程 |
| **Spring Boot 全版本** | 支持 Spring Boot 2.X、3.X、4.X |

### 2.3 Maven 依赖

```xml
<dependency>
    <groupId>com.dromara</groupId>
    <artifactId>liteflow-spring-boot-starter</artifactId>
    <version>2.13.0</version>
</dependency>
```

::: tip 版本说明
LiteFlow 的 `groupId` 为 `com.dromara`，`artifactId` 为 `liteflow-spring-boot-starter`（Spring Boot 项目）或 `liteflow-core`（非 Spring Boot 项目）。如需使用 AI Agent 编排功能（v2.16.0+），需额外引入 `liteflow-react-agent` 模块，且运行时需要 JDK 21+。
:::

### 2.4 快速上手

#### 第一步：定义组件

LiteFlow 中的每个步骤都是一个组件，继承 `NodeComponent` 并实现 `process` 方法：

```java
import com.yomahub.liteflow.annotation.LiteflowComponent;
import com.yomahub.liteflow.core.NodeComponent;

// 消息预处理组件
@LiteflowComponent("preprocessNode")
public class PreprocessNode extends NodeComponent {
    @Override
    public void process() {
        // 从上下文获取数据
        SessionContext ctx = this.getContextBean(SessionContext.class);
        // 执行预处理逻辑
        String cleaned = ctx.getMessage().trim().toLowerCase();
        ctx.setPreprocessedMessage(cleaned);
    }
}

// 意图识别组件
@LiteflowComponent("intentNode")
public class IntentNode extends NodeComponent {
    @Override
    public void process() {
        SessionContext ctx = this.getContextBean(SessionContext.class);
        Intent intent = nlpService.detectIntent(ctx.getPreprocessedMessage());
        ctx.setIntent(intent);
    }
}

// LLM 回复生成组件
@LiteflowComponent("llmNode")
public class LlmNode extends NodeComponent {
    @Override
    public void process() {
        SessionContext ctx = this.getContextBean(SessionContext.class);
        String reply = llmService.generate(ctx.getPreprocessedMessage());
        ctx.setReply(reply);
    }
}
```

#### 第二步：编写规则文件

在 `resources` 目录下创建 `flow.el.xml`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<flow>
    <chain name="sessionProcess">
        THEN(preprocessNode, intentNode, llmNode);
    </chain>
</flow>
```

#### 第三步：配置与执行

```yaml
# application.yml
liteflow:
  rule-source: flow.el.xml
```

```java
@Service
public class SessionService {

    @Resource
    private FlowExecutor flowExecutor;

    public SessionResult processSession(String message) {
        SessionContext context = new SessionContext();
        context.setMessage(message);

        // 执行流程
        LiteflowResponse response = flowExecutor.execute2Resp("sessionProcess", null, context);

        if (response.isSuccess()) {
            return SessionResult.success(context.getReply());
        } else {
            return SessionResult.fail(response.getMessage());
        }
    }
}
```

三步搞定：定义组件 → 编写规则 → 执行流程。组件只关注自己的业务逻辑，编排关系完全由规则文件控制。

### 2.5 编排语法

LiteFlow 使用 EL（Expression Language）表达式来描述编排关系，语法简洁直观：

#### 串行编排 THEN

```xml
<!-- 按顺序依次执行 -->
THEN(a, b, c);
```

#### 并行编排 WHEN

```xml
<!-- 并行执行，全部完成后继续 -->
WHEN(a, b, c);
```

#### 选择编排 SWITCH

```xml
<!-- 根据 a 的执行结果选择分支 -->
SWITCH(a).TO(b, c, d);
```

#### 条件编排 IF

```xml
<!-- 如果 a 返回 true，执行 b，否则执行 c -->
IF(a, b, c);

<!-- 省略 else 分支 -->
IF(a, b);
```

#### 循环编排 FOR / WHILE / ITERATOR

```xml
<!-- 固定次数循环 -->
FOR(3).DO(a);

<!-- 条件循环 -->
WHILE(a).DO(b);

<!-- 迭代器循环 -->
ITERATOR(x).DO(a);
```

#### 嵌套编排

LiteFlow 支持任意层级的嵌套组合：

```xml
<!-- 复杂嵌套：预处理 → 并行(意图识别, 情绪分析) → 条件路由 -->
THEN(
    preprocessNode,
    WHEN(intentNode, emotionNode),
    IF(needEscalationNode, escalateNode, 
        SWITCH(intentSwitch).TO(refundChain, consultChain, complaintChain)
    )
);
```

#### 编排语法总结

| 语法 | 语义 | 类比 |
|------|------|------|
| `THEN(a, b, c)` | 串行执行 | 顺序语句 |
| `WHEN(a, b, c)` | 并行执行 | 多线程 |
| `SWITCH(a).TO(b, c, d)` | 选择分支 | switch-case |
| `IF(a, b, c)` | 条件分支 | if-else |
| `FOR(n).DO(a)` | 固定次数循环 | for |
| `WHILE(a).DO(b)` | 条件循环 | while |
| `ITERATOR(x).DO(a)` | 迭代循环 | for-each |
| `CATCH(a).DO(b)` | 异常捕获 | try-catch |

::: tip 语法易读性
LiteFlow 的 EL 语法设计追求"所见即所得"——看规则文件就能知道流程是怎么运转的。学习门槛极低，5 分钟即可入门。
:::

![LiteFlow编排语法总览](/ai-cs/ecosystem-tools/flow-orchestration-engine/liteflow-syntax-overview.svg)

### 2.6 组件体系

#### 基本组件

LiteFlow 提供了几种基本组件类型：

| 组件类型 | 基类 | 说明 |
|---------|------|------|
| 普通组件 | `NodeComponent` | 最常用，执行业务逻辑 |
| 选择组件 | `NodeSwitchComponent` | 返回字符串决定下一个节点 |
| 条件组件 | `NodeIfComponent` | 返回布尔值，用于 IF 语法 |
| 循环组件 | `NodeForComponent` | 返回循环次数，用于 FOR 语法 |
| 迭代组件 | `NodeIteratorComponent` | 返回迭代器，用于 ITERATOR 语法 |
| 布尔组件 | `NodeBooleanComponent` | 返回布尔值，用于 WHILE 语法 |

#### 声明式组件

除了继承基类，LiteFlow 还支持声明式组件——用注解让任意类秒变组件：

```java
@LiteflowComponent
@LiteflowMethod(value = NodeType.COMMON, nodeId = "preprocessNode")
public class PreprocessService {

    @LiteflowMethod(value = LiteFlowMethodEnum.PROCESS, nodeId = "preprocessNode")
    public void process() {
        SessionContext ctx = LiteflowResponse.getContextBean(SessionContext.class);
        // 业务逻辑
    }
}
```

#### 组件重试

每个组件可以独立配置重试策略：

```java
@LiteflowComponent(retry = 3, retryForExceptions = {RuntimeException.class})
public class LlmNode extends NodeComponent {
    @Override
    public void process() {
        // 如果抛出 RuntimeException，会自动重试最多 3 次
    }
}
```

### 2.7 脚本语言支持

LiteFlow 支持在规则文件中直接定义脚本节点，支持 **Groovy、Java、Kotlin、JavaScript、QLExpress、Python、Lua、Aviator** 等多种脚本语言：

```xml
<!-- Groovy 脚本节点 -->
<node id="groovyScript" type="script" language="groovy">
    def ctx = contextBean(SessionContext.class)
    def score = ctx.vipLevel * 10 + ctx.orderCount
    ctx.score = score
</node>

<!-- QLExpress 脚本节点（与表达式引擎无缝结合） -->
<node id="qlexpressScript" type="script" language="qlexpress">
    score = user.vipLevel * 10 + user.orderCount;
</node>

<!-- Python 脚本节点 -->
<node id="pythonScript" type="script" language="python">
    score = ctx.getVipLevel() * 10 + ctx.getOrderCount()
    ctx.setScore(score)
</node>
```

::: tip 脚本与 Java 全打通
所有脚本语言均可调用 Java 方法、引用 Spring Bean 实例，甚至在脚本中发起 RPC 调用。这意味着你可以在脚本节点中做任何 Java 能做的事，同时享受脚本语言的灵活性。
:::

### 2.8 热刷新机制

LiteFlow 的热刷新是其核心特性之一——规则变化后，**无需重启应用，即时生效**：

```java
// 方式一：通过 API 手动刷新
@Resource
private FlowExecutor flowExecutor;

public void refreshRule(String newRuleContent) {
    flowExecutor.reloadRule();
}

// 方式二：从配置中心监听自动刷新
// LiteFlow 原生支持 Nacos、Etcd、Zookeeper、Apollo、Redis
```

```yaml
# 从 Nacos 加载规则，变更自动热刷新
liteflow:
  rule-source-ext-data: true
  rule-source-ext-data-map:
    nacosServerAddr: localhost:8848
    nacosNamespace: public
    nacosDataId: session-flow
    nacosGroup: DEFAULT_GROUP
```

::: tip 热刷新的安全性
LiteFlow 的热刷新在高并发下是安全的——正在执行的流程会使用旧的规则快照执行完毕，新请求自动使用新规则。不会出现规则刷新导致的执行错乱。
:::

### 2.9 上下文隔离

LiteFlow 提供了可靠的上下文隔离机制，每个请求拥有独立的上下文实例，无需担心高并发下的数据串流：

```java
// 自定义上下文
public class SessionContext {
    private String message;
    private Intent intent;
    private String reply;
    // getter / setter
}

// 执行时传入上下文
SessionContext context = new SessionContext();
context.setMessage("我想退款");
LiteflowResponse response = flowExecutor.execute2Resp("sessionProcess", null, context);

// 组件中获取上下文（类型安全）
@Override
public void process() {
    SessionContext ctx = this.getContextBean(SessionContext.class);
    // 每次请求的 ctx 都是独立实例
}
```

### 2.10 AI Agent 编排

从 v2.16.0 起，LiteFlow 引入了 AI Agent 模块 `liteflow-react-agent`，把一个完整的 ReAct（Reasoning + Acting）Agent 封装成标准的 LiteFlow 组件：

```xml
<!-- 串行编排：预处理 → AI Agent → 记录回复 -->
THEN(prepareNode, deepseekAgent, recordReply);

<!-- 并行编排：两个不同的大模型同时分析 -->
WHEN(deepseekAgent, qwenAgent);

<!-- 条件编排：根据问题类型路由到不同 Agent -->
IF(isMathNode, mathAgent, deepseekAgent);

<!-- 多 Agent 协同：并行分析 + 汇总决策 -->
THEN(prepareNode, WHEN(analyzerAgent, riskAgent), summaryAgent, notifyNode);
```

这里的 `THEN`、`WHEN`、`IF` 没有一个是为 AI 新造的，全是 LiteFlow 用了多年的编排算子。**你会编排 LiteFlow，你就会编排 AI。**

该模块对接了主流大模型平台——OpenAI、Claude、Gemini、DeepSeek、通义千问、Kimi、GLM 等，并提供多轮会话记忆、Skills 技能体系、流式输出等能力。

::: tip AI Agent 模块要求
AI Agent 模块基于 agentscope-java，运行时需要 JDK 21+。切换模型基本就是换一行 `model()` 的事。
:::

---

## 三、CompileFlow

### 3.1 项目背景

CompileFlow 是阿里巴巴开源的轻量级、高性能流程引擎，源自淘宝的 TBBPM（Taobao Business Process Management）工作流引擎。它专注于**纯内存、无状态执行**，通过将流程文件转换为 Java 代码再编译执行的方式，实现了接近原生 Java 的极致性能。

CompileFlow 目前支撑着阿里巴巴的多个核心系统，包括业务中台和交易系统。它允许开发者以可视化的方式设计业务逻辑，在业务分析师和工程师之间架起桥梁，使业务表达更加直观高效。

### 3.2 核心特性

| 特性 | 说明 |
|------|------|
| **极致性能** | 编译后执行架构，原生 Java 级别性能 |
| **类型安全** | 强类型约束，编译时校验，减少运行时错误 |
| **生产就绪** | 无缝 Spring Boot 集成，内置监控和企业级特性 |
| **多标准支持** | 同时支持 BPMN 2.0 和 TBBPM 两种流程规范 |
| **可视化设计** | 提供 IntelliJ IDEA 插件进行可视化流程建模 |
| **热部署** | 支持手动热重载和自动文件/Nacos 监听热部署 |
| **监控可观测** | 基于 SPI 的事件系统，支持 Micrometer/Prometheus |
| **纯内存无状态** | 不涉及数据库 I/O，执行效率极高 |
| **自定义 ClassLoader** | 支持插件化架构，可指定类加载器 |

### 3.3 与 LiteFlow 的本质区别

CompileFlow 与 LiteFlow 最本质的区别在于**执行模式**：

```text
LiteFlow：规则文件 → 解释执行（运行时解析 DSL，按编排关系调度组件）

CompileFlow：流程文件 → 生成 Java 代码 → 编译为字节码 → 直接执行
```

这意味着 CompileFlow 执行时**没有解析开销**——流程在部署时就被编译为原生的 Java 方法调用，执行性能等同于手写的 Java 代码。代价是每次流程变更都需要重新编译，且不支持运行时动态脚本。

![LiteFlow vs CompileFlow 执行模式对比](/ai-cs/ecosystem-tools/flow-orchestration-engine/liteflow-vs-compileflow.svg)

### 3.4 Maven 依赖

```xml
<!-- Spring Boot 项目（推荐） -->
<dependency>
    <groupId>com.alibaba.compileflow</groupId>
    <artifactId>compileflow-spring-boot-starter</artifactId>
    <version>2.0.0</version>
</dependency>
```

```xml
<!-- 非 Spring Boot 项目 -->
<dependency>
    <groupId>com.alibaba.compileflow</groupId>
    <artifactId>compileflow-core</artifactId>
    <version>2.0.0</version>
</dependency>
<!-- 根据流程规范选择其一 -->
<dependency>
    <groupId>com.alibaba.compileflow</groupId>
    <artifactId>compileflow-tbbpm</artifactId>
    <version>2.0.0</version>
</dependency>
```

::: warning ProcessEngine 是重量级对象
`ProcessEngine` 实例管理多个内部线程池（编译池、执行池、事件池、调度池），单个实例可能包含 16~64 个后台线程。**必须使用单例模式**，千万不要每次请求创建新实例。
:::

### 3.5 快速上手

#### 第一步：定义流程文件

在 `resources` 目录下创建流程文件 `bpm/session_process.tbbpm`（TBBPM 格式）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<process name="sessionProcess" displayName="会话处理流程"
         xmlns="http://compileflow.alibaba-inc.com/tbbpm">

    <start id="start" name="开始">
        <transition to="preprocess"/>
    </start>

    <autoTask id="preprocess" name="消息预处理">
        <action type="spring-bean">
            <actionHandle bean="preprocessService" method="process">
                <var name="message" contextVarName="message" inOutType="param"/>
                <var name="result" contextVarName="preprocessedMessage" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="intentDetect"/>
    </autoTask>

    <autoTask id="intentDetect" name="意图识别">
        <action type="spring-bean">
            <actionHandle bean="intentService" method="detect">
                <var name="message" contextVarName="preprocessedMessage" inOutType="param"/>
                <var name="result" contextVarName="intent" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="decision"/>
    </autoTask>

    <decision id="decision" name="意图路由">
        <transition to="refundTask" expr="intent == 'REFUND'"/>
        <transition to="consultTask" expr="intent == 'CONSULT'"/>
        <transition to="defaultTask" expr="default"/>
    </decision>

    <autoTask id="refundTask" name="退款处理">
        <action type="spring-bean">
            <actionHandle bean="refundService" method="handle">
                <var name="message" contextVarName="preprocessedMessage" inOutType="param"/>
                <var name="result" contextVarName="reply" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="end"/>
    </autoTask>

    <autoTask id="consultTask" name="咨询处理">
        <action type="spring-bean">
            <actionHandle bean="llmService" method="generate">
                <var name="message" contextVarName="preprocessedMessage" inOutType="param"/>
                <var name="result" contextVarName="reply" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="end"/>
    </autoTask>

    <autoTask id="defaultTask" name="默认处理">
        <action type="spring-bean">
            <actionHandle bean="defaultService" method="handle">
                <var name="message" contextVarName="preprocessedMessage" inOutType="param"/>
                <var name="result" contextVarName="reply" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="end"/>
    </autoTask>

    <end id="end" name="结束"/>
</process>
```

#### 第二步：实现 Service

```java
@Service
public class PreprocessService {
    public String process(String message) {
        return message.trim().toLowerCase();
    }
}

@Service
public class IntentService {
    public String detect(String message) {
        // 调用 NLP 服务识别意图
        return nlpClient.detectIntent(message);
    }
}

@Service
public class LlmService {
    public String generate(String message) {
        // 调用 LLM 生成回复
        return llmClient.chat(message);
    }
}
```

#### 第三步：执行流程

```java
@Service
public class SessionService {

    @Autowired
    private ProcessEngine<TbbpmModel> processEngine;

    public SessionResult processSession(String message) {
        Map<String, Object> context = new HashMap<>();
        context.put("message", message);

        // 执行流程
        ProcessResult<Map<String, Object>> result = processEngine.execute(
            ProcessSource.fromCode("bpm.session_process"),
            context
        );

        if (result.isSuccess()) {
            String reply = (String) result.getData().get("reply");
            return SessionResult.success(reply);
        } else {
            return SessionResult.fail(result.getErrorMessage());
        }
    }
}
```

#### 类型安全方式（推荐）

CompileFlow 支持强类型的输入输出：

```java
// 定义输入输出 DTO
public class SessionRequest {
    private String message;
    // getter / setter
}

public class SessionResponse {
    private String reply;
    private String intent;
    // getter / setter
}

// 类型安全执行
public SessionResponse processSession(SessionRequest request) {
    ProcessResult<SessionResponse> result = processEngine.execute(
        ProcessSource.fromCode("bpm.session_process"),
        request,
        SessionResponse.class
    );

    return result.orElseThrow(() -> new RuntimeException(result.getErrorMessage()));
}
```

### 3.6 流程节点类型

CompileFlow 支持两种流程规范：TBBPM 和 BPMN 2.0，各自支持的节点类型如下：

#### TBBPM 节点

| 节点类型 | 说明 | 类比 |
|---------|------|------|
| `start` | 开始节点 | 流程入口 |
| `end` | 结束节点 | 流程出口 |
| `autoTask` | 自动任务节点 | 调用 Java 方法 / Spring Bean |
| `scriptTask` | 脚本任务节点 | 执行脚本（Groovy/QLExpress） |
| `decision` | 决策节点（排他网关） | if-else 分支 |
| `parallel` | 并行网关 | 并行执行多分支 |
| `inclusive` | 包容网关 | 条件并行 |
| `loopProcess` | 循环节点 | for / while 循环 |
| `subBpm` | 子流程 | 调用另一个流程 |
| `continue` | 继续节点（循环内使用） | continue |
| `break` | 中断节点（循环内使用） | break |
| `waitTask` | 等待任务 | 有状态流程的等待点 |
| `waitEventTask` | 等待事件任务 | 等待外部事件触发 |
| `note` | 备注节点 | 注释（不执行） |

#### BPMN 2.0 节点

| 节点类型 | 说明 |
|---------|------|
| `startEvent` | 开始事件 |
| `endEvent` | 结束事件 |
| `serviceTask` | 服务任务 |
| `scriptTask` | 脚本任务 |
| `receiveTask` | 接收任务 |
| `exclusiveGateway` | 排他网关 |
| `parallelGateway` | 并行网关 |
| `inclusiveGateway` | 包容网关 |
| `subProcess` | 子流程 |
| `callActivity` | 调用活动 |
| `message` | 消息定义 |

::: warning 不支持的节点
CompileFlow 不支持 `userTask`（用户任务/人工审批）、`timerTask`（定时任务）、`signal`（信号）等节点。这是因为它定位为**纯内存无状态**引擎，不涉及持久化和人工交互。如需人工审批，请使用 Activiti 或 Flowable。
:::

### 3.7 编译执行机制

CompileFlow 的核心创新在于**编译后执行**——流程文件不是在运行时解释执行，而是先转换为 Java 源代码，再编译为字节码，最终作为普通 Java 方法执行：

```text
流程文件（XML）
     │
     ▼
┌─────────────┐
│  1. 解析阶段  │  XML → FlowModel（内存模型）
│  (Parser)   │  解析节点、连线、表达式
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  2. 代码生成  │  FlowModel → Java 源代码
│ (Generator) │  生成包含所有节点调用的 Java 类
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  3. 编译阶段  │  Java 源代码 → 字节码
│ (Compiler)  │  使用 Janino 编译器动态编译
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  4. 执行阶段  │  字节码 → 直接执行
│ (Executor)  │  等同于手写 Java 代码的性能
└─────────────┘
```

::: tip 为什么编译执行更快
解释执行（如 LiteFlow）在每次执行时都需要解析 DSL、调度组件、管理上下文；而编译执行将这些开销全部前置到部署阶段——运行时就是普通的 Java 方法调用，没有解析开销，没有反射开销（生成代码时已确定方法签名），因此性能等同于手写代码。
:::

![CompileFlow编译执行机制](/ai-cs/ecosystem-tools/flow-orchestration-engine/compileflow-mechanism.svg)

可以通过 Tooling Service 查看生成的 Java 代码：

```java
@Autowired
private ProcessEngine<TbbpmModel> processEngine;

public void inspectGeneratedCode() {
    ProcessToolingService<TbbpmModel> tooling = processEngine.tooling();

    // 查看流程模型
    TbbpmModel model = tooling.loadFlowModel(ProcessSource.fromCode("bpm.session_process"));
    System.out.println("流程名称: " + model.getName());

    // 查看生成的 Java 代码（调试利器）
    String javaCode = tooling.generateJavaCode(ProcessSource.fromCode("bpm.session_process"));
    System.out.println(javaCode);
}
```

### 3.8 引擎预热

CompileFlow 的"编译后执行"模型意味着首次执行会有编译延迟。建议在应用启动时预热所有常用流程：

```java
@Service
public class FlowPreheatingService implements ApplicationRunner {

    @Autowired
    private ProcessEngine<TbbpmModel> processEngine;

    @Override
    public void run(ApplicationArguments args) {
        // 预热：编译并缓存所有关键流程
        processEngine.admin().deploy(
            ProcessSource.fromCode("bpm.session_process"),
            ProcessSource.fromCode("bpm.refund_process"),
            ProcessSource.fromCode("bpm.complaint_process")
        );
    }
}
```

预热的好处：

- **消除首次延迟**：首次调用和后续调用一样快
- **提前发现错误**：流程文件或脚本的编译错误在启动时暴露
- **滚动更新友好**：新实例在接收流量前已完全就绪

### 3.9 热部署

CompileFlow 提供了强大的热部署能力，支持零停机更新流程：

#### 手动热重载

```java
// 通过 admin 服务手动触发热重载
processEngine.admin().deploy(ProcessSource.fromCode("bpm.session_process"));

// 从新的 XML 内容热重载
String newXml = loadFromConfigCenter();
processEngine.admin().deploy(ProcessSource.fromContent("bpm.session_process", newXml));

// 批量热重载
processEngine.admin().deploy(
    ProcessSource.fromCode("bpm.session_process"),
    ProcessSource.fromCode("bpm.refund_process")
);
```

#### 自动热部署——文件系统监听

```java
// 监控文件目录变化，自动热部署
FileSystemChangeDetector detector = new FileSystemChangeDetector("/opt/flows");
FlowHotDeployer hotDeployer = new FlowHotDeployer(processEngine.admin(), detector);
hotDeployer.start();  // 启动后台监控线程
```

#### 自动热部署——Nacos 配置中心

```java
// 监听 Nacos 配置变化，自动热部署
ConfigService configService = NacosFactory.createConfigService(properties);
List<String> flowDataIds = Arrays.asList("bpm.session_process", "bpm.refund_process");

NacosChangeDetector nacosDetector = new NacosChangeDetector(
    configService, flowDataIds, "DEFAULT_GROUP"
);
FlowHotDeployer hotDeployer = new FlowHotDeployer(processEngine.admin(), nacosDetector);
hotDeployer.start();
```

::: tip 热部署的原子性
CompileFlow 的热部署是原子性的——新流程编译成功后，会原子替换缓存中的旧版本。正在执行的请求使用旧版本执行完毕，新请求使用新版本。如果编译失败，旧版本不受影响。
:::

### 3.10 监控与可观测性

CompileFlow 基于 SPI（Service Provider Interface）提供事件驱动的监控能力：

#### 启用监控

```yaml
# application.yml
compileflow:
  observability:
    enabled: true          # 总开关
    events-async: true     # 异步处理事件，不影响性能
```

#### 实现事件监听器

```java
public class ProcessMetricsListener implements ProcessEventListener<ProcessEvent> {

    @Override
    public void onEvent(ProcessEvent event) {
        if (event instanceof ProcessCoreEvents.ExecutionCompleted) {
            ProcessCoreEvents.ExecutionCompleted completed =
                (ProcessCoreEvents.ExecutionCompleted) event;
            log.info("流程 [{}] 执行完成，耗时: {}ms",
                completed.getProcessCode(),
                completed.getContext().getDurationMs());
        } else if (event instanceof ProcessCoreEvents.ExecutionFailed) {
            ProcessCoreEvents.ExecutionFailed failed =
                (ProcessCoreEvents.ExecutionFailed) event;
            log.error("流程 [{}] 执行失败，traceId: {}",
                failed.getProcessCode(),
                failed.getContext().getTraceId());
        }
    }
}
```

#### 集成 Prometheus + Micrometer

```java
@Component
public class PrometheusMetricsListener implements ProcessEventListener<ProcessEvent> {

    @Autowired
    private MeterRegistry meterRegistry;

    @Override
    public void onEvent(ProcessEvent event) {
        String processCode = event.getProcessCode();
        ProcessEventContext context = event.getContext();

        if (event instanceof ProcessCoreEvents.ExecutionCompleted) {
            Timer.builder("compileflow.execution.duration")
                .tag("process.code", processCode)
                .tag("status", "success")
                .register(meterRegistry)
                .record(context.getDurationMs(), TimeUnit.MILLISECONDS);
        } else if (event instanceof ProcessCoreEvents.ExecutionFailed) {
            Timer.builder("compileflow.execution.duration")
                .tag("process.code", processCode)
                .tag("status", "failure")
                .register(meterRegistry)
                .record(context.getDurationMs(), TimeUnit.MILLISECONDS);
        }
    }
}
```

### 3.11 配置参考

```yaml
compileflow:
  # 流程模型类型：TBBPM（企业级优化）或 BPMN（国际标准）
  model-type: TBBPM

  executor:
    # 编译线程数（建议 1-4）
    compilation-threads: 2
    # 执行线程数（建议 CPU 核心数）
    execution-threads: 16

  cache:
    # 运行时缓存最大条数（生产环境建议 2000-10000）
    runtime-max-size: 2000

  observability:
    enabled: true
    metrics-enabled: true
    events-async: true
```

---

## 四、LiteFlow vs CompileFlow 深度对比

### 4.1 核心维度对比

| 维度 | LiteFlow | CompileFlow |
|------|----------|-------------|
| **出品方** | dromara 社区 | 阿里巴巴 |
| **执行模式** | 解释执行（运行时解析 DSL） | 编译执行（编译为 Java 字节码） |
| **流程描述** | DSL（XML/JSON/YML） | BPMN 2.0 / TBBPM XML |
| **性能** | 高（毫秒级，框架开销极小） | 极高（原生 Java 级别，无解析开销） |
| **首次执行** | 无额外延迟 | 有编译延迟（建议预热） |
| **动态脚本** | 支持 8 种脚本语言 | 支持 Groovy/QLExpress 脚本任务 |
| **热刷新** | 原生支持，高并发安全 | 支持（手动/文件/Nacos） |
| **规则存储** | DB/Nacos/Etcd/ZK/Apollo/Redis | 文件系统/Nacos |
| **可视化** | 无官方可视化设计器 | IntelliJ IDEA 插件 |
| **AI Agent** | v2.16.0+ 原生支持 | 不支持 |
| **类型安全** | 弱（上下文为 Object） | 强（泛型约束，编译时校验） |
| **JDK 要求** | JDK 8+（AI Agent 需 21+） | JDK 8+ |
| **Spring Boot** | 2.X / 3.X / 4.X | 2.X / 3.X |
| **状态管理** | 无状态 | 无状态（支持 waitTask 有状态流程） |
| **社区活跃度** | 高（国内社区活跃） | 中（阿里内部使用为主） |
| **学习曲线** | 低（5 分钟入门） | 中（需理解 BPMN/TBBPM 概念） |

### 4.2 性能对比

```text
性能对比（示意）

执行开销      LiteFlow          CompileFlow
              ┌──────────┐      ┌──────────┐
解析/调度开销  │ ■■■□□□□□ │      │ □□□□□□□□ │  编译后无解析开销
              └──────────┘      └──────────┘
              ┌──────────┐      ┌──────────┐
组件执行       │ ■■■■■■■■ │      │ ■■■■■■■■ │  取决于业务逻辑本身
              └──────────┘      └──────────┘
              ┌──────────┐      ┌──────────┐
首次执行延迟   │ □□□□□□□□ │      │ ■■■□□□□□ │  首次需编译
              └──────────┘      └──────────┘
```

::: tip 性能选择
如果你的流程执行频率极高（如每秒数万次），CompileFlow 的编译执行模式能带来显著的性能优势。如果执行频率一般（如每秒数百到数千次），LiteFlow 的框架开销可以忽略不计，两者的实际性能差异不大——瓶颈在业务逻辑本身。
:::

### 4.3 适用场景对比

| 场景 | 推荐 | 原因 |
|------|------|------|
| **高频交易流程** | CompileFlow | 编译执行，无解析开销 |
| **频繁变更的业务编排** | LiteFlow | 热刷新更轻量，DSL 更易修改 |
| **需要脚本灵活性** | LiteFlow | 支持 8 种脚本语言，脚本与 Java 全打通 |
| **需要类型安全** | CompileFlow | 强类型约束，编译时校验 |
| **AI Agent 编排** | LiteFlow | 原生支持 ReAct Agent 编排 |
| **可视化流程设计** | CompileFlow | IDEA 插件支持拖拽式设计 |
| **复杂编排（并行/循环/嵌套）** | 两者皆可 | LiteFlow DSL 更简洁，CompileFlow 节点更丰富 |
| **有状态流程（等待外部事件）** | CompileFlow | 支持 waitTask/waitEventTask |
| **快速原型开发** | LiteFlow | 学习门槛低，5 分钟入门 |

---

## 五、AI 客服系统中的实战应用

### 5.1 使用 LiteFlow 编排客服会话流程

```xml
<!-- LiteFlow 规则文件：客服会话处理流程 -->
<chain name="sessionProcess">
    THEN(
        preprocessNode,
        WHEN(intentNode, emotionNode, sensitiveNode),
        IF(
            needEscalationNode,
            escalateNode,
            SWITCH(intentSwitch).TO(
                refundChain,
                consultChain,
                complaintChain,
                defaultChain
            )
        ),
        recordNode
    );
</chain>

<!-- 退款处理子链 -->
<chain name="refundChain">
    THEN(
        refundCheckNode,
        IF(needApprovalNode, approvalNode),
        refundExecuteNode
    );
</chain>

<!-- 咨询处理子链：并行检索 + LLM 生成 -->
<chain name="consultChain">
    THEN(
        WHEN(knowledgeSearchNode, historySearchNode),
        llmGenerateNode
    );
</chain>

<!-- 投诉处理子链 -->
<chain name="complaintChain">
    THEN(
        complaintClassifyNode,
        IF(highRiskNode, seniorAgentNode, autoHandleNode)
    );
</chain>
```

```java
@Service
public class SessionFlowService {

    @Resource
    private FlowExecutor flowExecutor;

    public SessionResult process(SessionRequest request) {
        SessionContext context = new SessionContext();
        context.setMessage(request.getMessage());
        context.setUserId(request.getUserId());

        LiteflowResponse response = flowExecutor.execute2Resp("sessionProcess", null, context);

        if (response.isSuccess()) {
            return SessionResult.success(context.getReply(), context.getMetadata());
        } else {
            log.error("流程执行失败: {}", response.getMessage());
            return SessionResult.fallback();
        }
    }
}
```

**优势**：流程结构一目了然，运营可以在规则文件中直接调整步骤顺序，新增"敏感词检测"只需加一个节点。

### 5.2 使用 CompileFlow 编排高频交易流程

对于客服系统中的高频流程（如实时评分、路由决策），CompileFlow 的编译执行模式更适合：

```java
@Service
public class ScoringFlowService {

    @Autowired
    private ProcessEngine<TbbpmModel> processEngine;

    // 高频调用：每秒数千次
    public int score(User user, Message message) {
        Map<String, Object> context = new HashMap<>();
        context.put("vipLevel", user.getVipLevel());
        context.put("orderAmount", user.getOrderAmount());
        context.put("complaintCount", user.getComplaintCount());
        context.put("urgency", message.getUrgency());

        ProcessResult<Map<String, Object>> result = processEngine.execute(
            ProcessSource.fromCode("bpm.scoring"),
            context
        );

        return result.isSuccess() ? (int) result.getData().get("score") : 0;
    }
}
```

对应的 TBBPM 流程文件（简化版）：

```xml
<process name="scoring" displayName="会话评分流程">
    <start id="start"><transition to="calcBase"/></start>

    <autoTask id="calcBase" name="基础分计算">
        <action type="spring-bean">
            <actionHandle bean="scoringService" method="calcBaseScore">
                <var name="vipLevel" contextVarName="vipLevel" inOutType="param"/>
                <var name="orderAmount" contextVarName="orderAmount" inOutType="param"/>
                <var name="result" contextVarName="baseScore" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="checkComplaint"/>
    </autoTask>

    <decision id="checkComplaint" name="投诉加急">
        <transition to="addComplaintScore" expr="complaintCount > 0"/>
        <transition to="checkUrgency" expr="default"/>
    </decision>

    <autoTask id="addComplaintScore" name="投诉加权">
        <action type="spring-bean">
            <actionHandle bean="scoringService" method="addComplaintWeight">
                <var name="baseScore" contextVarName="baseScore" inOutType="param"/>
                <var name="complaintCount" contextVarName="complaintCount" inOutType="param"/>
                <var name="result" contextVarName="baseScore" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="checkUrgency"/>
    </autoTask>

    <decision id="checkUrgency" name="紧急加权">
        <transition to="addUrgencyScore" expr="urgency == 'high'"/>
        <transition to="finalize" expr="default"/>
    </decision>

    <autoTask id="addUrgencyScore" name="紧急加权">
        <action type="spring-bean">
            <actionHandle bean="scoringService" method="multiplyUrgency">
                <var name="baseScore" contextVarName="baseScore" inOutType="param"/>
                <var name="result" contextVarName="baseScore" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="finalize"/>
    </autoTask>

    <autoTask id="finalize" name="最终评分">
        <action type="spring-bean">
            <actionHandle bean="scoringService" method="finalize">
                <var name="baseScore" contextVarName="baseScore" inOutType="param"/>
                <var name="result" contextVarName="score" inOutType="return"/>
            </actionHandle>
        </action>
        <transition to="end"/>
    </autoTask>

    <end id="end"/>
</process>
```

**优势**：编译执行保证每秒数千次调用的性能，类型安全减少运行时错误，IDEA 插件可视化设计便于与业务分析师沟通。

### 5.3 混合使用：LiteFlow 编排 + QLExpress 规则

两种引擎可以与 QLExpress 表达式引擎配合使用——LiteFlow 负责流程编排，QLExpress 负责条件判断：

```xml
<!-- LiteFlow 规则文件 -->
<chain name="sessionProcess">
    THEN(
        preprocessNode,
        <!-- QLExpress 脚本节点：用表达式引擎做复杂条件判断 -->
        IF(
            qlexpressScript("user.vipLevel >= 5 && user.orderAmount > 10000 ? true : false"),
            vipChannelNode,
            normalChannelNode
        )
    );
</chain>
```

```java
// CompileFlow 中也可以使用 QLExpress 表达式
// 在 decision 节点的 expr 属性中使用 QLExpress 语法
<decision id="vipCheck">
    <transition to="vipChannel" expr="user.vipLevel >= 5 &amp;&amp; user.orderAmount > 10000"/>
    <transition to="normalChannel" expr="default"/>
</decision>
```

### 5.4 完整集成架构

```text
┌──────────────────────────────────────────────────────────┐
│                      AI 客服系统                           │
│                                                           │
│  ┌──────────────┐    ┌──────────────┐                    │
│  │ 规则配置中心   │    │  用户上下文   │                    │
│  │ (Nacos/DB)   │    │  (Context)   │                    │
│  └──────┬───────┘    └──────┬───────┘                    │
│         │                   │                             │
│         ▼                   ▼                             │
│  ┌──────────────────────────────────┐                    │
│  │       流程编排引擎层               │                    │
│  │                                  │                    │
│  │  ┌──────────┐  ┌──────────────┐  │                    │
│  │  │ LiteFlow  │  │ CompileFlow  │  │                    │
│  │  │ (会话编排) │  │ (高频评分)   │  │                    │
│  │  └─────┬────┘  └──────┬───────┘  │                    │
│  │        │              │          │                    │
│  │        └──────┬───────┘          │                    │
│  │               │                  │                    │
│  │     ┌─────────┴──────────┐       │                    │
│  │     │  QLExpress 节点     │       │                    │
│  │     │  (条件判断/规则求值)  │       │                    │
│  │     └────────────────────┘       │                    │
│  └──────────────────────────────────┘                    │
│                    │                                      │
│     ┌──────────────┼──────────────┐                      │
│         │           │           │                        │
│         ▼           ▼           ▼                        │
│    会话编排      评分路由      归因分析                     │
│    热刷新       编译执行      追踪树                        │
│    AI Agent    类型安全      监控告警                      │
│                                                           │
│  ✅ 流程与代码解耦，运营自助修改                             │
│  ✅ 无需发版，热刷新实时生效                                │
│  ✅ 高频流程编译执行，低频流程灵活编排                       │
│  ✅ 表达式引擎 + 编排引擎 + AI Agent 三位一体               │
└──────────────────────────────────────────────────────────┘
```

---

## 六、选型建议

![流程编排引擎选型决策图](/ai-cs/ecosystem-tools/flow-orchestration-engine/flow-selection-guide.svg)

### 6.1 选择 LiteFlow 的场景

- **业务流程频繁变更**：DSL 规则文件修改成本极低，热刷新即时生效
- **需要脚本灵活性**：想在流程节点中嵌入 Groovy/Python/QLExpress 脚本
- **AI Agent 编排**：需要将大模型 Agent 编排进业务流程
- **快速原型开发**：团队对 BPMN 不熟悉，希望快速上手
- **多种规则存储**：需要从 Nacos/ZK/Apollo/Redis 加载规则
- **声明式组件**：希望用注解让现有 Service 秒变流程组件

### 6.2 选择 CompileFlow 的场景

- **高频流程执行**：每秒数千到数万次调用，编译执行的性能优势显著
- **类型安全要求高**：希望编译时校验，减少运行时错误
- **可视化流程设计**：需要使用 IDEA 插件拖拽式设计流程
- **有状态流程**：需要 waitTask/waitEventTask 等待外部事件
- **阿里生态深度集成**：项目已使用阿里技术栈，希望与 TBBPM 体系一致
- **流程复杂度高**：流程节点多、分支多，编译执行避免运行时解析开销

### 6.3 混合使用建议

在 AI 客服系统中，两种引擎可以互补使用：

| 场景 | 引擎 | 原因 |
|------|------|------|
| 会话处理主流程 | LiteFlow | 流程变更频繁，需要热刷新和脚本灵活性 |
| 实时评分/路由 | CompileFlow | 高频调用，编译执行性能更优 |
| 条件判断 | QLExpress | 单条表达式求值，轻量高效 |
| AI Agent 编排 | LiteFlow | 原生支持 ReAct Agent 组件化 |

---

## 七、最佳实践

### 7.1 组件/节点设计原则

| 原则 | 说明 |
|------|------|
| **单一职责** | 每个组件/节点只做一件事，不要在一个节点中塞入多个业务逻辑 |
| **幂等性** | 组件应尽量设计为幂等的，便于重试和恢复 |
| **无状态** | 组件不应持有实例状态，状态全部放在上下文中 |
| **快速失败** | 出错时快速返回，不要在组件内部吞掉异常 |
| **可测试** | 组件应可独立测试，不依赖流程引擎上下文 |

### 7.2 上下文设计

```java
// ✅ 良好的上下文设计：清晰、类型安全
public class SessionContext {
    // 输入
    private String message;
    private Long userId;

    // 中间结果
    private String preprocessedMessage;
    private Intent intent;
    private Emotion emotion;

    // 输出
    private String reply;
    private Map<String, Object> metadata;

    // getter / setter
}
```

### 7.3 错误处理

```java
// LiteFlow：使用 CATCH 语法捕获异常
CATCH(riskyNode).DO(fallbackNode);

// LiteFlow：组件重试
@LiteflowComponent(retry = 3, retryForExceptions = {NetworkException.class})
public class LlmNode extends NodeComponent { ... }

// CompileFlow：通过 ProcessResult 安全处理
ProcessResult<SessionResponse> result = processEngine.execute(source, request, SessionResponse.class);
result.onSuccess(data -> log.info("成功: {}", data))
      .onFailure(error -> log.error("失败: {}", error));
```

### 7.4 性能优化

| 方面 | LiteFlow | CompileFlow |
|------|----------|-------------|
| **引擎实例** | FlowExecutor 单例 | ProcessEngine 单例（管理线程池） |
| **预热** | 无需预热 | 启动时 `deploy()` 预热所有流程 |
| **缓存** | 规则自动缓存 | `cache.runtime-max-size` 调优 |
| **线程池** | 依赖 Spring 管理 | `executor.execution-threads` 调优 |
| **监控** | 内置命令行监控 | SPI 事件 + Prometheus 集成 |

---

## 总结

流程编排引擎解决的核心问题是：**让业务流程成为可视化的规则，而非隐藏在代码中的调用链**。

**LiteFlow** 和 **CompileFlow** 代表了两种不同的编排范式：

- **LiteFlow** 走的是**轻量灵活**路线——DSL 驱动、5 分钟入门、支持 8 种脚本语言、热刷新即时生效、AI Agent 原生编排。它适合流程频繁变更、需要脚本灵活性和 AI 集成的场景。

- **CompileFlow** 走的是**极致性能**路线——编译后执行、原生 Java 性能、类型安全、可视化设计、有状态流程支持。它适合高频调用、对性能和类型安全有严格要求的场景。

在 AI 客服系统中，两种引擎可以互补使用：LiteFlow 负责会话主流程的编排（频繁变更、AI Agent 集成），CompileFlow 负责高频评分和路由（编译执行、极致性能），QLExpress 负责节点内的条件判断（轻量表达式求值）。三者配合，构成了一个从表达式到编排到 AI 的完整技术栈。

选择建议可以简单概括为：

1. **流程变更频繁 + 需要脚本/AI** → 选 LiteFlow
2. **高频执行 + 类型安全 + 可视化** → 选 CompileFlow
3. **两者都不是** → 看团队偏好，都能胜任

---

## 延伸阅读

- [LiteFlow 官网](https://liteflow.cc/) —— 官方文档和教程
- [LiteFlow GitHub 仓库](https://github.com/dromara/liteflow) —— 源码和 Issue
- [CompileFlow GitHub 仓库](https://github.com/alibaba/compileflow) —— 官方源码和文档
- [QLExpress4表达式引擎](/ai-cs/qlexpress-study-notes/) —— 表达式引擎的基础知识
- [Activiti 官网](https://www.activiti.org/) —— 完整的工作流引擎，适合需要人工审批的场景
- [Flowable 官网](https://flowable.com/) —— Activiti 的增强分支，功能更丰富
- [BPMN 2.0 规范](https://www.omg.org/spec/BPMN/2.0/) —— 业务流程建模标记法国际标准
