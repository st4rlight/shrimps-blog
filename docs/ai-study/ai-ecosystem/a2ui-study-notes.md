---
title: A2UI 学习笔记
tags:
  - A2UI
  - Agent
  - 生成式UI
  - Google
excerpt: A2UI（Agent-to-User Interface）是 Google 推出的开源声明式 UI 协议，让 AI Agent 用 JSON 描述界面意图，客户端用原生组件渲染。本文系统梳理 A2UI 的核心理念、架构设计、组件体系、渲染机制与实战用法。
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
2. 这段 JSON 通过**任意传输通道**（A2A 协议、AG-UI、SSE、WebSocket 等）到达客户端
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
| 出品方 | CopilotKit（2025.05） | Google（2025，v0.9） |
| 通信方式 | 事件流（SSE/WebSocket） | 不绑定传输 |
| 数据格式 | 结构化事件（16+ 种事件类型） | 声明式 JSON 蓝图 |
| 关注点 | 流式输出 · 状态同步 · 人工干预 | UI 生成 · 跨平台渲染 · 安全隔离 |

简单说：**AG-UI 是管道，A2UI 是内容。** AG-UI 负责建立 Agent 和前端之间的通信通道，A2UI 负责定义通过该通道传输的 UI 描述格式。两者可以很好地协同工作。

## 二、架构设计

### 2.1 全景架构

![A2UI架构总览](/ai-study/ai-ecosystem/a2ui-study-notes/a2ui-architecture-overview.svg)

A2UI 的架构把 UI 生成和 UI 执行**彻底解耦**：

- **Agent 端**：LLM 推理后生成声明式 JSON 蓝图（不包含任何可执行代码）
- **传输层**：JSON 蓝图通过任意通道传输到客户端
- **客户端**：A2UI Renderer 解析 JSON，映射为本地原生组件树
- **用户**：看到原生 UI，交互后触发新的 Agent 调用

### 2.2 三个核心组件

#### Agent（后端智能体）

Agent 负责理解用户意图，并决定需要展示什么样的界面。它由三部分组成：

- **LLM 推理**：理解用户意图，决定 UI 结构
- **JSON 蓝图生成器**：输出符合 A2UI 规范的声明式 UI 描述
- **Agent SDK**：Google 提供的 Python SDK，辅助 LLM 生成合规的 JSON

Agent 不需要知道客户端用的是什么框架——它只输出"我要一个 Card，里面放一个 Text 和一个 Button"这样的描述。

#### Transport（传输层）

A2UI 的一个重要设计决策：**不绑定传输协议**。JSON 蓝图可以通过任何通道传输：

- A2A 协议（Google 的 Agent 间通信协议）
- AG-UI（CopilotKit 的交互协议）
- SSE / WebSocket
- 甚至普通的 HTTP 响应

这意味着 A2UI 可以无缝集成到现有的 Agent 通信架构中，而不需要引入新的传输基础设施。

#### Client App（客户端应用）

客户端是 UI 渲染的执行者，包含两个核心模块：

- **A2UI Renderer**：解析 JSON 蓝图，构建组件树，映射为原生组件
- **Native Components**：经过审核的安全组件库，提供 Card、Text、Button、Slider 等基础组件

客户端拥有 UI 的完全控制权——它决定怎么渲染、用什么样式、如何响应交互。Agent 只描述"要什么"，客户端决定"怎么画"。

### 2.3 安全模型

A2UI 的安全设计是其核心优势之一：

- **不执行任意代码**：Agent 输出的是纯数据（JSON），不是代码
- **不注入 script 标签**：JSON 中不包含任何可执行内容
- **客户端本地渲染**：所有 UI 由客户端已审核的组件库渲染
- **跨信任边界安全**：即使 Agent 运行在远程服务器上，也无法操控客户端 UI

这和传统方案（Agent 返回 HTML/JS 在 iframe 中执行）形成了鲜明对比——传统方案中，Agent 的输出直接在用户浏览器中执行，存在 XSS 注入风险；而 A2UI 中，Agent 的输出只是数据描述，渲染由客户端的安全组件库完成。

## 三、JSON 蓝图：A2UI 的"语言"

### 3.1 扁平化邻接表结构

A2UI 的 JSON 蓝图不使用嵌套的树形结构，而是采用**扁平化的邻接表**（Flat Adjacency List）：

```json
{
  "beginRendering": {
    "surfaceId": "restaurant-search",
    "root": "card-1"
  },
  "surfaceUpdate": {
    "surfaceId": "restaurant-search",
    "components": [
      { "id": "card-1", "type": "Card", "children": ["text-1", "button-1"] },
      { "id": "text-1", "type": "Text", "text": "找到 5 家中餐厅" },
      { "id": "button-1", "type": "Button", "label": "筛选", "onClick": "filter-action" }
    ]
  }
}
```

**为什么不用嵌套树？** 因为扁平化结构天然支持**细粒度增量更新**——要修改一个组件，只需发送该组件的新版本，而不需要重传整棵树。

### 3.2 Surface 概念

**Surface（渲染表面）** 是 A2UI 中的一个核心概念，类似于一个"画布"或"容器"：

- 每个 Surface 有唯一的 `surfaceId`
- 一个 Agent 可以同时管理多个 Surface（如主界面 + 侧边栏）
- `beginRendering` 事件声明开始渲染某个 Surface
- `surfaceUpdate` 事件更新 Surface 的内容

### 3.3 三种核心 DataPart

一个完整的 A2UI 交互消息通常包含三个核心 DataPart：

| DataPart | 作用 | 说明 |
|----------|------|------|
| `beginRendering` | 开始渲染 | 声明 surfaceId 和根组件 ID |
| `surfaceUpdate` | 更新界面 | 添加、修改或删除组件 |
| `endRendering` | 结束渲染 | 标记 Surface 渲染完成 |

## 四、渲染流程

### 4.1 完整流程

![A2UI渲染流程机制](/ai-study/ai-ecosystem/a2ui-study-notes/a2ui-rendering-flow.svg)

从用户输入到原生 UI 渲染，完整经历七个步骤：

1. **用户输入**：用户在聊天框输入"帮我找纽约的中餐厅"
2. **message/send**：前端封装 JSON-RPC 2.0 请求发送给 Agent
3. **Agent 处理**：LLM 推理 + 工具调用，决定需要展示搜索结果卡片
4. **JSON 蓝图**：Agent 生成包含 `beginRendering` + `surfaceUpdate` 的 JSON
5. **传输到客户端**：通过 SSE/WebSocket/A2A/AG-UI 传输
6. **A2UI Renderer 解析**：扁平化列表 → 构建组件树 → 映射原生组件
7. **原生 UI 渲染**：React 组件 / Flutter Widget / Lit Web Component

### 4.2 增量更新机制

A2UI 的增量更新是其一大亮点。界面以扁平化组件列表形式组织，Agent 可以在对话流中逐次添加、修改或删除组件：

```text
初始：beginRendering + surfaceUpdate
      → 创建 Surface，渲染 Card + Text + Button

增量：surfaceUpdate (add)
      → 新增一个 Select 组件（菜系筛选）

增量：surfaceUpdate (update)
      → 修改 Text 内容为"找到 5 家餐厅"

增量：surfaceUpdate (remove)
      → 移除加载动画 Spinner
```

每次更新只传输变化的组件，不需要重传整个界面。这对于复杂界面（如多步表单、数据看板）尤其重要——大幅减少了数据传输量和渲染开销。

### 4.3 用户交互回调

当用户在渲染的 UI 上操作时（如点击按钮、提交表单），交互事件会通过消息流回传给 Agent：

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "evt-001",
      "role": "user",
      "parts": [
        {
          "kind": "data",
          "data": {
            "action": "filter-action",
            "params": { "cuisine": "川菜", "rating": "4.5+" }
          }
        }
      ]
    }
  },
  "id": 2
}
```

Agent 收到交互回调后，进行新一轮 LLM 推理，可能生成更新后的 UI 蓝图——这就是"对话式 UI"的循环：UI 展示 → 用户交互 → Agent 推理 → UI 更新。

## 五、组件体系

### 5.1 内置组件库

A2UI 提供了丰富的内置组件，覆盖常见 UI 场景：

| 组件类型 | 用途 | 示例场景 |
|---------|------|---------|
| `Card` | 卡片容器 | 信息展示、结果列表 |
| `Text` | 文本显示 | 标题、描述、提示 |
| `Button` | 按钮 | 提交、取消、操作触发 |
| `TextInput` | 文本输入 | 搜索框、表单字段 |
| `Select` | 下拉选择 | 筛选条件、选项选择 |
| `Slider` | 滑块 | 数值范围选择 |
| `DatePicker` | 日期选择 | 预约、日程安排 |
| `Image` | 图片展示 | 结果预览、图标 |
| `Chart` | 图表 | 数据可视化 |
| `List` | 列表 | 多项数据展示 |

### 5.2 Smart Wrapper（自定义组件扩展）

A2UI 不局限于内置组件。通过 **Smart Wrapper** 机制，开发者可以将任意现有 UI 组件接入 A2UI 生态：

```typescript
// 注册自定义组件
a2uiRenderer.registerComponent('MapView', {
  render: (props) => {
    return <MapViewComponent
      latitude={props.latitude}
      longitude={props.longitude}
      markers={props.markers}
    />
  },
  validate: (props) => {
    return props.latitude && props.longitude
  }
})
```

注册后，Agent 就可以在 JSON 蓝图中使用 `"type": "MapView"` 来引用这个自定义组件。这让 A2UI 既能开箱即用，又能无限扩展。

### 5.3 客户端自定义函数

v0.9 版本引入了**客户端自定义函数**（Client-Side Functions），允许 Agent 在 JSON 蓝图中引用客户端预定义的函数：

```json
{
  "id": "total-price",
  "type": "Text",
  "text": "{formatCurrency(calculateTotal(items))}"
}
```

这些函数在客户端本地执行，不经过网络——既保证了安全性，又提供了动态计算能力。

## 六、跨平台渲染

### 6.1 框架中立设计

A2UI 的核心设计原则之一是**框架中立**——同一套 JSON 描述可以无缝对接不同前端框架：

| 平台 | 渲染器 | 组件映射 |
|------|--------|---------|
| Web (React) | 官方 React Renderer | A2UI Card → React `<Card>` |
| Web (Lit) | Lit Renderer | A2UI Card → Lit `<a2ui-card>` |
| Web (Angular) | Angular Renderer | A2UI Card → Angular Component |
| Mobile (Flutter) | Flutter Renderer | A2UI Card → Flutter `Card` Widget |
| Desktop | 任意 Web 渲染器 | 通过 Electron / Tauri 运行 |

### 6.2 主题与样式

A2UI 支持**主题定制**和**样式统一**：

- 客户端可以全局配置主题色、字体、间距等
- Agent 生成的 JSON 只描述语义结构（"这是一个标题"），不描述具体样式（"24px 加粗蓝色"）
- 样式由客户端的主题系统统一控制，保证跨界面一致性

这意味着同一个 Agent 的输出，在不同客户端上会自动适配当地的视觉风格——企业内部系统的 Agent 输出会遵循企业 UI 规范，消费级 App 的 Agent 输出会遵循 App 的设计语言。

## 七、实战：如何使用 A2UI

### 7.1 客户端集成（React）

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

// 监听用户交互
renderer.onAction((action) => {
  // 将用户交互回传给 Agent
  agent.sendMessage({
    parts: [{
      kind: 'data',
      data: action,
    }]
  })
})

// 接收 Agent 的 JSON 蓝图并渲染
agent.on('message', (message) => {
  const dataParts = message.parts.filter(p => p.kind === 'data')
  for (const part of dataParts) {
    renderer.processDataPart(part.data)
  }
})
```

### 7.2 Agent 端集成（Python SDK）

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

# 生成 UI 蓝图
@agent.ui_renderer
def render_results(results: list) -> dict:
    """将搜索结果渲染为 A2UI 界面"""
    components = []
    for i, r in enumerate(results):
        components.append({
            "id": f"card-{i}",
            "type": "Card",
            "children": [f"name-{i}", f"rating-{i}"]
        })
        components.append({
            "id": f"name-{i}",
            "type": "Text",
            "text": f"{r['name']} - {r['rating']}⭐"
        })

    return {
        "beginRendering": {"surfaceId": "results", "root": "container"},
        "surfaceUpdate": {
            "surfaceId": "results",
            "components": [{"id": "container", "type": "List", "children": [c["id"] for c in components if c["type"] == "Card"]}] + components
        }
    }
```

### 7.3 与 AG-UI 协同使用

A2UI 和 AG-UI 的协同非常自然——AG-UI 提供通信通道，A2UI 提供通过该通道传输的 UI 内容：

```typescript
// AG-UI Client 负责通信
const agent = new HttpAgent({ serverUrl: '...' })

// A2UI Renderer 负责渲染
const renderer = new A2UIRenderer({ container: ... })

// AG-UI 事件流中携带 A2UI JSON 蓝图
agent.on('CUSTOM_EVENT', (event) => {
  if (event.name === 'a2ui-update') {
    renderer.processDataPart(event.data)
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

## 八、最佳实践

### 8.1 UI 蓝图要保持简洁

Agent 生成的 JSON 蓝图应该聚焦于**信息结构**，而非视觉细节。不要让 Agent 决定颜色、字号、间距——这些交给客户端的主题系统。

### 8.2 善用增量更新

不要每次都全量重传界面。对于局部变化（如更新列表中某一项的状态），使用 `surfaceUpdate` 的增量模式，只发送变化的组件。

### 8.3 组件粒度要适中

- 太粗：一个组件包含太多内容，增量更新困难
- 太细：JSON 膨胀，渲染开销增加
- 建议：每个组件是一个独立的交互单元或信息单元

### 8.4 交互回调要明确

每个可交互组件都应关联明确的 action 标识。Agent 收到回调后应能快速定位用户操作的上下文，避免不必要的 LLM 推理。

### 8.5 渐进式渲染

利用 `beginRendering` → `surfaceUpdate` → `endRendering` 的三阶段模式，让用户看到"正在构建界面"的过程，而不是等待完整 JSON 生成后才一次性渲染。这能显著提升感知性能。

## 九、版本演进与生态

### 9.1 版本历程

| 版本 | 时间 | 核心更新 |
|------|------|---------|
| v0.8 | 2025 初 | 初始公开版本，基础组件库 |
| v0.9 | 2025.04 | 共享 Web 核心库、官方 React 渲染器、Flutter/Lit/Angular 渲染器更新、Agent SDK、客户端自定义函数、客户端与服务器数据同步 |

### 9.2 生态集成

A2UI 生态正在快速发展，目前已支持：

- **AG2**：多 Agent 框架集成
- **A2A 1.0**：Google Agent 间通信协议
- **json-render**：通用 JSON 渲染方案
- 未来计划：Go、Kotlin 版本 SDK

### 9.3 适用场景

| 场景 | A2UI 的价值 |
|------|------------|
| 多步表单 | Agent 根据上下文动态生成表单，减少对话轮次 |
| 数据查询 | 搜索结果以卡片列表展示，支持筛选和排序 |
| 预约系统 | 日期选择器 + 时间 slots + 确认按钮 |
| 数据看板 | Agent 分析数据后生成图表和指标卡片 |
| 跨平台 Agent | 一套 UI 描述，Web/Mobile/Desktop 原生渲染 |

---

## 总结

A2UI 代表了 AI Agent 与用户界面通信方式的根本性进步。它的核心价值在于：

- **安全**：Agent 输出纯数据（JSON），不执行代码，天然防注入
- **跨平台**：同一份 JSON 在 Web/Mobile/Desktop 上原生渲染
- **框架中立**：不绑定前端框架，React/Flutter/Lit/Angular 均可
- **传输无关**：不绑定传输协议，可搭 AG-UI/A2A/SSE/WebSocket
- **增量更新**：扁平化邻接表结构支持细粒度 UI 演化

如果说 AG-UI 解决了 Agent 和用户"怎么说话"的问题，那 A2UI 解决了 Agent "怎么画界面"的问题。两者协同，让 AI Agent 不再只是一个在后台提供文本答案的 API 服务，而是能够构建出真正嵌入 UI 应用、感知上下文、实时协同的智能化体验。

Agent 时代，UI 不再是开发者的专属领域——Agent 也学会了"说界面"。
