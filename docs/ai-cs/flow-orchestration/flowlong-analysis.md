---
title: BPM审批流引擎
tags:
  - BPM
  - 审批流引擎
  - 工作流
  - FlowLong
  - 客服系统
excerpt: BPM 审批流引擎是解决"人工任务怎么流转"的核心基础设施。本文从 BPM 系统的基本概念出发，系统介绍审批流引擎的架构模型、分支路由、审批模式与中国式审批操作，最后以 FlowLong 飞龙工作流引擎为例，结合官方文档深入剖析其 JSON 流程定义、核心 API 与运行机制，并探讨在 AI 客服系统中的落地实践。
createTime: 2026/07/11 18:00:00
permalink: /ai-cs/flowlong-analysis/
---

# BPM审批流引擎

> 当你的业务需要"人参与决策"——比如客服工单需要主管审批、投诉升级需要多级确认、退款申请需要财务复核——你需要的不再是流程编排引擎，而是一个 **BPM 审批流引擎**。本文将从 BPM 系统的完整概念体系出发，讲清楚审批流引擎的架构模型、分支路由、审批模式与中国式审批特色，最后以 FlowLong 飞龙工作流引擎为例，深入其具体实现。

## 一、什么是 BPM 审批流引擎

### 1.1 问题背景

假设你在构建一个 AI 客服系统，客服工单从创建到关闭需要经过多级人工审批：

```java
// 硬编码方式：审批逻辑散落在代码里，状态流转与业务逻辑深度耦合
public class TicketService {

    public boolean submitTicket(Ticket ticket) {
        // 保存工单
        ticketMapper.insert(ticket);

        // 一线客服处理
        if (ticket.getCategory().equals("refund")) {
            // 退款需要主管 + 财务双重审批
            ticket.setStatus("PENDING_MANAGER");
            // 手动记录谁该审批
            ticket.setApproverId(getManagerId(ticket.getDeptId()));
            ticketMapper.updateById(ticket);
            // 发送通知
            notifyService.send(ticket.getApproverId(), "您有新的审批任务");
        } else if (ticket.getCategory().equals("complaint")) {
            // 投诉需要根据严重程度决定审批层级
            if (ticket.getSeverity() >= 3) {
                ticket.setStatus("PENDING_DIRECTOR");
                ticket.setApproverId(getDirectorId());
            } else {
                ticket.setStatus("PENDING_MANAGER");
                ticket.setApproverId(getManagerId(ticket.getDeptId()));
            }
            ticketMapper.updateById(ticket);
            notifyService.send(ticket.getApproverId(), "您有新的审批任务");
        }
        return true;
    }

    public boolean approve(Long ticketId, Long approverId, boolean approved) {
        Ticket ticket = ticketMapper.selectById(ticketId);
        // 验证审批人身份
        if (!approverId.equals(ticket.getApproverId())) {
            throw new RuntimeException("无权审批");
        }
        // 根据当前状态和审批结果决定下一步
        if (approved) {
            switch (ticket.getStatus()) {
                case "PENDING_MANAGER":
                    if (ticket.getCategory().equals("refund")) {
                        ticket.setStatus("PENDING_FINANCE");
                        ticket.setApproverId(getFinanceId());
                    } else {
                        ticket.setStatus("APPROVED");
                    }
                    break;
                case "PENDING_FINANCE":
                    ticket.setStatus("APPROVED");
                    break;
                case "PENDING_DIRECTOR":
                    ticket.setStatus("APPROVED");
                    break;
            }
        } else {
            ticket.setStatus("REJECTED");
        }
        ticketMapper.updateById(ticket);
        // ... 还有驳回、转办、加签等逻辑没写
    }
}
```

这段代码的问题不仅在于 `switch-case` 越来越长，更在于**审批流转逻辑和业务逻辑完全耦合**：

| 问题 | 说明 |
|------|------|
| **状态机硬编码** | 每增加一个审批节点，都要修改 `approve` 方法的 `switch-case` |
| **流转不可视** | 审批流程的全貌隐藏在代码的条件分支中，非技术人员无法理解 |
| **变更成本高** | 临时增加一个审批层级（如"总监复核"），需要改代码、测试、上线 |
| **无法追溯** | 审批历史散落在工单状态字段中，难以查询完整的审批轨迹 |
| **扩展困难** | 驳回、转办、加签等操作需要大量定制代码 |
| **并发问题** | 多人会签场景下，审批状态管理极易出错 |

### 1.2 BPM 的解决思路

BPM（Business Process Management，业务流程管理）的核心思想是：**把审批流程从业务代码中抽离出来，用流程定义描述审批节点、审批人和流转规则，由引擎负责任务分配、状态流转和历史记录**。

```jsonc
// BPM 方式：审批流程是数据，不是代码
{
  "flowName": "客服工单审批",
  "flowNodes": [
    { "nodeType": 0, "nodeCode": "start", "nodeName": "发起" },
    {
      "nodeType": 1, "nodeCode": "manager_approval", "nodeName": "主管审批",
      "permissionList": [{ "type": 0, "handler": "${manager_id}" }]
    },
    {
      "nodeType": 4, "nodeCode": "check_category", "nodeName": "类型判断",
      "conditionList": [
        { "nodeCode": "finance_approval", "expression": "category == 'refund'" },
        { "nodeCode": "end", "expression": "category != 'refund'" }
      ]
    },
    {
      "nodeType": 1, "nodeCode": "finance_approval", "nodeName": "财务审批",
      "permissionList": [{ "type": 0, "handler": "${finance_id}" }]
    },
    { "nodeType": 3, "nodeCode": "end", "nodeName": "结束" }
  ]
}
```

```java
// 业务代码只需调用引擎 API，完全不关心流转逻辑
flowLongEngine.startInstanceById(processId, flowCreator, args);
// 审批人办理任务
flowLongEngine.executeTask(taskId, flowCreator, args);
```

这样带来的好处：

- **流程与代码解耦**：审批流程存储在数据库，修改不需要重新发版
- **流程可视化**：JSON 定义即流程图，运营和产品都能理解
- **完整审批轨迹**：引擎自动记录每一步审批历史
- **丰富审批操作**：驳回、转办、委派、加签、减签等开箱即用
- **状态管理可靠**：引擎负责并发控制和状态一致性

### 1.3 BPM 的发展历程

BPM 并不是一个新概念，它的发展经历了几个阶段：

```text
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  1990s      │    │  2000s       │    │  2010s        │    │  2020s       │
│  工作流系统   │ →  │  BPMN 2.0    │ →  │  云原生 BPM   │ →  │  轻量审批引擎  │
│  (邮件驱动)  │    │  标准化       │    │  (微服务化)    │    │  (JSON/低代码) │
└─────────────┘    └──────────────┘    └───────────────┘    └──────────────┘
```

| 阶段 | 代表产品 | 特点 |
|------|---------|------|
| **早期工作流** | Lotus Notes、Exchange | 邮件驱动，简单状态流转 |
| **BPMN 标准化** | jBPM、Activiti、Flowable | BPMN 2.0 XML 标准，功能完整但复杂 |
| **云原生 BPM** | Camunda Cloud、Zeebe | 微服务架构，云原生部署 |
| **轻量审批引擎** | FlowLong、SnakerFlow | JSON 定义，专注审批场景，极简轻量 |

### 1.4 BPM 系统的核心概念

要理解 BPM 审批流引擎，需要先弄清楚三个核心概念——**模型、实例、任务**。整个框架都围绕这三个概念执行操作。

#### 流程模型（Process Model）

流程模型是对业务流程的抽象和描述，定义了流程中的各个环节、参与者和流转规则。在传统 BPM 引擎中用 BPMN 2.0 XML 描述，在轻量引擎（如 FlowLong）中用 JSON 描述。

流程模型的组成要素：

| 要素 | 说明 | 示例 |
|------|------|------|
| **节点（Node）** | 流程中的一个环节，分为条件节点和任务节点 | 审批节点、抄送节点、条件节点 |
| **连线（Transition）** | 节点之间的流转关系 | 主管审批 → 总监审批 |
| **参与者（Participant）** | 执行任务的人员、角色或部门 | 指定用户、角色、部门 |
| **分支（Branch）** | 流程的分叉与汇聚，传统 BPM 称为"网关" | 条件分支、并行分支 |

#### 流程实例（Process Instance）

流程实例是根据流程模型启动的具体执行实体。当一个业务流程被启动时，就会生成一个对应的流程实例，代表了流程的一次具体执行过程。

| 关键信息 | 说明 |
|---------|------|
| **流程定义引用** | 实例基于哪个流程模型启动 |
| **流程状态** | 审批中、审批通过、审批拒绝、撤销、超时、终止 |
| **执行路径** | 流程执行经过的节点和路径 |
| **流程变量** | 执行过程中传递的数据，如 `days`、`amount` |
| **参与者信息** | 每个节点的负责人、执行者 |
| **业务关联** | 通过 `businessKey` 关联外部业务数据 |

#### 流程任务（Task）

流程任务是流程实例中需要由参与者完成的具体工作。它是业务流程中的具体执行单元。

| 特点 | 说明 |
|------|------|
| **责任人指派** | 每个任务被指派给特定的人员、角色或部门 |
| **执行条件** | 只有满足条件才能执行（如前序任务完成） |
| **执行结果** | 任务有明确的完成状态：完成、拒绝、撤销、超时、终止 |
| **任务流转** | 任务完成后触发下一个任务的创建 |
| **通知提醒** | 系统通知责任人有新任务或提醒截止时间 |

### 1.5 BPM 审批流引擎 vs 工作流引擎 vs 流程编排引擎

在前面的文章中，我们已经介绍了[表达式引擎](/ai-cs/qlexpress-study-notes/)和[Flow流程编排引擎](/ai-cs/flow-orchestration-engine/)。BPM 审批流引擎在技术栈中处于一个独特的位置——它比流程编排引擎更重（有持久化、有人工任务），比通用工作流引擎更轻（不需要 BPMN 2.0 的全套复杂性）。

| 维度 | 表达式引擎 | 流程编排引擎 | BPM 审批流引擎 | 通用工作流引擎 |
|------|----------|------------|-----------|-----------|
| **核心能力** | 单条表达式求值 | 多步骤自动编排 | 人工审批任务流转 | 完整 BPM 流程管理 |
| **人工任务** | 不支持 | 不支持 | **核心能力** | 核心能力 |
| **状态持久化** | 无 | 通常无 | **数据库持久化** | 数据库持久化 |
| **流程描述** | 表达式字符串 | DSL（XML/JSON/YML） | **JSON** | BPMN 2.0 XML |
| **典型代表** | QLExpress、Aviator | LiteFlow、CompileFlow | **FlowLong** | Activiti、Flowable、Camunda |
| **复杂度** | 极低 | 低 | **低~中** | 高 |
| **学习曲线** | 极低 | 低 | **低** | 高 |
| **适用场景** | 条件判断、计算 | 业务步骤编排 | 审批、工单流转 | 复杂企业级流程 |

::: tip 四者的关系
**表达式引擎**解决"一个条件怎么判断"；**流程编排引擎**解决"多个步骤怎么协调"；**BPM 审批流引擎**解决"人工任务怎么流转"；**通用工作流引擎**解决"长周期复杂流程怎么治理"。四者互补，覆盖了从简单到复杂的完整流程管理需求。
:::

![四种流程引擎核心差异对比](/ai-cs/flow-orchestration/flowlong-analysis/engine-type-comparison.svg)

---

## 二、BPM 系统的架构模型

### 2.1 整体架构

一个典型的 BPM 审批流引擎采用分层架构设计，各层职责清晰：

```text
┌─────────────────────────────────────────────────────┐
│                    业务层                              │
│         LeaveService / TicketService / ...            │
└──────────────────────┬──────────────────────────────┘
                       │ 调用
┌──────────────────────▼──────────────────────────────┐
│                  流程引擎（Engine）                     │
│              （引擎入口 / 统一调度）                     │
├──────────┬──────────┬──────────┬─────────────────────┤
│ Process  │ Runtime  │  Query   │     Task            │
│ Service  │ Service  │ Service  │     Service         │
│ (流程定义) │ (流程实例) │ (查询服务) │   (任务管理)        │
├──────────┴──────────┴──────────┴─────────────────────┤
│              数据访问层（Data Access）                   │
│              ORM Mapper / CRUD                        │
├───────────────────────────────────────────────────────┤
│                  数据库（Database）                     │
│  流程定义表 / 流程实例表 / 任务表 / 历史表 / 参与者表     │
└───────────────────────────────────────────────────────┘
```

| 层级 | 职责 | 说明 |
|------|------|------|
| **引擎入口** | 统一调度，门面模式 | 核心类，获取各种服务 |
| **流程定义服务** | 流程的部署、卸载、版本管理 | `ProcessService` |
| **运行时服务** | 流程实例的启动、终止、模型获取 | `RuntimeService` |
| **查询服务** | 查询活动任务、历史任务、参与者 | `QueryService` |
| **任务服务** | 任务的审批、驳回、转办、委派、加签 | `TaskService` |
| **数据访问层** | 基于 ORM 的 CRUD | MyBatis-Plus / JPA |

### 2.2 流程定义与建模

流程定义是 BPM 的起始——所有工作流业务的展开都依赖于流程模型的定义。不同引擎对流程定义的描述方式不同：

| 方式 | 引擎 | 格式 | 特点 |
|------|------|------|------|
| **BPMN 2.0 XML** | Activiti、Flowable、Camunda | XML | 国际标准，功能强大但复杂 |
| **JSON** | FlowLong | JSON | 简洁直观，易于生成和解析 |
| **DSL** | LiteFlow | XML/EL/YML/JSON | 编排优先，灵活多变 |

传统 BPM 引擎采用 BPMN 2.0 标准，包含泳道、网关、连线、补偿、信号、活动、数据对象等复杂概念。而轻量审批引擎（如 FlowLong）化繁为简，**只有节点这一种概念**，节点分为条件节点和任务节点，其中任务节点包含审批任务、定时器任务、触发器任务、子流程任务等。

### 2.3 流程实例的生命周期

流程实例从启动到结束，经历一系列状态变化：

```text
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  审批中   │────→│ 审批通过  │     │  暂存待审    │
│ (running) │     │(approved)│     │ (pending)    │
└────┬─────┘     └──────────┘     └──────┬───────┘
     │                                   │ 重新提交
     ├────→ ┌──────────┐                 │
     │      │ 审批拒绝  │                 │
     │      │(rejected)│                 │
     │      └──────────┘                 │
     │                                   │
     ├────→ ┌──────────┐                 │
     │      │ 撤销审批  │                 │
     │      │ (revoked)│                 │
     │      └──────────┘                 │
     │                                   │
     ├────→ ┌──────────┐                 │
     │      │ 超时结束  │                 │
     │      │ (timeout)│                 │
     │      └──────────┘                 │
     │                                   │
     └────→ ┌──────────┐                 │
            │ 强制终止  │                 │
            │(terminated)│                │
            └──────────┘                 │
```

| 状态 | 说明 | 触发条件 |
|------|------|---------|
| **审批中** | 流程正在执行，有待办任务 | 流程启动 |
| **审批通过** | 所有审批节点完成 | 最后一个审批节点同意 |
| **审批拒绝** | 审批被拒绝且终止流程 | 审批人拒绝 + 终止策略 |
| **撤销审批** | 发起人主动撤销 | 发起人操作 |
| **超时结束** | 超过期望完成时间 | 定时任务检测 |
| **强制终止** | 管理员强制结束 | 管理操作 |

### 2.4 任务分配与参与者模型

BPM 系统通过参与者模型来确定"谁来审批"。参与者可以是具体用户、角色或部门：

| 参与者类型 | 说明 | 适用场景 |
|-----------|------|---------|
| **指定用户** | 明确指定某人为审批人 | 直接上级审批 |
| **指定角色** | 指定某个角色的人审批 | 风控审核角色 |
| **指定部门** | 指定某个部门的人审批 | 财务部门会签 |
| **动态变量** | 运行时通过变量解析审批人 | `${manager_id}` |
| **分组策略** | 角色/部门分组，支持认领或全员参与 | 公共任务认领 |

参与者还可以支持更复杂的模式：

- **代理**：A 指定代理人 B，B 完成任务后 A 和 B 都能查到
- **认领**：公共任务由角色/部门中某人主动认领
- **离职转办**：A 所有参与任务批量转给 B

### 2.5 持久化与历史追溯

BPM 系统的持久化设计是其可靠性的基石。核心数据分为**运行时数据**和**历史数据**两部分：

| 数据类型 | 说明 | 表（以 FlowLong 为例） |
|---------|------|---------------------|
| **流程定义** | 存储流程模型 JSON/XML | `flw_process` |
| **流程实例** | 正在运行的实例 | `flw_instance` |
| **活动任务** | 当前待办任务 | `flw_task` |
| **任务参与者** | 当前任务的参与者关联 | `flw_task_actor` |
| **历史实例** | 已完成的实例记录 | `flw_his_instance` |
| **历史任务** | 已办理的任务及其审批意见 | `flw_his_task` |
| **历史参与者** | 历史任务的参与者记录 | `flw_his_task_actor` |

::: tip 运行时与历史分离
运行时数据和历史数据分离是 BPM 引擎的通用设计：运行时表只存储当前活动数据，保证查询性能；历史表记录完整轨迹，支持审计和追溯。当流程实例完成后，数据从运行时表迁移到历史表。
:::

---

## 三、BPM 系统的分支与路由

分支（Branch）是 BPM 系统中控制流程走向的核心机制。传统 BPM 引擎（如 Flowable）称之为"网关"（Gateway），在轻量引擎（如 FlowLong）中被简化为条件节点。FlowLong 支持四种分支类型：

![FlowLong五种节点类型总览](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-node-types-overview.svg)

### 3.1 条件分支（排他分支）

> 排他分支用于在流程中实现决策，即根据条件选择**一个**分支执行。也用于处理异常情况，将流程路由到特定的异常处理分支。

**特点**：当流程执行到排他分支时，所有分支都会进行条件判断，但只会选择第一个条件为 `true` 的分支执行。按 JSON 中定义的顺序匹配。

```jsonc
// 条件分支示例：根据金额选择审批路径
{
  "nodeType": 4,
  "nodeCode": "check_amount",
  "nodeName": "金额判断",
  "conditionList": [
    { "nodeCode": "director_approval", "expression": "amount > 10000" },
    { "nodeCode": "manager_approval", "expression": "amount > 1000" },
    { "nodeCode": "end", "expression": "default" }
  ]
}
```

**应用场景**：流程决策点，根据条件选择不同的执行路径。

### 3.2 并行分支

> 并行分支允许将流程分成多条分支，也可以把多条分支汇聚到一起（fork/join）。

**特点**：
- **不解析条件**：即使顺序流中定义了条件，也会被忽略
- **数量无需平衡**：进入和出去的分支数量可以不同
- **同时执行**：所有分支同时激活

```text
并行分支：
         ┌─ 主管审批 ─┐
开始 ────┤             ├─→ 汇聚 ──→ 下一节点
         └─ 财务审批 ─┘
         （同时创建任务，全部完成后才继续）
```

**应用场景**：并行执行多个相互独立的任务，提高执行效率。

### 3.3 包容分支

> 包容分支可以看做是排他分支和并行分支的结合体。它允许基于条件选择**多条**分支执行，但如果没有任何一个分支满足条件，则可以选择默认分支。

**特点**：
- **解析条件**：所有外出顺序流都会进行条件判断
- **并行执行**：所有条件为 `true` 的分支都会并行执行
- **选择性等待**：汇聚时只等待被选中执行的分支

**应用场景**：当多个任务有不同的执行条件时，实现灵活的流程控制。特别适用于需要会签的任务场景。

### 3.4 路由分支

> 路由分支用于解决线性模型不支持回路流转的问题，根据条件选择重定向到指定节点。

**特点**：根据条件组自动重定向到指定节点，支持"环形审批"。

**应用场景**：常用于流程中需要重新复审的情况，可配置条件指定退回节点。

### 3.5 四种分支对比

| 分支类型 | 定义与功能 | 特点 | 应用场景 |
|------|-------------------------|-----------------------------------|-------------------|
| **条件分支** | 根据条件选择一个分支执行 | 只选择一个 `true` 的分支执行，按定义顺序 | 流程决策点，处理异常情况 |
| **并行分支** | 将流程分成多条分支或汇聚多条分支 | 不解析条件，数量无需平衡 | 并行执行多个任务，提高执行效率 |
| **包容分支** | 结合排它分支和并行分支的功能 | 解析条件，并行执行所有 `true` 的分支 | 灵活控制流程，适用于会签等任务场景 |
| **路由分支** | 根据条件选择一个分支执行 | 重定向到指定节点 | 根据条件复审，退回指定节点 |

---

## 四、BPM 系统的审批模式

### 4.1 串行审批与并行审批

![串行审批vs并行审批对比](/ai-cs/flow-orchestration/flowlong-analysis/serial-vs-parallel-comparison.svg)

#### 串行审批（顺序会签）

多个审批人按顺序依次审批，前一个审批完成后才轮到下一个：

```jsonc
{
  "nodeType": 1,
  "nodeCode": "serial_approval",
  "nodeName": "串行审批",
  "permissionList": [
    { "type": 0, "handler": "${team_leader_id}" },
    { "type": 0, "handler": "${manager_id}" },
    { "type": 0, "handler": "${director_id}" }
  ],
  "nextNodeCode": "end"
}
```

```text
流转过程：
  组长审批 → 主管审批 → 总监审批 → 下一节点
  （依次创建任务，前一个完成才创建下一个）
```

#### 并行审批（并行会签）

多个审批人同时收到任务，各自独立审批：

```jsonc
{
  "nodeType": 1,
  "nodeCode": "parallel_approval",
  "nodeName": "并行审批",
  "permissionList": [
    { "type": 0, "handler": "${manager_id}" },
    { "type": 0, "handler": "${finance_id}" }
  ],
  "nodeRatio": 1.0,  // 全票通过
  "nextNodeCode": "end"
}
```

```text
流转过程：
  ┌─ 主管审批 ─┐
  │             ├─→ 下一节点（两人都审批后才继续）
  └─ 财务审批 ─┘
  （同时创建任务，全部完成后才流转）
```

| 维度 | 串行审批 | 并行审批 |
|------|---------|---------|
| **任务创建** | 逐个创建 | 同时创建 |
| **审批效率** | 低（排队等待） | 高（并行处理） |
| **适用场景** | 有层级关系的审批 | 同级并行审核、会签 |

### 4.2 会签、或签与票签

这三种模式通过 `nodeRatio`（会签比例）或权重来控制：

| 模式 | 控制方式 | 含义 | 示例 |
|------|---------|------|------|
| **会签** | `nodeRatio = 1.0` | 全部同意才通过 | 三人审批，三人都同意才流转 |
| **或签** | `nodeRatio = 0` | 任一同意即通过 | 三人审批，任何一人同意即流转 |
| **票签** | 权重 `weight` | 投票权重比例 > 50% 即通过 | A 权重 3、B 权重 2、C 权重 1，A+B = 5/6 > 50% 通过 |

```jsonc
// 会签示例：三人全票通过
{
  "nodeType": 1,
  "nodeCode": "countersign",
  "nodeName": "三人会签",
  "permissionList": [
    { "type": 0, "handler": "${approver_1}" },
    { "type": 0, "handler": "${approver_2}" },
    { "type": 0, "handler": "${approver_3}" }
  ],
  "nodeRatio": 1.0,
  "nextNodeCode": "end"
}

// 或签示例：任一同意即通过
{
  "nodeType": 1,
  "nodeCode": "or_sign",
  "nodeName": "任一审批",
  "permissionList": [
    { "type": 0, "handler": "${manager_a}" },
    { "type": 0, "handler": "${manager_b}" },
    { "type": 0, "handler": "${manager_c}" }
  ],
  "nodeRatio": 0,
  "nextNodeCode": "end"
}
```

::: tip 票签的权重机制
票签任务中，`flw_task_actor` 表的 `weight` 字段记录不同处理人员的分量比例。当投票权重比例大于 50% 时就能进入下一个节点。这与会签的全票通过不同——票签允许部分人不同意，只要权重够就行。
:::

### 4.3 驳回与驳回策略

驳回是审批流中最常见的操作之一。成熟的 BPM 引擎支持灵活的驳回策略：

| 驳回策略 | 说明 | 适用场景 |
|---------|------|---------|
| **驳回到发起人** | 流程回到发起人重新提交 | 信息不完整，需要补充 |
| **驳回到上一节点** | 回到上一个审批节点 | 上一步审批有问题 |
| **驳回到指定节点** | 跳转到任意指定节点 | 跳过某些节点重新审批 |
| **终止审批流程** | 直接终止流程 | 完全不可接受的申请 |

驳回后重新审批的执行策略：

| 重新审批策略 | 说明 |
|------------|------|
| **继续执行** | 从驳回节点继续往下执行 |
| **回到上一个节点** | 退回驳回节点重新审批 |

```text
正常流程：  开始 → 主管审批 → 总监审批 → 结束
驳回流程：  开始 → 主管审批 ✗（驳回到发起人）
                    ↓
               发起人修改 → 重新提交 → 主管审批 → 总监审批 → 结束

驳回到上一节点：
  开始 → 主管审批 → 总监审批 ✗（驳回到上一节点）
                           ↓
                      主管审批 → 总监审批 → 结束
```

### 4.4 转办与委派

转办和委派都是将任务交给他人处理，但语义不同：

| 操作 | 语义 | 任务归属 | 适用场景 |
|------|------|---------|---------|
| **转办** | 我不审批了，换人来审 | 转办后任务归属被转办人 | 审批人不在/不合适 |
| **委派** | 我请人帮忙先审，最终还是要我确认 | 委派人审批后任务回到委派人 | 请上级/专家协助预审 |
| **代理** | A 指定代理人 B，B 完成后 A 和 B 都能查到 | 代理人完成任务后原处理人也能查看 | 授权代理审批 |
| **离职转办** | A 所有参与任务批量转给 B | 全部任务归属 B | 员工离职交接 |

```text
转办流程：  审批人A ──转办──→ 审批人B ──→ 下一节点
                       （A退出，B接手）

委派流程：  审批人A ──委派──→ 委派人B ──预审──→ 审批人A ──→ 下一节点
                       （B预审后，任务回到A）

代理流程：  审批人A ──代理──→ 代理人B ──完成──→ 任务结束
                       （A和B都能查到该任务）
```

### 4.5 加签与减签

加签是在审批过程中临时增加审批人，减签是减少审批人。这是**中国式审批**的特色功能：

| 加签类型 | 说明 | 示例场景 |
|---------|------|---------|
| **前加签** | 在当前审批人之前增加审批人 | 主管觉得需要组长先确认 |
| **后加签** | 在当前审批人之后增加审批人 | 主管审批后需要增加风控审核 |
| **并行加签** | 增加与当前审批人并行的审批人 | 需要增加一个会签人 |

```text
前加签：  新审批人 → 当前审批人 → 下一节点
后加签：  当前审批人 → 新审批人 → 下一节点
并行加签：当前审批人 ─┐
                    ├─→ 下一节点
          新审批人 ──┘
```

减签则是在当前办理人操作之前减少办理人，仅适用于并行/会签场景。

### 4.6 撤回与撤销

| 操作 | 执行者 | 条件 | 效果 |
|------|--------|------|------|
| **撤回（拿回）** | 上一节点提交人 | 当前办理人尚未处理 | 任务回到提交人 |
| **撤销** | 流程发起者 | 任意时间 | 整个流程实例被撤销 |

```text
撤回（拿回）：
  发起人 → 主管审批（待办中）
               ↓ 拿回
          任务回到发起人

撤销：
  发起人 → 主管审批 → 总监审批（进行中）
               ↓ 撤销
          整个流程实例标记为"已撤销"
```

### 4.7 其他中国式审批操作

除了上述核心操作，完整的 BPM 审批引擎还应支持以下中国式审批特色功能：

| 操作 | 说明 |
|------|------|
| **跳转** | 将当前流程实例跳转到任意办理节点 |
| **唤醒** | 历史任务唤醒，重新进入审批流程 |
| **认领** | 公共任务（角色/部门任务）由某人主动认领 |
| **已阅** | 标记任务为已查看状态 |
| **催办** | 通知当前活动任务处理人办理任务 |
| **沟通** | 与当前活动任务处理人沟通 |
| **终止** | 在任意节点终止流程实例 |
| **追加** | 发起流程后动态追加修改节点处理人 |
| **暂存待审** | 流程发起时暂存，发起人后续修改后重新提交激活 |
| **超时审批** | 超时后自动审批（自动通过或拒绝） |
| **自动提醒** | 根据设置的提醒时间提醒审批人（可设定提醒次数） |
| **穿越时空** | 指定某个日期发起审批，所有任务记录为该时间（如事后补审） |
| **AI 审批** | AI 智能体根据参数配置智能路由决策，智能辅助审批 |

---

## 五、主流 BPM 引擎对比

### 5.1 引擎全景

| 引擎 | 出品方 | 流程描述 | 依赖大小 | 特点 |
|------|--------|---------|---------|------|
| **FlowLong** | aizuda | JSON | ~1MB | 极简轻量，专注审批场景，MyBatis-Plus 生态，中国式审批 |
| **Activiti** | Alfresco | BPMN 2.0 XML | ~30MB+ | 功能完整，国际标准，社区成熟 |
| **Flowable** | Flowable | BPMN 2.0 XML | ~30MB+ | Activiti 分支，功能更丰富，支持 CMMN/DMN |
| **Camunda** | Camunda | BPMN 2.0 XML | ~40MB+ | 企业级流程引擎，监控能力强 |
| **SnakerFlow** | snakerflow | XML | ~5MB | 国产轻量工作流，类 Activiti 设计 |

### 5.2 设计理念对比

| 特性 | FlowLong（飞龙工作流） | 传统/主流工作流引擎（Camunda、Activiti） |
|------|------------------|------------------|
| **设计理念** | **审批模式优先**，贴近钉钉/飞书审批体验 | **BPMN 2.0 标准**优先，强调流程的规范性与复杂性 |
| **流程定义** | 自定义的 **JSON 格式**，结构简单，易于生成和解析 | 基于国际标准的 **BPMN XML**，功能强大但相对复杂 |
| **学习曲线** | **较低**，尤其适合有国内 OA 系统开发经验的开发者 | **较陡峭**，需要理解 BPMN 规范和各种技术细节 |
| **适用场景** | **企业级审批流程**（人事、财务、行政等） | **复杂业务流程**（订单处理、供应链管理、工业自动化） |
| **部署规模** | **轻量级**，适合快速集成到现有 Spring Boot 项目中 | **重量级**，通常作为独立服务部署，功能全面 |

### 5.3 功能对比

| 功能 | FlowLong | Activiti / Flowable |
|------|----------|-------------------|
| **人工审批** | ✅ 核心能力 | ✅ 核心能力 |
| **会签/或签/票签** | ✅ 原生支持 | ✅ 支持（配置较复杂） |
| **驳回/转办/委派/加签** | ✅ 开箱即用 | ✅ 支持（需自定义实现） |
| **条件/并行/包容/路由分支** | ✅ 原生支持 | ✅ 支持（BPMN 网关） |
| **父子流程** | ✅ 支持（同步/异步） | ✅ 支持 |
| **定时/触发器任务** | ✅ 支持 | ✅ 支持 |
| **AI 审批** | ✅ 支持 | ❌ 需自行集成 |
| **穿越时空审批** | ✅ 支持 | ❌ 不支持 |
| **可视化设计器** | ✅ 提供（独立组件） | ✅ Flowable Modeler |
| **BPMN 标准兼容** | ❌ 不兼容 | ✅ 完全兼容 |
| **数据库表数量** | 8 张 | ~20~40 张 |
| **持久化框架** | MyBatis-Plus | MyBatis / JPA |

---

## 六、FlowLong 飞龙工作流引擎实战

> 前面我们从 BPM 系统的角度梳理了审批流引擎的完整概念体系。接下来，我们以 **FlowLong 飞龙工作流引擎**为例，深入其具体实现。FlowLong 是 aizuda 团队开发的开源工作流引擎，采用 JSON 格式存储模型、仅 8 张表实现核心逻辑，专注为中国特色审批场景打造。

![FlowLong分层架构](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-architecture-overview.svg)

### 6.1 项目简介

FlowLong 中文名"飞龙"，LOGO 采用中国红、中国龙、华表为元素设计。它的设计初衷很简单：**Activiti 太重，手写太累，需要一个刚刚好的审批流引擎**。

在真实业务中，90% 的流程需求其实就是"审批"——请假审批、报销审批、工单审批、合同审批。这些场景的共同特征是：有人工参与的节点、需要持久化任务状态、需要记录审批历史。但对于这些场景，引入 Activiti/Flowable 这种重量级工作流引擎往往是大材小用——BPMN 2.0 的复杂性、大量不必要的表结构、陡峭的学习曲线，都增加了项目的维护成本。

FlowLong 在 `flowlong` 中抛弃了传统 BPMN 所包含的泳道、网关、连线、补偿、信号、活动、数据对象等复杂的概念，也不采用 XML 这种较重格式的标记语言作为模型设计，模型化繁为简只有节点这么一个概念。

### 6.2 核心特性

| 特性 | 说明 |
|------|------|
| **极简轻量** | 核心 JAR 仅约 1MB，引擎核心仅 8 张表 |
| **JSON 流程定义** | 用 JSON 描述流程，无需 BPMN 2.0 XML，直观易读 |
| **中国式审批** | 动态加签、任意驳回、拿回、撤销、已阅、沟通等特色操作 |
| **多种审批模式** | 顺序会签、并行会签、或签、票签（权重投票） |
| **四种分支类型** | 条件分支、并行分支、包容分支、路由分支 |
| **父子流程** | 主流程节点设置子流程，支持同步/异步 |
| **定时与触发器** | 定时任务、触发器任务（立即触发/定时触发） |
| **超时与提醒** | 超时自动审批、定时提醒（可设定次数） |
| **AI 审批** | AI 智能体智能路由决策，智能辅助审批 |
| **穿越时空** | 指定日期发起审批，任务记录为该时间 |
| **暂存待审** | 发起时暂存，后续修改后重新提交激活 |
| **MyBatis-Plus 持久化** | 基于 MyBatis-Plus，数据库操作透明可追踪 |
| **Spring Boot / Solon 集成** | 提供 Starter，自动配置，即引即用 |
| **流程设计器** | 提供独立的可视化流程设计器组件 |

### 6.3 安装集成

#### Maven 依赖

```xml
<!-- Spring Boot 2/3 -->
<dependency>
    <groupId>com.aizuda</groupId>
    <artifactId>flowlong-spring-boot-starter</artifactId>
    <version>1.2.5</version>
</dependency>

<!-- Spring Boot 4 使用专用 starter -->
<dependency>
    <groupId>com.aizuda</groupId>
    <artifactId>flowlong-spring-boot4-starter</artifactId>
    <version>1.2.5</version>
</dependency>
```

::: tip 环境要求
FlowLong 支持 Spring Boot 2.x/3.x/4.x 和 Solon 框架。环境要求 JDK 8+。如需使用 MyBatis-Plus 数据访问层，确保项目中已引入 MyBatis-Plus 依赖。最新版本号请查看 [Maven Central](https://central.sonatype.com/artifact/com.aizuda/flowlong-spring-boot-starter/versions)。
:::

#### 项目结构

```text
flowlong/
├── db/                              # 数据库脚本存放目录
├── flowlong-core/                   # 工作流核心库
├── flowlong-mybatis-plus/           # 数据访问层（默认 MyBatis-Plus）
├── flowlong-solon-plugin/           # Solon 启动插件
├── flowlong-solon-example/          # Solon 演示案例
├── flowlong-spring-boot-autoconfigure/  # Spring Boot 自动配置
├── flowlong-spring-boot-example/    # Spring Boot 演示案例
├── flowlong-spring-boot-starter/    # Spring Boot 2/3 启动插件
└── flowlong-spring-boot4-starter/   # Spring Boot 4 启动插件
```

### 6.4 数据库表结构

FlowLong 引擎核心仅 **8 张表**实现逻辑数据存储，采用 JSON 数据格式存储模型结构：

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `flw_process` | 流程定义 | `process_key`（唯一标识）、`process_name`、`model_content`（JSON 定义）、`process_version`、`process_state` |
| `flw_instance` | 流程实例 | `process_id`、`business_key`（业务关联）、`current_node_name`、`variable`（变量 JSON） |
| `flw_his_instance` | 历史流程实例 | 继承实例表字段 + `instance_state`（状态）、`end_time`、`duration` |
| `flw_ext_instance` | 扩展流程实例 | `instance_id`、`model_content`（动态添加节点存储临时模型） |
| `flw_task` | 待办任务 | `instance_id`、`task_name`、`task_key`、`task_type`、`perform_type`、`variable` |
| `flw_his_task` | 历史任务 | 继承任务表字段 + `task_state`、`finish_time`、`duration` |
| `flw_task_actor` | 任务参与者 | `task_id`、`actor_id`、`actor_name`、`actor_type`（0 用户/1 角色/2 部门）、`weight`（权重）、`agent_id` |
| `flw_his_task_actor` | 历史任务参与者 | 与 `flw_task_actor` 结构一致，存储历史记录 |

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  flw_process  │     │ flw_instance  │     │   flw_task    │
│  (流程定义)    │────→│  (流程实例)    │────→│  (待办任务)    │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                     ┌──────▼───────┐     ┌──────▼───────┐
                     │flw_his_instance│   │ flw_his_task  │
                     │  (历史实例)    │     │  (历史任务)    │
                     └──────────────┘     └──────┬───────┘
                                                 │
                     ┌──────────────┐     ┌──────▼───────┐
                     │flw_ext_instance│    │flw_task_actor│
                     │ (扩展实例)     │     │ (任务参与者)  │
                     └──────────────┘     └──────┬───────┘
                                                 │
                                          ┌──────▼───────┐
                                          │flw_his_task_ │
                                          │    actor     │
                                          │(历史参与者)   │
                                          └──────────────┘
```

**流程实例状态**（`flw_his_instance.instance_state`）：

| 状态值 | 含义 |
|-------|------|
| 0 | 审批中 |
| 1 | 审批通过 |
| 2 | 审批拒绝 |
| 3 | 撤销审批 |
| 4 | 超时结束 |
| 5 | 强制终止 |

**任务状态**（`flw_his_task.task_state`）：

| 状态值 | 含义 |
|-------|------|
| 0 | 活动 |
| 1 | 跳转 |
| 2 | 完成 |
| 3 | 拒绝 |
| 4 | 撤销审批 |
| 5 | 超时 |
| 6 | 终止 |
| 7 | 驳回终止 |

### 6.5 流程定义（JSON 格式）

FlowLong 使用 JSON 描述流程定义，节点定义对应的 Java 实体类为 `NodeModel`，源码位于 `flowlong-core/src/main/java/com/aizuda/bpm/engine/model` 目录。

```jsonc
{
  "flowName": "请假审批流程",
  "flowNodes": [
    {
      "nodeType": 0,            // 节点类型：0=开始
      "nodeCode": "start",
      "nodeName": "开始",
      "nextNodeCode": "manager_approval"
    },
    {
      "nodeType": 1,            // 节点类型：1=审批
      "nodeCode": "manager_approval",
      "nodeName": "主管审批",
      "permissionList": [
        { "type": 0, "handler": "${manager_id}" }
      ],
      "nextNodeCode": "check_days"
    },
    {
      "nodeType": 4,            // 节点类型：4=条件
      "nodeCode": "check_days",
      "nodeName": "天数判断",
      "conditionList": [
        { "nodeCode": "director_approval", "expression": "days > 3" },
        { "nodeCode": "cc_hr", "expression": "days <= 3" }
      ]
    },
    {
      "nodeType": 1,
      "nodeCode": "director_approval",
      "nodeName": "总监审批",
      "permissionList": [
        { "type": 0, "handler": "${director_id}" }
      ],
      "nextNodeCode": "cc_hr"
    },
    {
      "nodeType": 2,            // 节点类型：2=抄送
      "nodeCode": "cc_hr",
      "nodeName": "抄送HR",
      "permissionList": [
        { "type": 0, "handler": "${hr_id}" }
      ],
      "nextNodeCode": "end"
    },
    {
      "nodeType": 3,            // 节点类型：3=结束
      "nodeCode": "end",
      "nodeName": "结束"
    }
  ]
}
```

#### 节点类型

| `nodeType` | 类型 | 说明 |
|------------|------|------|
| 0 | 开始节点 | 流程入口，每个流程有且仅有一个 |
| 1 | 审批节点 | 需要人工审批的环节，最核心的节点类型 |
| 2 | 抄送节点 | 仅通知，不需要审批，任务自动完成 |
| 3 | 结束节点 | 流程出口，表示流程正常结束 |
| 4 | 条件节点 | 根据表达式动态选择下一个执行节点 |

#### 审批人设置

`permissionList` 定义了每个审批/抄送节点的处理人：

| `type` 值 | 含义 | `handler` 格式 | 示例 |
|-----------|------|---------------|------|
| 0 | 指定用户 | 用户ID 或 `${变量名}` | `"1001"` 或 `"${manager_id}"` |
| 1 | 指定角色 | 角色标识 | `"role_manager"` |
| 2 | 指定部门 | 部门ID | `"dept_001"` |

::: tip 动态审批人
`handler` 字段支持 `${变量名}` 语法，在流程启动时通过 `args` 参数传入实际值。这样可以根据业务上下文动态指定审批人。
:::

#### 会签比例

`nodeRatio` 字段控制并行审批的通过策略：

| `nodeRatio` | 含义 |
|------------|------|
| 不设置 | 串行审批（依次审批） |
| `1.0` | 会签（全票通过） |
| `0` | 或签（任一通过） |
| `0.5` | 比例通过（半数以上） |

### 6.6 核心 API

FlowLong 的核心类是 `FlowLongEngine`，它是流程引擎的关键接口，可以获取流程的各种服务：

```java
@Resource
private FlowLongEngine flowLongEngine;

// 获取各种服务
ProcessService processService = flowLongEngine.processService();   // 流程定义服务
QueryService queryService = flowLongEngine.queryService();         // 查询服务
TaskService taskService = flowLongEngine.taskService();            // 任务服务
RuntimeService runtimeService = flowLongEngine.runtimeService();   // 运行时服务
```

#### 部署流程

```java
// 方式一：根据资源文件部署（文件放在 resources 目录下）
Long processId = flowLongEngine.processService()
    .deployByResource("leave-approval.json", flowCreator, repeat);

// 方式二：根据输入流部署
Long processId = flowLongEngine.processService()
    .deploy(inputStream, flowCreator, repeat);

// 方式三：根据 JSON 字符串部署
Long processId = flowLongEngine.processService()
    .deploy(jsonString, flowCreator, repeat);
```

| 参数 | 说明 |
|------|------|
| `resourceName` / `input` / `jsonString` | 流程定义来源 |
| `flowCreator` | 流程任务部署者（`FlowCreator.of(userId, userName)`） |
| `repeat` | 是否重复部署：`true` 存在则版本+1 新增记录，`false` 存在则直接返回 |

#### 发起流程

```java
// 方式一：根据流程定义ID启动
Map<String, Object> args = new HashMap<>();
args.put("days", 5);
args.put("manager_id", 3001L);
args.put("director_id", 4001L);

flowLongEngine.startInstanceById(processId, flowCreator, args)
    .ifPresent(instance -> {
        // 获取实例信息
        Long instanceId = instance.getId();
    });

// 方式二：根据流程定义KEY启动
flowLongEngine.startInstanceByProcessKey(processKey, version, flowCreator, args)
    .ifPresent(instance -> {
        // 其它流程操作
    });
```

| 参数 | 说明 |
|------|------|
| `processId` / `processKey` | 流程定义ID或唯一标识 |
| `version` | 版本号（按 KEY 启动时可选） |
| `flowCreator` | 流程实例创建者 |
| `args` | 流程变量，用于条件判断和审批人解析 |
| `businessKey` | 业务KEY（用于关联业务数据） |

#### 审批任务

```java
// 审批同意
flowLongEngine.executeTask(taskId, flowCreator, args);

// 审批拒绝（默认返回上一级节点）
// nodeKey 为空则默认返回上一级，指定则跳转到该节点
// termination 为 true 时直接终止流程
flowLongEngine.executeRejectTask(flwTask, nodeKey, flowCreator, args, termination);

// 查询当前实例的活动任务
List<FlwTask> tasks = flowLongEngine.queryService()
    .getActiveTasksByInstanceId(instanceId).get();

// 查询历史任务
List<FlwHisTask> hisTasks = flowLongEngine.queryService()
    .getHisTasksByInstanceId(instanceId).get();
```

::: warning 事务一致性
业务层调用审批方法时，请务必保证事务一致性。在 SpringBoot 中使用 `@Transactional(rollbackFor = Exception.class)` 注解。
:::

#### 其他任务操作

```java
// 转办任务：A 转给 B 审批，B 审批后进入下一节点
flowLongEngine.taskService().transferTask(taskId, flowCreator, assigneeFlowCreator, args);

// 委派任务：A 转给 B 审批，B 审批后转回 A，A 审批后进入下一节点
flowLongEngine.taskService().delegateTask(taskId, flowCreator, assigneeFlowCreator, args);

// 撤回任务：后续任务未执行前有效
flowLongEngine.taskService().withdrawTask(taskId, flowCreator);

// 唤醒任务：唤醒历史任务，重新进入审批流程
flowLongEngine.taskService().resume(instanceId, nodeKey, flowCreator);

// 跳转到任意节点
flowLongEngine.executeJumpTask(taskId, nodeKey, flowCreator, args);

// 指定代理人
flowLongEngine.taskService().agentTask(taskId, flowCreator, agentFlowCreators, args);

// 认领角色任务
flowLongEngine.taskService().claimRole(taskId, flowCreator);

// 认领部门任务
flowLongEngine.taskService().claimDepartment(taskId, flowCreator);

// 追加节点模型（true=前置，false=后置）
flowLongEngine.executeAppendNodemodel(taskId, nodeModel, flowCreator, args, beforeAfter);
```

#### 节点模型驳回策略

在 `NodeModel` 中可配置驳回相关属性：

| 属性 | 说明 |
|------|------|
| `rejectStrategy` | 驳回策略：1=驳回到发起人，2=驳回到上一节点，3=驳回到指定节点，4=终止审批流程，5=驳回到模型父节点 |
| `rejectStart` | 驳回重新审批策略：1=继续往下执行，2=回到上一个节点 |

### 6.7 完整示例

将上面的步骤串联起来，一个完整的请假审批流程如下：

```java
@Service
public class LeaveApprovalDemo {

    @Resource
    private FlowLongEngine flowLongEngine;

    public void demo() {
        FlowCreator creator = FlowCreator.of("2001", "张三");

        // ========== 1. 部署流程 ==========
        Long processId = flowLongEngine.processService()
            .deployByResource("leave-approval.json", creator, false);

        // ========== 2. 发起请假 ==========
        Map<String, Object> args = new HashMap<>();
        args.put("days", 5);  // 请假5天，需要总监审批
        args.put("manager_id", "3001");
        args.put("director_id", "4001");
        args.put("hr_id", "5001");

        FlwInstance instance = flowLongEngine.startInstanceById(processId, creator, args).get();
        System.out.println("流程已启动，实例ID: " + instance.getId());

        // ========== 3. 主管审批 ==========
        List<FlwTask> managerTasks = flowLongEngine.queryService()
            .getActiveTasksByInstanceId(instance.getId()).get();
        FlwTask managerTask = managerTasks.stream()
            .filter(t -> "主管审批".equals(t.getTaskName()))
            .findFirst().get();
        flowLongEngine.executeTask(managerTask.getId(),
            FlowCreator.of("3001", "李主管"),
            Collections.singletonMap("reason", "同意，注意交接工作"));
        // 引擎自动流转到条件判断 → days=5 > 3 → 总监审批节点

        // ========== 4. 总监审批 ==========
        List<FlwTask> directorTasks = flowLongEngine.queryService()
            .getActiveTasksByInstanceId(instance.getId()).get();
        FlwTask directorTask = directorTasks.stream()
            .filter(t -> "总监审批".equals(t.getTaskName()))
            .findFirst().get();
        flowLongEngine.executeTask(directorTask.getId(),
            FlowCreator.of("4001", "王总监"),
            Collections.singletonMap("reason", "同意"));
        // 引擎自动流转到抄送HR → 结束

        // ========== 5. 查看审批历史 ==========
        List<FlwHisTask> history = flowLongEngine.queryService()
            .getHisTasksByInstanceId(instance.getId()).get();
        for (FlwHisTask hisTask : history) {
            System.out.printf("节点: %s, 审批人: %s, 状态: %d, 时间: %s%n",
                hisTask.getTaskName(),
                hisTask.getCreateBy(),
                hisTask.getTaskState(),
                hisTask.getFinishTime());
        }
        // 输出:
        // 节点: 主管审批, 审批人: 李主管, 状态: 2(完成), 时间: ...
        // 节点: 总监审批, 审批人: 王总监, 状态: 2(完成), 时间: ...
    }
}
```

三步搞定：**部署流程 → 启动实例 → 办理任务**。业务代码只关心业务数据，审批流转完全由引擎驱动。

---

## 七、AI 客服系统中的实战应用

### 7.1 客服工单审批流程

AI 客服系统中，工单从自动处理到人工审批是一个典型场景：

```json
{
  "flowName": "客服工单审批流程",
  "flowNodes": [
    {
      "nodeType": 0,
      "nodeCode": "start",
      "nodeName": "工单提交",
      "nextNodeCode": "route_by_category"
    },
    {
      "nodeType": 4,
      "nodeCode": "route_by_category",
      "nodeName": "分类路由",
      "conditionList": [
        { "nodeCode": "refund_approval", "expression": "category == 'refund' && amount > 100" },
        { "nodeCode": "complaint_approval", "expression": "category == 'complaint' && severity >= 3" },
        { "nodeCode": "end", "expression": "default" }
      ]
    },
    {
      "nodeType": 1,
      "nodeCode": "refund_approval",
      "nodeName": "退款审批",
      "permissionList": [
        { "type": 0, "handler": "${manager_id}" },
        { "type": 0, "handler": "${finance_id}" }
      ],
      "nodeRatio": 1.0,
      "nextNodeCode": "cc_record"
    },
    {
      "nodeType": 1,
      "nodeCode": "complaint_approval",
      "nodeName": "投诉审批",
      "permissionList": [
        { "type": 0, "handler": "${senior_manager_id}" }
      ],
      "nextNodeCode": "cc_record"
    },
    {
      "nodeType": 2,
      "nodeCode": "cc_record",
      "nodeName": "抄送记录",
      "permissionList": [
        { "type": 0, "handler": "${record_keeper_id}" }
      ],
      "nextNodeCode": "end"
    },
    {
      "nodeType": 3,
      "nodeCode": "end",
      "nodeName": "结束"
    }
  ]
}
```

```java
@Service
public class TicketApprovalService {

    @Resource
    private FlowLongEngine flowLongEngine;

    /**
     * 提交工单，启动审批流程
     */
    public Long submitTicket(Ticket ticket) {
        // AI 预处理：分类和金额计算
        TicketClassification classification = aiService.classify(ticket);
        ticket.setCategory(classification.getCategory());
        ticket.setAmount(classification.getAmount());
        ticket.setSeverity(classification.getSeverity());

        // 准备流程变量
        Map<String, Object> args = new HashMap<>();
        args.put("category", ticket.getCategory());
        args.put("amount", ticket.getAmount());
        args.put("severity", ticket.getSeverity());
        args.put("manager_id", deptService.getManagerId(ticket.getDeptId()));
        args.put("finance_id", financeService.getFinanceId());
        args.put("senior_manager_id", deptService.getSeniorManagerId());
        args.put("record_keeper_id", recordService.getKeeperId());

        // 启动审批流程
        FlowCreator creator = FlowCreator.of(
            ticket.getCreatorId().toString(),
            ticket.getCreatorName()
        );

        FlwInstance instance = flowLongEngine.startInstanceById(
            ticketProcessId, creator, args
        ).get();

        return instance.getId();
    }

    /**
     * 审批人处理工单
     */
    public void processApproval(ApprovalRequest request) {
        FlowCreator creator = FlowCreator.of(
            request.getApproverId().toString(),
            request.getApproverName()
        );

        switch (request.getAction()) {
            case APPROVE:
                flowLongEngine.executeTask(request.getTaskId(),
                    creator, Collections.singletonMap("reason", request.getComment()));
                break;
            case REJECT:
                // 驳回，nodeKey 为空则默认返回上一级
                FlwTask task = flowLongEngine.queryService()
                    .getActiveTasksByInstanceId(request.getInstanceId()).get().get(0);
                flowLongEngine.executeRejectTask(
                    task, null, creator,
                    Collections.singletonMap("rejectReason", request.getComment()),
                    false  // 不终止流程
                );
                break;
            case TRANSFER:
                flowLongEngine.taskService().transferTask(
                    request.getTaskId(), creator,
                    FlowCreator.of(request.getTargetUserId().toString(),
                                   request.getTargetUserName()),
                    Collections.singletonMap("reason", request.getComment())
                );
                break;
        }
    }

    /**
     * 查询我的待审批工单
     */
    public List<TicketTaskVO> myPendingTasks(String userId) {
        // 通过查询服务获取当前用户的活动任务
        List<FlwTask> tasks = flowLongEngine.queryService()
            .getActiveTasksByActorId(userId);

        return tasks.stream().map(task -> {
            FlwInstance instance = flowLongEngine.queryService()
                .getInstanceById(task.getInstanceId()).get();
            Ticket ticket = ticketMapper.selectById(
                Long.parseLong(instance.getBusinessKey())
            );
            return TicketTaskVO.of(task, ticket);
        }).collect(Collectors.toList());
    }
}
```

### 7.2 投诉升级审批

投诉场景中的多级升级审批：

```java
/**
 * 投诉升级审批流程
 * 当 AI 客服检测到高风险投诉时，自动触发升级审批
 */
@Service
public class ComplaintEscalationService {

    @Resource
    private FlowLongEngine flowLongEngine;

    /**
     * AI 检测到高风险投诉，触发升级
     */
    public Long escalateComplaint(Complaint complaint) {
        Map<String, Object> args = new HashMap<>();
        args.put("severity", complaint.getSeverity());
        args.put("emotion_score", complaint.getEmotionScore());
        args.put("first_manager_id", deptService.getManagerId(complaint.getDeptId()));
        args.put("director_id", deptService.getDirectorId());
        args.put("vp_id", deptService.getVPId());
        args.put("legal_id", legalService.getLegalCounselId());

        FlowCreator creator = FlowCreator.of(
            complaint.getCustomerId().toString(),
            complaint.getCustomerName()
        );

        return flowLongEngine.startInstanceById(
            complaintEscalationProcessId, creator, args
        ).get().getId();
    }

    /**
     * 查看投诉的完整审批轨迹
     */
    public List<ApprovalTraceVO> getApprovalTrace(Long instanceId) {
        List<FlwHisTask> history = flowLongEngine.queryService()
            .getHisTasksByInstanceId(instanceId).get();

        return history.stream()
            .map(hisTask -> ApprovalTraceVO.builder()
                .nodeName(hisTask.getTaskName())
                .approverName(hisTask.getCreateBy())
                .taskState(hisTask.getTaskState())  // 0活动/2完成/3拒绝/...
                .finishTime(hisTask.getFinishTime())
                .duration(hisTask.getDuration())
                .build())
            .collect(Collectors.toList());
    }
}
```

对应的流程定义：

```json
{
  "flowName": "投诉升级审批",
  "flowNodes": [
    {
      "nodeType": 0,
      "nodeCode": "start",
      "nodeName": "投诉受理",
      "nextNodeCode": "first_level"
    },
    {
      "nodeType": 1,
      "nodeCode": "first_level",
      "nodeName": "一线主管处理",
      "permissionList": [{ "type": 0, "handler": "${first_manager_id}" }],
      "nextNodeCode": "check_severity"
    },
    {
      "nodeType": 4,
      "nodeCode": "check_severity",
      "nodeName": "严重程度判断",
      "conditionList": [
        { "nodeCode": "second_level", "expression": "severity >= 4" },
        { "nodeCode": "legal_review", "expression": "severity >= 3 && emotion_score < 0.3" },
        { "nodeCode": "end", "expression": "default" }
      ]
    },
    {
      "nodeType": 1,
      "nodeCode": "second_level",
      "nodeName": "总监+VP会签",
      "permissionList": [
        { "type": 0, "handler": "${director_id}" },
        { "type": 0, "handler": "${vp_id}" }
      ],
      "nodeRatio": 1.0,
      "nextNodeCode": "legal_review"
    },
    {
      "nodeType": 1,
      "nodeCode": "legal_review",
      "nodeName": "法务审核",
      "permissionList": [{ "type": 0, "handler": "${legal_id}" }],
      "nextNodeCode": "end"
    },
    {
      "nodeType": 3,
      "nodeCode": "end",
      "nodeName": "结案"
    }
  ]
}
```

### 7.3 与 QLExpress / LiteFlow 的配合

![三引擎协作架构](/ai-cs/flow-orchestration/flowlong-analysis/engine-collaboration-overview.svg)

在 AI 客服系统中，FlowLong 可以与 QLExpress 表达式引擎和 LiteFlow 流程编排引擎配合使用，构成完整的技术栈：

| 引擎 | 职责 | 场景 |
|------|------|------|
| **FlowLong** | 人工审批任务流转 | 工单审批、投诉升级、退款复核 |
| **QLExpress** | 条件判断与规则求值 | 审批人动态计算、复杂条件路由 |
| **LiteFlow** | 自动步骤编排 | AI 会话处理流程、自动分类流程 |

```text
┌──────────────────────────────────────────────────────────┐
│                      AI 客服系统                           │
│                                                           │
│  ┌─────────────────────────────────────────┐             │
│  │           LiteFlow（自动编排层）           │             │
│  │                                         │             │
│  │  消息预处理 → AI意图识别 → 情绪分析       │             │
│  │       ↓                                 │             │
│  │  QLExpress条件判断                       │             │
│  │  (需要人工审批？)                        │             │
│  │       ↓ 是                              │             │
│  │  调用 FlowLong 启动审批流程               │             │
│  └─────────────────────┬───────────────────┘             │
│                        │                                  │
│  ┌─────────────────────▼───────────────────┐             │
│  │         FlowLong（人工审批层）             │             │
│  │                                         │             │
│  │  主管审批 → 总监审批 → 财务复核 → 结案    │             │
│  │  (驳回/转办/加签/会签...)                 │             │
│  └─────────────────────────────────────────┘             │
│                                                           │
│  ✅ 自动流程用 LiteFlow 编排                               │
│  ✅ 复杂条件用 QLExpress 求值                              │
│  ✅ 人工审批用 FlowLong 驱动                               │
└──────────────────────────────────────────────────────────┘
```

```java
// LiteFlow 节点中调用 FlowLong 启动审批
@LiteflowComponent("startApprovalNode")
public class StartApprovalNode extends NodeComponent {

    @Resource
    private FlowLongEngine flowLongEngine;

    @Override
    public void process() {
        TicketContext ctx = this.getContextBean(TicketContext.class);

        // 使用 QLExpress 判断是否需要人工审批
        boolean needApproval = Boolean.TRUE.equals(qlexpressRunner.execute(
            "amount > 100 || category == 'complaint' && severity >= 3",
            ctx.toVariables(), QLOptions.DEFAULT_OPTIONS
        ).getResult());

        if (needApproval) {
            // 启动 FlowLong 审批流程
            FlwInstance instance = flowLongEngine.startInstanceById(
                ctx.getProcessId(),
                FlowCreator.of(ctx.getCustomerId(), ctx.getCustomerName()),
                ctx.toVariables()
            ).get();
            ctx.setApprovalInstanceId(instance.getId());
            ctx.setNeedManualApproval(true);
        }
    }
}
```

---

## 八、选型建议

![审批流引擎选型决策图](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-selection-guide.svg)

### 8.1 选择 FlowLong 的场景

- **只需要审批功能**：不需要 BPMN 的定时任务、信号、子流程等复杂特性
- **快速上手**：团队没有 BPMN 经验，希望 5 分钟内跑通审批流
- **轻量部署**：不想引入 30MB+ 的依赖，追求极简技术栈
- **MyBatis-Plus 生态**：项目已使用 MyBatis-Plus，FlowLong 无缝衔接
- **中国式审批**：需要会签、或签、票签、加签、减签、转办、委派、代理等特色功能
- **AI 审批**：需要 AI 智能体辅助审批决策
- **中小型项目**：审批流程不超过 10 个节点，不需要可视化设计器

### 8.2 选择 Activiti / Flowable 的场景

- **复杂企业级流程**：需要子流程、定时任务、信号事件、消息事件等
- **BPMN 标准兼容**：需要与国际标准对接，或使用第三方 BPMN 工具
- **可视化流程设计**：需要业务人员通过拖拽式设计器管理流程
- **流程治理**：需要完整的流程版本管理、部署管理、监控仪表盘
- **大规模部署**：流程数量多、并发量大，需要企业级稳定性保障
- **多系统集成**：需要与 CRM、ERP 等系统通过标准协议集成

### 8.3 FlowLong vs Activiti / Flowable 详细对比

| 维度 | FlowLong | Activiti / Flowable |
|------|----------|-------------------|
| **依赖大小** | ~1MB | ~30MB+ |
| **流程描述** | JSON（简洁直观） | BPMN 2.0 XML（标准但复杂） |
| **学习曲线** | 低（5 分钟入门） | 高（需理解 BPMN 概念） |
| **数据库表数量** | 8 张 | ~20~40 张 |
| **持久化框架** | MyBatis-Plus | MyBatis / JPA |
| **Spring Boot 集成** | ✅ Starter（2/3/4） | ✅ Starter |
| **Solon 集成** | ✅ Plugin | ❌ 不支持 |
| **AI 审批** | ✅ 原生支持 | ❌ 需自行集成 |
| **穿越时空审批** | ✅ 支持 | ❌ 不支持 |
| **社区生态** | 国内社区，发展中 | 国际社区，成熟 |
| **适用规模** | 中小型项目 | 中大型企业级项目 |

::: tip 混合使用建议
如果你的系统既有自动编排需求（AI 处理流程），又有人工审批需求（工单审批），可以考虑 LiteFlow + FlowLong 的组合：LiteFlow 负责自动步骤编排，FlowLong 负责人工审批流转，QLExpress 负责条件判断。
:::

---

## 总结

BPM 审批流引擎的核心价值可以概括为一句话：**让审批流程成为数据，而非代码**。

从 BPM 系统的角度看，审批流引擎需要解决四个层面的问题：

1. **流程建模**——如何描述一个审批流程（JSON vs BPMN XML）
2. **任务流转**——如何驱动审批任务在节点间流动（条件/并行/包容/路由分支）
3. **审批操作**——如何支持丰富的审批行为（会签/或签/驳回/转办/加签/减签...）
4. **持久化与追溯**——如何可靠地存储和查询审批历史（运行时表 + 历史表）

FlowLong 作为轻量审批引擎的代表，其独特优势在于：

- **极简轻量**：~1MB 依赖，8 张表，5 分钟上手
- **JSON 定义**：无需 BPMN 知识，看 JSON 即懂流程
- **中国式审批全覆盖**：会签/或签/票签/驳回/转办/委派/代理/加签/减签/拿回/撤销/跳转/唤醒/认领/已阅/催办/沟通
- **四种分支**：条件分支、并行分支、包容分支、路由分支
- **高级特性**：AI 审批、穿越时空、暂存待审、超时审批、自动提醒、触发器
- **MyBatis-Plus 生态**：零 SQL 编写，分页友好，多数据库兼容
- **多框架支持**：Spring Boot 2/3/4 + Solon

在 AI 客服系统中，FlowLong 可以灵活支撑工单审批、投诉升级、退款复核等多种审批场景。结合 QLExpress 表达式引擎和 LiteFlow 流程编排引擎，可以构建从自动处理到人工审批的完整技术栈——LiteFlow 编排自动流程，QLExpress 做条件判断，FlowLong 驱动人工审批，三者各司其职，配合默契。

选择建议可以简单概括为：

1. **轻量审批 + 快速上手 + 中国式审批** → 选 FlowLong
2. **复杂 BPMN + 可视化设计 + 企业级治理** → 选 Activiti / Flowable
3. **两者都不是** → 看团队技术栈，MyBatis-Plus 生态选 FlowLong，JPA 生态选 Flowable

---

## 延伸阅读

- [FlowLong 官方文档](https://doc.flowlong.com/) —— 官方教程和 API 文档
- [FlowLong GitHub 仓库](https://github.com/aizuda/flowlong) —— 源码和 Issue
- [FlowLong Gitee 仓库](https://gitee.com/aizuda/flowlong) —— 国内镜像
- [FlowLong 流程设计器在线演示](https://flowlong-desginer.pages.dev/) —— 可视化流程设计器
- [QLExpress4表达式引擎](/ai-cs/qlexpress-study-notes/) —— 表达式引擎基础知识
- [Flow流程编排引擎](/ai-cs/flow-orchestration-engine/) —— LiteFlow 和 CompileFlow 流程编排引擎
- [Activiti 官网](https://www.activiti.org/) —— 完整的工作流引擎
- [Flowable 官网](https://flowable.com/) —— Activiti 的增强分支
- [MyBatis-Plus 官网](https://baomidou.com/) —— FlowLong 的持久化基础设施
