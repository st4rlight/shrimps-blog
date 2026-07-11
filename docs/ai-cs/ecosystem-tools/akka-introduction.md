---
title: Akka高并发系统介绍
tags:
  - Akka
  - Actor模型
  - 高并发
  - 分布式
  - 客服系统
excerpt: Akka 是基于 Actor 模型构建的高并发、分布式、容错消息驱动应用框架。本文从 Actor 模型理论基础出发，系统梳理 Akka 的核心概念、消息传递机制、容错策略、流处理与集群能力，并结合 AI 客服系统场景探讨其实践价值。
createTime: 2026/07/07 10:00:00
permalink: /ai-cs/akka-introduction/
---

# Akka高并发系统介绍

> 如果你在构建一个需要处理海量并发连接、要求高可用和弹性扩展的系统——比如一个同时服务数万在线会话的 AI 客服平台——那么传统的"一个请求一个线程"模型很快就会成为瓶颈。Akka 提供了一种截然不同的并发编程范式：**用 Actor 模型替代共享内存 + 锁**，用消息传递替代方法调用，用"让它崩溃"替代防御性编程。

[[TOC]]

---

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

```scala
// Akka 方式：Actor 封装状态，通过消息通信
class Counter extends Actor {
  var count = 0  // 私有状态，无需锁保护

  def receive = {
    case Increment => count += 1       // 一次只处理一条消息，天然线程安全
    case Get       => sender() ! count  // 异步回复
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

```scala
import akka.actor.ActorSystem

// 创建 ActorSystem
val system = ActorSystem("ai-customer-service")
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

```scala
// Scala：定义 Props
object SessionActor {
  def props(sessionId: String): Props = Props(new SessionActor(sessionId))
}

// 使用 Props 创建 Actor
val sessionRef = system.actorOf(SessionActor.props("session-001"), "session-001")
```

为什么要用 `Props` 而不直接 `new`？因为 Akka 需要：

- 在**远程节点**上创建 Actor 时，需要序列化创建逻辑
- 实现**位置透明性**——调用方不需要知道 Actor 在哪创建
- 统一管理 Actor 的**创建参数**和**调度策略**

### 3.4 ActorRef

`ActorRef` 是 Actor 的**引用**，是外部与 Actor 交互的唯一接口。你**永远拿不到** Actor 的实例对象，只能拿到 `ActorRef`：

```scala
// 创建 Actor，返回 ActorRef（不是 Actor 实例）
val sessionRef: ActorRef = system.actorOf(SessionActor.props("session-001"), "session-001")

// 通过 ActorRef 发送消息
sessionRef ! UserMessage("你好，我需要帮助")  // tell 模式
sessionRef.tell(UserMessage("你好"), ActorRef.noSender())  // Java 风格
```

`ActorRef` 的好处：

- **位置透明**：本地 Actor 和远程 Actor 的 `ActorRef` 接口完全一致
- **生命周期解耦**：Actor 重启后 `ActorRef` 不变，外部无感知
- **安全**：外部无法直接操作 Actor 内部状态

### 3.5 Message

消息是 Actor 之间通信的唯一方式。消息是**不可变对象**（immutable），通常用 case class（Scala）或 POJO（Java）定义：

```scala
// 不可变消息定义
case class UserMessage(text: String, timestamp: Long)
case class BotReply(text: String, confidence: Double)
case object GetHistory
case class EndSession(sessionId: String)
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

```scala
// Tell 模式：发后即忘
sessionRef ! UserMessage("你好")

// 等价于
sessionRef.tell(UserMessage("你好"), ActorRef.noSender())
```

`tell` 的第二个参数是**发送方引用**（`sender`），接收方可以通过 `sender()` 获取并回复。传入 `noSender()` 表示不需要回复。

### 4.2 Ask（Request-Response）

`ask`（Scala 中写作 `?`）用于需要等待回复的场景，返回一个 `Future`：

```scala
import akka.pattern.ask
import scala.concurrent.duration._
import scala.concurrent.Await

// Ask 模式：等待回复
implicit val timeout: Timeout = 3.seconds

val future: Future[List[String]] = (sessionRef ? GetHistory).mapTo[List[String]]

// 异步处理回复
future.onComplete {
  case Success(history) => println(s"历史消息: $history")
  case Failure(e)       => println(s"获取失败: ${e.getMessage}")
}
```

::: tip Tell vs Ask
**优先使用 Tell**。Ask 本质上也是通过 Tell 实现的——Akka 会创建一个临时 Actor 来接收回复，并完成对应的 Future。过度使用 Ask 会导致大量临时 Actor，增加开销。Ask 适合"必须拿到结果才能继续"的场景。
:::

### 4.3 Forward

`forward` 将消息转发给另一个 Actor，同时保持原始发送者不变：

```scala
class RouterActor extends Actor {
  val workerRef = context.actorOf(WorkerActor.props(), "worker")

  def receive = {
    case msg: ProcessRequest =>
      workerRef.forward(msg)  // 转发，sender 仍是原始发送者
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

```scala
class DbSessionActor extends Actor {
  private var connection: Connection = _

  override def preStart(): Unit = {
    connection = DriverManager.getConnection(url)  // 初始化数据库连接
    log.info("数据库连接已建立")
  }

  override def postStop(): Unit = {
    if (connection != null) connection.close()  // 释放连接
    log.info("数据库连接已关闭")
  }

  override def preRestart(reason: Throwable, message: Option[Any]): Unit = {
    // 重启前保存状态（可选）
    log.warning(s"Actor 即将重启，原因: ${reason.getMessage}")
    super.preRestart(reason, message)  // 默认会调用 postStop
  }

  def receive = {
    case Query(sql) => // ...
  }
}
```

### 5.3 停止 Actor

停止 Actor 有三种方式：

```scala
// 方式一：Actor 自己停止
context.stop(self)

// 方式二：父 Actor 停止子 Actor
context.stop(childRef)

// 方式三：通过 PoisonPill 毒丸消息（Actor 处理完当前消息后停止）
childRef ! PoisonPill

// 方式四：通过 gracefulStop 优雅停止（等待超时）
import akka.pattern.gracefulStop
val stopped: Future[Boolean] = gracefulStop(childRef, 5.seconds)
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

```scala
import akka.actor.OneForOneStrategy
import akka.actor.SupervisorStrategy._
import scala.concurrent.duration._

// OneForOne：只对出错的子 Actor 执行策略
override val supervisorStrategy = OneForOneStrategy(
  maxNrOfRetries = 3,        // 最大重试次数
  withinTimeRange = 1.minute // 时间窗口
) {
  case _: ArithmeticException      => Resume   // 算术异常：恢复
  case _: NullPointerException     => Restart  // 空指针：重启
  case _: IllegalArgumentException => Stop     // 非法参数：停止
  case _: Exception                => Escalate // 其他：上报
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

```scala
import akka.stream.scaladsl._
import akka.stream._

// 构建消息处理流水线
val pipeline: RunnableGraph[NotUsed] =
  Source.fromIterator(() => messageQueue.iterator())       // Source：消息队列
    .via(Flow[UserMessage]                                 // Flow 1：预处理
      .map(msg => preprocess(msg)))
    .via(Flow[PreprocessedMessage]                         // Flow 2：意图识别
      .async                                              // 异步边界，并行处理
      .map(msg => detectIntent(msg)))
    .via(Flow[IntentMessage]                              // Flow 3：生成回复
      .async
      .map(msg => generateReply(msg)))
    .to(Sink.foreach[(String, String)] {                  // Sink：发送回复
      case (sessionId, reply) => sendReply(sessionId, reply)
    })

// 运行流水线
pipeline.run()
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

```scala
import akka.cluster.sharding.ShardRegion
import akka.cluster.sharding.ClusterSharding

// 定义分片规则
val extractEntityId: ShardRegion.ExtractEntityId = {
  case msg @ SessionMessage(sessionId, _) => (sessionId, msg)
}

val extractShardId: ShardRegion.ExtractShardId = {
  case SessionMessage(sessionId, _) => (Math.abs(sessionId.hashCode) % 100).toString
}

// 启动分片
val sessionShardRegion = ClusterSharding(system).start(
  typeName = "Session",
  entityProps = SessionActor.props(),
  settings = ClusterShardingSettings(system),
  extractEntityId = extractEntityId,
  extractShardId = extractShardId
)

// 发送消息——Akka 自动路由到正确的节点和 Actor
sessionShardRegion ! SessionMessage("session-001", "你好")
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

```scala
import akka.persistence.PersistentActor

case class AddMessage(sessionId: String, message: String)
case class MessageAdded(sessionId: String, message: String)  // 事件

class SessionPersistentActor(sessionId: String) extends PersistentActor {

  override def persistenceId: String = s"session-$sessionId"

  var messages: List[String] = List.empty

  override def receiveCommand: Receive = {
    case AddMessage(sid, msg) =>
      // 先持久化事件，成功后再更新状态
      persist(MessageAdded(sid, msg)) { event =>
        messages = messages :+ msg  // 事件持久化成功后更新内存状态
        sender() ! Ack
      }

    case GetMessages =>
      sender() ! messages
  }

  override def receiveRecover: Receive = {
    case MessageAdded(_, msg) =>
      messages = messages :+ msg  // 重放事件，恢复状态
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

```scala
import akka.actor.typed.*
import akka.actor.typed.scaladsl.*

// 定义消息协议（密封 trait，编译器会检查穷尽性）
sealed trait SessionCommand
case class UserMessage(text: String, replyTo: ActorRef[BotReply]) extends SessionCommand
case class GetHistory(replyTo: ActorRef[HistoryResponse]) extends SessionCommand
case object EndSession extends SessionCommand

object SessionActor {
  // 类型安全的 Behavior
  def apply(sessionId: String): Behavior[SessionCommand] = Behaviors.setup { context =>
    var messages: List[String] = Nil

    Behaviors.receiveMessage {
      case UserMessage(text, replyTo) =>
        messages = messages :+ text
        replyTo ! BotReply(s"收到你的消息: $text", 0.95)  // 类型安全：只能发 BotReply
        Behaviors.same

      case GetHistory(replyTo) =>
        replyTo ! HistoryResponse(messages)
        Behaviors.same

      case EndSession =>
        context.log.info(s"会话 $sessionId 结束")
        Behaviors.stopped
    }
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

```scala
// ❌ 错误：在 Actor 中直接阻塞
class BadActor extends Actor {
  def receive = {
    case Query(sql) =>
      val result = db.query(sql)  // 阻塞调用！占住线程
      sender() ! result
  }
}

// ✅ 正确：使用 pipeTo 将 Future 结果转为消息
import akka.pattern.pipe

class GoodActor extends Actor {
  def receive = {
    case Query(sql) =>
      val result: Future[QueryResult] = Future { db.query(sql) }(blockingDispatcher)
      result.pipeTo(sender())  // Future 完成后自动发送结果给 sender
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

## 总结

Akka 并非银弹，但在以下场景中它的价值尤为突出：

- **海量并发会话**：AI 客服系统中数万级在线会话，Actor 模型提供了极低资源消耗的并发方案
- **状态隔离需求**：每个会话的上下文天然隔离，一个会话崩溃不影响全局
- **弹性扩展**：Cluster Sharding 让 Actor 在节点间自动分布和迁移，支持动态扩缩容
- **流式处理**：Akka Streams 的背压机制在处理 LLM 流式输出时非常有价值
- **事件溯源**：Persistence 支持会话历史恢复和审计追踪

对于 AI 客服系统来说，Akka 提供的不只是一个并发框架，而是一套**从会话管理到容错恢复、从单机处理到集群扩展的完整工程方案**。理解 Actor 模型的思维方式——**不共享、只传消息、让它崩溃**——是掌握 Akka 的关键。

如果你正在从传统并发编程转向 Akka，最大的思维转变是：

1. **从"共享 + 锁"到"隔离 + 消息"** —— 不再担心竞态条件，因为状态不共享
2. **从"防御性编程"到"Let-It-Crash"** —— 不再到处 try-catch，而是让监督者处理故障
3. **从"同步调用"到"异步消息"** —— 不再等待返回值，而是通过消息驱动流程

---

## 延伸阅读

- [Akka 官方文档](https://doc.akka.io/) —— 最权威的参考，包含完整指南和 API 文档
- [Akka Quickstart](https://doc.akka.io/docs/akka/current/typed/actors.html) —— 快速上手 Typed Actor
- [Actor Model 论文](https://arxiv.org/abs/1008.1459) —— Carl Hewitt 的 Actor 模型原始论文
- [Reactive Manifesto](https://www.reactivemanifesto.org/) —— 响应式系统宣言，Akka 的设计哲学源头
- [Let It Crash](https://www.erlang.org/doc/design_principles/des_princ.html) —— Erlang/OTP 的容错设计原则，Akka 的灵感来源
