---
title: FlowLong审批流引擎分析
tags:
  - FlowLong
  - 审批流引擎
  - 工作流
  - 工作流引擎
  - 客服系统
excerpt: FlowLong 是一款极轻量级的审批工作流引擎，以 JSON 定义流程、MyBatis-Plus 持久化、零 BPMN 依赖为核心理念，专注解决"审批"这一最高频的业务流程场景。本文从审批流引擎的基本概念出发，系统梳理 FlowLong 的流程定义、节点类型、审批操作、运行机制与实战用法，并结合 AI 客服系统场景探讨其落地实践。
createTime: 2026/07/11 18:00:00
permalink: /ai-cs/flowlong-analysis/
---

# FlowLong审批流引擎分析

> 当你的业务需要"人参与决策"——比如客服工单需要主管审批、投诉升级需要多级确认、退款申请需要财务复核——你需要的不再是流程编排引擎，而是一个**审批流引擎**。FlowLong 就是一款专为审批场景而生的极简工作流引擎，用 JSON 定义流程、以 MyBatis-Plus 持久化，无需 BPMN 2.0 的复杂性，5 分钟即可上手。

[[TOC]]

---

## 一、什么是审批流引擎

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

### 1.2 审批流引擎的解决思路

审批流引擎的核心思想是：**把审批流程从业务代码中抽离出来，用流程定义描述审批节点、审批人和流转规则，由引擎负责任务分配、状态流转和历史记录**。

```jsonc
// FlowLong 方式：审批流程是数据，不是代码
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
Long instanceId = runtimeService.start(processId, ticket.getId().toString(),
    createUser, variables);
// 审批人办理任务
taskService.complete(taskId, approverId, "同意，退款金额核对无误");
```

这样带来的好处：

- **流程与代码解耦**：审批流程存储在数据库，修改不需要重新发版
- **流程可视化**：JSON 定义即流程图，运营和产品都能理解
- **完整审批轨迹**：引擎自动记录每一步审批历史
- **丰富审批操作**：驳回、转办、委派、加签等开箱即用
- **状态管理可靠**：引擎负责并发控制和状态一致性

### 1.3 审批流引擎 vs 工作流引擎 vs 流程编排引擎

在前面的文章中，我们已经介绍了[表达式引擎](/ai-cs/qlexpress-study-notes/)和[流程编排引擎](/ai-cs/flow-orchestration-engine/)。审批流引擎在技术栈中处于一个独特的位置——它比流程编排引擎更重（有持久化、有人工任务），比通用工作流引擎更轻（不需要 BPMN 2.0 的复杂性）。

| 维度 | 表达式引擎 | 流程编排引擎 | 审批流引擎 | 工作流引擎 |
|------|----------|------------|-----------|-----------|
| **核心能力** | 单条表达式求值 | 多步骤自动编排 | 人工审批任务流转 | 完整 BPM 流程管理 |
| **人工任务** | 不支持 | 不支持 | **核心能力** | 核心能力 |
| **状态持久化** | 无 | 通常无 | **数据库持久化** | 数据库持久化 |
| **流程描述** | 表达式字符串 | DSL（XML/JSON/YML） | **JSON** | BPMN 2.0 XML |
| **典型代表** | QLExpress、Aviator | LiteFlow、CompileFlow | **FlowLong** | Activiti、Flowable |
| **复杂度** | 极低 | 低 | **低~中** | 高 |
| **学习曲线** | 极低 | 低 | **低** | 高 |
| **适用场景** | 条件判断、计算 | 业务步骤编排 | 审批、工单流转 | 复杂企业级流程 |

::: tip 四者的关系
**表达式引擎**解决"一个条件怎么判断"；**流程编排引擎**解决"多个步骤怎么协调"；**审批流引擎**解决"人工任务怎么流转"；**工作流引擎**解决"长周期复杂流程怎么治理"。四者互补，覆盖了从简单到复杂的完整流程管理需求。
:::

![四种流程引擎核心差异对比](/ai-cs/flow-orchestration/flowlong-analysis/engine-type-comparison.svg)

### 1.4 主流审批流/工作流引擎对比

| 引擎 | 出品方 | 流程描述 | 依赖大小 | 特点 |
|------|--------|---------|---------|------|
| **FlowLong** | aizuda | JSON | ~1MB | 极简轻量，专注审批场景，MyBatis-Plus 生态 |
| **Activiti** | Alfresco | BPMN 2.0 XML | ~30MB+ | 功能完整，国际标准，社区成熟 |
| **Flowable** | Flowable | BPMN 2.0 XML | ~30MB+ | Activiti 分支，功能更丰富，支持 CMMN/DMN |
| **Camunda** | Camunda | BPMN 2.0 XML | ~40MB+ | 企业级流程引擎，监控能力强 |
| **SnakerFlow** | snakerflow | XML | ~5MB | 国产轻量工作流，类 Activiti 设计 |

本文聚焦于 **FlowLong**——它代表了"极简审批流"范式，用最小的代价解决最高频的审批需求。如果你的系统只需要审批功能，不需要 BPMN 2.0 的全套复杂性，FlowLong 是 JVM 生态中最值得考虑的选择。

---

## 二、FlowLong 简介

### 2.1 项目背景

FlowLong 由 aizuda 团队开发并开源，与 MyBatis-Plus 同源生态。它的设计初衷很简单：**Activiti 太重，手写太累，需要一个刚刚好的审批流引擎**。

在真实业务中，90% 的流程需求其实就是"审批"——请假审批、报销审批、工单审批、合同审批。这些场景的共同特征是：**有人工参与的节点、需要持久化任务状态、需要记录审批历史**。但对于这些场景，引入 Activiti/Flowable 这种重量级工作流引擎往往是大材小用——BPMN 2.0 的复杂性、大量不必要的表结构、陡峭的学习曲线，都增加了项目的维护成本。

FlowLong 的设计理念是：**用 JSON 描述流程，用 MyBatis-Plus 持久化，用最少的代码完成最多的审批场景**。它不追求 BPMN 2.0 标准兼容，不追求覆盖所有 BPM 场景，而是专注于把"审批"这件事做到极致简单。

### 2.2 核心特性

| 特性 | 说明 |
|------|------|
| **极简轻量** | 核心 JAR 仅约 1MB，依赖极少，零 BPMN 知识要求 |
| **JSON 流程定义** | 用 JSON 描述流程，无需 BPMN 2.0 XML，直观易读 |
| **丰富审批操作** | 同意、驳回、转办、委派、加签、减签、撤回，开箱即用 |
| **多种审批模式** | 串行审批、并行审批、会签（全票通过）、或签（任一通过） |
| **条件路由** | 条件节点支持表达式动态路由，按业务变量选择分支 |
| **抄送通知** | 原生支持抄送节点，审批结果自动通知相关人员 |
| **MyBatis-Plus 持久化** | 基于 MyBatis-Plus，数据库操作透明可追踪 |
| **Spring Boot 集成** | 提供 Starter，自动配置，即引即用 |
| **审批历史追溯** | 完整记录每一步审批操作，支持查询和审计 |
| **动态审批人** | 支持在运行时动态指定审批人，通过变量表达式 `${var}` 解析 |
| **流程版本管理** | 支持流程定义多版本，新版本不影响进行中的实例 |

### 2.3 Maven 依赖

```xml
<dependency>
    <groupId>com.aizuda</groupId>
    <artifactId>flowlong-spring-boot-starter</artifactId>
    <version>1.0.9</version>
</dependency>
```

::: tip 版本说明
FlowLong 的 `groupId` 为 `com.aizuda`，`artifactId` 为 `flowlong-spring-boot-starter`（Spring Boot 项目）。如需使用 MyBatis-Plus 数据访问层，确保项目中已引入 MyBatis-Plus 依赖。环境要求 JDK 8+、Spring Boot 2.x/3.x。
:::

::: warning API 版本声明
本文基于 FlowLong 1.0.x 版本撰写，API 接口和配置项可能随版本更新而变化。示例中的类名、方法签名、JSON 字段等请以[官方文档](https://flowlong.com/)为准。在升级版本前，建议查阅官方 Changelog 确认兼容性变更。
:::

```yaml
# application.yml 最简配置
flowlong:
  # 数据库表前缀（默认 flw_）
  table-prefix: flw_
  # 是否自动建表（开发环境推荐 true）
  auto-create-table: true
```

### 2.4 数据库表结构

FlowLong 的持久化层基于 MyBatis-Plus，核心表结构如下：

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `flw_process` | 流程定义 | `id`、`flow_name`、`flow_json`（JSON 定义）、`version` |
| `flw_instance` | 流程实例 | `id`、`process_id`、`business_id`（业务关联）、`create_time` |
| `flw_task` | 待办任务 | `id`、`instance_id`、`node_code`、`node_name`、`assignee`（审批人） |
| `flw_his_instance` | 历史实例 | 记录已完成或已取消的流程实例 |
| `flw_his_task` | 历史任务 | 记录每个已办理的任务及其审批意见 |
| `flw_recruit_task` | 加签任务 | 记录加签产生的临时任务 |
| `flw_copy_task` | 抄送任务 | 记录抄送通知信息 |

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  flw_process  │     │ flw_instance  │     │   flw_task    │
│  (流程定义)    │────→│  (流程实例)    │────→│  (待办任务)    │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                     ┌──────▼───────┐     ┌──────▼───────┐
                     │flw_his_instance│    │ flw_his_task  │
                     │  (历史实例)    │     │  (历史任务)    │
                     └──────────────┘     └──────────────┘

    ┌──────────────────┐     ┌──────────────────┐
    │ flw_recruit_task  │     │  flw_copy_task   │
    │  (加签任务)        │     │  (抄送任务)       │
    └──────────────────┘     └──────────────────┘
```

::: tip 自动建表
开发环境可通过 `flowlong.auto-create-table=true` 自动创建所有表。生产环境建议使用 Flyway/Liquibase 管理表结构变更。
:::

---

## 三、快速上手

### 3.1 流程定义（JSON 格式）

FlowLong 使用 JSON 描述流程定义，相比 BPMN 2.0 XML 更加简洁直观：

```json
{
  "flowName": "请假审批流程",
  "flowNodes": [
    {
      "nodeType": 0,
      "nodeCode": "start",
      "nodeName": "开始",
      "nextNodeCode": "manager_approval"
    },
    {
      "nodeType": 1,
      "nodeCode": "manager_approval",
      "nodeName": "主管审批",
      "permissionList": [
        { "type": 0, "handler": "${manager_id}" }
      ],
      "nextNodeCode": "check_days"
    },
    {
      "nodeType": 4,
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
      "nodeType": 2,
      "nodeCode": "cc_hr",
      "nodeName": "抄送HR",
      "permissionList": [
        { "type": 0, "handler": "${hr_id}" }
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

这个 JSON 定义了一个完整的请假审批流程：**开始 → 主管审批 → 条件判断（>3天走总监审批）→ 抄送HR → 结束**。看 JSON 就能理解流程全貌，无需可视化设计器。

### 3.2 启动流程

```java
@Service
public class LeaveService {

    @Autowired
    private ProcessService processService;

    @Autowired
    private RuntimeService runtimeService;

    @Autowired
    private TaskService taskService;

    /**
     * 发起请假申请
     */
    public Long submitLeave(LeaveRequest request) {
        // 1. 部署流程定义（通常在系统初始化时完成，这里仅为演示）
        Long processId = processService.deploy(loadFlowJson("leave-approval.json"));

        // 2. 准备流程变量（用于条件判断和审批人解析）
        Map<String, Object> variables = new HashMap<>();
        variables.put("days", request.getDays());
        variables.put("manager_id", request.getManagerId());
        variables.put("director_id", request.getDirectorId());
        variables.put("hr_id", request.getHrId());

        // 3. 启动流程实例
        //    businessId 关联业务数据（如请假单ID）
        //    createUser 为发起人信息
        FlowLongUser createUser = FlowLongUser.of(
            request.getApplicantId(),
            request.getApplicantName()
        );

        Long instanceId = runtimeService.start(
            processId,
            request.getLeaveId().toString(),  // businessId
            createUser,
            variables
        );

        return instanceId;
    }
}
```

### 3.3 办理任务

```java
/**
 * 审批人办理任务
 */
public void approve(Long taskId, Long approverId, String comment) {
    // 查询待办任务
    FlowLongTask task = taskService.getById(taskId);

    // 验证审批人身份
    if (!String.valueOf(approverId).equals(task.getAssignee())) {
        throw new RuntimeException("无权审批此任务");
    }

    // 办理任务（同意）
    taskService.complete(taskId, approverId, comment);
    // 引擎自动：关闭当前任务 → 创建历史记录 → 解析下一节点 → 创建新任务
}

/**
 * 驳回任务
 */
public void reject(Long taskId, Long approverId, String comment) {
    // 驳回到发起人重新提交
    taskService.reject(taskId, approverId, comment);
}

/**
 * 查询我的待办
 */
public List<FlowLongTask> myTasks(Long userId) {
    return taskService.listByUserId(userId);
}
```

### 3.4 完整示例

将上面的步骤串联起来，一个完整的请假审批流程如下：

```java
@Service
public class LeaveApprovalDemo {

    @Autowired
    private LeaveService leaveService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private HistoryService historyService;

    public void demo() {
        // ========== 1. 发起请假 ==========
        LeaveRequest request = new LeaveRequest();
        request.setLeaveId(1001L);
        request.setApplicantId(2001L);
        request.setApplicantName("张三");
        request.setDays(5);  // 请假5天，需要总监审批
        request.setManagerId(3001L);
        request.setDirectorId(4001L);
        request.setHrId(5001L);

        Long instanceId = leaveService.submitLeave(request);
        System.out.println("流程已启动，实例ID: " + instanceId);

        // ========== 2. 主管审批 ==========
        List<FlowLongTask> managerTasks = taskService.listByUserId(3001L);
        FlowLongTask managerTask = managerTasks.get(0);
        taskService.complete(managerTask.getId(), 3001L, "同意，注意交接工作");
        // 引擎自动流转到条件判断 → days=5 > 3 → 总监审批节点

        // ========== 3. 总监审批 ==========
        List<FlowLongTask> directorTasks = taskService.listByUserId(4001L);
        FlowLongTask directorTask = directorTasks.get(0);
        taskService.complete(directorTask.getId(), 4001L, "同意");
        // 引擎自动流转到抄送HR → 结束

        // ========== 4. 查看审批历史 ==========
        List<FlowLongHisTask> history = historyService.listByInstanceId(instanceId);
        for (FlowLongHisTask hisTask : history) {
            System.out.printf("节点: %s, 审批人: %s, 意见: %s, 时间: %s%n",
                hisTask.getNodeName(),
                hisTask.getApproverName(),
                hisTask.getComment(),
                hisTask.getCompleteTime());
        }
        // 输出:
        // 节点: 主管审批, 审批人: 3001, 意见: 同意，注意交接工作, 时间: ...
        // 节点: 总监审批, 审批人: 4001, 意见: 同意, 时间: ...
    }
}
```

三步搞定：**定义流程 JSON → 启动流程 → 办理任务**。业务代码只关心业务数据，审批流转完全由引擎驱动。

---

## 四、流程定义与节点类型

### 4.1 JSON 流程定义格式

FlowLong 的 JSON 流程定义由两部分组成：流程元信息 + 节点列表。

```jsonc
{
  "flowName": "流程名称",
  "version": "1.0.0",          // 可选，版本号
  "flowNodes": [                // 节点列表
    {
      "nodeType": 0,            // 节点类型（0=开始, 1=审批, 2=抄送, 3=结束, 4=条件）
      "nodeCode": "唯一标识",
      "nodeName": "显示名称",
      "nextNodeCode": "下一节点",  // 非条件节点的下一节点
      "permissionList": [],      // 审批人列表（审批/抄送节点）
      "conditionList": [],       // 条件分支（条件节点）
      "nodeRatio": null          // 会签比例（可选）
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `flowName` | String | 流程名称 |
| `version` | String | 流程版本号 |
| `flowNodes` | Array | 节点列表 |
| `nodeType` | int | 节点类型：0=开始，1=审批，2=抄送，3=结束，4=条件 |
| `nodeCode` | String | 节点唯一编码 |
| `nodeName` | String | 节点显示名称 |
| `nextNodeCode` | String | 下一节点编码（非条件节点使用） |
| `permissionList` | Array | 审批人/抄送人列表 |
| `conditionList` | Array | 条件分支列表（条件节点使用） |
| `nodeRatio` | Float | 会签比例，如 `1.0` 表示全票通过，`0.5` 表示半数通过 |

### 4.2 节点类型详解

![FlowLong五种节点类型总览](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-node-types-overview.svg)

FlowLong 支持五种节点类型，覆盖了审批流的核心场景：

#### 开始节点（nodeType = 0）

流程入口，每个流程有且仅有一个开始节点。

```json
{
  "nodeType": 0,
  "nodeCode": "start",
  "nodeName": "开始",
  "nextNodeCode": "first_approval"
}
```

#### 审批节点（nodeType = 1）

最核心的节点类型，表示需要人工审批的环节。

```json
{
  "nodeType": 1,
  "nodeCode": "manager_approval",
  "nodeName": "主管审批",
  "permissionList": [
    { "type": 0, "handler": "${manager_id}" }
  ],
  "nextNodeCode": "next_node",
  "nodeRatio": null  // null=单人审批，1.0=会签（全票），0.5=半数通过
}
```

#### 抄送节点（nodeType = 2）

仅通知，不需要审批。任务自动完成，仅记录抄送信息。

```json
{
  "nodeType": 2,
  "nodeCode": "cc_hr",
  "nodeName": "抄送HR",
  "permissionList": [
    { "type": 0, "handler": "${hr_id}" }
  ],
  "nextNodeCode": "end"
}
```

#### 结束节点（nodeType = 3）

流程出口，表示流程正常结束。

```json
{
  "nodeType": 3,
  "nodeCode": "end",
  "nodeName": "结束"
}
```

#### 条件节点（nodeType = 4）

根据表达式动态选择下一个执行节点，类似 `switch-case`。

```json
{
  "nodeType": 4,
  "nodeCode": "check_amount",
  "nodeName": "金额判断",
  "conditionList": [
    { "nodeCode": "director_approval", "expression": "amount > 10000" },
    { "nodeCode": "manager_approval", "expression": "amount > 1000" },
    { "nodeCode": "end", "expression": "amount <= 1000" }
  ]
}
```

::: tip 条件匹配规则
条件节点的 `conditionList` 按顺序匹配，第一个满足 `expression` 的分支会被执行。如果所有条件都不满足，流程会报错——建议最后一个条件使用 `default` 或恒真表达式作为兜底。
:::

### 4.3 审批人设置

`permissionList` 定义了每个审批/抄送节点的处理人：

```jsonc
"permissionList": [
  {
    "type": 0,                    // 审批人类型
    "handler": "${manager_id}"     // 审批人标识
  }
]
```

| `type` 值 | 含义 | `handler` 格式 | 示例 |
|-----------|------|---------------|------|
| 0 | 指定用户 | 用户ID 或 `${变量名}` | `"1001"` 或 `"${manager_id}"` |
| 1 | 指定角色 | 角色标识 | `"role_manager"` |
| 2 | 指定部门 | 部门ID | `"dept_001"` |

::: tip 动态审批人
`handler` 字段支持 `${变量名}` 语法，在流程启动时通过 `variables` 传入实际值。这样可以根据业务上下文动态指定审批人——比如根据工单的部门归属，动态解析出对应部门的主管。
:::

```java
// 启动流程时传入动态审批人
Map<String, Object> variables = new HashMap<>();
variables.put("manager_id", deptService.getManagerId(ticket.getDeptId()));
variables.put("director_id", deptService.getDirectorId());

runtimeService.start(processId, businessId, createUser, variables);
```

### 4.4 条件表达式

条件节点的 `expression` 支持简单的表达式语法：

```json
"conditionList": [
  { "nodeCode": "director_approval", "expression": "amount > 10000 && category == 'refund'" },
  { "nodeCode": "manager_approval", "expression": "amount > 1000" },
  { "nodeCode": "end", "expression": "default" }
]
```

| 表达式 | 说明 |
|--------|------|
| `amount > 10000` | 数值比较 |
| `category == 'refund'` | 字符串相等判断 |
| `days > 3 && urgency == 'high'` | 逻辑与 |
| `type == 'A' \|\| type == 'B'` | 逻辑或 |
| `default` | 兜底条件，恒真 |

表达式中的变量名对应启动流程时传入的 `variables` Map 中的 key。

::: tip 与 QLExpress 的配合
FlowLong 的条件表达式语法相对简单，适用于基本的条件路由。如果需要更复杂的条件判断逻辑，可以在业务层使用 [QLExpress4](/ai-cs/qlexpress-study-notes/) 预先计算结果，再将结果作为变量传入 FlowLong 的条件节点。
:::

---

## 五、审批操作详解

### 5.1 串行审批与并行审批

![串行审批vs并行审批对比](/ai-cs/flow-orchestration/flowlong-analysis/serial-vs-parallel-comparison.svg)

FlowLong 通过 `permissionList` 的配置方式区分串行和并行审批：

#### 串行审批

多个审批人按顺序依次审批，前一个审批完成后才轮到下一个：

```json
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

#### 并行审批

多个审批人同时收到任务，各自独立审批：

```json
{
  "nodeType": 1,
  "nodeCode": "parallel_approval",
  "nodeName": "并行审批",
  "permissionList": [
    { "type": 0, "handler": "${manager_id}" },
    { "type": 0, "handler": "${finance_id}" }
  ],
  "nodeRatio": 1.0,
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
| **`nodeRatio`** | 不设置 | 设置（如 `1.0` 全票通过） |
| **适用场景** | 有层级关系的审批 | 同级并行审核、会签 |

### 5.2 会签与或签

会签和或签是并行审批的两种特殊模式，通过 `nodeRatio` 字段控制：

| 模式 | `nodeRatio` | 含义 | 示例 |
|------|------------|------|------|
| **会签** | `1.0` | 全部同意才通过 | 三人审批，三人都同意才流转 |
| **或签** | `0` | 任一同意即通过 | 三人审批，任何一人同意即流转 |
| **比例签** | `0.5` | 达到比例即通过 | 五人审批，三人（60%）同意即通过 |

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

::: tip 会签的内部机制
当 `nodeRatio` 设置后，引擎会同时为所有审批人创建任务。每次有人完成审批时，引擎检查已通过的比例是否达到 `nodeRatio`。达到则关闭所有剩余任务并流转到下一节点；如果有人驳回，则直接终止整组任务。
:::

### 5.3 驳回

驳回是审批流中最常见的操作之一。FlowLong 支持驳回至发起人重新提交：

```java
// 驳回当前任务，流程回到发起人
taskService.reject(taskId, approverId, "信息不完整，请补充后重新提交");

// 驳回后的流程状态：
// 1. 当前任务关闭，记录到历史
// 2. 流程实例状态变为"驳回"
// 3. 发起人收到重新提交的通知
// 4. 发起人修改后重新提交，流程从第一个审批节点重新开始
```

驳回后重新提交的流转机制：

```text
正常流程：  开始 → 主管审批 → 总监审批 → 结束
驳回流程：  开始 → 主管审批 ✗（驳回）
                    ↓
               发起人修改 → 重新提交 → 主管审批 → 总监审批 → 结束
```

::: warning 驳回的范围
FlowLong 默认的驳回行为是回到发起人重新提交。如果业务需要"驳回至上一个审批节点"而非回到发起人，需要在业务层自定义驳回逻辑。
:::

### 5.4 转办与委派

转办和委派都是将任务交给他人处理，但语义不同：

| 操作 | 语义 | 任务归属 | 适用场景 |
|------|------|---------|---------|
| **转办** | 我不审批了，换人来审 | 转办后任务归属被转办人 | 审批人不在/不合适 |
| **委派** | 我请人帮忙先审，最终还是要我确认 | 委派人审批后任务回到委派人 | 请上级/专家协助预审 |

```java
// 转办：把任务转给其他人审批
// 转办后，原审批人不再参与此任务
taskService.transfer(taskId, currentUserId, targetUserId, "我不负责此领域，转给技术主管");

// 委派：请他人帮忙预审，预审后任务回到自己手中
// 委派人完成预审后，任务重新分配给原审批人
taskService.delegate(taskId, currentUserId, targetUserId, "请法务先审核合同条款");
```

```text
转办流程：  审批人A ──转办──→ 审批人B ──→ 下一节点
                       （A退出，B接手）

委派流程：  审批人A ──委派──→ 委派人B ──预审──→ 审批人A ──→ 下一节点
                       （B预审后，任务回到A）
```

### 5.5 加签与减签

加签是在审批过程中临时增加审批人，减签是减少审批人。这是中国式审批的特色功能：

| 加签类型 | 说明 | 示例场景 |
|---------|------|---------|
| **前加签** | 在当前审批人之前增加审批人 | 主管觉得需要组长先确认 |
| **后加签** | 在当前审批人之后增加审批人 | 主管审批后需要增加风控审核 |
| **并行加签** | 增加与当前审批人并行的审批人 | 需要增加一个会签人 |

```java
// 加签：在当前任务上增加审批人
// 前加签：新审批人先审，审完回到当前审批人
taskService.addSign(taskId, currentUserId, SignType.BEFORE,
    Arrays.asList(FlowLongUser.of(6001L, "赵组长")), "请组长先确认");

// 并行加签：新审批人与当前审批人同时审批
taskService.addSign(taskId, currentUserId, SignType.PARALLEL,
    Arrays.asList(FlowLongUser.of(7001L, "孙风控")), "需要风控同步审核");

// 减签：移除某个审批人（仅并行/会签场景）
taskService.removeSign(taskId, currentUserId, targetUserId, "该审批人已调离");
```

加签产生的临时任务记录在 `flw_recruit_task` 表中，与原始任务关联。

### 5.6 撤回

撤回是发起人在审批人尚未办理时，将任务收回：

```java
// 撤回：在下一节点审批人尚未办理时，收回任务
// 撤回条件：下一节点任务未被处理
boolean success = taskService.revoke(taskId, currentUserId, "信息有误，撤回修改");

if (success) {
    // 撤回成功，任务回到发起人手中
    // 发起人可以修改后重新提交
} else {
    // 撤回失败，审批人已开始处理
    throw new RuntimeException("审批人已处理，无法撤回");
}
```

```text
正常流程：  发起人 → 主管审批（待办中）→ ...
撤回流程：  发起人 → 主管审批（待办中）
                       ↓ 撤回
              任务回到发起人，可修改后重新提交
```

::: warning 撤回的条件
撤回仅在下一审批节点尚未办理时有效。如果审批人已经完成审批（同意/驳回），则无法撤回。引擎会检查任务状态，确保撤回操作的安全性。
:::

### 5.7 流程取消

流程取消（又称"终止流程"）是指强制结束一个正在进行的流程实例，通常在业务数据失效或流程不再需要时使用：

```java
/**
 * 取消流程实例
 * 适用于：业务数据被删除、流程不再需要、异常情况强制终止
 */
public void cancelProcess(Long instanceId, String reason) {
    // 取消流程实例
    // 引擎内部执行：
    // 1. 检查流程实例是否存在且处于运行状态
    // 2. 关闭所有待办任务（从 flw_task 删除）
    // 3. 将流程实例移到历史表（flw_his_instance）
    // 4. 标记实例状态为"已取消"
    runtimeService.cancel(instanceId, reason);
}

/**
 * 业务场景示例：工单被删除时取消关联的审批流程
 */
public void onTicketDeleted(Long ticketId) {
    // 根据 businessId 查询流程实例
    FlwInstance instance = runtimeService.getByBusinessId(ticketId.toString());
    if (instance != null && instance.isRunning()) {
        runtimeService.cancel(instance.getId(), "工单已删除，流程自动取消");
    }
}
```

```text
正常流程：  开始 → 主管审批 → 总监审批 → 结束
取消流程：  开始 → 主管审批（待办中）
                       ↓ 取消
              流程实例标记为"已取消"，所有待办任务关闭
```

::: warning 流程取消的注意事项
- 流程取消是**不可逆操作**，取消后无法恢复
- 取消后流程实例会进入历史表，可通过 `HistoryService` 查询
- 建议在取消前记录取消原因，便于后续审计
- 与"驳回"的区别：驳回是审批操作的一种，流程仍在运行（发起人可重新提交）；取消是强制终止，流程彻底结束
:::

---

## 六、架构与运行机制

### 6.1 整体架构

![FlowLong分层架构](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-architecture-overview.svg)

FlowLong 采用分层架构设计，各层职责清晰：

```text
┌─────────────────────────────────────────────────────┐
│                    业务层                              │
│         LeaveService / TicketService / ...            │
└──────────────────────┬──────────────────────────────┘
                       │ 调用
┌──────────────────────▼──────────────────────────────┐
│                  FlowLongEngine                       │
│              （引擎入口 / 统一调度）                     │
├──────────┬──────────┬──────────┬─────────────────────┤
│ Process  │ Runtime  │   Task   │     History         │
│ Service  │ Service  │ Service  │     Service         │
│ (流程定义) │ (流程实例) │ (任务管理) │   (历史记录)          │
├──────────┴──────────┴──────────┴─────────────────────┤
│              MyBatis-Plus 数据访问层                    │
│    FlwProcessMapper / FlwInstanceMapper / ...        │
├───────────────────────────────────────────────────────┤
│                  数据库（MySQL）                        │
│  flw_process / flw_instance / flw_task / flw_his_*   │
└───────────────────────────────────────────────────────┘
```

| 层级 | 职责 | 核心类 |
|------|------|-------|
| **引擎入口** | 统一调度，门面模式 | `FlowLongEngine` |
| **流程定义服务** | 流程的部署、查询、版本管理 | `ProcessService` |
| **运行时服务** | 流程实例的启动、取消、查询 | `RuntimeService` |
| **任务服务** | 任务的办理、转办、委派、加签、驳回 | `TaskService` |
| **历史服务** | 历史实例和任务的查询、审计 | `HistoryService` |
| **数据访问层** | 基于 MyBatis-Plus 的 CRUD | `*Mapper` |

### 6.2 流程启动机制

当调用 `runtimeService.start()` 启动流程时，引擎内部执行以下步骤：

```text
runtimeService.start(processId, businessId, createUser, variables)
     │
     ▼
┌─────────────────────────────────┐
│ 1. 加载流程定义                    │  从 flw_process 表读取 JSON
│    解析 JSON → FlowModel         │  反序列化为内存模型
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 2. 创建流程实例                    │  写入 flw_instance 表
│    记录 businessId、发起人         │  关联业务数据
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 3. 解析第一个审批节点               │  从开始节点的 nextNodeCode
│    解析审批人（变量替换）            │  ${manager_id} → 实际值
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 4. 创建待办任务                    │  写入 flw_task 表
│    通知审批人                      │  可扩展通知方式
└─────────────────────────────────┘
```

```java
// 引擎启动流程的伪代码
public Long start(Long processId, String businessId, FlowLongUser createUser,
                  Map<String, Object> variables) {
    // 1. 加载并解析流程定义
    FlwProcess process = processMapper.selectById(processId);
    FlowModel flowModel = JSON.parseObject(process.getFlowJson(), FlowModel.class);

    // 2. 创建流程实例
    FlwInstance instance = new FlwInstance();
    instance.setProcessId(processId);
    instance.setBusinessId(businessId);
    instance.setCreateUserId(createUser.getUserId());
    instance.setCreateTime(LocalDateTime.now());
    instanceMapper.insert(instance);

    // 3. 解析第一个审批节点（从 start 节点的 nextNodeCode 开始）
    FlowNode startNode = flowModel.getNode("start");
    FlowNode firstApprovalNode = flowModel.getNode(startNode.getNextNodeCode());

    // 4. 解析审批人（变量替换）
    List<FlowLongUser> approvers = resolvePermissionList(
        firstApprovalNode.getPermissionList(), variables);

    // 5. 创建待办任务
    for (FlowLongUser approver : approvers) {
        FlwTask task = new FlwTask();
        task.setInstanceId(instance.getId());
        task.setNodeCode(firstApprovalNode.getNodeCode());
        task.setNodeName(firstApprovalNode.getNodeName());
        task.setAssignee(approver.getUserId());
        taskMapper.insert(task);
    }

    return instance.getId();
}
```

### 6.3 任务流转机制

当审批人办理任务时，引擎执行以下流转逻辑：

```text
taskService.complete(taskId, userId, comment)
     │
     ▼
┌─────────────────────────────────┐
│ 1. 关闭当前任务                    │  从 flw_task 删除
│    记录到历史                      │  写入 flw_his_task
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 2. 检查并行/会签是否完成             │  如果是会签节点
│    未完成 → 等待其他审批人            │  检查 nodeRatio 是否达到
└──────────┬──────────────────────┘
           │ 完成
           ▼
┌─────────────────────────────────┐
│ 3. 解析下一节点                    │  读取 nextNodeCode
│    条件节点 → 匹配 expression      │  或 conditionList 匹配
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ 4. 创建下一节点任务                 │  写入 flw_task
│    或到达结束节点 → 完成流程实例      │  或更新 flw_instance 状态
└─────────────────────────────────┘
```

关键流转规则：

| 当前节点类型 | 流转逻辑 |
|------------|---------|
| 审批节点（单人） | 直接流转到 `nextNodeCode` |
| 审批节点（会签） | 检查 `nodeRatio`，未达到则等待，达到后流转 |
| 抄送节点 | 自动完成，创建抄送记录后立即流转 |
| 条件节点 | 匹配 `conditionList` 中的 `expression`，跳转到匹配的 `nodeCode` |
| 结束节点 | 标记流程实例为已完成 |

### 6.4 持久化机制

FlowLong 的持久化完全基于 MyBatis-Plus，所有数据操作通过 Mapper 接口完成：

```java
// 引擎内部的数据操作示例（简化）
// 1. 创建任务
FlwTask task = new FlwTask();
task.setInstanceId(instanceId);
task.setNodeCode("manager_approval");
task.setNodeName("主管审批");
task.setAssignee(managerId);
task.setCreateTime(LocalDateTime.now());
taskMapper.insert(task);  // MyBatis-Plus 自动 insert

// 2. 完成任务
FlwTask pendingTask = taskMapper.selectById(taskId);
// 移到历史表
FlwHisTask hisTask = FlwHisTask.of(pendingTask, approverId, "同意", LocalDateTime.now());
hisTaskMapper.insert(hisTask);
// 删除待办
taskMapper.deleteById(taskId);

// 3. 创建下一节点任务
FlwTask nextTask = new FlwTask();
nextTask.setInstanceId(pendingTask.getInstanceId());
nextTask.setNodeCode(nextNode.getNodeCode());
nextTask.setAssignee(nextApproverId);
taskMapper.insert(nextTask);
```

::: tip MyBatis-Plus 的优势
基于 MyBatis-Plus 意味着：
- **零 SQL 编写**：所有 CRUD 通过 BaseMapper 自动完成
- **分页友好**：审批列表、待办查询天然支持 MyBatis-Plus 分页插件
- **多数据库兼容**：通过 MyBatis-Plus 的数据库方言，支持 MySQL、PostgreSQL、Oracle 等
- **事务管理**：集成 Spring 事务，流程操作自动参与数据库事务
:::

### 6.5 事件监听机制

FlowLong 提供了事件监听机制，允许业务系统在流程状态变化时执行自定义逻辑，实现流程与业务的解耦：

```java
/**
 * FlowLong 事件类型
 */
public enum FlowLongEventType {
    PROCESS_STARTED,      // 流程已启动
    PROCESS_COMPLETED,    // 流程已完成
    PROCESS_CANCELLED,    // 流程已取消
    PROCESS_REJECTED,     // 流程被驳回
    TASK_CREATED,         // 任务已创建
    TASK_COMPLETED,       // 任务已完成（同意）
    TASK_REJECTED,        // 任务已驳回
    TASK_TRANSFERRED,     // 任务已转办
    TASK_DELEGATED        // 任务已委派
}
```

```java
/**
 * 注册事件监听器
 */
@Component
public class TicketFlowListener {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private TicketService ticketService;

    /**
     * 监听任务创建事件：通知审批人
     */
    @FlowLongListener(event = TASK_CREATED)
    public void onTaskCreated(FlowLongEvent event) {
        Long taskId = event.getTaskId();
        Long assignee = event.getAssignee();
        String nodeName = event.getNodeName();

        // 发送通知给审批人
        notificationService.send(assignee,
            String.format("您有新的【%s】任务需要处理", nodeName));
    }

    /**
     * 监听流程完成事件：更新业务状态
     */
    @FlowLongListener(event = PROCESS_COMPLETED)
    public void onProcessCompleted(FlowLongEvent event) {
        String businessId = event.getBusinessId();
        Long ticketId = Long.parseLong(businessId);

        // 更新工单状态为"已审批"
        ticketService.updateStatus(ticketId, TicketStatus.APPROVED);
    }

    /**
     * 监听流程驳回事件：通知发起人
     */
    @FlowLongListener(event = PROCESS_REJECTED)
    public void onProcessRejected(FlowLongEvent event) {
        String businessId = event.getBusinessId();
        Long creatorId = event.getCreatorId();
        String reason = event.getReason();

        // 通知发起人流程被驳回
        notificationService.send(creatorId,
            String.format("您的申请已被驳回，原因：%s", reason));

        // 更新工单状态
        ticketService.updateStatus(Long.parseLong(businessId), TicketStatus.REJECTED);
    }

    /**
     * 监听流程取消事件：清理关联数据
     */
    @FlowLongListener(event = PROCESS_CANCELLED)
    public void onProcessCancelled(FlowLongEvent event) {
        String businessId = event.getBusinessId();
        // 更新业务状态为"已取消"
        ticketService.updateStatus(Long.parseLong(businessId), TicketStatus.CANCELLED);
    }
}
```

::: tip 事件监听的最佳实践
- **通知解耦**：通过事件监听发送通知，避免在业务代码中硬编码通知逻辑
- **状态同步**：监听流程完成/驳回/取消事件，同步更新业务数据状态
- **审计日志**：监听所有事件类型，记录完整的操作审计日志
- **异步处理**：对于耗时的监听逻辑（如发送邮件），建议使用 `@Async` 异步执行，避免阻塞流程流转
:::

### 6.6 流程版本管理机制

FlowLong 支持流程定义的多版本管理，新版本部署后不影响进行中的旧版本实例：

```java
/**
 * 流程版本管理示例
 */
@Service
public class ProcessVersionService {

    @Autowired
    private ProcessService processService;

    /**
     * 部署新版本流程定义
     * 每次部署会生成一个新版本号，旧版本继续保留
     */
    public Long deployNewVersion(String flowJson) {
        // 部署流程，版本号自动递增
        // 如果 flowName 相同，则创建新版本
        // 如果 flowName 不同，则创建新流程
        return processService.deploy(flowJson);
    }

    /**
     * 查询流程的所有版本
     */
    public List<FlwProcess> listVersions(String flowName) {
        return processService.listByFlowName(flowName);
    }

    /**
     * 查询当前激活的最新版本
     */
    public FlwProcess getActiveVersion(String flowName) {
        return processService.getLatestVersion(flowName);
    }

    /**
     * 按版本号查询特定版本
     */
    public FlwProcess getVersion(String flowName, Integer version) {
        return processService.getByVersion(flowName, version);
    }
}
```

版本管理的核心规则：

| 场景 | 行为 |
|------|------|
| **首次部署** | 创建版本 1 |
| **同名再部署** | 创建版本 2，版本 1 保留 |
| **启动流程** | 默认使用最新版本的流程定义 |
| **进行中实例** | 不受新版本影响，继续按旧版本执行 |
| **新发起实例** | 使用最新版本的流程定义 |

```text
版本 1 (v1)：开始 → 主管审批 → 结束
                    ↓
              已启动的实例 A（按 v1 执行）

版本 2 (v2)：开始 → 主管审批 → 总监审批 → 结束
                    ↓
              新启动的实例 B（按 v2 执行）

说明：实例 A 不受 v2 部署影响，继续按 v1 流程执行
```

::: tip 版本管理的最佳实践
- **流程变更时部署新版本**：不要直接修改已部署的流程 JSON，而是部署新版本
- **测试后再上线**：新版本部署后，先用测试业务验证流程正确性
- **保留旧版本**：不要删除旧版本定义，以便追溯历史实例的执行依据
- **版本说明**：在流程定义的 `version` 字段中记录版本变更说明
:::

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
      "nextNodeCode": "ai_classify"
    },
    {
      "nodeType": 1,
      "nodeCode": "ai_classify",
      "nodeName": "AI分类",
      "permissionList": [
        { "type": 0, "handler": "ai_system" }
      ],
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

    @Autowired
    private RuntimeService runtimeService;

    @Autowired
    private TaskService taskService;

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
        Map<String, Object> variables = new HashMap<>();
        variables.put("category", ticket.getCategory());
        variables.put("amount", ticket.getAmount());
        variables.put("severity", ticket.getSeverity());
        variables.put("manager_id", deptService.getManagerId(ticket.getDeptId()));
        variables.put("finance_id", financeService.getFinanceId());
        variables.put("senior_manager_id", deptService.getSeniorManagerId());
        variables.put("record_keeper_id", recordService.getKeeperId());

        // 启动审批流程
        return runtimeService.start(
            ticketProcessId,
            ticket.getId().toString(),
            FlowLongUser.of(ticket.getCreatorId(), ticket.getCreatorName()),
            variables
        );
    }

    /**
     * 审批人处理工单
     */
    public void processApproval(ApprovalRequest request) {
        switch (request.getAction()) {
            case APPROVE:
                taskService.complete(request.getTaskId(),
                    request.getApproverId(), request.getComment());
                break;
            case REJECT:
                taskService.reject(request.getTaskId(),
                    request.getApproverId(), request.getComment());
                break;
            case TRANSFER:
                taskService.transfer(request.getTaskId(),
                    request.getApproverId(),
                    request.getTargetUserId(),
                    request.getComment());
                break;
            case ADD_SIGN:
                taskService.addSign(request.getTaskId(),
                    request.getApproverId(), SignType.PARALLEL,
                    request.getAdditionalApprovers(),
                    request.getComment());
                break;
        }
    }

    /**
     * 查询我的待审批工单
     */
    public Page<TicketTaskVO> myPendingTasks(Long userId, int pageNum, int pageSize) {
        Page<FlowLongTask> taskPage = taskService.pageByUserId(userId, pageNum, pageSize);

        // 关联工单信息
        List<TicketTaskVO> voList = taskPage.getRecords().stream()
            .map(task -> {
                // businessId 存储在 FlwInstance 上，需通过 instanceId 查询实例获取
                FlwInstance instance = runtimeService.getById(task.getInstanceId());
                Ticket ticket = ticketMapper.selectById(Long.parseLong(instance.getBusinessId()));
                return TicketTaskVO.of(task, ticket);
            })
            .collect(Collectors.toList());

        return new Page<>(pageNum, pageSize, taskPage.getTotal()).setRecords(voList);
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

    @Autowired
    private RuntimeService runtimeService;

    @Autowired
    private TaskService taskService;

    @Autowired
    private HistoryService historyService;

    /**
     * AI 检测到高风险投诉，触发升级
     */
    public Long escalateComplaint(Complaint complaint) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("severity", complaint.getSeverity());
        variables.put("emotion_score", complaint.getEmotionScore());
        variables.put("first_manager_id", deptService.getManagerId(complaint.getDeptId()));
        variables.put("director_id", deptService.getDirectorId());
        variables.put("vp_id", deptService.getVPId());
        variables.put("legal_id", legalService.getLegalCounselId());

        return runtimeService.start(
            complaintEscalationProcessId,
            complaint.getId().toString(),
            FlowLongUser.of(complaint.getCustomerId(), complaint.getCustomerName()),
            variables
        );
    }

    /**
     * 查看投诉的完整审批轨迹
     */
    public List<ApprovalTraceVO> getApprovalTrace(Long instanceId) {
        List<FlowLongHisTask> history = historyService.listByInstanceId(instanceId);

        return history.stream()
            .map(hisTask -> ApprovalTraceVO.builder()
                .nodeName(hisTask.getNodeName())
                .approverName(hisTask.getApproverName())
                .comment(hisTask.getComment())
                .action(hisTask.getAction())  // APPROVE / REJECT / TRANSFER
                .completeTime(hisTask.getCompleteTime())
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

    @Autowired
    private RuntimeService runtimeService;

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
            Long instanceId = runtimeService.start(
                ctx.getProcessId(),
                ctx.getTicketId().toString(),
                FlowLongUser.of(ctx.getCustomerId(), ctx.getCustomerName()),
                ctx.toVariables()
            );
            ctx.setApprovalInstanceId(instanceId);
            ctx.setNeedManualApproval(true);
        }
    }
}
```

---

## 八、选型建议

![审批流引擎选型决策图](/ai-cs/flow-orchestration/flowlong-analysis/flowlong-selection-guide.svg)

### 8.1 FlowLong vs Activiti / Flowable

| 维度 | FlowLong | Activiti / Flowable |
|------|----------|-------------------|
| **依赖大小** | ~1MB | ~30MB+ |
| **流程描述** | JSON（简洁直观） | BPMN 2.0 XML（标准但复杂） |
| **学习曲线** | 低（5 分钟入门） | 高（需理解 BPMN 概念） |
| **人工审批** | ✅ 核心能力 | ✅ 核心能力 |
| **会签/或签** | ✅ 原生支持 | ✅ 支持（配置较复杂） |
| **驳回/转办/加签** | ✅ 开箱即用 | ✅ 支持（需自定义实现） |
| **可视化设计器** | ❌ 无（JSON 即定义） | ✅ Flowable Modeler |
| **BPMN 标准兼容** | ❌ 不兼容 | ✅ 完全兼容 |
| **定时任务/信号** | ❌ 不支持 | ✅ 支持 |
| **子流程** | ❌ 不支持 | ✅ 支持 |
| **多实例** | ✅ 会签/或签 | ✅ 支持（配置复杂） |
| **数据库表数量** | ~7 张 | ~20~40 张 |
| **持久化框架** | MyBatis-Plus | MyBatis / JPA |
| **Spring Boot 集成** | ✅ Starter | ✅ Starter |
| **社区生态** | 国内社区，发展中 | 国际社区，成熟 |
| **适用规模** | 中小型项目 | 中大型企业级项目 |

### 8.2 选择 FlowLong 的场景

- **只需要审批功能**：不需要 BPMN 的定时任务、信号、子流程等复杂特性
- **快速上手**：团队没有 BPMN 经验，希望 5 分钟内跑通审批流
- **轻量部署**：不想引入 30MB+ 的依赖，追求极简技术栈
- **MyBatis-Plus 生态**：项目已使用 MyBatis-Plus，FlowLong 无缝衔接
- **中国式审批**：需要会签、或签、加签、减签、转办、委派等特色功能
- **中小型项目**：审批流程不超过 10 个节点，不需要可视化设计器

### 8.3 选择 Activiti / Flowable 的场景

- **复杂企业级流程**：需要子流程、定时任务、信号事件、消息事件等
- **BPMN 标准兼容**：需要与国际标准对接，或使用第三方 BPMN 工具
- **可视化流程设计**：需要业务人员通过拖拽式设计器管理流程
- **流程治理**：需要完整的流程版本管理、部署管理、监控仪表盘
- **大规模部署**：流程数量多、并发量大，需要企业级稳定性保障
- **多系统集成**：需要与 CRM、ERP 等系统通过标准协议集成

::: tip 混合使用建议
如果你的系统既有自动编排需求（AI 处理流程），又有人工审批需求（工单审批），可以考虑 LiteFlow + FlowLong 的组合：LiteFlow 负责自动步骤编排，FlowLong 负责人工审批流转，QLExpress 负责条件判断。
:::

---

## 总结

FlowLong 的核心价值可以概括为一句话：**让审批流程成为数据，而非代码**。

相比 Activiti/Flowable 等重量级工作流引擎，FlowLong 的独特优势在于：

- **极简轻量**：~1MB 依赖，7 张表，5 分钟上手
- **JSON 定义**：无需 BPMN 知识，看 JSON 即懂流程
- **审批全覆盖**：串行/并行/会签/或签/驳回/转办/委派/加签/减签/撤回
- **MyBatis-Plus 生态**：零 SQL 编写，分页友好，多数据库兼容
- **动态审批人**：`${变量名}` 语法，运行时动态指定
- **条件路由**：表达式驱动的分支选择，满足动态审批需求

在 AI 客服系统中，FlowLong 可以灵活支撑工单审批、投诉升级、退款复核等多种审批场景。结合 QLExpress 表达式引擎和 LiteFlow 流程编排引擎，可以构建从自动处理到人工审批的完整技术栈——LiteFlow 编排自动流程，QLExpress 做条件判断，FlowLong 驱动人工审批，三者各司其职，配合默契。

选择建议可以简单概括为：

1. **轻量审批 + 快速上手** → 选 FlowLong
2. **复杂 BPMN + 可视化设计** → 选 Activiti / Flowable
3. **两者都不是** → 看团队技术栈，MyBatis-Plus 生态选 FlowLong，JPA 生态选 Flowable

---

## 延伸阅读

- [FlowLong 官方文档](https://flowlong.com/) —— 官方教程和 API 文档
- [FlowLong GitHub 仓库](https://github.com/aizuda/flowlong) —— 源码和 Issue
- [FlowLong Gitee 仓库](https://gitee.com/aizuda/flowlong) —— 国内镜像
- [QLExpress4表达式引擎](/ai-cs/qlexpress-study-notes/) —— 表达式引擎基础知识
- [流程编排引擎Flow](/ai-cs/flow-orchestration-engine/) —— LiteFlow 和 CompileFlow 流程编排引擎
- [Activiti 官网](https://www.activiti.org/) —— 完整的工作流引擎
- [Flowable 官网](https://flowable.com/) —— Activiti 的增强分支
- [MyBatis-Plus 官网](https://baomidou.com/) —— FlowLong 的持久化基础设施
