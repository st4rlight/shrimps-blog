---
title: Java线程同步方案
tags:
  - Java
  - 多线程
  - 线程同步
excerpt: 系统梳理 Java 中常见的线程同步方案，从内置关键字到 JUC 工具类，厘清各自的适用场景与使用注意事项。
createTime: 2026/05/28 10:00:00
permalink: /notes/java-thread-synchronization/
---

# Java线程同步方案

> 多线程编程中，"同步"的核心诉求是：保证共享资源在并发访问下的正确性与一致性。

[[TOC]]

---

## 为什么需要线程同步

当多个线程同时访问共享可变资源时，如果没有合理的同步机制，就会出现：

- **竞态条件（Race Condition）**：结果依赖线程执行顺序
- **数据不一致**：一个线程的修改对另一个线程不可见
- **指令重排序**：编译器或处理器优化导致执行顺序与代码顺序不一致

Java 提供了从轻量到重量级的多种同步方案，适用于不同场景。

---

## synchronized 与 Object wait/notify

`synchronized` 是 Java 内置的同步机制，基于 Monitor 实现。配合 `Object` 的 `wait()`、`notify()`、`notifyAll()` 可实现线程间通信。

### synchronized 用法

```java
// 1. 同步实例方法 —— 锁的是当前实例对象
public synchronized void method() {
    // 临界区
}

// 2. 同步静态方法 —— 锁的是当前类的 Class 对象
public static synchronized void staticMethod() {
    // 临界区
}

// 3. 同步代码块 —— 锁的是指定对象
public void method() {
    synchronized (lockObj) {
        // 临界区
    }
}
```

### wait / notify / notifyAll

```java
private final Object lock = new Object();
private boolean conditionMet = false;

// 等待线程
public void waitForCondition() throws InterruptedException {
    synchronized (lock) {
        while (!conditionMet) {
            lock.wait(); // 释放锁并等待，被唤醒后重新竞争锁
        }
        // 条件满足，继续执行
    }
}

// 通知线程
public void signalCondition() {
    synchronized (lock) {
        conditionMet = true;
        lock.notify();  // 唤醒一个等待线程
        // lock.notifyAll(); // 唤醒所有等待线程
    }
}
```

**使用要点：**

| 要点 | 说明 |
|------|------|
| 必须在同步块中调用 | 否则抛 `IllegalMonitorStateException` |
| 用 while 而非 if 检查条件 | 防止虚假唤醒（spurious wakeup） |
| notify vs notifyAll | `notify` 只唤醒一个线程，`notifyAll` 更安全 |
| wait 释放锁 | 调用 `wait()` 后当前线程释放锁并进入等待集 |
| 被唤醒后重新竞争锁 | 从 `wait()` 返回不代表立刻持有锁，需重新竞争 |

**经典示例：生产者-消费者**

```java
private final List<String> buffer = new ArrayList<>();
private final int MAX_CAPACITY = 10;

// 生产者
public void produce(String item) throws InterruptedException {
    synchronized (buffer) {
        while (buffer.size() == MAX_CAPACITY) {
            buffer.wait(); // 缓冲区满，等待消费者消费
        }
        buffer.add(item);
        buffer.notifyAll(); // 通知消费者
    }
}

// 消费者
public String consume() throws InterruptedException {
    synchronized (buffer) {
        while (buffer.isEmpty()) {
            buffer.wait(); // 缓冲区空，等待生产者生产
        }
        String item = buffer.remove(0);
        buffer.notifyAll(); // 通知生产者
        return item;
    }
}
```

**注意事项：**

- 尽量使用同步代码块而非同步方法，减小锁粒度
- 避免在同步块中执行耗时操作（如 I/O、网络请求）
- `wait/notify` 的局限：一个锁只有一个等待队列，无法精确唤醒特定条件的线程

---

## volatile

`volatile` 是轻量级的同步机制，保证可见性和禁止指令重排序，但**不保证原子性**。

```java
private volatile boolean running = true;

public void stop() {
    running = false; // 其他线程立即可见
}
```

**适用场景：**

- 状态标志位（如 `running`、`initialized`）
- 单次写入、多次读取的共享变量
- DCL（双重检查锁定）中的实例引用

**不适用场景：**

- `volatile int count; count++` —— `++` 操作不是原子的，需要用 `AtomicInteger`

---

## ReentrantLock 与 Condition

`ReentrantLock` 是 `java.util.concurrent.locks` 包提供的可重入独占锁，功能比 `synchronized` 更丰富。通过 `newCondition()` 创建 `Condition` 对象，可实现多条件精确唤醒。

### ReentrantLock 基本用法

```java
private final ReentrantLock lock = new ReentrantLock();

public void method() {
    lock.lock();
    try {
        // 临界区
    } finally {
        lock.unlock(); // 必须在 finally 中释放锁
    }
}
```

**相比 synchronized 的优势：**

| 能力 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 可中断获取锁 | ❌ | ✅ `lockInterruptibly()` |
| 超时获取锁 | ❌ | ✅ `tryLock(timeout, unit)` |
| 公平锁 | ❌ | ✅ `new ReentrantLock(true)` |
| 条件变量 | 只有一个 wait/notify | ✅ 多个 `Condition` |
| 锁状态查询 | ❌ | ✅ `isHeld()`, `getQueueLength()` |

### Condition 条件变量

`Condition` 解决了 `wait/notify` 只有单一等待队列的问题，每个 `Condition` 对应一个独立的等待队列：

```java
private final ReentrantLock lock = new ReentrantLock();
private final Condition notFull = lock.newCondition();  // 缓冲区未满条件
private final Condition notEmpty = lock.newCondition(); // 缓冲区非空条件
private final List<String> buffer = new ArrayList<>();
private final int MAX_CAPACITY = 10;

// 生产者
public void produce(String item) throws InterruptedException {
    lock.lock();
    try {
        while (buffer.size() == MAX_CAPACITY) {
            notFull.await(); // 缓冲区满，在 notFull 条件上等待
        }
        buffer.add(item);
        notEmpty.signal(); // 通知消费者：缓冲区非空了
    } finally {
        lock.unlock();
    }
}

// 消费者
public String consume() throws InterruptedException {
    lock.lock();
    try {
        while (buffer.isEmpty()) {
            notEmpty.await(); // 缓冲区空，在 notEmpty 条件上等待
        }
        String item = buffer.remove(0);
        notFull.signal(); // 通知生产者：缓冲区不满了
    } finally {
        lock.unlock();
    }
}
```

### Condition 与 Object wait/notify 对比

| 能力 | Object wait/notify | Condition |
|------|-------------------|-----------|
| 前置条件 | 必须持有 synchronized 锁 | 必须持有对应的 Lock |
| 等待队列数量 | 1 个（所有线程共用） | 多个（每个 Condition 独立） |
| 精确唤醒 | ❌ `notify()` 随机唤醒一个 | ✅ `signal()` 唤醒指定条件上的线程 |
| 超时等待 | `wait(timeout)` | `await(timeout, unit)` |
| 不响应中断 | ❌ | ✅ `awaitUninterruptibly()` |
| 截止时间等待 | ❌ | ✅ `awaitUntil(deadline)` |
| 虚假唤醒防护 | 需要 while 循环 | 同样需要 while 循环 |

**注意事项：**

- **必须在 `finally` 块中释放锁**，否则异常会导致锁永不释放
- 不要在 `lock()` 之前就 `try`，否则如果 `lock()` 抛异常，`unlock()` 会抛 `IllegalMonitorStateException`
- `Condition.await()` 同样存在虚假唤醒问题，必须用 `while` 循环检查条件

---

## ReadWriteLock 与 StampedLock

### ReadWriteLock

`ReadWriteLock` 将读写分离：读锁共享，写锁独占。适合**读多写少**的场景。

```java
private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
private final Lock readLock = rwLock.readLock();
private final Lock writeLock = rwLock.writeLock();

public Object read() {
    readLock.lock();
    try {
        return data;
    } finally {
        readLock.unlock();
    }
}

public void write(Object newData) {
    writeLock.lock();
    try {
        data = newData;
    } finally {
        writeLock.unlock();
    }
}
```

**注意事项：**

- 写锁可以降级为读锁，但读锁不能升级为写锁（会导致死锁）
- 非公平模式下，写锁可能被"饿死"（持续有读锁进来）

### StampedLock

`StampedLock` 是 JDK 1.8 引入的，支持乐观读，在读多写少场景下性能优于 `ReadWriteLock`。

```java
private final StampedLock sl = new StampedLock();

public Object read() {
    long stamp = sl.tryOptimisticRead(); // 乐观读
    Object result = data;
    if (!sl.validate(stamp)) {
        stamp = sl.readLock(); // 乐观读失败，升级为悲观读锁
        try {
            result = data;
        } finally {
            sl.unlockRead(stamp);
        }
    }
    return result;
}

public void write(Object newData) {
    long stamp = sl.writeLock();
    try {
        data = newData;
    } finally {
        sl.unlockWrite(stamp);
    }
}
```

**注意事项：**

- **不可重入**，不要在持有锁时再次获取
- 不支持 `Condition`
- 适合作为内部实现，不建议直接暴露给外部使用

---

## Atomic 原子类

`Atomic` 类基于 CAS（Compare-And-Swap）实现，无锁并发，适合简单的计数或引用更新。

```java
private final AtomicInteger count = new AtomicInteger(0);

public void increment() {
    count.incrementAndGet(); // 原子自增
}

public int getCount() {
    return count.get();
}
```

**常用原子类：**

| 类 | 用途 |
|----|------|
| `AtomicInteger` | 整数原子操作 |
| `AtomicLong` | 长整数原子操作 |
| `AtomicBoolean` | 布尔值原子操作 |
| `AtomicReference<V>` | 引用类型原子操作 |
| `AtomicStampedReference<V>` | 带版本号的引用（解决 ABA 问题） |
| `LongAdder` | 高并发下的计数器（分段 CAS，性能优于 AtomicLong） |

**注意事项：**

- CAS 存在 ABA 问题，可用 `AtomicStampedReference` 解决
- 高竞争下 CAS 自旋会消耗 CPU，此时 `LongAdder` 是更好的选择

---

## CountDownLatch 与 CyclicBarrier

### CountDownLatch

`CountDownLatch` 让一个或多个线程等待其他线程完成操作，**一次性使用**。

```java
CountDownLatch latch = new CountDownLatch(3);

// 工作线程
executor.submit(() -> {
    doWork();
    latch.countDown(); // 计数减 1
});

// 等待线程
latch.await(); // 阻塞直到计数为 0
System.out.println("所有工作完成");
```

- 计数器不可重置，用完即废（如需重置，用 `CyclicBarrier`）
- 确保 `countDown()` 一定会被执行（放在 `finally` 中）

### CyclicBarrier

`CyclicBarrier`（循环屏障）让一组线程互相等待，全部到达屏障点后再一起继续执行。栅栏推倒后自动重置，可以循环使用。

```java
CyclicBarrier barrier = new CyclicBarrier(3, () -> {
    System.out.println("所有线程到达屏障，执行回调");
});

// 每个工作线程
barrier.await(); // 等待其他线程到齐后继续
```

**典型场景：分阶段同步推进**

```java
CyclicBarrier barrier = new CyclicBarrier(3, () -> {
    System.out.println("--- 一轮完成，开始下一轮 ---");
});

for (int round = 0; round < 5; round++) {
    doWork(round);     // 各自处理
    barrier.await();   // 等齐后再进入下一轮
}
```

**注意事项：**

- 参与线程数必须与 parties 一致，否则屏障永远不会触发
- 某个线程中断或超时后，其他等待线程会收到 `BrokenBarrierException`
- 避免在线程池中使用（线程池大小 < parties 时可能导致死锁）

### 对比

| | CountDownLatch | CyclicBarrier |
|---|---|---|
| 可重用 | ❌ 一次性 | ✅ 自动重置，循环使用 |
| 等待模型 | 一个线程等待其他线程完成 | 线程之间互相等待 |
| 计数方式 | `countDown()` 递减 | `await()` 到达计数 |
| 回调 | ❌ | ✅ 屏障触发时可执行 `barrierAction` |
| 异常处理 | 异常不影响其他线程 | 一个线程异常会破坏屏障 |
| 典型场景 | 主线程等待 N 个子任务完成 | 多线程分阶段同步推进 |

---

## Semaphore

`Semaphore`（信号量）用于控制同时访问某个资源的线程数量，本质是一个计数器。线程通过 `acquire()` 获取许可，通过 `release()` 释放许可。

```java
Semaphore semaphore = new Semaphore(5); // 5 个许可，最多 5 个线程同时访问

public void access() throws InterruptedException {
    semaphore.acquire();
    try {
        // 访问受限资源
    } finally {
        semaphore.release();
    }
}
```

### 公平与非公平

```java
Semaphore unfair = new Semaphore(5);       // 非公平（默认），吞吐量高
Semaphore fair = new Semaphore(5, true);   // 公平，按等待顺序获取
```

### 典型场景

**1. 数据库连接池限流**

```java
public class ConnectionPool {
    private final Semaphore semaphore;
    private final List<Connection> pool;

    public ConnectionPool(int poolSize) {
        this.semaphore = new Semaphore(poolSize);
        this.pool = new ArrayList<>(poolSize);
    }

    public Connection getConnection() throws InterruptedException {
        semaphore.acquire();
        synchronized (pool) { return pool.remove(0); }
    }

    public void releaseConnection(Connection conn) {
        synchronized (pool) { pool.add(conn); }
        semaphore.release();
    }
}
```

**2. 接口并发控制**

```java
public void handleRequest(HttpServletRequest request) {
    if (!semaphore.tryAcquire()) {
        response.setStatus(429); // 快速失败
        return;
    }
    try {
        doHandle(request);
    } finally {
        semaphore.release();
    }
}
```

**3. Semaphore 实现互斥**（permits = 1 时退化为互斥锁）

```java
Semaphore mutex = new Semaphore(1);
```

> 注意：与 `synchronized` 不同，Semaphore 不会自动绑定线程，`release()` 可以在任意线程调用。

**注意事项：**

- **必须确保 `release()` 被执行**：放在 `finally` 块中，否则许可会被耗尽
- **acquire 和 release 不要求同一线程**：这与 `synchronized`/`ReentrantLock` 不同
- **tryAcquire 适合快速失败**：不需要等待时用 `tryAcquire()`，适合限流场景

---

## 方案对比与选型

| 方案 | 互斥 | 可见性 | 原子性 | 可中断 | 适用场景 |
|------|:----:|:------:|:------:|:------:|----------|
| `synchronized` | ✅ | ✅ | ✅ | ❌ | 通用同步，代码简洁 |
| `volatile` | ❌ | ✅ | ❌ | - | 状态标志、DCL |
| `ReentrantLock` | ✅ | ✅ | ✅ | ✅ | 需要高级特性（超时、公平、条件） |
| `ReadWriteLock` | 部分 | ✅ | ✅ | ✅ | 读多写少 |
| `StampedLock` | 部分 | ✅ | ✅ | ❌ | 读多写少且追求极致性能 |
| `Atomic` 类 | ❌ | ✅ | ✅ | - | 简单计数、引用更新 |
| `CountDownLatch` | - | - | - | ✅ | 一次性等待多个线程完成 |
| `CyclicBarrier` | - | - | - | ✅ | 多轮同步、线程互相等待 |
| `Semaphore` | 部分 | ✅ | ✅ | ✅ | 限流、资源池 |
| `Object wait/notify` | ✅ | ✅ | - | ❌ | synchronized 下的简单线程通信 |
| `Condition` | ✅ | ✅ | - | ✅ | Lock 下的精确线程通信 |

**选型建议：**

1. **能简单就简单**：优先 `synchronized`，JDK 1.6+ 之后性能已经很好
2. **需要高级特性才用 Lock**：如超时获取、公平锁、条件变量
3. **线程间通信**：`synchronized` 配合 `wait/notify`；需要多条件精确唤醒时用 `Condition`
4. **读多写少**：`ReadWriteLock` 或 `StampedLock`
5. **简单计数**：`Atomic` 类或 `LongAdder`
6. **线程协调**：`CountDownLatch`（一次性）或 `CyclicBarrier`（可重用）
7. **限流控制**：`Semaphore`
