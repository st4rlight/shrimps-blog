---
title: A2UI 学习笔记
tags:
  - A2UI
  - Agent
  - 生成式UI
  - Google
excerpt: A2UI（Agent-to-User Interface）是 Google 推出的开源声明式 UI 协议，让 AI Agent 用 JSON 描述界面意图，客户端用原生组件渲染。本文系统梳理 A2UI 的核心理念、架构设计、消息协议、数据绑定、Catalog 系统、动作架构、渲染机制与实战用法。
createTime: 2026/07/05 10:00:00
permalink: /ai-study/a2ui-study-notes/
---

# A2UI 学习笔记

想象这样一个场景——你对一个 AI 助手说："帮我订一张明天晚上 7 点的两人桌。"

如果 Agent 只能回复文本，接下来将是一连串低效的对话："请问哪一天？""什么时间？""几位？"……一个本可以用一个表单瞬间解决的事情，变成了五六个回合的文字乒乓球。

更好的方式显然是：Agent 直接生成一个表单界面，带有日期选择器、时间选择器、人数输入框和确认按钮。用户在 UI 上操作，一次提交，搞定。

但这件"显然更好"的事情，在技术上却极其棘手。Agent 可能运行在远程服务器上，甚至跨越组织的信任边界。它不能直接操控你的 UI，只能发送消息。传统的方案——在 iframe 中嵌入 Agent 返回的 HTML/JavaScript——不仅笨重、风格割裂，还引入了严重的安全隐患。

**A2UI（Agent-to-User Interface）** 就是为此而生的 Google 开源协议：Agent 发送声明式的 JSON 消息来描述界面的意图，客户端应用用自己原生的组件库来渲染。**安全如数据，表达如代码。**

## 一、A2UI 是什么

一句话概括：**A2UI 是一套让 Agent 用「数据」描述界面、由客户端用「原生组件」渲染的开放协议。**

### 1.1 核心理念

A2UI 的核心思想可以拆成三层：

1. **Agent 生成一段 JSON**，描述"我想展示一个标题、一个日期选择器和一个按钮"
2. 这段 JSON 通过**任意传输通道**（A2A 协议、AG-UI、MCP、SSE、WebSocket 等）到达客户端
3. 客户端的 **A2UI 渲染器**读取 JSON，将抽象的组件描述映射为自己代码库中的原生组件——可以是 Flutter Widget、Angular Component、Lit Web Component 或 React 组件

这意味着同一份 A2UI JSON 可以在 Web、移动端和桌面端上获得原生渲染体验，而不需要 Agent 关心客户端的具体技术栈。

### 1.2 它解决的核心问题

生成式 AI 很擅长写文字和写代码，但在"呈现富交互界面"上一直很笨拙。已有的几种做法都有硬伤：

| 方案 | 痛点 |
|------|------|
| 纯文本对话 | 多轮交互效率极低，用户体验差 |
| Agent 返回 HTML/JS 塞进 iframe | 安全隐患大（XSS 注入）、风格割裂、跨平台差 |
| Agent 直接操作 DOM | 不可控、不安全、无法跨平台 |
| 固定模板匹配 | 灵活性差，无法应对多样化需求 |

A2UI 给出的答案是：**Agent 不发送代码（不安全），也不发送固定图片（不灵活），而是发送一段声明式的 JSON，描述"我想要什么界面"。客户端拿到这段 JSON 后，用自己本地已经写好、经过审核的组件库去渲染。**

### 1.3 与 AG-UI 的区别

这里有一个非常重要的区分——**不要混淆"A2UI"和"AG-UI"**：

![AG-UI vs A2UI 对比](/ai-study/ai-ecosystem/a2ui-study-notes/ag-ui-vs-a2ui-comparison.svg)

| 维度 | AG-UI | A2UI |
|------|-------|------|
| 全称 | Agent-User Interaction Protocol | Agent-to-User Interface |
| 定位 | **交互协议**——"怎么通信" | **UI 协议**——"画什么界面" |
| 出品方 | CopilotKit（2025.05） | Google（2025，v0.8 → v1.0） |
| 通信方式 | 事件流（SSE/WebSocket） | 不绑定传输 |
| 数据格式 | 结构化事件（16+ 种事件类型） | 声明式 JSON 消息流 |
| 关注点 | 流式输出 · 状态同步 · 人工干预 | UI 生成 · 跨平台渲染 · 安全隔离 |

简单说：**AG-UI 是管道，A2UI 是内容。** AG-UI 负责建立 Agent 和前端之间的通信通道，A2UI 负责定义通过该通道传输的 UI 描述格式。事实上，AG-UI 是 A2UI 的标准传输绑定之一——AG-UI 会自动将 A2UI 消息翻译为 AG-UI 事件并处理传输和状态同步。

## 二、架构设计

### 2.1 全景架构

![A2UI架构总览](/ai-study/ai-ecosystem/a2ui-study-notes/a2ui-architecture-overview.svg)

A2UI 的架构把 UI 生成和 UI 执行**彻底解耦**：

- **Agent 端**：LLM 推理后生成声明式 JSON 消息流（不包含任何可执行代码）
- **传输层**：JSON 消息通过任意通道传输到客户端
- **客户端**：A2UI Renderer 解析 JSON，映射为本地原生组件树
- **用户**：看到原生 UI，交互后触发新的 Agent 调用

### 2.2 三个核心解耦

A2UI 的核心哲学是将三个关键元素解耦：

1. **组件树（Structure）**——Agent 提供的抽象 UI 结构（"一个 Card 里有 Text 和 Button"）
2. **数据模型（State）**——动态填充 UI 的应用状态（独立于结构，可单独更新）
3. **组件目录（Catalog）**——客户端定义的可信组件映射（Agent 只能使用 Catalog 中声明的组件）

这种设计带来的好处：Agent 只能使用客户端预定义的组件（安全），同一份 UI 描述可在不同框架上渲染（灵活），数据变更无需重发整个 UI 结构（高效）。

### 2.3 安全模型

A2UI 的安全设计是其核心优势之一：

- **不执行任意代码**：Agent 输出的是纯数据（JSON），不是代码
- **不注入 script 标签**：JSON 中不包含任何可执行内容
- **沙箱化执行**：`functionCall` 机制是安全的沙箱接口，Agent 只能触发客户端预注册的行为，无法暴露用户于恶意脚本
- **客户端本地渲染**：所有 UI 由客户端已审核的组件库渲染
- **跨信任边界安全**：即使 Agent 运行在远程服务器上，也无法操控客户端 UI
- **数据模型隔离**：在多 Agent 架构中，Orchestrator 负责确保一个 Agent 的 Surface 数据不会泄露给另一个 Agent

## 三、消息协议：A2UI 的"语言"

### 3.1 消息格式

A2UI 消息是 JSON 对象，以 **JSON Lines（JSONL）** 格式传输——每行一个完整的 JSON 对象。这种格式对流式传输友好，便于 LLM 增量生成，且对错误有韧性：

```jsonl
{"version": "v0.9", "createSurface": {"surfaceId": "main", "catalogId": "https://a2ui.org/.../catalog.json"}}
{"version": "v0.9", "updateComponents": {"surfaceId": "main", "components": [...]}}
{"version": "v0.9", "updateDataModel": {"surfaceId": "main", "path": "/user", "value": {"name": "Alice"}}}
```

### 3.2 消息类型总览

A2UI 协议定义了以下消息类型（以 v0.9 / v1.0 为准）：

| 消息类型 | 方向 | 作用 |
|---------|------|------|
| `createSurface` | Agent → Client | 创建新的渲染表面，指定 Catalog |
| `updateComponents` | Agent → Client | 添加或更新 UI 组件 |
| `updateDataModel` | Agent → Client | 更新应用状态（数据模型） |
| `deleteSurface` | Agent → Client | 移除一个 Surface 及其所有内容 |
| `action` | Client → Agent | 用户交互事件（点击按钮等） |
| `error` | Client → Agent | 客户端验证失败或运行时错误报告 |
| `callFunction` | Agent → Client | v1.0 新增：服务端发起的远程函数调用 |
| `actionResponse` | Agent → Client | v1.0 新增：对客户端 action 的同步响应 |

> **版本演进**：v0.8 使用 `beginRendering` + `surfaceUpdate` + `dataModelUpdate`；v0.9 将 `beginRendering` 替换为 `createSurface`（分离 Surface 创建与渲染），`surfaceUpdate` 改为 `updateComponents`，`dataModelUpdate` 改为 `updateDataModel`，并引入 `version` 字段。v1.0 进一步新增 `callFunction` 和 `actionResponse` 实现双向 RPC。

### 3.3 createSurface：创建渲染表面

`createSurface` 信号通知客户端初始化并渲染一个 Surface：

```typescript
// v0.9 Schema
{
  version: "v0.9";
  createSurface: {
    surfaceId: string;       // 必填：唯一标识符
    catalogId: string;       // 必填：组件 Catalog 的 URL
    theme?: object;          // 可选：主题配置（v1.0 改为 surfaceProperties）
    sendDataModel?: boolean; // 可选：请求客户端回传数据模型
  }
}
```

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "booking",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "sendDataModel": true
  }
}
```

v1.0 进一步允许在 `createSurface` 中直接嵌入初始 `components` 和 `dataModel`，实现**单消息 UI 实例化**——一条消息就能完成完整的 UI 组装：

```json
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "hello",
    "catalogId": "https://a2ui.org/.../v1_0/catalogs/basic/catalog.json",
    "surfaceProperties": { "agentDisplayName": "Booking Bot" },
    "components": [
      { "id": "root", "component": "Text", "text": "Hello World" }
    ],
    "dataModel": { "greeting": "Hello" }
  }
}
```

> **注意**：`surfaceId` 必须在客户端生命周期内全局唯一。重复创建已存在的 Surface 是一个错误。在多 Agent 架构中，Orchestrator 负责管理 Surface ID 以避免冲突。

### 3.4 updateComponents：定义 UI 结构

`updateComponents` 以**扁平化邻接表**形式添加或更新组件——所有组件平铺在一个列表中，通过 `id` 和 `children`（ID 引用列表）建立父子关系，而非传统的嵌套树结构（详见 [5.1 邻接表模型](#_5-1-邻接表模型)）：

```json
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "booking",
    "components": [
      {
        "id": "root",
        "component": "Column",
        "children": ["header", "guests-field", "submit-btn"]
      },
      {
        "id": "header",
        "component": "Text",
        "text": "确认预订",
        "variant": "h1"
      },
      {
        "id": "guests-field",
        "component": "TextField",
        "label": "人数",
        "value": { "path": "/reservation/guests" }
      },
      {
        "id": "submit-btn",
        "component": "Button",
        "child": "submit-text",
        "variant": "primary",
        "action": {
          "event": {
            "name": "confirm",
            "context": {
              "details": { "path": "/reservation" }
            }
          }
        }
      }
    ]
  }
}
```

v0.9 的组件结构比 v0.8 更扁平——组件类型直接是字符串（`"component": "Text"` 而非 `"component": { "Text": {...} }`），属性平铺在组件对象上。发送已有 ID 的组件会更新该组件（而非复制）。

### 3.5 updateDataModel：更新应用状态

`updateDataModel` 使用 **JSON Pointer（RFC 6901）** 路径更新数据模型：

```json
{
  "version": "v0.9",
  "updateDataModel": {
    "surfaceId": "booking",
    "path": "/reservation",
    "value": {
      "datetime": "2025-12-16T19:00:00Z",
      "guests": "2"
    }
  }
}
```

- `path` 默认为 `/`（根），支持精确到叶子节点：`/user/email`
- `value` 可以是任意 JSON 类型；**v1.0 中设为 `null` 表示删除该路径的值**
- 组件通过 `{"path": "/reservation/guests"}` 绑定数据后，数据更新时自动重渲染

> **v0.8 → v0.9 变化**：v0.8 使用 `contents` 邻接表 + 类型化字段（`valueString`、`valueNumber` 等），v0.9 简化为标准 JSON Pointer 路径 + 原生 JSON 值，更接近标准 JSON Patch 语义。

### 3.6 deleteSurface：移除渲染表面

```json
{
  "version": "v0.9",
  "deleteSurface": { "surfaceId": "modal" }
}
```

移除 Surface 的所有组件和数据模型。客户端应从 UI 中移除该 Surface。删除不存在的 Surface 是安全的（no-op）。

### 3.7 Surface 概念

**Surface（渲染表面）** 是 A2UI 中的核心概念，类似于一个"画布"或"容器"：

- 每个 Surface 有唯一的 `surfaceId`，在客户端生命周期内全局唯一
- 一个 Agent 可以同时管理多个 Surface（如主界面 + 侧边栏 + 模态框）
- Surface 的 `surfaceId` 和 `catalogId` 在创建后固定，要重新配置需先删除再重建
- 一个 Surface 是一个完整的、内聚的 UI（表单、仪表盘、聊天界面等）

### 3.8 消息顺序

消息顺序需满足以下约束：

1. `createSurface` 必须在 `updateComponents` 和 `updateDataModel` 之前
2. `updateComponents` 和 `updateDataModel` 可以交替发送
3. 不同 Surface 的消息相互独立
4. 多条消息可以增量更新同一个 Surface

推荐顺序（渐进式构建）：

```jsonl
{"version": "v0.9", "createSurface":    {"surfaceId": "main", "catalogId": "..."}}
{"version": "v0.9", "updateComponents": {"surfaceId": "main", "components": [...]}}  // Header
{"version": "v0.9", "updateComponents": {"surfaceId": "main", "components": [...]}}  // Body + Footer
{"version": "v0.9", "updateDataModel":  {"surfaceId": "main", "path": "/", "value": {...}}}
```

## 四、数据绑定

数据绑定是 A2UI 的核心能力之一——它将 UI 组件连接到应用状态，使用 **JSON Pointer（RFC 6901）** 路径实现响应式更新。

### 4.1 结构与状态分离

A2UI 严格分离两个概念：

- **结构（Structure）**：组件树——"有一个 Card，里面放 Text 和 Button"
- **状态（State）**：数据模型——`{"user": {"name": "Alice"}, "items": [...]}`

这种分离意味着：更新数据时不需要重发组件结构，更新结构时不需要重发数据。组件通过 `path` 引用数据模型中的值，数据变化时自动重渲染。

### 4.2 Dynamic 类型

v1.0 定义了一系列 `Dynamic*` 类型，任何可绑定的属性都接受三种形式：

| 形式 | 示例 | 说明 |
|------|------|------|
| **字面量** | `"Hello, World!"` | 直接提供值 |
| **路径绑定** | `{"path": "/user/name"}` | 从数据模型中按 JSON Pointer 取值 |
| **函数调用** | `{"functionCall": {"call": "formatCurrency", "args": {...}}}` | 调用客户端本地函数计算值 |

```json
// 字面量
{ "id": "title", "component": "Text", "text": "欢迎" }

// 路径绑定——数据变化时自动更新
{ "id": "name", "component": "Text", "text": { "path": "/user/name" } }

// 函数调用——客户端本地计算
{ "id": "total", "component": "Text", "text": { "functionCall": { "call": "formatCurrency", "args": { "value": { "path": "/cart/total" } } } } }
```

### 4.3 响应式更新

当 `updateDataModel` 修改了某个路径的值，所有绑定该路径的组件**自动重渲染**：

```jsonl
// 初始：绑定 /message
{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components": [{"id": "msg", "component": "Text", "text": {"path": "/message"}}]}}

// 更新数据 → 组件自动刷新
{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/message", "value": "Hello, Alice!"}}
```

### 4.4 动态列表（模板子组件）

容器组件的 `children` 不仅可以是静态的 ID 数组，还可以是**模板**——从数据绑定列表动态生成子组件：

```json
{
  "id": "restaurant-list",
  "component": "Column",
  "children": {
    "template": {
      "componentId": "restaurant-card",
      "path": "/restaurants"
    }
  }
}
```

这会为 `/restaurants` 数组中的每个元素实例化一个 `restaurant-card` 组件。v1.0 还新增了内置 `@index` 函数，可在模板中获取当前迭代索引（支持 `offset` 参数）。

### 4.5 输入绑定：读写契约

A2UI 为所有输入组件（TextField、CheckBox、Slider 等）定义了**读写契约**：

1. **读（Model → View）**：组件渲染时从绑定的 `path` 拉取值
2. **写（View → Model）**：用户输入时，渲染器**立即**将新值写入本地数据模型

这意味着**本地数据模型始终是 UI 当前状态的唯一真相源**。这个"View → Model"同步纯粹在渲染器本地完成，不经过网络——用户每次按键都会同步更新本地模型，但不会产生网络请求。

> **同步保证**：本地模型更新是**同步的**。这保证了在任何 Event 触发前，数据模型已完全更新——不存在"打字和点击之间的竞态条件"。

这种本地优先的设计带来了显著的**性能优势**：开发者不需要实现网络防抖，不用担心延迟抖动。网络完全不受"UI 噪音"（如逐个按键）的影响，直到用户正式提交 Event。

## 五、组件体系

### 5.1 邻接表模型

A2UI 使用**扁平化邻接表**（Flat Adjacency List）而非嵌套树来组织组件。来看同一个界面的两种表达方式：

**传统嵌套树（Nested Tree）——A2UI 不采用：**

```json
{
  "type": "Column",
  "children": [
    {
      "type": "Text",
      "text": "确认预订",
      "variant": "h1"
    },
    {
      "type": "TextField",
      "label": "人数",
      "value": { "path": "/reservation/guests" }
    },
    {
      "type": "Button",
      "child": { "type": "Text", "text": "提交" },
      "action": { "event": { "name": "confirm" } }
    }
  ]
}
```

**扁平化邻接表（Flat Adjacency List）——A2UI 采用：**

```json
[
  { "id": "root",       "component": "Column",   "children": ["header", "guests-field", "submit-btn"] },
  { "id": "header",     "component": "Text",     "text": "确认预订", "variant": "h1" },
  { "id": "guests-field","component": "TextField","label": "人数", "value": { "path": "/reservation/guests" } },
  { "id": "submit-btn", "component": "Button",   "child": "submit-text", "action": { "event": { "name": "confirm" } } },
  { "id": "submit-text","component": "Text",     "text": "提交" }
]
```

两者的核心区别：

| 维度 | 嵌套树 | 扁平化邻接表 |
|------|--------|------------|
| **结构** | 子组件直接内联在父组件的 `children` 数组中，层层嵌套 | 所有组件平铺在一个列表中，通过 `id` 和 `children`（ID 引用列表）建立父子关系 |
| **定位** | 要修改某个组件，需要知道它在树中的完整路径（第几层、第几个子节点） | 只需知道组件 `id`，直接用 ID 定位，与层级无关 |
| **增量更新** | 修改一个叶子节点也要重传从根到该节点的整条路径 | 只发一条 `{ "id": "header", "component": "Text", "text": "新标题" }` 即可 |
| **添加/删除** | 需要操作父节点的 `children` 数组（可能涉及深层嵌套结构） | 修改父组件的 `children` ID 列表即可，或直接新增/移除组件定义 |
| **重复引用** | 同一个子组件无法被多个父组件引用（它是一份数据拷贝） | 同一个 `id` 可以被多个父组件引用（引用的是 ID，不是内联数据） |
| **LLM 生成** | LLM 需要维护正确的嵌套层级和括号匹配，深层结构容易出错 | 每条组件定义都是扁平的，LLM 可以逐条生成，互不影响 |

**一句话总结**：嵌套树把"组件是什么"和"组件在哪"耦合在一起；邻接表把它们拆开——每条记录只描述组件自身的属性，父子关系通过 ID 引用独立表达。这就是 A2UI 能实现细粒度增量更新的根本原因。

### 5.2 内置组件库（Basic Catalog）

A2UI 的 Basic Catalog 提供了覆盖常见 UI 场景的组件：

| 组件类型 | 用途 | 示例场景 |
|---------|------|---------|
| `Text` | 文本显示 | 标题、描述、提示（支持 `variant` 语义提示） |
| `Button` | 按钮 | 提交、取消、操作触发（支持 `action` 和 `checks`） |
| `TextField` | 文本输入 | 搜索框、表单字段（支持双向绑定） |
| `CheckBox` | 复选框 | 布尔选择 |
| `Slider` | 滑块 | 数值范围选择 |
| `Card` | 卡片容器 | 信息展示、结果列表 |
| `Column` / `Row` | 布局容器 | 垂直 / 水平排列子组件 |
| `Image` | 图片展示 | 结果预览、图标 |
| `Icon` | 图标 | 功能图标（v1.0 使用 `path` 属性定义 SVG） |
| `Video` | 视频 | 媒体播放（v1.0 支持 `posterUrl`） |

> 组件的具体定义由 Catalog 的 JSON Schema 规定。不同 Catalog 可以定义完全不同的组件集。

### 5.3 自定义组件扩展

A2UI 不局限于内置组件。开发者可以定义自己的 Catalog，将任意现有 UI 组件接入 A2UI 生态：

```typescript
// Angular 示例：注册自定义组件
import { Catalog, DEFAULT_CATALOG } from '@a2ui/angular';

export const MY_CATALOG = {
  ...DEFAULT_CATALOG, // 继承 Basic Catalog
  MapView: {
    type: () => import('./map_view').then(r => r.MapView),
    bindings: ({ properties }) => [
      inputBinding('latitude', () => properties['latitude']),
      inputBinding('longitude', () => properties['longitude']),
    ],
  },
} as Catalog;
```

注册后，Agent 就可以在 JSON 蓝图中使用 `"component": "MapView"` 来引用这个自定义组件。

### 5.4 客户端自定义函数

A2UI 允许 Agent 在 JSON 中引用客户端预定义的函数，这些函数在客户端本地执行，不经过网络——既保证了安全性，又提供了动态计算能力：

```json
{
  "id": "total-price",
  "component": "Text",
  "text": {
    "functionCall": {
      "call": "formatCurrency",
      "args": { "value": { "path": "/cart/total" } }
    }
  }
}
```

v1.0 进一步引入了 `callFunction` 消息类型，支持**服务端发起的远程函数调用**——Agent 可以主动请求客户端执行函数并获取返回值（`functionResponse`），实现真正的双向 RPC。

## 六、Catalog 系统

### 6.1 Catalog 是什么

**Catalog（组件目录）** 是一个 JSON Schema 文件，定义了 Agent 可以使用的组件、函数和主题。所有从 Agent 发来的 A2UI JSON 都会根据选定的 Catalog 进行验证。

```json
{
  "catalogId": "https://my-company.com/catalogs/v1/custom.json",
  "components": {
    "HelloWorldBanner": {
      "type": "object",
      "description": "A simple banner greeting.",
      "properties": {
        "message": { "type": "string", "description": "The banner text." }
      },
      "required": ["message"]
    }
  },
  "functions": [
    { "name": "formatCurrency", "parameters": {...} }
  ]
}
```

### 6.2 Basic Catalog vs. 自定义 Catalog

| 场景 | 推荐 | 工作量 |
|------|------|--------|
| 为成熟前端添加 A2UI | 定义镜像现有设计系统的 Catalog | 中等 |
| 全新项目 | 先用 Basic Catalog，再逐步演进 | 低 |

定义自己的 Catalog 可以将 Agent 限制为只使用你应用中存在的组件和视觉语言，而非通用的输入框或按钮。Catalog 可以从零构建，也可以导入 Basic Catalog 的定义来节省时间。

> **设计哲学**：A2UI 认为可移植性不需要跨客户端的标准化 Catalog——LLM 可以为不同的前端解释不同的 Catalog。

### 6.3 Catalog 协商

客户端和 Agent 必须通过协商确定使用哪个 Catalog：

**Step 1**（可选）：Agent 在 A2A Agent Card 中声明它支持的 Catalog

**Step 2**（必须）：客户端在每条消息的 `metadata` 中声明它支持的 Catalog 列表（按偏好排序）：

```json
{
  "parts": [{"text": "查询航班状态"}],
  "metadata": {
    "a2uiClientCapabilities": {
      "v0.9": {
        "supportedCatalogIds": [
          "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
          "https://my-company.com/catalogs/v1/custom.json"
        ]
      }
    }
  }
}
```

**Step 3**：Agent 创建 Surface 时，从客户端的 `supportedCatalogIds` 中选择最佳匹配。该选择在 Surface 生命周期内锁定。

### 6.4 Catalog 版本管理

Catalog 更新分为**破坏性变更**（需要 Major 版本升级）和**非破坏性变更**（可在当前 Major 版本内演进）：

| 变更类型 | 示例 | 版本要求 |
|---------|------|---------|
| **破坏性** | 添加/删除容器组件（Grid、Accordion） | Major 升级（v1 → v2） |
| **破坏性** | 修改字段类型（string → object） | Major 升级 |
| **破坏性** | 添加必填属性（无默认值） | Major 升级 |
| **非破坏性** | 添加叶子组件（Badge、Tooltip） | 当前版本内 |
| **非破坏性** | 添加可选属性 | 当前版本内 |
| **非破坏性** | 删除属性 | 当前版本内 |

> **catalogId 命名规范**：推荐使用 URI 格式（如 `https://example.com/catalogs/v1/catalog.json`），仅作为唯一标识符，**不意味着运行时下载**——Catalog 定义必须在编译/部署时已知。

### 6.5 验证与优雅降级

A2UI 采用**两阶段验证**策略：

1. **Agent 端（发送前）**：Agent 运行时根据 Catalog 定义验证生成的 JSON。验证失败时，Agent 可以尝试修复或降级为文本回复。
2. **客户端（接收后）**：客户端根据本地 Catalog 定义验证接收的 JSON。验证失败时，向 Agent 报告错误。

即使验证通过，渲染器也可能遇到运行时问题（缺少资源、组件未加载等）。此时应**优雅降级**而非崩溃：

- **未知组件**：渲染安全的占位符或跳过该节点
- **整个 Surface 失败**：显示原始文本描述或通用错误消息

客户端通过 `error` 消息向 Agent 报告验证错误，Agent 可以自我修正并重新发送：

```json
{
  "version": "v0.9",
  "error": {
    "code": "VALIDATION_FAILED",
    "surfaceId": "flight-status-card",
    "path": "/components/FlightCard/flightNumber",
    "message": "Missing required property 'flightNumber' in component 'FlightCard'."
  }
}
```

## 七、用户交互与动作

### 7.1 动作架构

A2UI 的交互系统基于 `action` 属性，支持两种动作类型：

| 类型 | 关键字 | 执行位置 | 说明 |
|------|--------|---------|------|
| **Event** | `event` | Agent（需网络往返） | 将数据发送给 Agent 处理（如点击"提交"） |
| **Function** | `functionCall` | 渲染器（本地执行） | 在客户端立即执行，不通知 Agent（如打开 URL） |

```json
// Event 类型——发送给 Agent
{
  "id": "submit-btn",
  "component": "Button",
  "child": "btn-text",
  "action": {
    "event": {
      "name": "submit_reservation",
      "context": {
        "time": {"path": "/reservationTime"},
        "size": {"path": "/partySize"}
      }
    }
  }
}

// Function 类型——本地执行
{
  "id": "help-btn",
  "component": "Button",
  "child": "help-text",
  "action": {
    "functionCall": {
      "call": "openUrl",
      "args": {"url": "https://a2ui.org/help"}
    }
  }
}
```

> **Context vs. 数据模型**：数据模型代表 Surface 的完整状态树，而 `context` 是精心挑选的"视图"——为特定事件提供所需值的子集，简化 Agent 的处理逻辑。

### 7.2 函数验证（Checks）

Basic Catalog 定义了一组有限的验证检查，交互组件可以声明 `checks` 列表。对于 `Button`，如果任何检查失败，按钮会**自动禁用**：

```json
{
  "id": "submit-button",
  "component": "Button",
  "child": "submit-text",
  "checks": [
    {
      "condition": {
        "call": "required",
        "args": {"value": {"path": "/partySize"}}
      },
      "message": "人数不能为空"
    }
  ],
  "action": {"event": {"name": "submit_booking"}}
}
```

> **注意**：验证检查管理的是 **UI 状态（用户体验）**，防止无效交互。它不是**数据完整性**检查的替代品——后者仍必须在 Agent 端执行。

### 7.3 用户交互流程

当用户与组件交互（如点击按钮）时：

1. **解析**：渲染器解析 `context` 中的所有 `path` 引用，从本地数据模型取值
2. **构建**：渲染器构建 `action` 负载
3. **分发**：通过传输通道发送给 Agent

```json
{
  "version": "v0.9",
  "action": {
    "name": "submit_reservation",
    "surfaceId": "booking-surface",
    "sourceComponentId": "submit-btn",
    "timestamp": "2026-02-25T10:40:00Z",
    "context": {
      "time": "7:00 PM",
      "size": 4
    }
  }
}
```

> **版本差异**：v0.8 使用 `userAction` 作为顶层键，v0.9 改为更简洁的 `action`。

### 7.4 表单提交模式

读写契约 + Event 分发构成了一个健壮的表单提交模式：

1. **绑定**：TextField 绑定到 `/reservationTime`
2. **交互**：用户输入"7:00 PM"，本地模型 `/reservationTime` 立即更新
3. **提交**：用户点击"预订"按钮，Event 从本地模型解析 `/reservationTime` 路径，将当前值发送给 Agent

由于本地模型更新是同步的，不存在"打字和点击之间的竞态条件"——Write 总是先于 Event 提交。

### 7.5 v1.0 双向 RPC

v1.0 引入了两个新的消息类型，实现了完整的双向 RPC：

- **`actionResponse`**：Agent 可以对客户端的 `action` 返回同步响应。客户端为需要响应的 action 生成 `actionId`（通过 `wantResponse: true` 标记），Agent 返回的值直接写入数据模型。
- **`callFunction` / `functionResponse`**：Agent 可以主动请求客户端执行函数并获取返回值。如果客户端收到对 `clientOnly` 函数的远程调用，会拒绝并返回 `INVALID_FUNCTION_CALL` 错误。

## 八、数据模型同步

### 8.1 sendDataModel 机制

A2UI v0.9 引入了强大的"无状态"同步功能。Agent 在 `createSurface` 中设置 `sendDataModel: true`，渲染器就会在每条发送给 Agent 的消息**元数据**中自动附带该 Surface 的**完整数据模型**：

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "booking-surface",
    "catalogId": "...",
    "sendDataModel": true
  }
}
```

在 A2A 传输中，数据模型放在 `a2uiClientDataModel` 对象中：

```json
{
  "parts": [{"text": "好的，提交预订"}],
  "metadata": {
    "a2uiClientDataModel": {
      "version": "v0.9",
      "surfaces": {
        "booking-surface": {
          "partySize": 4,
          "reservationTime": "7:00 PM",
          "notes": "靠窗座位"
        }
      }
    }
  }
}
```

### 8.2 为什么需要数据模型同步

| 优势 | 说明 |
|------|------|
| **简化接线** | 不需要手动将每个输入字段映射到按钮的 `context`，Agent 直接从元数据查看所有字段状态 |
| **无状态 Agent** | Agent 不需要为每个用户会话维护本地状态，每次交互都收到完整的当前上下文 |
| **语音快捷方式** | 用户可以通过语音或文本触发 Event（如"好的，提交"），即使没有点击特定按钮。Agent 从元数据获取更新后的数据模型，立即处理请求 |

### 8.3 安全注意事项

当 `sendDataModel: true` 启用时，开发者必须理解数据可见性：

- **点对点可见性**：只有接收传输信封的后端（创建 Surface 的 Agent 或中间 Orchestrator）能读取此数据
- **Orchestrator 的责任**：在多 Agent 架构中，Orchestrator 必须执行**数据隔离**——解析 `a2uiClientDataModel`，识别 `surfaceId`，确保数据模型只传递给拥有该 Surface 的子 Agent

> **安全风险——状态抓取**：如果 Orchestrator 未能剥离 `a2uiClientDataModel`，恶意或被入侵的子 Agent 可能"抓取"其他活跃 Surface 的状态。例如，天气子 Agent 可能读取银行 Surface 的敏感数据。剥离是多 Agent 系统的强制安全要求。

## 九、渲染流程

### 9.1 完整流程

![A2UI渲染流程机制](/ai-study/ai-ecosystem/a2ui-study-notes/a2ui-rendering-flow.svg)

从用户输入到原生 UI 渲染，完整经历以下步骤：

1. **用户输入**：用户在聊天框输入"帮我找纽约的中餐厅"
2. **消息发送**：前端封装请求发送给 Agent（通过 A2A / AG-UI / MCP / HTTP 等传输通道）
3. **Agent 处理**：LLM 推理 + 工具调用，决定需要展示搜索结果卡片
4. **生成消息流**：Agent 生成 `createSurface` → `updateComponents` → `updateDataModel` 消息序列
5. **传输到客户端**：以 JSONL 流式传输
6. **A2UI Renderer 解析**：逐条解析消息，构建组件树，映射原生组件
7. **原生 UI 渲染**：React 组件 / Flutter Widget / Lit Web Component

### 9.2 渐进式渲染

A2UI 支持**渐进式渲染**——不需要等整个响应生成完毕才显示，而是边生成边渲染。用户看到 UI 实时构建的过程，而不是盯着加载动画：

```jsonl
{"version": "v0.9", "createSurface":    {"surfaceId": "main", "catalogId": "..."}}        // 创建
{"version": "v0.9", "updateComponents": {"surfaceId": "main", "components": [...]}}       // Header 先出来
{"version": "v0.9", "updateComponents": {"surfaceId": "main", "components": [...]}}       // Body 跟上
{"version": "v0.9", "updateDataModel":  {"surfaceId": "main", "path": "/", "value": {...}}} // 数据填充
```

### 9.3 增量更新

界面以扁平化组件列表形式组织，Agent 可以在对话流中逐次添加、修改或删除组件：

```text
初始：createSurface + updateComponents
      → 创建 Surface，渲染 Column + Text + Button

增量：updateComponents (add)
      → 新增一个 Select 组件（菜系筛选）

增量：updateComponents (update)
      → 修改 Text 内容（同 ID 发送新属性即可更新）

增量：updateDataModel (update path)
      → 只更新 /restaurants/0/rating，绑定的组件自动刷新

结束：deleteSurface
      → 移除整个 Surface
```

每次更新只传输变化的组件或数据路径，不需要重传整个界面。

### 9.4 性能优化

A2UI 建议以下性能优化策略：

- **批处理**：缓冲 16ms 的更新，批量渲染
- **差异比较**：对比新旧组件，只更新变化的属性
- **细粒度更新**：更新 `/user/name` 而非整个 `/` 模型
- **渐进式渲染**：利用流式传输，让用户看到 UI 构建过程

## 十、客户端能力声明

在 Agent 安全地发送 UI 之前，渲染器必须声明它支持哪些组件 Catalog。这通过 `a2uiClientCapabilities` 对象完成：

```json
{
  "a2uiClientCapabilities": {
    "v0.9": {
      "supportedCatalogIds": [
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        "https://my-company.com/catalogs/v1/custom.json"
      ],
      "inlineCatalogs": []
    }
  }
}
```

- **`supportedCatalogIds`**：渲染器能渲染的 Catalog URI 数组（按偏好排序）
- **`inlineCatalogs`**：（可选）用于开发或特殊环境，允许内联发送完整 Catalog Schema

没有这个握手，Agent 无法确定渲染器能否处理特定的组件。

## 十一、跨平台渲染与主题

### 11.1 框架中立设计

A2UI 的核心设计原则之一是**框架中立**——同一套 JSON 描述可以无缝对接不同前端框架：

| 平台 | 渲染器 | 组件映射 |
|------|--------|---------|
| Web (React) | 官方 React Renderer | A2UI Card → React `<Card>` |
| Web (Lit) | Lit Renderer | A2UI Card → Lit `<a2ui-card>` |
| Web (Angular) | Angular Renderer | A2UI Card → Angular Component |
| Mobile (Flutter) | Flutter Renderer | A2UI Card → Flutter `Card` Widget |
| Mobile (iOS/Android) | AGenUI（阿里/高德开源） | 原生 SwiftUI / Jetpack Compose |
| Desktop | 任意 Web 渲染器 | 通过 Electron / Tauri 运行 |

### 11.2 主题与样式

A2UI 遵循**渲染器控制样式**的方法——Agent 提供语义提示（不是视觉样式），客户端的主题系统统一控制实际外观：

**语义提示**（Agent 发送）：

```json
{
  "id": "title",
  "component": "Text",
  "text": "Welcome",
  "variant": "h1"
}
```

常见的 `variant` 值：`h1`、`h2`、`h3`、`h4`、`h5`、`body`、`caption`。客户端将语义提示映射为目标平台的实际组件和样式。

> **v1.0 变化**：v0.9 的 `theme` 字段（含 `primaryColor` 等硬编码品牌色）在 v1.0 中被替换为 `surfaceProperties`——一个可扩展的对象，将视觉样式完全委托给目标框架的原生主题系统。这实现了"解耦品牌化"。

## 十二、多 Agent 编排

在多 Agent 系统中，一个中央 **Orchestrator** 管理用户与多个专门子 Agent 之间的交互。核心挑战是确保渲染器的 `action` 消息能路由回生成该 UI Surface 的特定子 Agent。

### 12.1 Surface 所有权模式

Orchestrator 维护一个 `surfaceId` → 拥有该 Surface 的子 Agent 的映射：

```python
# 子 Agent 创建 Surface 时，Orchestrator 记录所有权
def on_surface_created(surface_id, agent_name, session):
    session.state.update({f"owner_of_{surface_id}": agent_name})

# 渲染器发回 action 时，Orchestrator 路由到正确的子 Agent
async def handle_incoming_action(payload, session):
    surface_id = payload["action"]["surfaceId"]
    target_agent = session.state.get(f"owner_of_{surface_id}")
    if target_agent:
        return transfer_to(target_agent)
```

### 12.2 数据隔离与元数据剥离

在多 Agent 环境中，`a2uiClientDataModel` 可能包含属于不同 Agent 的多个 Surface 状态。为防止敏感数据泄露，Orchestrator 必须**剥离**数据模型元数据，只包含目标子 Agent 拥有的 Surface 数据：

```python
async def intercept(self, request_payload, target_agent, session):
    data_model = request_payload["params"]["message"].get("metadata", {}).get("a2uiClientDataModel")
    if data_model:
        # 只保留目标 Agent 拥有的 Surface
        filtered = {
            sid: state for sid, state in data_model["surfaces"].items()
            if session.state.get(f"owner_of_{sid}") == target_agent.name
        }
        request_payload["params"]["message"]["metadata"]["a2uiClientDataModel"]["surfaces"] = filtered
    return request_payload
```

## 十三、传输协议集成

### 13.1 A2A 编码

在标准 A2A 绑定中，A2UI 消息编码为 A2A **DataPart**，使用特定元数据标识：

- **MIME 类型**：`application/a2ui+json`（v1.0 改名，v0.9 为 `application/json+a2ui`）
- **data 字段**：包含 A2UI 消息的**列表**（A2A v1.0+），允许在单个网络包中发送多条更新

```json
{
  "kind": "data",
  "metadata": { "mimeType": "application/a2ui+json" },
  "data": [
    { "version": "v0.9", "createSurface": { ... } },
    { "version": "v0.9", "updateComponents": { ... } }
  ]
}
```

### 13.2 AG-UI 绑定

[AG-UI](https://ag-ui.com/) 是 A2UI 的标准传输绑定，将 A2UI 消息翻译为 AG-UI 事件，自动处理传输和状态同步。常用于全栈 React、Vue、Angular 应用。CopilotKit 是 AG-UI 的创建者和主要消费者。

### 13.3 MCP 绑定

v1.0 正式支持 **MCP（Model Context Protocol）** 作为传输层。A2UI 可以通过 MCP 工具调用、工具输出或资源订阅来传输，允许 Agent 为客户端应用动态渲染富用户界面：

- MCP Tool 返回 A2UI JSON 作为工具输出
- MCP Resource 提供可订阅的 A2UI 界面定义
- 客户端通过 MCP 协议获取 A2UI 消息并渲染

### 13.4 自定义传输

A2UI 是传输无关的——任何能发送 JSON 的机制都可以：

- **SSE + JSON RPC**：标准服务器推送事件，适合 Web 集成
- **WebSocket**：持久双向连接，适合实时更新和用户操作
- **REST / HTTP**：简单请求-响应，但缺乏流式能力
- **gRPC、消息队列**：只要能携带 JSON，都可以

### 13.5 传输契约

传输层必须满足以下要求：

1. **可靠交付**：消息必须按生成顺序送达（A2UI 依赖有状态更新）
2. **消息分帧**：必须清晰界定每条 JSON 消息的边界（JSONL 换行、WebSocket 帧、SSE 事件等）
3. **元数据支持**：必须提供关联元数据的机制（数据模型同步、能力交换都依赖元数据）
4. **双向能力**（可选）：渲染流是单向的（Agent → Client），但交互应用需要返回通道传输 `action` 消息

## 十四、错误处理

### 14.1 错误类型

| 错误类型 | 原因 | 处理方式 |
|---------|------|---------|
| Surface 已存在 | `surfaceId` 已被使用 | 确保全局唯一，Orchestrator 管理 ID 冲突 |
| Surface 未找到 | `surfaceId` 不存在 | 确保匹配已创建的 Surface |
| 未知组件类型 | 组件类型不在 Catalog 中 | 检查 Catalog 协商结果 |
| 无效属性 | 属性不存在于该组件类型 | 对照 Catalog Schema 验证 |
| 循环引用 | 组件引用自身为子组件 | 修复组件层次结构 |
| 畸形消息 | JSON 格式错误 | 跳过并继续，或发送错误给 Agent 修正 |
| 网络中断 | 连接断开 | 显示错误状态，重连后 Agent 重发或恢复 |

### 14.2 客户端到服务端错误报告

客户端检测到验证错误或运行时失败时，通过 `error` 消息报告给 Agent，形成关键的反馈循环：

```json
{
  "version": "v0.9",
  "error": {
    "code": "VALIDATION_FAILED",
    "surfaceId": "booking-surface",
    "path": "/components/0/children",
    "message": "Expected array of strings, got null."
  }
}
```

Agent 可以捕获此错误，自我修正后重新发送正确的 UI。

## 十五、实战：如何使用 A2UI

### 15.1 客户端集成（React）

```typescript
import { A2UIRenderer } from '@a2ui/react'
import '@a2ui/react/dist/styles.css'

// 创建渲染器实例
const renderer = new A2UIRenderer({
  container: document.getElementById('a2ui-container'),
  theme: {
    primaryColor: '#3b82f6',
    borderRadius: '8px',
  },
})

// 注册自定义组件
renderer.registerComponent('MapView', MapViewWrapper)

// 监听用户交互——将 action 回传给 Agent
renderer.onAction((action) => {
  agent.sendMessage({
    version: 'v0.9',
    action: action,
  })
})

// 接收 Agent 的 A2UI 消息流并渲染
agent.on('message', (message) => {
  // A2A 传输：从 DataPart 中提取 A2UI 消息列表
  const dataParts = message.parts.filter(p => p.kind === 'data')
  for (const part of dataParts) {
    if (part.metadata?.mimeType === 'application/a2ui+json') {
      for (const a2uiMsg of part.data) {
        renderer.processMessage(a2uiMsg)
      }
    }
  }
})
```

### 15.2 Agent 端集成（Python SDK）

```python
from a2ui import A2UIAgent, Surface, Component

# 创建 A2UI Agent
agent = A2UIAgent(
    model="gemini-2.0-flash",
    system_prompt="你是一个餐厅推荐助手..."
)

# 定义工具
@agent.tool
def search_restaurants(location: str, cuisine: str = None) -> list:
    """搜索餐厅"""
    return [{"name": "川味坊", "rating": 4.5, "address": "..."}]

# 生成 UI 蓝图（v0.9 格式）
@agent.ui_renderer
def render_results(results: list) -> list:
    """将搜索结果渲染为 A2UI 界面"""
    components = [
        {
            "id": "root",
            "component": "Column",
            "children": [f"card-{i}" for i in range(len(results))]
        }
    ]
    for i, r in enumerate(results):
        components.append({
            "id": f"card-{i}",
            "component": "Card",
            "child": f"name-{i}"
        })
        components.append({
            "id": f"name-{i}",
            "component": "Text",
            "text": f"{r['name']} - {r['rating']}⭐"
        })

    # 返回 A2UI 消息列表
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "results",
                "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            }
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "results",
                "components": components
            }
        }
    ]
```

### 15.3 与 AG-UI 协同使用

A2UI 和 AG-UI 的协同非常自然——AG-UI 是 A2UI 的标准传输绑定，自动处理消息翻译和状态同步：

```typescript
// AG-UI Client 负责通信
const agent = new HttpAgent({ serverUrl: '...' })

// A2UI Renderer 负责渲染
const renderer = new A2UIRenderer({ container: ... })

// AG-UI 事件流中自动携带 A2UI JSON 消息
agent.on('CUSTOM_EVENT', (event) => {
  if (event.name === 'a2ui-update') {
    // AG-UI 已将 A2UI 消息从事件中提取
    renderer.processMessage(event.data)
  }
})

// 用户交互通过 AG-UI 回传
renderer.onAction((action) => {
  agent.sendCustomEvent({
    name: 'a2ui-action',
    data: action,
  })
})
```

### 15.4 与 MCP 集成

A2UI 可以通过 MCP 工具调用返回 UI 界面：

```python
from mcp.server import Server
from a2ui import A2UIAgent

server = Server("a2ui-mcp-server")
agent = A2UIAgent(model="gemini-2.0-flash")

@server.tool()
async def get_recipe_a2ui(ingredients: list[str]) -> dict:
    """返回 A2UI 格式的食谱卡片"""
    # Agent 生成 A2UI 消息
    messages = agent.render_recipe(ingredients)
    return {
        "content": [
            {
                "type": "resource",
                "resource": {
                    "uri": "a2ui://recipe-card",
                    "mimeType": "application/a2ui+json",
                    "text": json.dumps(messages)
                }
            }
        ]
    }
```

## 十六、最佳实践

### 16.1 UI 蓝图要保持简洁

Agent 生成的 JSON 应聚焦于**信息结构**，而非视觉细节。不要让 Agent 决定颜色、字号、间距——使用语义提示（`variant: "h1"`），交给客户端的主题系统。

### 16.2 善用增量更新

不要每次都全量重传界面。对于局部变化，使用 `updateComponents`（同 ID 发送新属性）或 `updateDataModel`（精确路径更新），只发送变化的部分。

### 16.3 组件粒度要适中

- 太粗：一个组件包含太多内容，增量更新困难
- 太细：JSON 膨胀，渲染开销增加
- 建议：每个组件是一个独立的交互单元或信息单元
- **使用描述性 ID**：`"user-profile-card"` 而非 `"c1"`

### 16.4 结构与数据分离

用数据绑定（`{"path": "/user/name"}`）而非字面量填充内容。这样数据更新时组件自动刷新，无需重发组件结构。

### 16.5 交互回调要明确

每个可交互组件都应关联明确的 action 标识。`context` 只包含该事件所需的值子集，而非整个数据模型——简化 Agent 的处理逻辑。

### 16.6 渐进式渲染

利用 `createSurface` → `updateComponents` → `updateDataModel` 的流式模式，让用户看到"正在构建界面"的过程，而不是等待完整 JSON 生成后才一次性渲染。

### 16.7 预计算显示值

数据格式化（货币、日期）应在 Agent 发送前完成：

```json
// 推荐
{"price": "$19.99"}

// 不推荐——客户端需要知道格式化逻辑
{"price": 19.99}
```

### 16.8 定义自己的 Catalog

生产应用应定义自己的 Catalog，将 Agent 限制为只使用你应用中存在的组件和视觉语言。可以先从 Basic Catalog 开始，逐步演进。

## 十七、版本演进与生态

### 17.1 版本历程

| 版本 | 时间 | 核心更新 |
|------|------|---------|
| v0.8 | 2025 初 | 初始公开版本，基础组件库，`beginRendering` + `surfaceUpdate` + `dataModelUpdate` |
| v0.9 | 2025.04 | `createSurface` 分离创建与渲染、`updateComponents` / `updateDataModel` 重命名、`version` 字段、`sendDataModel` 数据模型同步、Catalog 协商、共享 Web 核心库、官方 React 渲染器、Flutter/Lit/Angular 渲染器更新、Agent SDK、客户端自定义函数 |
| v0.9.1 | 2025 下半年 | 小幅修订和 bug 修复 |
| v1.0 (Candidate) | 2025.11 - 2026.06 | **双向 RPC**（`actionResponse` + `callFunction`/`functionResponse`）、**单消息 UI 实例化**（`createSurface` 内嵌组件和数据）、`surfaceProperties` 替代 `theme`（解耦品牌化）、Catalog 函数定义改为对象映射、UAX #31 标识符规范、`@index` 模板迭代索引、MCP 传输绑定、MIME 类型改为 `application/a2ui+json`、`null` 值删除语义 |

### 17.2 生态集成

A2UI 生态正在快速发展：

- **AG-UI / CopilotKit**：标准传输绑定，全栈 React/Vue/Angular 集成
- **A2A 1.0**：Google Agent 间通信协议，A2A Extension 定义 A2UI 元数据放置和协商
- **MCP**：Model Context Protocol 传输绑定，通过工具调用和资源订阅传输 A2UI
- **AG2**：多 Agent 框架集成
- **json-render**：通用 JSON 渲染方案
- **AGenUI**：阿里/高德开源的端云一体原生 A2UI 框架，覆盖 iOS/Android/HarmonyOS 三端
- **未来计划**：Go、Kotlin 版本 SDK

### 17.3 适用场景

| 场景 | A2UI 的价值 |
|------|------------|
| 多步表单 | Agent 根据上下文动态生成表单，减少对话轮次 |
| 数据查询 | 搜索结果以卡片列表展示，支持筛选和排序 |
| 预约系统 | 日期选择器 + 时间 slots + 确认按钮 |
| 数据看板 | Agent 分析数据后生成图表和指标卡片 |
| 跨平台 Agent | 一套 UI 描述，Web/Mobile/Desktop 原生渲染 |
| 语音交互 | `sendDataModel` + 语音指令，无需点击按钮即可提交 |
| 多 Agent 系统 | Orchestrator 管理多个 Surface，路由交互到正确的子 Agent |

### 17.4 GenUI 模式

A2UI 适用于多种生成式 UI 模式：

| 模式 | 特征 | 示例 |
|------|------|------|
| **Chat** | UI 片段按时间排列，混合用户输入 | 聊天界面中的卡片消息 |
| **Canvas** | 与 Agent 协作的空间 | 文档编辑、设计画布 |
| **Dashboard** | UI 片段按含义组织，持久固定 | 数据看板、管理后台 |
| **Wizard** | UI 片段逐个展示，收集任务信息 | 多步表单、配置向导 |

> **NoAI 信息**：在 GenUI 上下文中，应用所有者需明确定义哪些信息**不应被 AI 访问**（如信用卡信息），并在 UI 中清晰展示哪些输入会发送给 AI、哪些不会。这在医疗、金融等敏感场景中尤为重要。

---

## 总结

A2UI 代表了 AI Agent 与用户界面通信方式的根本性进步。它的核心价值在于：

- **安全**：Agent 输出纯数据（JSON），不执行代码，天然防注入；沙箱化的 `functionCall` 机制确保 Agent 只能触发预注册行为
- **跨平台**：同一份 JSON 在 Web/Mobile/Desktop 上原生渲染
- **框架中立**：不绑定前端框架，React/Flutter/Lit/Angular 均可
- **传输无关**：不绑定传输协议，可搭 AG-UI/A2A/MCP/SSE/WebSocket
- **增量更新**：扁平化邻接表 + JSON Pointer 路径支持细粒度 UI 演化
- **结构与数据分离**：组件树和数据模型独立更新，响应式绑定自动刷新
- **Catalog 系统**：可协商、可版本化、可验证的组件目录，支持优雅降级
- **双向 RPC**（v1.0）：`actionResponse` 和 `callFunction` 实现完整的双向通信
- **多 Agent 编排**：Surface 所有权模式和数据隔离确保多 Agent 环境的安全

如果说 AG-UI 解决了 Agent 和用户"怎么说话"的问题，那 A2UI 解决了 Agent "怎么画界面"的问题。两者协同，让 AI Agent 不再只是一个在后台提供文本答案的 API 服务，而是能够构建出真正嵌入 UI 应用、感知上下文、实时协同的智能化体验。

Agent 时代，UI 不再是开发者的专属领域——Agent 也学会了"说界面"。
