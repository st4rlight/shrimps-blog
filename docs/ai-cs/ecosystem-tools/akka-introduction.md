---
title: Akka高并发系统介绍
tags:
  - Akka
  - Actor模型
  - 高并发
  - 分布式
  - 客服系统
excerpt: Akka 是基于 Actor 模型构建的高并发、分布式、容错消息驱动应用框架。本文从 Actor 模型理论基础出发，系统梳理 Akka 的核心概念、消息传递机制、容错策略（Supervision + Circuit Breaker）、流处理与集群能力（Cluster Sharding + Receptionist）、事件溯源、Routers 路由、FSM 状态机、测试策略、生态模块全景，并涵盖 Akka 许可证变更与 Apache Pekko 的选型建议，结合 AI 客服系统场景探讨完整工程实践。
createTime: 2026/07/07 10:00:00
permalink: /ai-cs/akka-introduction/
---

# Akka高并发系统介绍

> 如果你在构建一个需要处理海量并发连接、要求高可用和弹性扩展的系统——比如一个同时服务数万在线会话的 AI 客服平台——那么传统的"一个请求一个线程"模型很快就会成为瓶颈。Akka 提供了一种截然不同的并发编程范式：**用 Actor 模型替代共享内存 + 锁**，用消息传递替代方法调用，用"让它崩溃"替代防御性编程。

## 一、为什么需要 Akka

### 1.1 传统并发模型的困境

在传统的 Java/JVM 并发编程中，我们习惯于使用**共享内存 + 锁**的方式：

```java
// 传统方式：共享可变状态 + 锁
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        count++;  // 多线程下需要加锁保护
    }

    public synchronized int get() {
        return count;
    }
}
```

这种模型在低并发下工作良好，但在高并发场景下会暴露一系列问题：

| 问题 | 说明 |
|------|------|
| **锁竞争** | 线程争抢锁导致上下文切换开销剧增，吞吐量下降 |
| **死锁风险** | 多把锁的获取顺序不一致，极易产生死锁 |
| **可扩展性差** | 锁粒度难以把控——粗锁限制并发度，细锁增加复杂度 |
| **线程开销** | 每个线程约占 1MB 栈空间，数万线程 = 数十 GB 内存 |
| **调试困难** | 竞态条件、内存可见性问题难以复现和定位 |

### 1.2 Akka 的回答

Akka 的核心思想是：**不共享，不锁，只传消息**。

它借鉴了 Erlang 语言的 Actor 模型，把并发抽象为一个个独立的 Actor，每个 Actor：

- 拥有**私有状态**，外部无法直接访问
- 通过**异步消息**与其他 Actor 通信
- 一次只处理**一条消息**，天然串行，无需加锁
- 极其轻量，单个 JVM 上可以创建**数百万**个 Actor

```java
// Akka 方式：Actor 封装状态，通过消息通信
public class Counter extends AbstractActor {
    private int count = 0;  // 私有状态，无需锁保护

    public static Props props() {
        return Props.create(Counter.class);
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(Increment.class, msg -> count++)                          // 一次只处理一条消息，天然线程安全
            .match(Get.class, msg -> getSender().tell(count, getSelf()))     // 异步回复
            .build();
    }
}
```

### 1.3 Akka 在 AI 客服系统中的价值

AI 客服系统的典型特征与 Akka 的能力高度契合：

| 客服系统需求 | Akka 能力 |
|-------------|----------|
| 数万级并发会话 | 单 JVM 百万级 Actor，极低资源消耗 |
| 会话状态管理 | Actor 天然封装会话状态，隔离且线程安全 |
| 会话间隔离 | 一个会话 Actor 崩溃不影响其他会话 |
| 弹性扩缩容 | Akka Cluster 支持节点动态加入/退出 |
| 消息流处理 | Akka Streams 支持背压的流式处理 |
| 高可用容错 | Supervision 树 + Let-It-Crash 策略 |

---

## 二、Actor 模型基础

### 2.1 什么是 Actor 模型

Actor 模型由 Carl Hewitt 于 1973 年提出，是一种**并发计算的数学模型**。它的核心思想是将系统分解为大量独立的 Actor，每个 Actor 是一个并发原语。

一个 Actor 可以做三件事：

![Actor模型核心概念总览](/ai-cs/ecosystem-tools/akka-introduction/actor-model-overview.svg)

```text
┌─────────────────────────────────────────┐
│                 Actor                    │
│                                          │
│  1. 接收消息 → 处理消息（修改私有状态）   │
│  2. 创建子 Actor                         │
│  3. 向其他 Actor 发送消息                │
│                                          │
│  ┌─────────┐  私有状态（外部不可见）      │
│  │ state   │                             │
│  └─────────┘                             │
└─────────────────────────────────────────┘
      ↑ 消息              ↓ 消息
      │                   │
   Mailbox             其他 Actor
```

| 能力 | 说明 |
|------|------|
| **接收消息** | 每个 Actor 有一个 Mailbox（邮箱），消息按 FIFO 顺序排队，Actor 一次只取一条消息处理 |
| **创建子 Actor** | Actor 可以创建子 Actor，形成 Actor 层级结构（Supervision 树） |
| **发送消息** | Actor 可以向已知的 ActorRef 发送消息，消息是异步的，发送后不阻塞 |

### 2.2 Actor 的核心特性

**1. 封装性**

Actor 的状态完全私有，外部只能通过发送消息与其交互。不存在共享可变状态，因此**不需要锁**。

**2. 异步性**

消息发送是 fire-and-forget（发后即忘），发送方不会等待接收方处理完毕。这使得系统天然解耦，各组件可以独立演进。

**3. 公平性**

每个 Actor 一次只处理一条消息。当 Mailbox 中有多条消息时，它们会被依次处理。如果 Actor 需要处理耗时操作，应避免在 `receive` 方法中阻塞。

**4. 位置透明性**

发送消息时，你只需要一个 `ActorRef`，不需要关心目标 Actor 是在本地 JVM 还是远程节点。这是 Akka 分布式能力的基石。

### 2.3 与传统并发模型的对比

![共享内存+锁 vs Actor模型](/ai-cs/ecosystem-tools/akka-introduction/concurrency-model-comparison.svg)

| 维度 | 共享内存 + 锁 | Actor 模型 |
|------|--------------|-----------|
| 状态管理 | 共享可变状态 | Actor 私有状态，不共享 |
| 同步方式 | 锁 / CAS 临界区 | 消息传递，天然异步 |
| 并发单元 | 线程（OS 级，~1MB/个） | Actor（用户级，~300 字节/个） |
| 错误处理 | try-catch 防御式编程 | Let-It-Crash + 监督恢复 |
| 扩展方式 | 线程池扩容 | Actor 拆分 / 集群分布 |
| 心智负担 | 高（死锁、竞态、可见性） | 低（消息驱动，无共享） |

---

## 三、Akka 核心概念

### 3.1 ActorSystem

`ActorSystem` 是 Akka 的根容器，是所有 Actor 的家。一个 JVM 通常只创建一个 `ActorSystem`，它管理：

- 线程池（Dispatcher）—— Actor 运行在其上
- 配置（Configuration）
- 调度器（Scheduler）—— 定时任务
- Actor 生命周期管理

```java
import akka.actor.ActorSystem;

// 创建 ActorSystem
ActorSystem system = ActorSystem.create("ai-customer-service");
```

::: tip ActorSystem 是重量级
`ActorSystem` 分配线程池、调度器等资源，创建和销毁开销大。一个应用通常只创建一个 `ActorSystem`，在应用关闭时才 `terminate()` 它。
:::

### 3.2 Actor

`Actor` 是 Akka 的核心抽象。定义一个 Actor 需要继承 `AbstractActor`（Java）或 `Actor`（Scala），并实现 `createReceive()` 方法：

```java
// Java 版本
public class SessionActor extends AbstractActor {
    private String sessionId;
    private List<String> messageHistory = new ArrayList<>();

    // 构造方法
    public SessionActor(String sessionId) {
        this.sessionId = sessionId;
    }

    // Props：Actor 的创建配方
    public static Props props(String sessionId) {
        return Props.create(SessionActor.class, sessionId);
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(UserMessage.class, msg -> {
                // 处理用户消息
                messageHistory.add(msg.getText());
                System.out.println("会话 " + sessionId + " 收到: " + msg.getText());
            })
            .match(GetHistory.class, msg -> {
                // 回复历史消息
                getSender().tell(messageHistory, getSelf());
            })
            .build();
    }
}
```

### 3.3 Props

`Props` 是 Actor 的**创建配置对象**，描述了如何创建一个 Actor 实例。它的作用类似于工厂模式的配置：

```java
// Java：在 Actor 类中定义静态 props 方法
public static Props props(String sessionId) {
    return Props.create(SessionActor.class, sessionId);
}

// 使用 Props 创建 Actor
ActorRef sessionRef = system.actorOf(SessionActor.props("session-001"), "session-001");
```

为什么要用 `Props` 而不直接 `new`？因为 Akka 需要：

- 在**远程节点**上创建 Actor 时，需要序列化创建逻辑
- 实现**位置透明性**——调用方不需要知道 Actor 在哪创建
- 统一管理 Actor 的**创建参数**和**调度策略**

### 3.4 ActorRef

`ActorRef` 是 Actor 的**引用**，是外部与 Actor 交互的唯一接口。你**永远拿不到** Actor 的实例对象，只能拿到 `ActorRef`：

```java
// 创建 Actor，返回 ActorRef（不是 Actor 实例）
ActorRef sessionRef = system.actorOf(SessionActor.props("session-001"), "session-001");

// 通过 ActorRef 发送消息
sessionRef.tell(new UserMessage("你好，我需要帮助", System.currentTimeMillis()), ActorRef.noSender());  // tell 模式
```

`ActorRef` 的好处：

- **位置透明**：本地 Actor 和远程 Actor 的 `ActorRef` 接口完全一致
- **生命周期解耦**：Actor 重启后 `ActorRef` 不变，外部无感知
- **安全**：外部无法直接操作 Actor 内部状态

### 3.5 Message

消息是 Actor 之间通信的唯一方式。消息是**不可变对象**（immutable），通常用 case class（Scala）或 POJO（Java）定义：

```java
// 不可变消息定义（使用 Java Record）
public record UserMessage(String text, long timestamp) {}
public record BotReply(String text, double confidence) {}
public record GetHistory() {}
public record EndSession(String sessionId) {}
```

::: warning 消息必须不可变
Akka 要求消息必须是不可变的。如果消息中包含可变对象（如 `ListBuffer`），多个 Actor 可能同时访问它，导致竞态条件。最佳实践是使用 `case class` + 不可变集合。
:::

### 3.6 Mailbox

每个 Actor 都有一个 Mailbox（邮箱），接收到的消息会在其中排队。Mailbox 默认是 FIFO 队列，但也支持优先级队列等自定义实现：

```text
Mailbox（FIFO 队列）
┌───┬───┬───┬───┬───┐
│ M1│ M2│ M3│ M4│ M5│  ← 消息按到达顺序排队
└───┴───┴───┴───┴───┘
     ↓
  Actor 一次取一条消息处理
```

---

## 四、消息传递模式

### 4.1 Tell（Fire-and-Forget）

`tell`（Scala 中写作 `!`）是最常用的消息发送方式——发送后不等待回复：

```java
// Tell 模式：发后即忘
sessionRef.tell(new UserMessage("你好", System.currentTimeMillis()), ActorRef.noSender());
```

`tell` 的第二个参数是**发送方引用**（`sender`），接收方可以通过 `sender()` 获取并回复。传入 `noSender()` 表示不需要回复。

### 4.2 Ask（Request-Response）

`ask`（Scala 中写作 `?`）用于需要等待回复的场景，返回一个 `Future`：

```java
import akka.pattern.Patterns;
import akka.util.Timeout;
import java.time.Duration;
import java.util.concurrent.CompletionStage;

// Ask 模式：等待回复
Timeout timeout = Timeout.create(Duration.ofSeconds(3));

CompletionStage<Object> future = Patterns.ask(sessionRef, new GetHistory(), timeout);

// 异步处理回复
future.thenAccept(history -> System.out.println("历史消息: " + history))
      .exceptionally(e -> {
          System.out.println("获取失败: " + e.getMessage());
          return null;
      });
```

::: tip Tell vs Ask
**优先使用 Tell**。Ask 本质上也是通过 Tell 实现的——Akka 会创建一个临时 Actor 来接收回复，并完成对应的 Future。过度使用 Ask 会导致大量临时 Actor，增加开销。Ask 适合"必须拿到结果才能继续"的场景。
:::

### 4.3 Forward

`forward` 将消息转发给另一个 Actor，同时保持原始发送者不变：

```java
public class RouterActor extends AbstractActor {
    private final ActorRef workerRef;

    public RouterActor() {
        this.workerRef = getContext().actorOf(WorkerActor.props(), "worker");
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(ProcessRequest.class, msg ->
                workerRef.forward(msg, getContext()))  // 转发，sender 仍是原始发送者
            .build();
    }
}
```

这样 `WorkerActor` 收到消息时，`sender()` 是最初发消息给 `RouterActor` 的人，而不是 `RouterActor`。

### 4.4 消息传递模式对比

![消息传递模式对比](/ai-cs/ecosystem-tools/akka-introduction/messaging-patterns-comparison.svg)

| 模式 | 语义 | 适用场景 | 是否阻塞 |
|------|------|---------|---------|
| **Tell** | 发后即忘 | 事件通知、命令下达 | 否 |
| **Ask** | 请求-响应 | 需要获取结果 | 否（返回 Future） |
| **Forward** | 转发（保持原 sender） | 路由、代理 | 否 |

---

## 五、Actor 生命周期

理解 Actor 的生命周期，对于正确管理资源和处理故障至关重要。

### 5.1 生命周期流程

![Actor生命周期流程](/ai-cs/ecosystem-tools/akka-introduction/lifecycle-flow.svg)

### 5.2 生命周期回调

| 方法 | 调用时机 | 典型用途 |
|------|---------|---------|
| `preStart()` | Actor 创建后、处理消息前 | 初始化连接、加载配置 |
| `postStop()` | Actor 停止后 | 关闭连接、释放资源 |
| `preRestart(reason, message)` | Actor 即将重启前（旧实例） | 保存状态、记录日志 |
| `postRestart(reason)` | Actor 重启后（新实例） | 恢复状态、重新初始化 |

```java
public class DbSessionActor extends AbstractActor {
    private Connection connection;

    @Override
    public void preStart() {
        connection = DriverManager.getConnection(url);  // 初始化数据库连接
        log().info("数据库连接已建立");
    }

    @Override
    public void postStop() {
        if (connection != null) connection.close();  // 释放连接
        log().info("数据库连接已关闭");
    }

    @Override
    public void preRestart(Throwable reason, Optional<Object> message) {
        // 重启前保存状态（可选）
        log().warning("Actor 即将重启，原因: " + reason.getMessage());
        super.preRestart(reason, message);  // 默认会调用 postStop
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(Query.class, msg -> { /* ... */ })
            .build();
    }
}
```

### 5.3 停止 Actor

停止 Actor 有三种方式：

```java
// 方式一：Actor 自己停止
getContext().stop(getSelf());

// 方式二：父 Actor 停止子 Actor
getContext().stop(childRef);

// 方式三：通过 PoisonPill 毒丸消息（Actor 处理完当前消息后停止）
childRef.tell(PoisonPill.getInstance(), ActorRef.noSender());

// 方式四：通过 gracefulStop 优雅停止（等待超时）
import akka.pattern.Patterns;
import java.time.Duration;
CompletionStage<Boolean> stopped = Patterns.gracefulStop(childRef, Duration.ofSeconds(5));
```

---

## 六、Supervision 与容错策略

这是 Akka 最具特色的设计之一——**Let-It-Crash（让它崩溃）** 哲学。

### 6.1 Let-It-Crash 理念

传统编程范式：出现异常 → 捕获 → 尝试恢复 → 继续运行（在同一个对象实例中）。

Akka 范式：出现异常 → **让 Actor 崩溃** → 父 Actor（监督者）决定如何处理 → **重启新实例**。

为什么这样做更健壮？因为很多时候，**重建一个干净的对象比修复一个已损坏的状态更安全**。Erlang 用这套理念做到了电话交换机 99.9999999% 的可用性（9 个 9）。

### 6.2 Supervisor Strategy

![Supervision监督策略总览](/ai-cs/ecosystem-tools/akka-introduction/supervision-strategy-overview.svg)

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| **Resume** | 子 Actor 保持当前状态继续运行 | 异常是暂时的，状态仍然有效 |
| **Restart** | 创建新的子 Actor 实例，旧实例销毁 | 状态可能已损坏，需要重置 |
| **Stop** | 永久终止子 Actor | 子 Actor 的职责已结束或无法恢复 |
| **Escalate** | 将决策权交给更上层的监督者 | 当前层级无法处理此故障 |

### 6.3 OneForOne vs AllForOne

Akka 提供两种监督策略：

```java
import akka.actor.OneForOneStrategy;
import akka.actor.SupervisorStrategy;
import akka.actor.SupervisorStrategy.*;
import akka.japi.function.Function;
import java.time.Duration;

// OneForOne：只对出错的子 Actor 执行策略
@Override
public SupervisorStrategy supervisorStrategy() {
    return new OneForOneStrategy(
        3,                              // 最大重试次数
        Duration.ofMinutes(1),          // 时间窗口
        DeciderBuilder
            .match(ArithmeticException.class, e -> SupervisorStrategy.resume())     // 算术异常：恢复
            .match(NullPointerException.class, e -> SupervisorStrategy.restart())   // 空指针：重启
            .match(IllegalArgumentException.class, e -> SupervisorStrategy.stop())  // 非法参数：停止
            .matchAny(e -> SupervisorStrategy.escalate())                            // 其他：上报
            .build()
    );
}
```

| 策略模式 | 行为 | 适用场景 |
|---------|------|---------|
| **OneForOneStrategy** | 只对崩溃的子 Actor 执行恢复策略 | 子 Actor 之间相互独立 |
| **AllForOneStrategy** | 对**所有**子 Actor 执行恢复策略 | 子 Actor 之间紧密耦合，一个崩溃需要全部重启 |

### 6.4 客服系统中的 Supervision 实践

以 AI 客服系统为例，典型的 Actor 层级和监督策略如下：

```text
                    CustomerServiceSystem (root)
                            │
            ┌───────────────┼───────────────┐
            │               │               │
     SessionManager    KnowledgeBase    ModelGateway
       (Supervisor)      Actor          Actor
            │
    ┌───────┼───────┐
    │       │       │
 Session  Session  Session
  (001)   (002)   (003)
```

- `SessionManager` 监督所有 `Session` Actor，某个会话崩溃时 **Restart** 该单个会话（OneForOne）
- `ModelGateway` 负责调用 LLM API，超时或限流时 **Resume**（重试即可）
- `KnowledgeBase` 连接知识库，连接异常时 **Restart**（重新建立连接）

---

## 七、Akka Streams

### 7.1 什么是 Akka Streams

Akka Streams 是基于 Actor 模型构建的**流处理库**，提供了声明式的流式数据处理 API。它的核心优势是内置**背压（Backpressure）** 机制——当下游处理不过来时，自动通知上游减速，避免 OOM。

### 7.2 核心概念

Akka Streams 有三个核心抽象：

```text
Source(输出) → Flow(转换) → Sink(消费)

┌──────────┐     ┌──────────┐     ┌──────────┐
│  Source  │ ──→ │   Flow   │ ──→ │   Sink   │
│ (数据源)  │     │ (处理器)  │     │ (消费者)  │
└──────────┘     └──────────┘     └──────────┘
```

| 组件 | 语义 | 说明 |
|------|------|------|
| **Source** | 一个输出 | 数据源，只有输出端口（如 Kafka 消费者、文件读取） |
| **Flow** | 一个输入 + 一个输出 | 转换器，接收输入、处理后输出 |
| **Sink** | 一个输入 | 数据终点，只有输入端口（如数据库写入、打印输出） |

### 7.3 客服场景示例：消息处理流水线

```java
import akka.stream.javadsl.*;
import akka.NotUsed;

// 构建消息处理流水线
Source<UserMessage, NotUsed> source = Source.fromIterator(() -> messageQueue.iterator());

Flow<UserMessage, PreprocessedMessage, NotUsed> preprocessFlow =
    Flow.of(UserMessage.class).map(this::preprocess);

Flow<PreprocessedMessage, IntentMessage, NotUsed> intentFlow =
    Flow.of(PreprocessedMessage.class)
        .async()                         // 异步边界，并行处理
        .map(this::detectIntent);

Flow<IntentMessage, ReplyResult, NotUsed> replyFlow =
    Flow.of(IntentMessage.class)
        .async()
        .map(this::generateReply);

Sink<ReplyResult, NotUsed> sink = Sink.foreach(result ->
    sendReply(result.sessionId(), result.reply()));

// 运行流水线
source.via(preprocessFlow).via(intentFlow).via(replyFlow).to(sink).run(system);
```

### 7.4 背压机制

背压是 Akka Streams 的核心特性。当下游处理速度慢于上游生产速度时，系统会自动进行流量控制：

![Akka Streams流水线与背压机制](/ai-cs/ecosystem-tools/akka-introduction/akka-streams-pipeline.svg)

这比传统的"无限缓冲队列"方式安全得多——不会因为积压过多消息而导致 OOM。

---

## 八、Akka Cluster

### 8.1 为什么需要集群

单个 JVM 的 Actor 能力虽然强大，但在面对**水平扩展**需求时仍然不够。Akka Cluster 让多个 JVM 节点组成一个逻辑集群，Actor 可以跨节点通信，实现真正的分布式系统。

### 8.2 集群核心概念

| 概念 | 说明 |
|------|------|
| **Node（节点）** | 集群中的一个 JVM 实例，通过 IP:Port 标识 |
| **Cluster（集群）** | 多个 Node 组成的逻辑集群 |
| **Seed Node（种子节点）** | 集群启动时最先加入的节点，其他节点通过它加入集群 |
| **Gossip 协议** | 节点间通过 Gossip 协议传播集群状态（谁加入了、谁离开了） |
| **Sharding（分片）** | 将大量同类型 Actor 分散到不同节点上，实现负载均衡 |

### 8.3 集群角色与客服场景

![Akka Cluster与Sharding总览](/ai-cs/ecosystem-tools/akka-introduction/cluster-sharding-overview.svg)

在 AI 客服系统中，典型的集群部署方案：

- **Gateway 节点**：接收用户 WebSocket 连接，将消息路由到对应的 Session Actor
- **Session Worker 节点**：运行 Session Actor，处理会话逻辑
- **Model Gateway 节点**：统一管理 LLM API 调用，做限流和负载均衡

### 8.4 Cluster Sharding

当系统中有数百万个 Session Actor 时，不可能全部放在一个节点上。Cluster Sharding 自动将 Actor 分散到集群各节点：

```java
import akka.cluster.sharding.ClusterSharding;
import akka.cluster.sharding.ClusterShardingSettings;
import akka.cluster.sharding.ShardRegion;

// 定义分片规则
ShardRegion.MessageExtractor messageExtractor = new ShardRegion.MessageExtractor() {
    @Override
    public String entityId(Object message) {
        if (message instanceof SessionMessage msg) {
            return msg.sessionId();
        }
        return null;
    }

    @Override
    public Object entityMessage(Object message) {
        return message;
    }

    @Override
    public String shardId(Object message) {
        if (message instanceof SessionMessage msg) {
            return String.valueOf(Math.abs(msg.sessionId().hashCode()) % 100);
        }
        return null;
    }
};

// 启动分片
ActorRef sessionShardRegion = ClusterSharding.get(system).start(
    "Session",
    SessionActor.props(),
    ClusterShardingSettings.create(system),
    messageExtractor
);

// 发送消息——Akka 自动路由到正确的节点和 Actor
sessionShardRegion.tell(new SessionMessage("session-001", "你好"), ActorRef.noSender());
```

Sharding 的核心逻辑：

1. 每个 Session 有一个 `entityId`（会话 ID）
2. `extractShardId` 将 entityId 映射到某个 Shard（分片）
3. 每个 Shard 被分配到集群中的某个节点
4. 当节点宕机时，Shard 自动迁移到其他节点

---

## 九、Akka Persistence

### 9.1 事件溯源（Event Sourcing）

Akka Persistence 提供了事件溯源能力——Actor 的状态变化不是直接更新数据库，而是**追加写入**一条条不可变的事件。Actor 的当前状态可以通过重放事件来恢复。

![传统方式 vs 事件溯源](/ai-cs/ecosystem-tools/akka-introduction/event-sourcing-comparison.svg)

### 9.2 Persistent Actor

```java
import akka.persistence.AbstractPersistentActor;

public record AddMessage(String sessionId, String message) {}
public record MessageAdded(String sessionId, String message) {}  // 事件

public class SessionPersistentActor extends AbstractPersistentActor {
    private final String sessionId;
    private final List<String> messages = new ArrayList<>();

    public SessionPersistentActor(String sessionId) {
        this.sessionId = sessionId;
    }

    @Override
    public String persistenceId() {
        return "session-" + sessionId;
    }

    @Override
    public Receive createReceiveRecover() {
        return receiveBuilder()
            .match(MessageAdded.class, evt -> messages.add(evt.message()))  // 重放事件，恢复状态
            .build();
    }

    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(AddMessage.class, cmd -> {
                // 先持久化事件，成功后再更新状态
                persist(new MessageAdded(cmd.sessionId(), cmd.message()), evt -> {
                    messages.add(evt.message());  // 事件持久化成功后更新内存状态
                    getSender().tell(Ack.getInstance(), getSelf());
                });
            })
            .match(GetMessages.class, msg ->
                getSender().tell(new ArrayList<>(messages), getSelf()))
            .build();
    }
}
```

### 9.3 客服场景中的应用

在 AI 客服系统中，会话历史是非常关键的数据。使用 Akka Persistence：

- **会话恢复**：Session Actor 重启后，通过重放事件恢复完整的对话历史
- **审计追踪**：事件日志天然是完整的操作记录，满足审计需求
- **时间旅行**：可以重放到任意历史时间点的状态，用于问题排查

---

## 十、实战入门：构建一个简易客服会话 Actor

下面通过一个完整的示例，将前面学到的概念串起来。

### 10.1 项目依赖

```xml
<!-- Maven pom.xml -->
<dependencies>
  <dependency>
    <groupId>com.typesafe.akka</groupId>
    <artifactId>akka-actor-typed_3</artifactId>
    <version>2.8.5</version>
  </dependency>
  <dependency>
    <groupId>com.typesafe.akka</groupId>
    <artifactId>akka-stream_3</artifactId>
    <version>2.8.5</version>
  </dependency>
</dependencies>
```

### 10.2 定义消息

```java
// 消息定义（不可变）
public interface SessionCommand {}

public record UserMessage(String sessionId, String text, long timestamp) implements SessionCommand {}
public record BotReply(String text, double confidence) implements SessionCommand {}
public record GetHistory(String sessionId) implements SessionCommand {}
public record EndSession(String sessionId) implements SessionCommand {}
```

### 10.3 实现 Session Actor

```java
import akka.actor.typed.ActorRef;
import akka.actor.typed.Behavior;
import akka.actor.typed.javadsl.AbstractBehavior;
import akka.actor.typed.javadsl.ActorContext;
import akka.actor.typed.javadsl.Behaviors;
import akka.actor.typed.javadsl.Receive;

import java.util.ArrayList;
import java.util.List;

public class SessionActor extends AbstractBehavior<SessionCommand> {

    // 创建 Actor 的工厂方法
    public static Behavior<SessionCommand> create(String sessionId) {
        return Behaviors.setup(ctx -> new SessionActor(ctx, sessionId));
    }

    private final String sessionId;
    private final List<String> messageHistory = new ArrayList<>();
    private final ActorRef<SessionCommand> modelGateway;  // 引用模型网关 Actor

    private SessionActor(ActorContext<SessionCommand> context, String sessionId) {
        super(context);
        this.sessionId = sessionId;
        // 获取模型网关的引用
        this.modelGateway = context.spawn(ModelGatewayActor.create(), "model-gateway");
        context.getLog().info("会话 Actor 已启动: {}", sessionId);
    }

    @Override
    public Receive<SessionCommand> createReceive() {
        return newReceiveBuilder()
            .onMessage(UserMessage.class, this::onUserMessage)
            .onMessage(GetHistory.class, this::onGetHistory)
            .onMessage(EndSession.class, this::onEndSession)
            .onMessage(BotReply.class, this::onBotReply)
            .build();
    }

    // 处理用户消息
    private Behavior<SessionCommand> onUserMessage(UserMessage msg) {
        messageHistory.add("[用户] " + msg.text());
        context.getLog().info("收到用户消息: {}", msg.text());

        // 将消息转发给模型网关处理
        modelGateway.tell(msg);
        return this;
    }

    // 处理模型回复
    private Behavior<SessionCommand> onBotReply(BotReply reply) {
        messageHistory.add("[客服] " + reply.text() + " (置信度: " + reply.confidence() + ")");
        context.getLog().info("生成回复: {}", reply.text());
        return this;
    }

    // 获取历史消息
    private Behavior<SessionCommand> onGetHistory(GetHistory msg) {
        // 回复请求方
        getContext().getSender().tell(new HistoryResponse(new ArrayList<>(messageHistory)));
        return this;
    }

    // 结束会话
    private Behavior<SessionCommand> onEndSession(EndSession msg) {
        context.getLog().info("会话结束: {}", sessionId);
        return Behaviors.stopped();  // 停止自身
    }
}
```

### 10.4 运行系统

```java
import akka.actor.typed.ActorSystem;

public class CustomerServiceApp {
    public static void main(String[] args) {
        // 创建 ActorSystem
        ActorSystem<SessionCommand> system = ActorSystem.create(
            SessionActor.create("session-001"),
            "ai-customer-service"
        );

        // 发送用户消息
        system.tell(new UserMessage("session-001", "你好，我想咨询退款流程", System.currentTimeMillis()));

        // 发送结束消息
        system.tell(new EndSession("session-001"));
    }
}
```

---

## 十一、Akka Typed（新 API）

Akka 2.6+ 引入了 **Akka Typed**（类型安全的 Actor API），解决了经典 API 的一个核心痛点——**消息类型不安全**。

### 11.1 Classic vs Typed

| 维度 | Classic API | Typed API |
|------|------------|-----------|
| 消息类型 | `Any`（无类型约束） | 泛型约束（如 `ActorRef[SessionCommand]`） |
| 编译期检查 | 无（运行时匹配） | 有（编译器保证类型安全） |
| Behavior 定义 | `receive` 块 | `Behaviors.setup` / `receive` 函数 |
| 推荐度 | 已废弃维护 | **推荐使用** |

### 11.2 Typed Actor 示例

```java
import akka.actor.typed.*;
import akka.actor.typed.javadsl.*;

// 定义消息协议（密封接口，编译器会检查穷尽性）
public sealed interface SessionCommand permits UserMessage, GetHistory, EndSession {}
public record UserMessage(String text, ActorRef<BotReply> replyTo) implements SessionCommand {}
public record GetHistory(ActorRef<HistoryResponse> replyTo) implements SessionCommand {}
public record EndSession() implements SessionCommand {}

public class SessionActor extends AbstractBehavior<SessionCommand> {
    private final String sessionId;
    private final List<String> messages = new ArrayList<>();

    public static Behavior<SessionCommand> create(String sessionId) {
        return Behaviors.setup(ctx -> new SessionActor(ctx, sessionId));
    }

    private SessionActor(ActorContext<SessionCommand> context, String sessionId) {
        super(context);
        this.sessionId = sessionId;
    }

    @Override
    public Receive<SessionCommand> createReceive() {
        return newReceiveBuilder()
            .onMessage(UserMessage.class, this::onUserMessage)
            .onMessage(GetHistory.class, this::onGetHistory)
            .onMessage(EndSession.class, this::onEndSession)
            .build();
    }

    private Behavior<SessionCommand> onUserMessage(UserMessage msg) {
        messages.add(msg.text());
        msg.replyTo().tell(new BotReply("收到你的消息: " + msg.text(), 0.95));  // 类型安全：只能发 BotReply
        return this;
    }

    private Behavior<SessionCommand> onGetHistory(GetHistory msg) {
        msg.replyTo().tell(new HistoryResponse(new ArrayList<>(messages)));
        return this;
    }

    private Behavior<SessionCommand> onEndSession(EndSession msg) {
        getContext().getLog().info("会话 {} 结束", sessionId);
        return Behaviors.stopped();
    }
}
```

Typed API 的最大好处是：**如果 `replyTo` 期望接收 `BotReply`，但你试图发送其他类型，编译器会直接报错**，而不是等到运行时才发现。

---

## 十二、最佳实践

### 12.1 消息设计

| 原则 | 说明 |
|------|------|
| **消息必须不可变** | 使用 `case class` + `val` 字段，永远不要传递可变对象 |
| **消息要小** | 大对象传输会增加序列化开销（特别是远程通信时） |
| **用密封 trait 约束消息类型** | Typed API 中用 `sealed trait` 让编译器检查穷尽性 |
| **不要用 String 做消息** | `"start"` 这种字符串消息无法被编译器检查，容易拼错 |

### 12.2 Actor 设计

| 原则 | 说明 |
|------|------|
| **Actor 粒度要适中** | 太细（每个字段一个 Actor）增加通信开销；太粗（整个系统一个 Actor）失去并发优势 |
| **不要在 Actor 中阻塞** | 阻塞会占用 Dispatcher 线程，导致其他 Actor 饥饿。耗时操作用 `pipeTo` 或单独的 Dispatcher |
| **Actor 之间不共享状态** | 这是 Actor 模型的基本原则，违反它等于回到锁地狱 |
| **合理使用 Ask** | 优先 Tell，只在必须等待结果时用 Ask，并设置合理的超时 |

### 12.3 避免阻塞操作

```java
// ❌ 错误：在 Actor 中直接阻塞
public class BadActor extends AbstractActor {
    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(Query.class, msg -> {
                QueryResult result = db.query(msg.sql());  // 阻塞调用！占住线程
                getSender().tell(result, getSelf());
            })
            .build();
    }
}

// ✅ 正确：使用 pipeTo 将 CompletableFuture 结果转为消息
import akka.pattern.Patterns;
import java.util.concurrent.CompletableFuture;

public class GoodActor extends AbstractActor {
    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(Query.class, msg -> {
                CompletableFuture<QueryResult> result = CompletableFuture
                    .supplyAsync(() -> db.query(msg.sql()), blockingExecutor);
                Patterns.pipe(result, getContext().getDispatcher()).to(getSender());
                // CompletableFuture 完成后自动发送结果给 sender
            })
            .build();
    }
}
```

### 12.4 容错设计

| 原则 | 说明 |
|------|------|
| **合理划分 Supervision 层级** | 每层只管自己能处理的故障，处理不了的就 Escalate |
| **区分可恢复和不可恢复异常** | 暂时性故障（网络抖动）用 Resume，状态损坏用 Restart |
| **设置重试上限** | 避免无限重启导致 CPU 空转（maxNrOfRetries + withinTimeRange） |
| **使用 Circuit Breaker** | 对外部调用（如 LLM API）使用熔断器，避免级联故障 |

### 12.5 性能调优

| 方面 | 建议 |
|------|------|
| **Dispatcher 选择** | 默认 `default-dispatcher` 适合 CPU 密集型；阻塞操作用 `blocking-dispatcher` 隔离 |
| **Mailbox 大小** | 默认无上限，生产环境建议设置 `mailbox-capacity` 防止 OOM |
| **批量处理** | 用 `Stash` 或自定义 Mailbox 实现消息批量处理，减少 Actor 切换开销 |
| **监控** | 使用 Akka 的 `instrumentation` 或 Lightbend Telemetry 监控 Actor 性能指标 |

---

## 十三、与竞品对比

| 框架 | 语言 | 并发模型 | 适合场景 | 学习曲线 |
|------|------|---------|---------|---------|
| **Akka** | Scala/Java | Actor 模型 | 高并发分布式系统、流处理 | 较陡 |
| **Erlang/OTP** | Erlang | Actor 模型 | 电信级高可用系统 | 陡（函数式+小众语言） |
| **Vert.x** | Java/Kotlin | 事件循环（Reactor） | 响应式 Web 应用 | 中等 |
| **Project Reactor** | Java | Reactive Streams | 响应式数据处理 | 中等 |
| **Spring WebFlux** | Java | Reactive（Netty） | 响应式 Web 服务 | 中等 |
| **Go goroutine** | Go | CSP 模型 | 通用高并发服务 | 低 |
| **Java Virtual Thread** | Java | 轻量级线程 | 通用高并发服务 | 低 |

Akka 的独特优势在于：**Actor 模型 + 位置透明性 + 完整的分布式工具链**（Cluster、Sharding、Persistence、Streams），形成了一套从单机到分布式的完整解决方案。

---

## 十四、Circuit Breaker（熔断器）

在分布式系统中，一个服务的故障可能像雪崩一样传导到上游，导致整个系统不可用。Akka 提供了内置的 **Circuit Breaker**（熔断器）来防止这种级联故障。

### 14.1 熔断器核心思想

熔断器的灵感来自电路保险丝——当电流过大时自动断开电路，保护电器设备。在软件系统中，当对下游服务的调用失败率超过阈值时，熔断器会"跳闸"，后续请求直接快速失败，不再等待超时。

![Circuit Breaker 状态机](/ai-cs/ecosystem-tools/akka-introduction/circuit-breaker-states.svg)

熔断器有三个状态：

| 状态 | 行为 | 说明 |
|------|------|------|
| **Closed（关闭）** | 正常放行请求 | 统计失败率，超过阈值则跳到 Open |
| **Open（打开）** | 快速失败，不调用下游 | 等待一段复位时间后进入 Half-Open |
| **Half-Open（半开）** | 放行少量试探请求 | 成功则回到 Closed，失败则回到 Open |

### 14.2 代码示例

```java
import akka.pattern.CircuitBreaker;
import java.time.Duration;
import java.util.concurrent.CompletionStage;

// 创建熔断器
CircuitBreaker breaker = new CircuitBreaker(
    system.getScheduler(),
    5,                          // 最多容忍 5 次失败
    Duration.ofSeconds(3),      // 调用超时时间
    Duration.ofSeconds(30),     // 复位等待时间
    system.dispatcher()
);

// 方式一：withCircuitBreaker（返回 CompletionStage）
CompletionStage<String> result = breaker.withCircuitBreaker(() ->
    Patterns.ask(modelGateway, new Query("你好"), timeout)
             .thenApply(obj -> (String) obj)
);

// 方式二：withSyncCircuitBreaker（同步调用）
String syncResult = breaker.withSyncCircuitBreaker(() -> externalService.call());

// 监听状态变化
breaker.onClose(() -> log.info("熔断器关闭，恢复正常"));
breaker.onOpen(() -> log.warning("熔断器打开，请求被熔断！"));
breaker.onHalfOpen(() -> log.info("熔断器半开，正在试探恢复"));
```

### 14.3 客服场景中的熔断实践

在 AI 客服系统中，LLM API 是最不稳定的下游依赖——可能因流量高峰、限流或模型维护而超时。典型的熔断配置：

```java
// 针对 LLM API 的熔断器
CircuitBreaker llmBreaker = new CircuitBreaker(
    system.getScheduler(),
    10,                         // 10 次失败后熔断
    Duration.ofSeconds(5),      // LLM 调用 5 秒超时
    Duration.ofSeconds(60),     // 60 秒后试探恢复
    system.dispatcher()
);

// 在 ModelGateway Actor 中使用
public class ModelGatewayActor extends AbstractActor {
    @Override
    public Receive createReceive() {
        return receiveBuilder()
            .match(Query.class, msg -> {
                ActorRef originalSender = getSender();
                llmBreaker.withCircuitBreaker(() -> llmClient.complete(msg.text()))
                    .whenComplete((reply, failure) -> {
                        if (failure == null) {
                            originalSender.tell(new BotReply(reply, 0.95), getSelf());
                        } else {
                            originalSender.tell(new BotReply("抱歉，服务暂时繁忙，请稍后重试", 0.0), getSelf());
                        }
                    });
            })
            .build();
    }
}
```

::: tip 熔断 vs 重试
熔断器和重试是互补的：**重试**处理偶发失败（网络抖动），**熔断**处理持续性故障（服务宕机）。重试加重试次数上限，达到上限后触发熔断，是最佳实践组合。
:::

---

## 十五、Routers（路由器）

当一个 Actor 的消息处理速度跟不上生产速度时，单靠一个 Actor 会成为瓶颈。**Router** 可以将消息分发到一组同类型的 Actor（Routees），实现并行处理和负载均衡。

### 15.1 Pool Router vs Group Router

Akka Typed 提供两种 Router：

| 类型 | 特点 | 适用场景 |
|------|------|---------|
| **Pool Router** | 自己创建并管理子 Actor（Routees），子 Actor 是本地 Actor | 简单的并行处理，不需跨节点 |
| **Group Router** | 不创建 Actor，而是通过 Receptionist 发现已注册的服务 Actor | 集群范围内的负载均衡 |

### 15.2 Pool Router 示例

```java
import akka.actor.typed.*;
import akka.actor.typed.javadsl.*;

// 定义 Worker
public class Worker extends AbstractBehavior<Worker.Command> {
    public sealed interface Command permits DoLog {}
    public record DoLog(String text) implements Command {}

    public static Behavior<Command> create() {
        return Behaviors.setup(Worker::new);
    }

    private Worker(ActorContext<Command> context) {
        super(context);
    }

    @Override
    public Receive<Command> createReceive() {
        return newReceiveBuilder()
            .onMessage(DoLog.class, msg -> {
                getContext().getLog().info("Worker 收到消息: {}", msg.text());
                return this;
            })
            .build();
    }
}

// 创建 Pool Router
import akka.actor.typed.javadsl.Routers;

Behavior<Worker.Command> pool = Routers.pool(
    4,                    // 4 个 Worker
    Worker.create()       // Worker 的 Behavior
).withRoundRobinRouting();  // 轮询路由

ActorRef<Worker.Command> routerRef = getContext().spawn(pool, "worker-pool");

// 发送消息——Router 自动分发给某个 Worker
routerRef.tell(new Worker.DoLog("处理消息1"));
routerRef.tell(new Worker.DoLog("处理消息2"));
routerRef.tell(new Worker.DoLog("处理消息3"));
routerRef.tell(new Worker.DoLog("处理消息4"));
// 4 条消息分别分给 4 个 Worker 并行处理
```

### 15.3 路由策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **Round-Robin（轮询）** | 按顺序依次分配 | 各 Worker 处理能力相近 |
| **Random（随机）** | 随机选择一个 Worker | 简单均匀分配 |
| **Consistent Hashing（一致性哈希）** | 根据消息内容的哈希值选择 Worker | 需要相同 key 的消息路由到同一 Worker |
| **Smallest Mailbox（最小邮箱）** | 选择消息队列最短的 Worker | 各消息处理耗时差异较大 |

### 15.4 Group Router 与集群感知

Group Router 结合 Receptionist 可以实现**集群感知路由**——消息自动分发到集群中任意节点上注册的 Worker：

```java
// Worker 在集群各节点上启动时注册自己
ServiceKey<Worker.Command> workerServiceKey =
    ServiceKey.create(Worker.Command.class, "worker-service");

getContext().getSystem().receptionist()
    .tell(Receptionist.register(workerServiceKey, getContext().getSelf()));

// Group Router 通过 ServiceKey 发现所有 Worker
Behavior<Worker.Command> group = Routers.group(workerServiceKey)
    .withRoundRobinRouting();

ActorRef<Worker.Command> groupRouter = getContext().spawn(group, "worker-group");

// 发送消息——自动路由到集群中任意节点的 Worker
groupRouter.tell(new Worker.DoLog("集群范围内处理"));
```

::: tip Pool vs Group 选择
- **Pool**：适合单节点并行，Router 自动管理 Worker 生命周期
- **Group**：适合集群级负载均衡，Worker 生命周期由各自节点管理，Router 只负责路由
:::

---

## 十六、FSM（有限状态机）

在实际业务中，很多 Actor 的行为会随状态变化而变化——比如一个客服会话有"等待中"、"对话中"、"转人工中"、"已结束"等状态。Akka 提供了 **FSM（Finite State Machine）** 支持，让 Actor 以状态机的方式组织行为。

### 16.1 FSM 核心概念

在 Akka Typed 中，FSM 通过**不同的 Behavior 表示不同的状态**，每次处理消息后返回下一个状态的 Behavior：

| 概念 | 说明 | 示例 |
|------|------|------|
| **State（状态）** | Actor 当前所处的行为模式 | Idle、Active、Flushing |
| **Data（状态数据）** | 随状态流转的内部数据 | 待发送的消息队列 |
| **Event（事件）** | 触发状态转换的消息 | Queue、Flush、Timeout |
| **Transition（转换）** | 从一个状态切换到另一个 | Idle → Active |

### 16.2 客服会话 FSM 示例

以 AI 客服会话为例，设计一个有状态的会话 Actor：

```java
import akka.actor.typed.*;
import akka.actor.typed.javadsl.*;
import java.time.Duration;

// 消息（事件）
public sealed interface SessionEvent permits UserMessage, BotReply, UserAway, UserReturn, SessionTimeout, EndSession {}
public record UserMessage(String text) implements SessionEvent {}
public record BotReply(String text, double confidence) implements SessionEvent {}
public record UserAway() implements SessionEvent {}
public record UserReturn() implements SessionEvent {}
public record SessionTimeout() implements SessionEvent {}
public record EndSession() implements SessionEvent {}

// 状态数据
public record SessionData(List<String> messages, long awaySince) {
    public SessionData addMessage(String msg) {
        return new SessionData(new ArrayList<>(messages) {{ add(msg); }}, awaySince);
    }
}

// 会话 FSM Actor
public class SessionFSM extends AbstractBehavior<SessionEvent> {

    private final String sessionId;

    // 初始状态：Idle（等待用户消息）
    public static Behavior<SessionEvent> create(String sessionId) {
        return Behaviors.setup(ctx -> new SessionFSM(ctx, sessionId))
            .narrow();  // 初始进入 idle
    }

    private SessionFSM(ActorContext<SessionEvent> context, String sessionId) {
        super(context);
        this.sessionId = sessionId;
        // 启动时进入 idle 状态
        getContext().getSelf().tell(new EnterIdle());
    }

    // Idle 状态：等待第一条消息
    private Behavior<SessionEvent> idle(SessionData data) {
        return Behaviors.receiveMessage()
            .onMessage(UserMessage.class, msg ->
                // 收到消息，切换到 Active 状态
                active(data.addMessage("[用户] " + msg.text())))
            .onMessage(EndSession.class, msg -> Behaviors.stopped())
            .build();
    }

    // Active 状态：正在对话
    private Behavior<SessionEvent> active(SessionData data) {
        return Behaviors.withTimers(timers -> {
            // 启动空闲超时计时器
            timers.startSingleTimer(SessionTimeout.class, new SessionTimeout(), Duration.ofMinutes(5));

            return Behaviors.receiveMessage()
                .onMessage(UserMessage.class, msg -> {
                    timers.startSingleTimer(SessionTimeout.class, new SessionTimeout(), Duration.ofMinutes(5));
                    return active(data.addMessage("[用户] " + msg.text()));
                })
                .onMessage(BotReply.class, msg ->
                    active(data.addMessage("[客服] " + msg.text())))
                .onMessage(UserAway.class, msg ->
                    // 用户离开，切换到 Away 状态
                    away(new SessionData(data.messages(), System.currentTimeMillis())))
                .onMessage(SessionTimeout.class, msg ->
                    // 超时自动结束
                    Behaviors.stopped())
                .onMessage(EndSession.class, msg -> Behaviors.stopped())
                .build();
        });
    }

    // Away 状态：用户暂时离开
    private Behavior<SessionEvent> away(SessionData data) {
        return Behaviors.withTimers(timers -> {
            timers.startSingleTimer(SessionTimeout.class, new SessionTimeout(), Duration.ofMinutes(30));

            return Behaviors.receiveMessage()
                .onMessage(UserReturn.class, msg ->
                    // 用户回来，切回 Active
                    active(data))
                .onMessage(SessionTimeout.class, msg -> Behaviors.stopped())
                .onMessage(EndSession.class, msg -> Behaviors.stopped())
                .build();
        });
    }

    // 内部消息：进入 Idle 状态
    private record EnterIdle() implements SessionEvent {}

    @Override
    public Receive<SessionEvent> createReceive() {
        return newReceiveBuilder()
            .onMessage(EnterIdle.class, msg -> idle(new SessionData(List.of(), 0L)))
            .build();
    }
}
```

### 16.3 状态转换图

```text
                    ┌──────────┐
     UserMessage     │          │  EndSession / Timeout
    ───────────────→ │  Active  │ ───────────────→ [Stopped]
         ↑           │          │
         │           └────┬─────┘
         │                │ UserAway
         │                ↓
         │           ┌──────────┐
         │           │          │  Timeout (30min)
         │  UserReturn│   Away   │ ───────────────→ [Stopped]
         └───────────│          │
                     └──────────┘

    ┌──────────┐  UserMessage   ┌──────────┐
    │   Idle   │ ─────────────→ │  Active  │
    │ (初始)   │                 │ (对话中)  │
    └──────────┘                 └──────────┘
```

::: tip FSM vs if-else
当 Actor 只有 2-3 个简单状态时，用 `if-else` 就够了。但当状态超过 3 个、状态间转换复杂、需要状态超时或条件转换时，FSM 模式让代码更清晰、更可维护——每个状态的行为是独立的 Behavior，互不干扰。
:::

---

## 十七、Actor Discovery 与 Receptionist

在单机模式下，Actor 之间可以通过 `ActorRef` 直接通信。但在集群环境中，你往往不知道目标 Actor 在哪个节点上。Akka Typed 引入了 **Receptionist**——一个集群范围内的**服务注册中心**。

### 17.1 Receptionist 核心概念

Receptionist 的工作方式类似服务发现：

| 操作 | 说明 |
|------|------|
| **Register** | Actor 启动时将自己注册到 Receptionist，关联一个 `ServiceKey` |
| **Find** | 其他 Actor 通过 `ServiceKey` 查询已注册的 Actor |
| **Subscribe** | 订阅服务变化通知，当有 Actor 注册/注销时收到更新 |

```scala
import akka.actor.typed.receptionist.*
import akka.actor.typed.ActorRef

// 定义 ServiceKey（类型安全的服务标识）
val ModelGatewayKey = ServiceKey[ModelCommand]("model-gateway")

// Worker Actor 启动时注册自己
class ModelGatewayActor extends AbstractBehavior[ModelCommand](context) {
  override def onMessage(msg: ModelCommand): Behavior[ModelCommand] = {
    // 注册到 Receptionist
    context.system.receptionist ! Receptionist.Register(ModelGatewayKey, context.self)
    // ...处理消息
    this
  }
}

// 客户端通过 Receptionist 查找服务
class SessionActor extends AbstractBehavior[SessionCommand](context) {
  // 订阅服务变化
  context.system.receptionist ! Receptionist.Subscribe(ModelGatewayKey, serviceKeyUpdate)

  private def serviceKeyUpdate(listing: Receptionist.Listing): Behavior[SessionCommand] = {
    val gateways: Set[ActorRef[ModelCommand]] = listing.serviceInstances(ModelGatewayKey)
    // 保存可用的 ModelGateway 引用
    this
  }
}
```

### 17.2 Receptionist 在集群中的价值

| 优势 | 说明 |
|------|------|
| **动态发现** | 新节点加入集群后，其上的 Actor 自动注册到 Receptionist，其他节点立即可见 |
| **自动剔除** | 节点宕机或 Actor 停止后，Receptionist 自动移除对应条目 |
| **类型安全** | `ServiceKey` 携带消息类型，编译器保证消息类型匹配 |
| **无单点** | Receptionist 基于 Gossip 协议在集群间同步，没有中心化注册中心 |

### 17.3 客服系统中的服务发现

在 AI 客服系统的集群部署中，Receptionist 可以实现以下服务发现：

```text
┌─────────────┐         ┌──────────────┐
│  Gateway    │         │  Receptionist │
│  Node       │ Find    │  (Cluster     │
│             │────────→│   Wide)       │
│  Session    │         └──────┬───────┘
│  Actors     │                │
└─────────────┘                │ Register
                    ┌───────────┼───────────┐
                    │           │           │
              ┌─────┴──┐  ┌─────┴──┐  ┌─────┴──┐
              │Worker 1 │  │Worker 2 │  │Worker 3 │
              │(Node A) │  │(Node B) │  │(Node C) │
              └─────────┘  └─────────┘  └─────────┘
```

- **Session Actor** 注册到 Receptionist，Gateway 节点可以动态发现任意节点上的会话
- **Model Gateway** 注册到 Receptionist，Session Actor 可以找到可用的模型网关
- **Knowledge Base Worker** 注册到 Receptionist，实现知识库查询的负载均衡

---

## 十八、Akka 生态模块总览

Akka 不只是一个 Actor 框架，而是一个完整的**响应式应用工具包**。除了前面介绍的核心模块，Akka 生态还包含大量配套工具：

### 18.1 模块全景

| 模块 | 功能 | 客服系统场景 |
|------|------|------------|
| **Akka Actor** | Actor 模型核心 | 会话管理、消息路由 |
| **Akka Streams** | 流处理 + 背压 | LLM 流式输出处理 |
| **Akka Cluster** | 集群管理 | 多节点会话分布 |
| **Akka Cluster Sharding** | Actor 分片 | 数百万会话的水平扩展 |
| **Akka Persistence** | 事件溯源 | 会话历史持久化与恢复 |
| **Akka HTTP** | HTTP/WebSocket 服务 | 客服 WebSocket 接入层 |
| **Akka gRPC** | gRPC 服务 | 微服务间通信 |
| **Akka Connectors** (Alpakka) | 外部系统集成 | Kafka、MQ、AWS 等对接 |
| **Akka Projections** | CQRS 读模型构建 | 从事件流构建查询视图 |
| **Akka Management** | 运维管理 | 集群健康检查、滚动升级 |
| **Akka Discovery** | 服务发现 | K8s/DNS 服务发现 |
| **Akka Split Brain Resolver** | 脑裂处理 | 集群网络分区恢复 |

### 18.2 关键模块详解

**Akka HTTP** —— 构建接入层

Akka HTTP 是基于 Akka Streams 构建的 HTTP 服务器/客户端，非常适合做 WebSocket 接入层：

```scala
import akka.http.scaladsl.Http
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.model.ws.{TextMessage, Message}

// WebSocket 会话路由
val route = path("chat" / Segment) { sessionId =>
  handleWebSocketMessages {
    // 将 WebSocket 消息转发给对应的 Session Actor
    Flow[Message].collect {
      case TextMessage.Strict(text) =>
        sessionRegion ! SessionMessage(sessionId, text)
        TextMessage("已收到您的消息")
    }
  }
}

Http().newServerAt("0.0.0.0", 8080).bind(route)
```

**Akka Connectors (Alpakka)** —— 外部系统集成

Alpakka 提供了 70+ 连接器，集成了 Kafka、MQTT、AWS S3、Elasticsearch、MongoDB 等：

```scala
import akka.stream.alpakka.kafka.scaladsl.*
import akka.stream.alpakka.kafka.*

// Kafka 消费者 → Session Actor
val kafkaConsumer: Source[CommittableMessage[String, String], _] =
  Consumer.committableSource(consumerSettings, Subscriptions.topics("user-messages"))

kafkaConsumer
  .map { msg =>
    val record = msg.record
    sessionRegion ! SessionMessage(record.key, record.value)
    msg.committableOffset
  }
  .batch(max = 100, first => CommittableOffsetBatch(first)) { (batch, offset) =>
    batch.updated(offset)
  }
  .mapAsync(1)(_.commitScaladsl())
  .run()
```

**Akka Projections** —— CQRS 读模型

当你使用事件溯源持久化会话数据后，需要一个机制将事件流转化为可查询的视图（如"最近 24 小时的会话统计"）。Akka Projections 就是做这件事的：

```scala
import akka.projection.scaladsl.*
import akka.projection.eventsourced.EventEnvelope

// 定义投影：将会话事件转化为统计读模型
val projection = SourceProvider[Offset, EventEnvelope[SessionEvent]](
  sessionEventSource
)

ProjectionHandler
  .atLeastOnce[EventEnvelope[SessionEvent]](
    projectionId = ProjectionId("session-stats", "daily"),
    sourceProvider = projection,
    handler = () => new SessionStatsHandler()
  )
```

### 18.3 Split Brain Resolver

在集群环境中，网络分区可能导致"脑裂"——两个子集群各自认为对方已死，各自选举 Leader，导致数据不一致。Split Brain Resolver 提供了自动处理策略：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **Static Quorum** | 节点数少于法定多数时自动 down 自己 | 固定节点数量的集群 |
| **Keep Majority** | 保留节点数多的子集群，down 少的 | 动态节点集群 |
| **Lease** | 通过外部锁（如 K8s lease）决定 | K8s 环境 |
| **Keep Oldest** | 保留最老的节点 | 有状态的单例节点保护 |

---

## 十九、Akka 测试策略

Actor 是异步的、消息驱动的，传统的单元测试方法不能直接套用。Akka 提供了专门的测试工具包。

### 19.1 TestKit

Akka Typed 的 `ActorTestKit` 提供了一套测试 Actor 的工具：

```scala
import akka.actor.testkit.typed.scaladsl.*
import org.scalatest.wordspec.AnyWordSpecLike

class SessionActorSpec extends ScalaTestWithActorTestKit with AnyWordSpecLike {

  "SessionActor" must {

    "回复用户消息" in {
      // 创建测试探针（TestProbe），用于接收和断言消息
      val probe = createTestProbe[BotReply]()
      val session = spawn(SessionActor("session-001"))

      // 发送消息，指定回复方为 probe
      session ! UserMessage("你好", probe.ref)

      // 断言收到了正确的回复
      probe.expectMessage(BotReply("收到你的消息: 你好", 0.95))
    }

    "在结束时停止自身" in {
      val session = spawn(SessionActor("session-002"))
      session ! EndSession

      // 断言 Actor 已停止
      createTestProbe().expectTerminated(session)
    }

    "获取历史消息" in {
      val replyProbe = createTestProbe[HistoryResponse]()
      val session = spawn(SessionActor("session-003"))

      session ! UserMessage("消息1", createTestProbe[BotReply]().ref)
      session ! UserMessage("消息2", createTestProbe[BotReply]().ref)
      session ! GetHistory(replyProbe.ref)

      // 断言历史消息正确
      val response = replyProbe.receiveMessage()
      response.messages should have size 2
      response.messages should contain("[用户] 消息1")
    }
  }
}
```

### 19.2 测试技巧

| 技巧 | 说明 | 示例 |
|------|------|------|
| **TestProbe** | 模拟 Actor，接收并断言消息 | `probe.expectMessage(...)` |
| **expectNoMessage** | 断言在指定时间内没有收到消息 | `probe.expectNoMessage(100.millis)` |
| **fishForMessage** | 在时间窗口内"钓鱼"等待特定消息 | `probe.fishForMessage(3.seconds) { case ... => }` |
| **Behaviors.testable** | 让 Actor 的行为可测试 | 返回 `Effect` 而非直接执行副作用 |
| **手动调度控制** | 使用 `ManualTime` 控制 Scheduler | 避免测试中的时间等待 |

### 19.3 测试原则

```scala
// ❌ 错误：在测试中使用 Thread.sleep 等待异步结果
session ! UserMessage("hello", probe.ref)
Thread.sleep(1000)  // 不可靠！
probe.expectMessage(BotReply("...", 0.95))

// ✅ 正确：使用 TestKit 的断言方法，它会自动等待
session ! UserMessage("hello", probe.ref)
probe.expectMessage(3.seconds, BotReply("...", 0.95))  // 最多等 3 秒
```

::: tip 测试覆盖率建议
- 每种消息类型至少有一个测试用例
- 测试 Actor 的状态转换（特别是 FSM Actor 的各状态流转）
- 测试容错行为（注入异常，验证 Supervision 策略是否正确执行）
- 测试边界条件（空邮箱、超时、并发消息）
:::

---

## 二十、Akka 许可证变更与 Apache Pekko

### 20.1 许可证变更事件

2022 年 9 月，Akka 的母公司 Lightbend 宣布将 Akka 的许可证从 **Apache 2.0** 变更为 **Business Source License (BSL 1.1)**。这一变更的影响：

| 方面 | 变更前（Apache 2.0） | 变更后（BSL 1.1） |
|------|--------------------|--------------------|
| **源码开放** | ✅ 是 | ✅ 是（源码仍然开放） |
| **生产免费使用** | ✅ 是 | ❌ 否（需购买商业许可） |
| **非生产使用** | ✅ 免费使用 | ✅ 免费使用（开发、测试、教育） |
| **修改和分发** | ✅ 自由 | ❌ 受限 |
| **变更生效版本** | — | Akka 2.7+（2022 年 9 月后） |
| **旧版本** | — | Akka 2.6.x 及更早版本仍为 Apache 2.0 |

### 20.2 Apache Pekko 的诞生

作为对许可证变更的回应，社区基于 Akka 2.6.x（最后一个 Apache 2.0 版本）创建了 **Apache Pekko** ——一个完全开源的 Akka 分支。

| 维度 | Akka（Lightbend） | Apache Pekko |
|------|-------------------|--------------|
| **许可证** | BSL 1.1（生产需付费） | Apache 2.0（完全免费） |
| **维护方** | Lightbend Inc. | Apache 软件基金会 |
| **初始版本** | 2.6.x 分叉 | 1.0.0（2023 年） |
| **当前版本** | 2.8.x+ | 1.6.x |
| **API 兼容性** | — | 与 Akka 2.6.x 高度兼容 |
| **模块覆盖** | 全套模块 | 核心模块 + HTTP + gRPC + Connectors + Persistence 插件 |
| **社区活跃度** | 活跃（商业驱动） | 活跃（社区驱动，持续增长） |

### 20.3 如何选择

| 场景 | 推荐 | 理由 |
|------|------|------|
| **新项目，预算有限** | Apache Pekko | 完全免费，API 兼容，社区活跃 |
| **新项目，有商业预算** | Akka | 有商业支持和 SLA 保障 |
| **已有 Akka 2.6.x 项目** | 评估迁移到 Pekko | 避免未来 BSL 许可证限制 |
| **已有 Akka 2.7+ 项目** | 保持 Akka | 已有商业许可，迁移成本可能较高 |
| **学习与研究** | Apache Pekko | 免费、开源、文档完善 |

### 20.4 迁移指南

从 Akka 2.6.x 迁移到 Apache Pekko 的主要步骤：

```xml
<!-- Akka 依赖（BSL 许可证） -->
<!--
<dependency>
  <groupId>com.typesafe.akka</groupId>
  <artifactId>akka-actor-typed_2.13</artifactId>
  <version>2.6.20</version>
</dependency>
-->

<!-- 替换为 Apache Pekko 依赖 -->
<dependency>
  <groupId>org.apache.pekko</groupId>
  <artifactId>pekko-actor-typed_2.13</artifactId>
  <version>1.6.0</version>
</dependency>
```

代码层面的改动主要是**包名替换**：`akka.` → `org.apache.pekko.`，大部分 API 保持一致。Pekko 官方提供了详细的迁移指南和自动化工具辅助迁移。

::: warning 决策建议
如果你正在启动一个新的 AI 客服系统项目，**强烈建议评估 Apache Pekko**。它提供了与 Akka 2.6.x 几乎完全相同的功能集，且完全免费开源。只有在需要 Lightbend 商业支持或 Akka 2.7+ 独有特性时，才需要考虑商业版 Akka。
:::

---

## 总结

Akka 并非银弹，但在以下场景中它的价值尤为突出：

- **海量并发会话**：AI 客服系统中数万级在线会话，Actor 模型提供了极低资源消耗的并发方案
- **状态隔离需求**：每个会话的上下文天然隔离，一个会话崩溃不影响全局
- **弹性扩展**：Cluster Sharding 让 Actor 在节点间自动分布和迁移，支持动态扩缩容
- **流式处理**：Akka Streams 的背压机制在处理 LLM 流式输出时非常有价值
- **事件溯源**：Persistence 支持会话历史恢复和审计追踪
- **容错弹性**：Supervision 策略 + Circuit Breaker 构建多层次的故障防护体系
- **服务发现**：Receptionist 实现集群范围内的动态服务注册与发现
- **状态管理**：FSM 模式让复杂会话状态（等待→对话→离开→结束）清晰可控
- **负载均衡**：Routers 将消息分发到多个 Worker，实现并行处理和水平扩展

对于 AI 客服系统来说，Akka 提供的不只是一个并发框架，而是一套**从会话管理到容错恢复、从单机处理到集群扩展、从服务发现到测试保障的完整工程方案**。理解 Actor 模型的思维方式——**不共享、只传消息、让它崩溃**——是掌握 Akka 的关键。

如果你正在从传统并发编程转向 Akka，最大的思维转变是：

1. **从"共享 + 锁"到"隔离 + 消息"** —— 不再担心竞态条件，因为状态不共享
2. **从"防御性编程"到"Let-It-Crash"** —— 不再到处 try-catch，而是让监督者处理故障
3. **从"同步调用"到"异步消息"** —— 不再等待返回值，而是通过消息驱动流程
4. **从"单机思维"到"分布式优先"** —— 位置透明性让你从设计之初就考虑分布式部署
5. **从"手工选型"到"生态整合"** —— Akka/Pekko 提供了从 HTTP 到 Persistence 的全栈工具链

---

## 延伸阅读

### 官方资源

- [Akka 官方文档](https://doc.akka.io/) —— 最权威的参考，包含完整指南和 API 文档
- [Akka Quickstart](https://doc.akka.io/docs/akka/current/typed/actors.html) —— 快速上手 Typed Actor
- [Apache Pekko 官方文档](https://pekko.apache.org/docs/pekko/current/) —— 开源分支文档，与 Akka 2.6.x 高度兼容
- [Akka Samples（GitHub）](https://github.com/akka/akka-samples) —— 官方示例项目集，涵盖 Cluster、Persistence、Streams 等
- [Akka License FAQ](https://www.lightbend.com/akka/license-faq) —— BSL 许可证常见问题解答

### 理论基础

- [Actor Model 论文](https://arxiv.org/abs/1008.1459) —— Carl Hewitt 的 Actor 模型原始论文
- [Reactive Manifesto](https://www.reactivemanifesto.org/) —— 响应式系统宣言，Akka 的设计哲学源头
- [Let It Crash](https://www.erlang.org/doc/design_principles/des_princ.html) —— Erlang/OTP 的容错设计原则，Akka 的灵感来源

### 进阶主题

- [Akka Persistence 指南](https://doc.akka.io/docs/akka/current/typed/persistence.html) —— 事件溯源与持久化详解
- [Akka Cluster Sharding](https://doc.akka.io/docs/akka/current/typed/cluster-sharding.html) —— 大规模 Actor 分片方案
- [Akka Streams Cookbook](https://doc.akka.io/docs/akka/current/stream/stream-cookbook.html) —— 流处理实战技巧
- [Akka Projections](https://doc.akka.io/docs/akka-projection/current/) —— CQRS 读模型构建
- [Akka HTTP 指南](https://doc.akka.io/docs/akka-http/current/) —— 构建 HTTP/WebSocket 服务
- [Akka Connectors (Alpakka)](https://doc.akka.io/docs/alpakka/current/) —— 70+ 外部系统集成连接器

### 书籍推荐

- **《Akka in Action》** —— Raymond Roestenburg 等著，最经典的 Akka 实战书籍
- **《Akka Cookbook》** —— Packt 出版，覆盖常见场景的配方式指南
- **《Reactive Design Patterns》** —— Roland Kuhn 等著，响应式设计模式（含 Actor 模式）
- **《Designing for Scalability with Erlang/OTP》** —— Erlang/OTP 的设计思想，理解 Akka 的根源
