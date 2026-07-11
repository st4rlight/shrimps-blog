---
title: 有限状态机FSM
tags:
  - 状态机
  - FSM
  - 策略模式
  - 客服系统
  - 状态管理
excerpt: 从状态机的基础概念出发，系统梳理有限状态机的三要素、两大分类（DFA/NFA）、四种经典实现方式（if-else、状态模式、枚举驱动、状态机引擎），对比 Spring StateMachine、Squirrel-Foundation、Colon 等主流框架，并结合 st4rlight-util 策略模式封装实战演示轻量级状态机的落地实践。
createTime: 2026/07/11 18:00:00
permalink: /ai-cs/fsm-introduction/
---

# 有限状态机FSM

> 当你的业务对象有"状态"——订单从"待支付"到"已支付"再到"已发货"，客服会话从"等待中"到"对话中"再到"已结束"——你用什么管理这些状态流转？`if-else` 堆多了就是面条代码，`switch-case` 写深了就是维护噩梦。**有限状态机（FSM）** 提供了一种结构化、可维护、可可视化的状态管理范式。

[[TOC]]

---

## 一、背景与动机

### 1.1 状态管理的困境

在实际业务开发中，几乎每一个核心业务对象都伴随着状态流转。以 AI 客服系统的工单为例：

```java
// 硬编码方式：状态判断散落在各处，维护成本高
public void handleTicket(Ticket ticket, String action) {
    if ("PENDING".equals(ticket.getStatus())) {
        if ("assign".equals(action)) {
            ticket.setStatus("ASSIGNED");
            // 分配逻辑...
        } else if ("cancel".equals(action)) {
            ticket.setStatus("CANCELLED");
            // 取消逻辑...
        } else {
            throw new BizException("当前状态不支持此操作");
        }
    } else if ("ASSIGNED".equals(ticket.getStatus())) {
        if ("process".equals(action)) {
            ticket.setStatus("PROCESSING");
            // 处理逻辑...
        } else if ("transfer".equals(action)) {
            ticket.setStatus("TRANSFERRED");
            // 转交逻辑...
        }
    } else if ("PROCESSING".equals(ticket.getStatus())) {
        // 更多嵌套...
    }
    // ... 状态越多，if-else 越深
}
```

这段代码的问题不仅在于 `if-else` 多，更在于：

| 问题 | 说明 |
|------|------|
| **状态爆炸** | N 个状态 × M 个动作 = N×M 种分支组合，呈乘法增长 |
| **非法转换难防** | 没有机制约束哪些状态可以转到哪些状态，容易写出非法流转 |
| **散落不可视** | 状态流转规则散落在代码各处，无法一眼看出全貌 |
| **测试困难** | 每个分支都需要单独覆盖，组合爆炸导致测试用例激增 |
| **扩展僵化** | 新增一个状态，需要修改所有涉及的 `if-else` 链 |

### 1.2 状态机的解决思路

有限状态机（Finite State Machine，FSM）的核心思想是：**将状态、事件、转换三者显式建模，用一张"状态转换表"替代散落的 `if-else`**。

```java
// 状态机方式：声明式定义状态流转规则
StateMachine<SessionState, SessionEvent> fsm = StateMachineBuilder
    .<SessionState, SessionEvent>create()
    .initialState(SessionState.IDLE)
    .transition(SessionState.IDLE,      SessionEvent.USER_MESSAGE,   SessionState.ACTIVE)
    .transition(SessionState.ACTIVE,    SessionEvent.USER_AWAY,      SessionState.AWAY)
    .transition(SessionState.AWAY,      SessionEvent.USER_RETURN,    SessionState.ACTIVE)
    .transition(SessionState.ACTIVE,    SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED)
    .transition(SessionState.AWAY,      SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED)
    .transition(SessionState.ACTIVE,    SessionEvent.END_SESSION,    SessionState.CLOSED)
    .build();

// 触发事件，状态机自动处理流转
fsm.fire(SessionEvent.USER_MESSAGE);
System.out.println(fsm.getCurrentState());  // ACTIVE
```

**关键差异：** `if-else` 是**命令式**的——你告诉代码"如果在这个状态，就做这个"；状态机是**声明式**的——你定义"什么状态 + 什么事件 = 什么新状态"，引擎负责执行。

---

## 二、什么是有限状态机

### 2.1 定义

**有限状态机**（Finite State Machine，简称 FSM），又称有限状态自动机（Finite State Automaton，FSA），是一个数学计算模型。它在任意时刻恰好处于**有限个状态中的一个**，并可以在外部**事件**的驱动下从一个状态**转换**到另一个状态。

![有限状态机核心概念总览](/ai-cs/ecosystem-tools/fsm-introduction/fsm-overview.svg)

### 2.2 三要素

状态机的核心由三个要素构成：

| 要素 | 说明 | 示例 |
|------|------|------|
| **State（状态）** | 对象在生命周期中的一个稳定阶段 | `IDLE`、`ACTIVE`、`CLOSED` |
| **Event（事件）** | 触发状态变化的外部输入 | `USER_MESSAGE`、`TIMEOUT` |
| **Transition（转换）** | 从一个状态到另一个状态的映射规则 | `IDLE + USER_MESSAGE → ACTIVE` |

除了三要素，状态机还涉及以下辅助概念：

| 概念 | 说明 | 示例 |
|------|------|------|
| **Action（动作）** | 在转换发生时执行的副作用 | 发送通知、写入日志 |
| **Guard（守卫条件）** | 转换的前置条件，满足才允许转换 | `confidence > 0.8` |
| **Initial State（初始状态）** | 状态机的起点 | `IDLE` |
| **Final State（终态）** | 状态机的终点，到达后不再转换 | `CLOSED` |

### 2.3 一个直观的例子：客服会话

以 AI 客服会话为例，设计一个状态机：

```text
状态集合 S = { IDLE, ACTIVE, AWAY, CLOSED }
事件集合 E = { USER_MESSAGE, USER_AWAY, USER_RETURN, SESSION_TIMEOUT, END_SESSION }
初始状态   = IDLE
终态       = CLOSED

转换规则 δ:
  δ(IDLE,    USER_MESSAGE)    = ACTIVE
  δ(ACTIVE,  USER_AWAY)       = AWAY
  δ(AWAY,    USER_RETURN)     = ACTIVE
  δ(ACTIVE,  SESSION_TIMEOUT) = CLOSED
  δ(AWAY,    SESSION_TIMEOUT) = CLOSED
  δ(ACTIVE,  END_SESSION)     = CLOSED
  δ(IDLE,    END_SESSION)     = CLOSED
```

用状态转换图表示：

```text
                 USER_MESSAGE
    ┌──────┐ ───────────────→ ┌──────┐
    │ IDLE │                   │ACTIVE│ ←─────┐
    └──┬───┘                   └──┬───┘       │
       │                          │           │ USER_RETURN
       │ END_SESSION              │ USER_AWAY  │
       │                          ↓           │
       │                     ┌──────┐         │
       │                     │ AWAY │ ────────┘
       │                     └──┬───┘
       │                        │ SESSION_TIMEOUT
       │     END_SESSION        │
       │     SESSION_TIMEOUT    │
       ↓                        ↓
    ┌──────┐
    │CLOSED│  (终态)
    └──────┘
```

**关键特性：** 在任意时刻，会话恰好处于 `{IDLE, ACTIVE, AWAY, CLOSED}` 中的一个状态。只有在特定事件下，状态才会按照预定义的规则转换。**非法的转换（如 `IDLE + USER_AWAY`）会被状态机拒绝**，这正是状态机的核心保护能力。

---

## 三、状态机的两大分类

### 3.1 DFA 与 NFA

根据转换函数的特性，有限状态机分为两大类：

| 类型 | 全称 | 特点 | 适用场景 |
|------|------|------|---------|
| **DFA** | Deterministic Finite Automaton（确定性有限自动机） | 每个状态 + 事件**唯一确定**一个目标状态 | 业务状态管理、订单流转 |
| **NFA** | Nondeterministic Finite Automaton（非确定性有限自动机） | 同一个状态 + 事件可能对应**多个**目标状态 | 正则表达式引擎、词法分析 |

**DFA 示例（确定性）：**

```
δ(IDLE, USER_MESSAGE) → ACTIVE   // 唯一确定
```

给定当前状态和事件，只有一个确定的下一状态。**绝大多数业务场景使用 DFA**。

**NFA 示例（非确定性）：**

```
δ(S0, 'a') → {S1, S2}   // 可能转到 S1 或 S2
```

同一个输入可能导致多个不同的目标状态。NFA 通常用于编译原理中的正则表达式匹配和词法分析，在业务开发中很少直接使用。

### 3.2 业务中的选择

在实际业务开发中，我们几乎总是使用 **DFA**——因为业务状态流转需要**确定性**：一个订单在"待支付"状态收到"支付成功"事件，必须**确定**地转到"已支付"状态，不能有歧义。

::: tip DFA 和 NFA 的等价性
从理论计算机科学的角度，任何 NFA 都可以转化为等价的 DFA（子集构造法）。这意味着两者在表达能力上是等价的，只是 NFA 更紧凑、DFA 更高效。在业务开发中，我们直接使用 DFA 即可。
:::

---

## 四、状态机的实现方式

### 4.1 实现方式总览

![状态机四种实现方式对比](/ai-cs/ecosystem-tools/fsm-introduction/fsm-implementation-comparison.svg)

### 4.2 方式一：if-else / switch-case

最原始的方式——用条件分支硬编码状态逻辑。

```java
public class SessionHandler {

    public SessionState handleEvent(SessionState currentState, SessionEvent event) {
        switch (currentState) {
            case IDLE:
                if (event == SessionEvent.USER_MESSAGE) return SessionState.ACTIVE;
                if (event == SessionEvent.END_SESSION)  return SessionState.CLOSED;
                break;
            case ACTIVE:
                if (event == SessionEvent.USER_AWAY)       return SessionState.AWAY;
                if (event == SessionEvent.SESSION_TIMEOUT) return SessionState.CLOSED;
                if (event == SessionEvent.END_SESSION)     return SessionState.CLOSED;
                break;
            case AWAY:
                if (event == SessionEvent.USER_RETURN)     return SessionState.ACTIVE;
                if (event == SessionEvent.SESSION_TIMEOUT) return SessionState.CLOSED;
                break;
            case CLOSED:
                // 终态，不再转换
                break;
        }
        // 非法转换，返回当前状态不变
        return currentState;
    }
}
```

**优点：** 简单直接，零依赖，适合状态极少（2-3 个）的简单场景。

**缺点：**

| 缺点 | 说明 |
|------|------|
| 状态多了不可维护 | 状态数 × 事件数 = 分支数，呈乘法增长 |
| 无法可视化 | 流转规则隐藏在代码中，无法直观看到全貌 |
| 无统一校验 | 非法转换只能靠手动 `break` + 默认返回 |
| Action 难以嵌入 | 状态转换时需要执行的副作用逻辑无处安放 |

### 4.3 方式二：状态模式（State Pattern）

利用 GoF 状态模式——将每个状态封装为一个类，状态的行为和转换逻辑内聚在状态对象中。

```java
// 状态接口
public interface SessionStateHandler {
    SessionState getState();
    SessionState handleEvent(SessionContext ctx, SessionEvent event);
}

// IDLE 状态处理
public class IdleStateHandler implements SessionStateHandler {
    @Override
    public SessionState getState() { return SessionState.IDLE; }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case USER_MESSAGE:
                // 执行 Action：记录第一条消息
                ctx.recordMessage(event.getPayload());
                return SessionState.ACTIVE;
            case END_SESSION:
                return SessionState.CLOSED;
            default:
                return SessionState.IDLE;  // 忽略非法事件
        }
    }
}

// ACTIVE 状态处理
public class ActiveStateHandler implements SessionStateHandler {
    @Override
    public SessionState getState() { return SessionState.ACTIVE; }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case USER_AWAY:
                ctx.setAwaySince(System.currentTimeMillis());
                return SessionState.AWAY;
            case SESSION_TIMEOUT:
                ctx.closeSession();
                return SessionState.CLOSED;
            case END_SESSION:
                ctx.closeSession();
                return SessionState.CLOSED;
            default:
                return SessionState.ACTIVE;
        }
    }
}

// 状态机上下文
public class SessionContext {
    private SessionStateHandler currentHandler;
    private final Map<SessionState, SessionStateHandler> handlers;

    public SessionContext(Map<SessionState, SessionStateHandler> handlers) {
        this.handlers = handlers;
        this.currentHandler = handlers.get(SessionState.IDLE);
    }

    public void fire(SessionEvent event) {
        SessionState nextState = currentHandler.handleEvent(this, event);
        currentHandler = handlers.get(nextState);
    }

    public SessionState getCurrentState() {
        return currentHandler.getState();
    }
}
```

**优点：**

| 优点 | 说明 |
|------|------|
| 状态内聚 | 每个状态的处理逻辑封装在独立类中，职责单一 |
| 开闭原则 | 新增状态只需新增类，不修改已有状态（对扩展开放，对修改关闭） |
| Action 自然嵌入 | 状态转换时的副作用逻辑自然地写在 `handleEvent` 中 |

**缺点：** 状态类数量随状态数线性增长；状态间的转换关系仍然散落在各个状态类中，不够集中可视化。

### 4.4 方式三：枚举驱动

利用 Java 枚举的强大表达能力，在枚举中声明式地定义转换规则。

```java
public enum SessionState {

    IDLE {
        @Override
        public SessionState next(SessionEvent event) {
            return switch (event) {
                case USER_MESSAGE -> ACTIVE;
                case END_SESSION  -> CLOSED;
                default           -> this;
            };
        }
    },

    ACTIVE {
        @Override
        public SessionState next(SessionEvent event) {
            return switch (event) {
                case USER_AWAY       -> AWAY;
                case SESSION_TIMEOUT -> CLOSED;
                case END_SESSION     -> CLOSED;
                default              -> this;
            };
        }
    },

    AWAY {
        @Override
        public SessionState next(SessionEvent event) {
            return switch (event) {
                case USER_RETURN     -> ACTIVE;
                case SESSION_TIMEOUT -> CLOSED;
                case END_SESSION     -> CLOSED;
                default              -> this;
            };
        }
    },

    CLOSED {
        @Override
        public SessionState next(SessionEvent event) {
            return this;  // 终态不再转换
        }
    };

    // 抽象方法：每个状态自行定义转换规则
    public abstract SessionState next(SessionEvent event);
}

// 使用
SessionState state = SessionState.IDLE;
state = state.next(SessionEvent.USER_MESSAGE);  // ACTIVE
state = state.next(SessionEvent.USER_AWAY);     // AWAY
state = state.next(SessionEvent.USER_RETURN);   // ACTIVE
```

**优点：** 声明式、零依赖、类型安全、代码紧凑。

**缺点：** 难以嵌入复杂的 Action 逻辑（枚举不适合承载重业务逻辑）；转换规则仍散落在各枚举值中；不支持守卫条件（Guard）。

### 4.5 方式四：状态机引擎

使用专门的状态机框架，以声明式 API 集中定义所有转换规则，由引擎负责驱动执行。

```java
// 以通用状态机 API 为例（概念示意）
StateMachine<SessionState, SessionEvent> fsm = StateMachineBuilder
    .<SessionState, SessionEvent>create()
    .initialState(SessionState.IDLE)
    // 状态 + 事件 → 目标状态 + 动作
    .transition(SessionState.IDLE, SessionEvent.USER_MESSAGE, SessionState.ACTIVE,
                ctx -> ctx.log("用户进入对话"))
    .transition(SessionState.ACTIVE, SessionEvent.USER_AWAY, SessionState.AWAY,
                ctx -> ctx.recordAwayTime())
    .transition(SessionState.AWAY, SessionEvent.USER_RETURN, SessionState.ACTIVE,
                ctx -> ctx.log("用户回归"))
    .transition(SessionState.ACTIVE, SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED,
                ctx -> ctx.closeSession())
    .transition(SessionState.AWAY, SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED,
                ctx -> ctx.closeSession())
    .transition(SessionState.ACTIVE, SessionEvent.END_SESSION, SessionState.CLOSED,
                ctx -> ctx.closeSession())
    .transition(SessionState.IDLE, SessionEvent.END_SESSION, SessionState.CLOSED,
                ctx -> ctx.closeSession())
    .build();

// 驱动
fsm.fire(SessionEvent.USER_MESSAGE);  // IDLE → ACTIVE，自动执行 log("用户进入对话")
```

**优点：**

| 优点 | 说明 |
|------|------|
| 规则集中 | 所有转换规则在一处定义，一目了然 |
| 可视化友好 | 框架通常支持导出状态转换图 |
| 支持 Action 和 Guard | 转换时可执行动作、设置前置条件 |
| 可扩展 | 支持状态嵌套、并行状态等高级特性 |

**缺点：** 引入框架依赖，学习成本较高，适合复杂状态流转场景。

#### 状态机引擎的底层原理：转换映射表

参考 [Java有限状态机FSM（基础篇）](https://juejin.cn/post/7059400669651812388)，状态机引擎的本质其实就是**将每条转换记录保存为一张映射表**，在触发事件时遍历映射表，根据当前状态和事件找到匹配的记录，执行动作并跳转到次态。

一条转换记录包含四个要素：

```java
/**
 * 状态机转换记录（状态机引擎的底层数据结构）
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StateMachineRecord<S, E> {
    private S currentState;  // 现态
    private E event;         // 触发事件（条件）
    private S nextState;     // 次态
    private Action action;   // 执行动作
}
```

所有开源状态机框架（Spring StateMachine、Squirrel-Foundation、Colon）的核心都是这张转换映射表，只是在此基础上做了更多优化：

| 优化方向 | 说明 |
|---------|------|
| **注解驱动** | 用 `@Transit`、`@Transition` 等注解替代手动构建记录，更简洁 |
| **索引加速** | 用 Map<状态, Map<事件, 记录>> 建立索引，O(1) 查找而非遍历 |
| **懒加载** | 转换规则按需解析，启动更快 |
| **类型安全** | 泛型约束确保状态和事件类型正确 |
| **生命周期管理** | 支持状态进入/退出回调、状态嵌套、并行区域等高级特性 |

### 4.6 四种方式对比

| 维度 | if-else | 状态模式 | 枚举驱动 | 状态机引擎 |
|------|---------|---------|---------|-----------|
| **复杂度** | 低 | 中 | 低 | 高 |
| **可维护性** | 差 | 好 | 中 | 优 |
| **可视化** | 不支持 | 不支持 | 不支持 | 支持 |
| **Action 支持** | 手动嵌入 | 自然嵌入 | 困难 | 原生支持 |
| **Guard 支持** | 手动 if | 手动 if | 不支持 | 原生支持 |
| **适用状态数** | ≤ 3 | 3~8 | ≤ 6 | 任意 |
| **适用场景** | 极简逻辑 | 中等复杂度 | 纯状态流转 | 复杂业务编排 |

::: tip 选型建议
- **状态 ≤ 3 且无 Action**：`if-else` 足矣，不必过度设计
- **状态 3~8 且需要 Action**：状态模式或枚举驱动
- **状态 > 8 或需要可视化 / 嵌套 / 并行**：使用状态机引擎
- **团队已有策略模式封装**：可基于策略模式快速搭建轻量级状态机（见下文实战）
:::

---

## 五、主流状态机框架对比

在 Java 生态中，有几个成熟的状态机框架可供选择。

### 5.1 Spring StateMachine

**Spring StateMachine** 是 Spring 官方提供的状态机框架，与 Spring 生态深度集成。

```java
@Configuration
@EnableStateMachine
public class SessionStateMachineConfig
        extends EnumStateMachineConfigurerAdapter<SessionState, SessionEvent> {

    @Override
    public void configure(StateMachineStateConfigurer<SessionState, SessionEvent> states)
            throws Exception {
        states
            .withStates()
            .initial(SessionState.IDLE)
            .states(EnumSet.allOf(SessionState.class))
            .end(SessionState.CLOSED);
    }

    @Override
    public void configure(StateMachineTransitionConfigurer<SessionState, SessionEvent> transitions)
            throws Exception {
        transitions
            .withExternal()
                .source(SessionState.IDLE).target(SessionState.ACTIVE)
                .event(SessionEvent.USER_MESSAGE)
                .action(userEnterAction())
            .and()
            .withExternal()
                .source(SessionState.ACTIVE).target(SessionState.AWAY)
                .event(SessionEvent.USER_AWAY)
            .and()
            .withExternal()
                .source(SessionState.AWAY).target(SessionState.ACTIVE)
                .event(SessionEvent.USER_RETURN)
            .and()
            .withExternal()
                .source(SessionState.ACTIVE).target(SessionState.CLOSED)
                .event(SessionEvent.SESSION_TIMEOUT)
            .and()
            .withExternal()
                .source(SessionState.AWAY).target(SessionState.CLOSED)
                .event(SessionState.SESSION_TIMEOUT);
    }

    @Bean
    public Action<SessionState, SessionEvent> userEnterAction() {
        return ctx -> System.out.println("用户进入对话");
    }
}
```

**特点：**

| 方面 | 说明 |
|------|------|
| **集成度** | 与 Spring Boot / Spring Cloud 深度集成 |
| **功能** | 支持嵌套状态、并行状态、守卫条件、动作 |
| **持久化** | 支持 StateMachinePersist，可将状态持久化到 DB / Redis |
| **重量级** | 配置较繁琐，适合大型 Spring 项目 |
| **学习曲线** | 较陡，概念较多（Region、Choice、Junction 等） |

### 5.2 Squirrel-Foundation

**Squirrel-Foundation** 是一个轻量级的状态机库，致力于提供**轻量化、高灵活性和扩展性、便于纠错、类型安全**的企业级 Java 状态机实现。它支持注解和 Fluent API 两种定义方式，以 DSL（Domain Specific Language，领域特定语言）风格的链式调用著称。

> **Squirrel 四要素**：参考 [Squirrel 状态机实践分享](https://juejin.cn/post/7309310129024155686)，状态机可归纳为四个要素——**现态**（当前状态）、**条件**（又称事件，触发状态迁移）、**动作**（条件满足后执行的操作）、**次态**（迁移后的新状态）。"现态"和"条件"是因，"动作"和"次态"是果。

#### 5.2.1 引入依赖

```xml
<dependency>
    <groupId>org.squirrelframework</groupId>
    <artifactId>squirrel-foundation</artifactId>
    <version>0.3.8</version>
</dependency>
```

#### 5.2.2 完整实战：商品状态机

下面参考 [st4rlight 的 Squirrel-Foundation 实战文章](https://juejin.cn/post/7060513727166021663)，以商品状态流转为例，演示 Squirrel-Foundation 的完整用法。

**第一步：定义状态枚举**

```java
/**
 * 商品状态枚举
 */
public enum CommodityState {
    WAIT_AUDIT(1, "待审核"),
    WAIT_MODIFY(2, "待修改"),
    OFF_SHELF(3, "未上架"),
    ON_SHELF(4, "已上架");

    private final int code;
    private final String desc;

    CommodityState(int code, String desc) {
        this.code = code;
        this.desc = desc;
    }
}
```

**第二步：定义事件枚举**

```java
/**
 * 商品事件枚举
 */
public enum CommodityEvent {
    AUDIT_PASS(1, "审核通过"),
    EDIT_INFO(2, "编辑信息"),
    UP_SHELF(3, "上架"),
    DOWN_SHELF(4, "下架");

    private final int code;
    private final String desc;

    CommodityEvent(int code, String desc) {
        this.code = code;
        this.desc = desc;
    }
}
```

**第三步：定义上下文**

```java
/**
 * 商品状态机上下文
 */
public class CommodityContext {
    // 商品信息
    private Commodity commodity;
    // 操作人员
    private String operator;

    // getters & setters...
}
```

**第四步：定义伴生字符串常量类**

> **为什么要常量类？** 使用注解定义状态机时，`@Transit` 的 `from`、`to`、`on` 参数需要字符串常量，直接使用枚举的 `toString()` 会报错。因此需要额外定义一个常量类，配合 `import static` 使用，既避免硬编码字符串，又保持代码清晰。

```java
/**
 * 商品状态机枚举常量
 */
public class StateMachineConstant {
    // 状态部分常量
    public static final String WAIT_AUDIT  = "WAIT_AUDIT";
    public static final String WAIT_MODIFY = "WAIT_MODIFY";
    public static final String OFF_SHELF   = "OFF_SHELF";
    public static final String ON_SHELF    = "ON_SHELF";

    // 事件部分常量
    public static final String AUDIT_PASS = "AUDIT_PASS";
    public static final String EDIT_INFO  = "EDIT_INFO";
    public static final String UP_SHELF   = "UP_SHELF";
    public static final String DOWN_SHELF = "DOWN_SHELF";
}
```

**第五步：定义状态机**

```java
import static cn.st4rlight.constant.StateMachineConstant.*;

/**
 * 商品状态机
 * 使用 @Transitions 注解声明式定义状态转换规则
 */
@Transitions({
    // 待审核 --(审核通过)--> 未上架
    @Transit(from = WAIT_AUDIT, to = OFF_SHELF, on = AUDIT_PASS),
    // 待审核 --(编辑信息)--> 待修改
    @Transit(from = WAIT_AUDIT, to = WAIT_MODIFY, on = EDIT_INFO),
    // 待修改 --(编辑信息)--> 待审核
    @Transit(from = WAIT_MODIFY, to = WAIT_AUDIT, on = EDIT_INFO),
    // 未上架 --(上架)--> 已上架
    @Transit(from = OFF_SHELF, to = ON_SHELF, on = UP_SHELF),
    // 已上架 --(下架)--> 未上架
    @Transit(from = ON_SHELF, to = OFF_SHELF, on = DOWN_SHELF)
})
public class CommodityFSM
    extends AbstractStateMachine<CommodityFSM, CommodityState, CommodityEvent, CommodityContext> {
}
```

**第六步：封装状态机工具类**

> **st4rlight 最佳实践**：将状态机当作**工具类**使用——输入当前状态和事件，输出次态。状态转换规则通过注解一目了然，不在状态机中承载过重的业务逻辑。

```java
/**
 * 商品状态机工具类
 */
public class CommodityFSMUtil {

    // StateMachineBuilder 可复用（线程安全）
    private static final StateMachineBuilder<CommodityFSM, CommodityState, CommodityEvent, CommodityContext>
        builder = StateMachineBuilderFactory.create(
            CommodityFSM.class, CommodityState.class, CommodityEvent.class, CommodityContext.class);

    /**
     * 获取下一个状态
     * @param fromState 当前状态
     * @param event     触发事件
     * @param context   上下文
     * @return 转换后的次态（如果转换不合法则返回原状态）
     */
    public static CommodityState getNextState(
            CommodityState fromState, CommodityEvent event, CommodityContext context) {
        StateMachineConfiguration conf = StateMachineConfiguration
            .create()
            .enableDebugMode(true)
            .enableAutoStart(true);
        CommodityFSM sm = builder.newStateMachine(fromState, conf);

        try {
            sm.fire(event, context);
            return sm.getCurrentState();
        } catch (Exception ex) {
            // 非法转换，返回原状态
            return fromState;
        }
    }
}
```

#### 5.2.3 Squirrel-Foundation 的实现原理

参考 [Squirrel 状态机实践分享](https://juejin.cn/post/7309310129024155686)，Squirrel 的核心组件关系如下：

| 组件 | 说明 |
|------|------|
| **StateMachineBuilderFactory** | 创建 StateMachineBuilder 的动态代理工厂 |
| **StateMachineBuilder** | 描述状态机实例创建细节（State/Event/Context 类型信息），可复用为单例 |
| **StateMachine** | 由 Builder 创建，**不被共享**，每个实例独立维护当前状态 |

```text
StateMachineBuilderFactory
        │ create(MyStateMachine.class)
        ↓
StateMachineBuilder (单例，可复用)
        │ newStateMachine(initialState)
        ↓
StateMachine (实例，不共享)
        │ fire(event, context)
        ↓
    状态转换 + 执行 Action
```

#### 5.2.4 特点总结

| 方面 | 说明 |
|------|------|
| **轻量** | 无 Spring 依赖，纯 Java 库 |
| **API** | 支持注解定义 + Fluent API，DSL 风格链式调用 |
| **功能** | 支持嵌套状态、守卫条件、动作、监听器、状态机持久化 |
| **类型安全** | 泛型参数 `StateMachine<T, S, E, C>` 确保编译期类型检查 |
| **性能** | 轻量级，启动快，StateMachineBuilder 可复用 |
| **社区** | 活跃度一般，文档相对较少 |

#### 5.2.5 Spring 集成：StateMachineEngine 引擎封装

参考 [Squirrel 状态机实践分享](https://juejin.cn/post/7309310129024155686)，在实际的 Spring 项目中，通常会封装一个通用的 `StateMachineEngine`，统一管理所有状态机的创建和触发，并通过 `ApplicationContext` 注入 Spring Bean。

**定义通用引擎：**

```java
/**
 * 状态机引擎：统一管理所有状态机的创建和触发
 * @param <T> 状态机类型
 * @param <S> 状态枚举类型
 * @param <E> 事件枚举类型
 * @param <C> 上下文类型
 */
public class StateMachineEngine<T extends UntypedStateMachine, S, E, C>
        implements ApplicationContextAware {

    private ApplicationContext applicationContext;

    // 缓存所有 StateMachineBuilder（key = 状态机类名），避免重复创建
    private static final Map<String, UntypedStateMachineBuilder> builderMap = new HashMap<>();

    @Override
    public void setApplicationContext(ApplicationContext ctx) throws BeansException {
        this.applicationContext = ctx;
    }

    /**
     * 触发状态转换
     * @param machine  状态机类
     * @param state    当前状态
     * @param event    触发事件
     * @param context  上下文
     */
    @Transactional
    public void fire(Class<T> machine, S state, E event, C context) {
        StateMachineBuilder builder = getStateMachineBuilder(machine);
        StateMachine stateMachine = builder.newStateMachine(state, applicationContext);
        stateMachine.fire(event, context);
    }

    /**
     * 获取或创建 StateMachineBuilder（复用机制）
     */
    private StateMachineBuilder getStateMachineBuilder(Class<T> stateMachine) {
        UntypedStateMachineBuilder builder = builderMap.get(stateMachine.getName());
        if (builder == null) {
            builder = StateMachineBuilderFactory.create(stateMachine, ApplicationContext.class);
            builderMap.put(stateMachine.getName(), builder);
        }
        return builder;
    }
}
```

**定义具体状态机（注解方式）：**

```java
/**
 * 店铺审核状态机
 */
@States({
    @State(name = "AUDIT"),   // 待审核
    @State(name = "AGREE"),   // 审核通过
    @State(name = "REJECT")   // 审核驳回
})
@Transitions({
    @Transit(from = "AUDIT", to = "AGREE",  on = "AGREE",  callMethod = "agree"),
    @Transit(from = "AUDIT", to = "REJECT", on = "REJECT", callMethod = "reject"),
    @Transit(from = "REJECT", to = "AUDIT", on = "SUBMIT", callMethod = "submit"),
    @Transit(from = "AGREE",  to = "AUDIT", on = "SUBMIT", callMethod = "submit")
})
@StateMachineParameters(
    stateType = ShopAuditStatusEnum.class,
    eventType = ShopAuditEventEnum.class,
    contextType = ShopAuditParam.class
)
public class ShopAuditStateMachine extends AbstractUntypedStateMachine {

    private ApplicationContext applicationContext;

    public ShopAuditStateMachine() {}

    public ShopAuditStateMachine(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    // 审核通过业务逻辑
    public void agree(ShopAuditStatusEnum from, ShopAuditStatusEnum to,
                      ShopAuditEventEnum event, ShopAuditParam param) {
        // 通过 applicationContext 获取 Spring Bean 执行业务逻辑
        ShopService shopService = applicationContext.getBean(ShopService.class);
        shopService.auditAgree(param);
    }

    // 审核驳回业务逻辑
    public void reject(ShopAuditStatusEnum from, ShopAuditStatusEnum to,
                       ShopAuditEventEnum event, ShopAuditParam param) {
        ShopService shopService = applicationContext.getBean(ShopService.class);
        shopService.auditReject(param);
    }

    // 提交审核业务逻辑
    public void submit(ShopAuditStatusEnum from, ShopAuditStatusEnum to,
                       ShopAuditEventEnum event, ShopAuditParam param) {
        ShopService shopService = applicationContext.getBean(ShopService.class);
        shopService.resubmit(param);
    }
}
```

**客户端调用：**

```java
@Service
public class ShopAuditService {

    @Autowired
    private StateMachineEngine stateMachineEngine;

    /**
     * 审核通过
     */
    public void auditAgree(ShopAuditParam param) {
        stateMachineEngine.fire(
            ShopAuditStateMachine.class,
            ShopAuditStatusEnum.AUDIT,   // 当前状态：待审核
            ShopAuditEventEnum.AGREE,    // 事件：审核通过
            param                        // 上下文
        );
    }

    /**
     * 审核驳回
     */
    public void auditReject(ShopAuditParam param) {
        stateMachineEngine.fire(
            ShopAuditStateMachine.class,
            ShopAuditStatusEnum.AUDIT,
            ShopAuditEventEnum.REJECT,
            param
        );
    }
}
```

> **st4rlight 最佳实践**：避免过重地使用状态机。一般**仅将状态机用于做状态转换**（即当成工具类使用），输入参数和事件得到次态。在状态较多时，避免在状态机中定义大量切面事件，除非是特别明显且不会改变的事件可以在切面中操作，否则不建议使用。

### 5.3 Colon

**Colon** 是一个超轻量级状态机库，核心理念是"用最少的代码定义状态机"。

```java
StateMachine<SessionState, SessionEvent> fsm = ColonStateMachine
    .<SessionState, SessionEvent>builder()
    .initialState(SessionState.IDLE)
    .addTransition(SessionState.IDLE,   SessionEvent.USER_MESSAGE,    SessionState.ACTIVE)
    .addTransition(SessionState.ACTIVE, SessionEvent.USER_AWAY,       SessionState.AWAY)
    .addTransition(SessionState.AWAY,   SessionEvent.USER_RETURN,     SessionState.ACTIVE)
    .addTransition(SessionState.ACTIVE, SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED)
    .addTransition(SessionState.AWAY,   SessionEvent.SESSION_TIMEOUT, SessionState.CLOSED)
    .addTransition(SessionState.ACTIVE, SessionEvent.END_SESSION,     SessionState.CLOSED)
    .build();

fsm.fire(SessionEvent.USER_MESSAGE);
// 当前状态: ACTIVE
```

**特点：**

| 方面 | 说明 |
|------|------|
| **超轻量** | 仅几百行代码，零依赖 |
| **API** | Builder 模式，极简定义 |
| **功能** | 基础状态转换，支持 Action 回调 |
| **适用场景** | 简单状态流转，不想引入重框架 |

### 5.4 框架选型对比

![状态机框架选型决策图](/ai-cs/ecosystem-tools/fsm-introduction/fsm-framework-selection-guide.svg)

| 框架 | 依赖 | 功能丰富度 | 学习曲线 | 适用场景 |
|------|------|-----------|---------|---------|
| **Spring StateMachine** | Spring 生态 | ★★★★★ | 陡 | 大型 Spring Boot 项目，需要嵌套/并行状态 |
| **Squirrel-Foundation** | 无 | ★★★★ | 中 | 中型项目，需要轻量但功能完整的状态机 |
| **Colon** | 无 | ★★ | 低 | 小型项目，简单状态流转 |
| **自研（策略模式）** | 无 | ★★★ | 低 | 已有策略模式基础，状态数适中 |

::: tip 选型建议
- **Spring Boot 项目 + 复杂状态**：首选 Spring StateMachine
- **非 Spring 项目 + 中等复杂度**：选 Squirrel-Foundation
- **极简场景**：Colon 或枚举驱动
- **已有策略模式封装**：自研轻量级状态机（下文实战）
:::

---

## 六、实战：基于策略模式封装轻量级状态机

在实际开发中，并非所有场景都需要引入完整的状态机框架。如果你的项目已有策略模式的基础封装，可以在此基础上**快速搭建一个轻量级状态机**——既获得状态机的声明式流转能力，又避免引入额外依赖。

### 6.1 设计思路

下面参考 `st4rlight-util` 项目中的策略模式封装，演示如何将其扩展为轻量级状态机。

核心设计思路：

1. **状态 = 策略类型**：每个状态对应一个策略实现，策略接口承载状态处理逻辑
2. **策略工厂 = 状态分发器**：`AbstractStrategyFactory` 根据"当前状态"自动找到对应的策略处理器
3. **转换表 = 声明式映射**：在策略实现中声明"当前状态 + 事件 → 目标状态"的映射

```text
┌─────────────────────────────────────────────────────┐
│                  状态机引擎                           │
│                                                      │
│  ┌──────────┐    fire(event)    ┌───────────────┐   │
│  │  Context  │ ───────────────→ │ StrategyFactory│   │
│  │ (当前状态) │                  │  .getStrategy() │   │
│  └──────────┘                  └───────┬───────┘   │
│       ↑                                 │           │
│       │         更新状态                 ↓           │
│       │         ┌──────────────────────────┐       │
│       └─────────│  StateStrategy (策略接口)  │       │
│                 │  - handleEvent(ctx, ev)  │       │
│                 │  - 返回 next state        │       │
│                 └──────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

### 6.2 基础封装：策略接口

参考 `st4rlight-util` 的 `IBaseGenericStrategy` 接口设计，策略接口需要声明当前状态所支持的类型，并处理事件：

```java
/**
 * 状态策略基础接口
 * @param <S> 状态枚举类型
 * @param <E> 事件枚举类型
 * @param <C> 上下文类型
 */
public interface IStateStrategy<S extends Enum<S>, E extends Enum<E>, C> {

    /**
     * 当前策略对应的状态
     */
    S supplyState();

    /**
     * 处理事件，返回目标状态
     * @param context 状态机上下文
     * @param event   触发的事件
     * @return 转换后的目标状态（如果不转换则返回当前状态）
     */
    S handleEvent(C context, E event);
}
```

这个接口借鉴了 `IBaseGenericStrategy` 的设计思路——用枚举标识类型，通过 `supplyState()` 声明当前策略负责的状态。

### 6.3 基础封装：状态机引擎

参考 `AbstractStrategyFactory` 的注册与分发机制，构建状态机引擎：

```java
/**
 * 轻量级状态机引擎
 * @param <S> 状态枚举类型
 * @param <E> 事件枚举类型
 * @param <C> 上下文类型
 */
public class LightStateMachine<S extends Enum<S>, E extends Enum<E>, C> {

    // 状态 → 策略处理器的映射（由策略工厂初始化）
    private final Map<S, IStateStrategy<S, E, C>> stateStrategyMap;

    // 当前状态
    private S currentState;

    // 状态变化监听器（可选）
    private final List<StateChangeListener<S, E, C>> listeners = new ArrayList<>();

    public LightStateMachine(S initialState,
                             List<IStateStrategy<S, E, C>> strategies) {
        this.currentState = initialState;
        this.stateStrategyMap = Maps.newHashMap();

        // 注册所有状态策略（类似 AbstractStrategyFactory 的初始化逻辑）
        for (IStateStrategy<S, E, C> strategy : strategies) {
            S state = strategy.supplyState();
            if (stateStrategyMap.containsKey(state)) {
                throw new IllegalStateException(
                    String.format("状态【%s】已有策略实现，不可重复注册", state));
            }
            stateStrategyMap.put(state, strategy);
        }

        // 校验：确保每个枚举状态都有对应的策略实现
        // （参考 AbstractStrategyFactory 的枚举完整性校验）
        S[] allStates = initialState.getDeclaringClass().getEnumConstants();
        for (S state : allStates) {
            if (!stateStrategyMap.containsKey(state)) {
                throw new IllegalStateException(
                    String.format("状态【%s】未找到策略实现", state));
            }
        }
    }

    /**
     * 触发事件
     */
    public S fire(C context, E event) {
        // 1. 根据当前状态获取策略
        IStateStrategy<S, E, C> strategy = stateStrategyMap.get(currentState);
        if (strategy == null) {
            throw new IllegalStateException(
                String.format("当前状态【%s】无策略实现", currentState));
        }

        // 2. 策略处理事件，返回目标状态
        S prevState = currentState;
        S nextState = strategy.handleEvent(context, event);

        // 3. 如果状态发生变化，更新当前状态并通知监听器
        if (nextState != prevState) {
            currentState = nextState;
            for (StateChangeListener<S, E, C> listener : listeners) {
                listener.onStateChanged(prevState, nextState, event, context);
            }
        }

        return nextState;
    }

    /**
     * 获取当前状态
     */
    public S getCurrentState() {
        return currentState;
    }

    /**
     * 注册状态变化监听器
     */
    public void addListener(StateChangeListener<S, E, C> listener) {
        listeners.add(listener);
    }

    /**
     * 状态变化监听器
     */
    @FunctionalInterface
    public interface StateChangeListener<S, E, C> {
        void onStateChanged(S from, S to, E event, C context);
    }
}
```

**关键设计点（对照 `AbstractStrategyFactory`）：**

| 设计点 | AbstractStrategyFactory | LightStateMachine |
|--------|------------------------|-------------------|
| 类型标识 | `supplyType()` / `supportTypes()` | `supplyState()` |
| 注册机制 | 构造函数遍历策略列表 | 构造函数遍历策略列表 |
| 完整性校验 | 检查枚举值是否都有实现 | 检查枚举状态是否都有实现 |
| 分发机制 | `getStrategy(type)` | `stateStrategyMap.get(currentState)` |
| 唯一性校验 | 无（支持多类型映射到同一策略） | 有（一个状态只能有一个策略） |

### 6.4 实战场景：客服会话状态机

以 AI 客服会话为例，完整实现一个状态机。

#### 6.4.1 定义状态和事件枚举

```java
// 会话状态
public enum SessionState {
    IDLE,       // 空闲，等待用户消息
    ACTIVE,     // 活跃对话中
    AWAY,       // 用户暂时离开
    TRANSFERRING, // 转人工中
    CLOSED      // 已关闭（终态）
}

// 会话事件
public enum SessionEvent {
    USER_MESSAGE,      // 用户发送消息
    USER_AWAY,         // 用户离开
    USER_RETURN,       // 用户回归
    REQUEST_HUMAN,     // 请求转人工
    HUMAN_ASSIGNED,    // 人工客服已接入
    SESSION_TIMEOUT,   // 会话超时
    END_SESSION        // 主动结束
}

// 会话上下文
public class SessionContext {
    private String sessionId;
    private List<String> messages = new ArrayList<>();
    private long lastActiveTime;
    private String assignedAgentId;

    // getters & setters...

    public void recordMessage(String message) {
        messages.add(message);
        lastActiveTime = System.currentTimeMillis();
    }
}
```

#### 6.4.2 实现各状态的策略处理器

```java
// IDLE 状态策略
@Component
public class IdleStateStrategy
        implements IStateStrategy<SessionState, SessionEvent, SessionContext> {

    @Override
    public SessionState supplyState() {
        return SessionState.IDLE;
    }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case USER_MESSAGE:
                // Action: 记录第一条消息
                ctx.recordMessage("[用户] 进入会话");
                return SessionState.ACTIVE;

            case END_SESSION:
                return SessionState.CLOSED;

            default:
                // IDLE 状态不处理 USER_AWAY、REQUEST_HUMAN 等事件
                return SessionState.IDLE;
        }
    }
}

// ACTIVE 状态策略
@Component
public class ActiveStateStrategy
        implements IStateStrategy<SessionState, SessionEvent, SessionContext> {

    @Override
    public SessionState supplyState() {
        return SessionState.ACTIVE;
    }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case USER_AWAY:
                return SessionState.AWAY;

            case REQUEST_HUMAN:
                // Action: 创建转人工工单
                return SessionState.TRANSFERRING;

            case SESSION_TIMEOUT:
            case END_SESSION:
                return SessionState.CLOSED;

            default:
                return SessionState.ACTIVE;
        }
    }
}

// AWAY 状态策略
@Component
public class AwayStateStrategy
        implements IStateStrategy<SessionState, SessionEvent, SessionContext> {

    @Override
    public SessionState supplyState() {
        return SessionState.AWAY;
    }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case USER_RETURN:
                // Action: 记录回归时间
                ctx.setLastActiveTime(System.currentTimeMillis());
                return SessionState.ACTIVE;

            case END_SESSION:
            case SESSION_TIMEOUT:
                return SessionState.CLOSED;

            default:
                return SessionState.AWAY;
        }
    }
}

// TRANSFERRING 状态策略
@Component
public class TransferringStateStrategy
        implements IStateStrategy<SessionState, SessionEvent, SessionContext> {

    @Override
    public SessionState supplyState() {
        return SessionState.TRANSFERRING;
    }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        switch (event) {
            case HUMAN_ASSIGNED:
                // Action: 分配人工客服
                ctx.setAssignedAgentId("agent-001");
                return SessionState.ACTIVE;

            case END_SESSION:
                return SessionState.CLOSED;

            default:
                return SessionState.TRANSFERRING;
        }
    }
}

// CLOSED 状态策略（终态）
@Component
public class ClosedStateStrategy
        implements IStateStrategy<SessionState, SessionEvent, SessionContext> {

    @Override
    public SessionState supplyState() {
        return SessionState.CLOSED;
    }

    @Override
    public SessionState handleEvent(SessionContext ctx, SessionEvent event) {
        // 终态不再处理任何事件
        return SessionState.CLOSED;
    }
}
```

#### 6.4.3 组装状态机

```java
@Configuration
public class SessionStateMachineConfig {

    @Bean
    public LightStateMachine<SessionState, SessionEvent, SessionContext>
            sessionStateMachine(
                    IdleStateStrategy idleStrategy,
                    ActiveStateStrategy activeStrategy,
                    AwayStateStrategy awayStrategy,
                    TransferringStateStrategy transferringStrategy,
                    ClosedStateStrategy closedStrategy) {

        // 收集所有状态策略（类似 AbstractStrategyFactory 的构造方式）
        List<IStateStrategy<SessionState, SessionEvent, SessionContext>> strategies =
            List.of(idleStrategy, activeStrategy, awayStrategy,
                    transferringStrategy, closedStrategy);

        // 创建状态机，初始状态为 IDLE
        LightStateMachine<SessionState, SessionEvent, SessionContext> fsm =
            new LightStateMachine<>(SessionState.IDLE, strategies);

        // 注册监听器：状态变化时记录日志
        fsm.addListener((from, to, event, ctx) -> {
            System.out.println(String.format(
                "[FSM] 会话 %s: %s --(%s)--> %s",
                ctx.getSessionId(), from, event, to));
        });

        return fsm;
    }
}
```

> **注意**：上述示例中 `LightStateMachine` 是单例 Bean，适用于无状态场景。如果每个会话需要独立的状态机实例（有状态场景），应使用工厂方法为每个会话创建独立实例。

#### 6.4.4 使用状态机

```java
@Service
public class SessionService {

    // 每个会话维护独立的状态机实例
    private final Map<String, LightStateMachine<SessionState, SessionEvent, SessionContext>>
        sessionFsmMap = new ConcurrentHashMap<>();

    private final List<IStateStrategy<SessionState, SessionEvent, SessionContext>>
        strategies;

    public SessionService(
            List<IStateStrategy<SessionState, SessionEvent, SessionContext>> strategies) {
        this.strategies = strategies;
    }

    /**
     * 获取或创建会话状态机
     */
    private LightStateMachine<SessionState, SessionEvent, SessionContext>
            getOrCreateFsm(String sessionId) {
        return sessionFsmMap.computeIfAbsent(sessionId, id -> {
            // 每个会话创建独立的状态机实例
            // 注意：策略是无状态的，可以安全共享
            return new LightStateMachine<>(SessionState.IDLE, strategies);
        });
    }

    /**
     * 处理用户消息
     */
    public void onUserMessage(String sessionId, String text) {
        SessionContext ctx = new SessionContext(sessionId);
        LightStateMachine<SessionState, SessionEvent, SessionContext> fsm =
            getOrCreateFsm(sessionId);

        SessionState prev = fsm.getCurrentState();
        fsm.fire(ctx, SessionEvent.USER_MESSAGE);

        // 检查状态是否变化
        if (fsm.getCurrentState() == SessionState.ACTIVE && prev == SessionState.IDLE) {
            // 从 IDLE 切换到 ACTIVE，触发 LLM 回复
            triggerLlmReply(sessionId, text);
        } else if (fsm.getCurrentState() == SessionState.ACTIVE) {
            // 已在 ACTIVE 状态，直接回复
            triggerLlmReply(sessionId, text);
        }
    }

    /**
     * 用户离开
     */
    public void onUserAway(String sessionId) {
        SessionContext ctx = new SessionContext(sessionId);
        getOrCreateFsm(sessionId).fire(ctx, SessionEvent.USER_AWAY);
    }

    /**
     * 请求转人工
     */
    public void onRequestHuman(String sessionId) {
        SessionContext ctx = new SessionContext(sessionId);
        getOrCreateFsm(sessionId).fire(ctx, SessionEvent.REQUEST_HUMAN);
        // 状态机已切换到 TRANSFERRING，执行转人工逻辑
        assignHumanAgent(sessionId);
    }
}
```

### 6.5 状态转换图

```text
                        USER_MESSAGE
     ┌──────┐ ─────────────────────→ ┌──────────┐
     │ IDLE │                         │  ACTIVE  │ ←──────────┐
     └──┬───┘                         └────┬─────┘            │
        │                                  │                  │
        │ END_SESSION                      │ USER_AWAY        │ USER_RETURN
        │                                  ↓                  │
        │                             ┌──────────┐            │
        │                             │   AWAY   │ ───────────┘
        │                             └────┬─────┘
        │                                  │
        │                                  │ SESSION_TIMEOUT
        │     END_SESSION                  │ END_SESSION
        │     SESSION_TIMEOUT              ↓
        │     (from ACTIVE)           ┌──────────┐
        │     (from AWAY)          ┌──│  CLOSED  │ (终态)
        ↓                          │  └──────────┘
     ┌──────┐                      │
     │CLOSED│ ←─────────────────────┘
     └──────┘

                        REQUEST_HUMAN
     ┌──────────┐ ──────────────→ ┌──────────────┐
     │  ACTIVE  │                  │ TRANSFERRING │
     └──────────┘ ←────────────── └──────┬───────┘
                   HUMAN_ASSIGNED         │
                                          │ END_SESSION
                                          ↓
                                   ┌──────────┐
                                   │  CLOSED  │
                                   └──────────┘
```

### 6.6 设计要点总结

| 设计要点 | 说明 | 参考来源 |
|---------|------|---------|
| **策略接口泛型化** | `IStateStrategy<S, E, C>` 三个泛型参数分别标识状态、事件、上下文 | `IBaseGenericStrategy<E>` 的泛型设计 |
| **枚举完整性校验** | 构造时检查所有枚举状态是否都有策略实现 | `AbstractStrategyFactory` 的枚举校验逻辑 |
| **策略无状态共享** | 策略实现不持有可变状态，可被多个状态机实例安全共享 | 策略模式的无状态特性 |
| **监听器机制** | 状态变化时通知监听器，实现解耦的副作用处理 | 观察者模式 |
| **终态保护** | 终态策略返回自身，拒绝所有事件 | 状态机终态语义 |

::: tip 与完整框架的取舍
这种基于策略模式的轻量级状态机适合**状态数 ≤ 10、无嵌套/并行状态**的场景。如果需要状态嵌套、子状态机、并行区域等高级特性，建议使用 Spring StateMachine 或 Squirrel-Foundation。
:::

---

## 七、客服系统中的状态机实践

### 7.1 客服工单状态机

在 AI 客服系统中，工单是最典型的状态流转对象。一个工单从创建到关闭，通常经历以下状态：

| 状态 | 说明 |
|------|------|
| `PENDING` | 待受理（工单刚创建） |
| `AI_PROCESSING` | AI 处理中（AI 正在尝试自动解决） |
| `AI_RESOLVED` | AI 已解决（等待用户确认） |
| `ESCALATED` | 已升级转人工（AI 无法解决） |
| `HUMAN_PROCESSING` | 人工处理中 |
| `RESOLVED` | 已解决（用户确认） |
| `CLOSED` | 已关闭（终态） |

典型的事件流转：

```text
PENDING ──(ASSIGN_AI)──→ AI_PROCESSING ──(AI_SOLVE)──→ AI_RESOLVED
                              │                           │
                              │ AI_FAIL                   │ USER_CONFIRM
                              ↓                           ↓
                          ESCALATED ──(ASSIGN_HUMAN)──→ HUMAN_PROCESSING
                                                            │
                                                            │ HUMAN_SOLVE
                                                            ↓
                                                         RESOLVED ──(USER_CLOSE)──→ CLOSED
                                                            │
                                                            │ USER_REJECT
                                                            ↓
                                                         ESCALATED (回到转人工)
```

### 7.2 状态机在客服系统中的价值

| 价值 | 说明 |
|------|------|
| **防止非法流转** | 工单不能从 `CLOSED` 直接跳到 `AI_PROCESSING`，状态机自动拒绝 |
| **统一可视化** | 状态流转规则集中定义，运营和开发都能看懂 |
| **审计追踪** | 每次状态变化记录日志，满足合规审计需求 |
| **条件守卫** | 转人工前检查"AI 处理次数是否超限"，未超限不允许转人工 |
| **副作用解耦** | 状态变化触发通知（短信、推送），通过监听器解耦 |

### 7.3 与其他客服系统组件的协作

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  消息接入层   │ ──→ │  意图识别    │ ──→ │  状态机引擎   │
│ (WebSocket)  │     │  (NLP/LLM)  │     │  (FSM)      │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                    状态变化事件 │
                                               ↓
                    ┌──────────────────────────┼──────────────────┐
                    │                          │                  │
              ┌─────┴─────┐           ┌────────┴──────┐  ┌────────┴──────┐
              │ AI 回复引擎 │           │  人工客服分配   │  │  通知服务     │
              │ (LLM)     │           │  (Routing)    │  │ (Push/SMS)   │
              └───────────┘           └───────────────┘  └───────────────┘
```

- **意图识别** 产出事件（`AI_SOLVE`、`AI_FAIL`），驱动状态机流转
- **状态机** 根据当前状态和事件决定下一步，通过监听器通知其他组件
- **AI 回复引擎** 在 `AI_PROCESSING` 状态下被激活
- **人工客服分配** 在状态变为 `ESCALATED` 时被触发
- **通知服务** 在任何状态变化时发送通知给用户

---

## 八、状态机设计最佳实践

### 8.1 状态设计原则

| 原则 | 说明 | 反面案例 |
|------|------|---------|
| **状态正交** | 每个状态代表一个独立的、不可再分的阶段 | `ACTIVE_AND_AWAY`（应拆分为 `ACTIVE` 和 `AWAY`） |
| **状态有限** | 状态数量应有限且可控（通常 ≤ 15） | 用字符串拼接状态：`"ACTIVE_v2_TIMEOUT"` |
| **终态明确** | 至少有一个终态，且终态不可逆 | 工单没有"已关闭"状态，永远在流转 |
| **避免伪状态** | 状态应反映业务语义，而非技术细节 | `DB_SAVING`、`REDIS_CACHING` 不应作为业务状态 |

### 8.2 事件设计原则

| 原则 | 说明 |
|------|------|
| **事件语义化** | 事件名描述"发生了什么"，而非"做什么"（`USER_AWAY` 而非 `SET_AWAY`） |
| **事件不可变** | 事件是已发生的事实，不应携带可变数据 |
| **事件粒度适中** | 不要把多个语义合并为一个事件（`USER_MESSAGE_AND_AWAY`） |

### 8.3 转换设计原则

| 原则 | 说明 |
|------|------|
| **显式优于隐式** | 所有合法转换必须显式声明，未声明的转换一律拒绝 |
| **守卫条件独立** | Guard 只做条件判断，不执行副作用 |
| **Action 幂等** | 转换动作应尽量幂等，防止异常重试导致重复执行 |

### 8.4 持久化与恢复

在有状态的业务场景中，状态机的当前状态需要持久化：

```java
// 持久化：将当前状态写入数据库
public void persistSessionState(String sessionId, SessionState state) {
    sessionMapper.updateState(sessionId, state.name());
}

// 恢复：从数据库加载状态，重建状态机
public LightStateMachine<SessionState, SessionEvent, SessionContext>
        restoreSessionStateMachine(String sessionId) {
    SessionEntity entity = sessionMapper.selectById(sessionId);
    SessionState restoredState = SessionState.valueOf(entity.getState());

    // 用恢复的状态作为初始状态创建状态机
    return new LightStateMachine<>(restoredState, strategies);
}
```

::: warning 状态持久化的注意事项
1. **状态字段应使用枚举名而非序号**：`status VARCHAR(32)` 存 `'ACTIVE'`，不要用 `int` 存 `2`，防止枚举顺序变化导致数据错乱
2. **状态变更需加乐观锁**：并发场景下，`UPDATE session SET status='ACTIVE' WHERE id=? AND status='IDLE'`，防止并发流转
3. **状态变更需记录日志**：谁在什么时间触发了什么事件导致状态从 A 变为 B，满足审计需求
:::

---

## 九、常见陷阱与误区

### 9.1 状态膨胀

**问题：** 把本应是"属性"的东西当成了"状态"。

```text
// ❌ 错误：把渠道类型当成了状态
states = { WEB_ACTIVE, APP_ACTIVE, MINI_PROGRAM_ACTIVE, WEB_AWAY, APP_AWAY, ... }

// ✅ 正确：渠道是属性，状态只有 ACTIVE/AWAY
states = { ACTIVE, AWAY }
context.channel = "WEB"  // 属性
```

**经验法则：** 如果两个状态的转换规则完全相同，只是某个属性不同，那么它们应该是同一个状态，那个不同的东西是属性。

### 9.2 状态机滥用

**问题：** 所有问题都用状态机解决，包括不需要的场景。

```java
// ❌ 不需要状态机：简单的开关逻辑
StateMachine<SwitchState, SwitchEvent> fsm = ...
// 只有两个状态 ON/OFF，一个事件 TOGGLE → 这就是 if-else

// ✅ 直接用 boolean
boolean isOn = false;
isOn = !isOn;
```

**经验法则：** 状态 ≤ 3 且转换规则简单时，不需要状态机。状态机适合**状态 ≥ 4 且转换规则复杂**的场景。

### 9.3 忽略并发安全

**问题：** 多线程同时触发事件，导致状态机状态不一致。

```java
// ❌ 非线程安全：共享状态机实例
sharedStateMachine.fire(event);  // 多线程调用，currentState 竞态

// ✅ 线程安全方案一：每个对象独立状态机实例
Map<String, LightStateMachine<...>> fsmMap = new ConcurrentHashMap<>();
fsmMap.computeIfAbsent(id, k -> new LightStateMachine<>(INITIAL, strategies));

// ✅ 线程安全方案二：加锁保护
synchronized (fsm) {
    fsm.fire(event);
}
```

---

## 总结

有限状态机是一种**结构化、可维护、可可视化**的状态管理范式。本文从基础概念到实战应用，系统梳理了 FSM 的核心知识体系：

### 核心要点回顾

| 主题 | 要点 |
|------|------|
| **三要素** | 状态（State）、事件（Event）、转换（Transition） |
| **两大分类** | DFA（确定性，业务首选）、NFA（非确定性，编译原理用） |
| **四种实现** | if-else（极简）、状态模式（中等）、枚举驱动（纯流转）、状态机引擎（复杂） |
| **三大框架** | Spring StateMachine（重量级）、Squirrel-Foundation（轻量级）、Colon（超轻量） |
| **自研方案** | 基于策略模式封装轻量级状态机，零依赖，适合中等复杂度场景 |

### 选型决策

- **状态 ≤ 3**：`if-else` 或枚举驱动，无需引入框架
- **状态 4~8**：策略模式封装的轻量级状态机（参考 `st4rlight-util`）
- **状态 > 8 或需嵌套/并行**：Spring StateMachine 或 Squirrel-Foundation
- **Spring Boot 项目**：优先考虑 Spring StateMachine
- **非 Spring 项目**：考虑 Squirrel-Foundation 或自研

### 状态机的价值

状态机最大的价值不在于代码量减少，而在于**将隐式的状态流转逻辑显式化**——从"散落在各处的 `if-else`"变为"集中定义的转换表"。这使得：

1. **状态流转规则一目了然**，新成员能快速理解业务全貌
2. **非法转换被自动拦截**，防止人为编写错误的流转逻辑
3. **状态变化可审计**，每次流转都有迹可循
4. **扩展性好**，新增状态只需新增策略/转换，不影响已有逻辑

对于 AI 客服系统而言，工单流转、会话管理、转人工流程等场景天然适合状态机——用结构化的方式管理复杂的状态流转，让代码更清晰、更可靠。

---

## 延伸阅读

### 理论基础

- [Finite-state machine - Wikipedia](https://en.wikipedia.org/wiki/Finite-state_machine) —— FSM 的百科全书式介绍
- [Introduction to Automata Theory](https://en.wikipedia.org/wiki/Automata_theory) —— 自动机理论，FSM 的数学基础
- [DFA vs NFA](https://en.wikipedia.org/wiki/Nondeterministic_finite_automaton) —— 确定性与非确定性有限自动机的区别

### 框架文档

- [Spring StateMachine 官方文档](https://docs.spring.io/spring-statemachine/docs/current/reference/) —— Spring 官方状态机框架完整指南
- [Squirrel-Foundation GitHub](https://github.com/hekailiang/squirrel) —— 轻量级状态机库
- [Colon GitHub](https://github.com/zhangchi124/colon) —— 超轻量级状态机库

### 设计模式

- [State Pattern - Refactoring Guru](https://refactoring.guru/design-patterns/state) —— 状态模式的可视化讲解
- [Strategy Pattern - Refactoring Guru](https://refactoring.guru/design-patterns/strategy) —— 策略模式，自研状态机的基础

### 参考文章

- [Java有限状态机FSM（基础篇）](https://juejin.cn/post/7059400669651812388) —— FSM 概念讲解与四种实现方式对比（switch-case、状态模式、枚举、转换映射）
- [Java有限状态机FSM（Squirrel-Foundation篇）](https://juejin.cn/post/7060513727166021663) —— Squirrel-Foundation 框架的完整实战用法，含状态枚举、事件枚举、上下文、常量类、工具类封装
- [Squirrel-Foundation 保姆级 Demo](https://juejin.cn/post/7363823940605607976) —— Squirrel-Foundation 与 StatusMachine 对比，DSL 概念讲解，TrafficLight 完整示例
- [Squirrel 状态机实践分享](https://juejin.cn/post/7309310129024155686) —— 店铺审核 Case 实战，StateMachineEngine 引擎封装，Spring 集成与注解定义

### 相关文章

- [Akka FSM（有限状态机）](/ai-cs/akka-introduction/#_十六-fsm-有限状态机) —— Akka 框架中的 FSM 实现，Actor 模型与状态机的结合
