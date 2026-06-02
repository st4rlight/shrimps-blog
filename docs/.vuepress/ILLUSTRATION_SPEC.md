# 博客文章配图生成规范

> 本规范定义了 shrimps-blog 博客文章 SVG 配图的生成风格、存放位置、命名规则与引用方式。
> 供 AI 工具（如 CatPaw、Claude Code 等）在为文章生成配图时读取和遵循。

---

## 1. 存放位置与目录结构

### 1.1 基础路径

所有文章配图统一存放在 VuePress 的 `public` 目录下，按**栏目 → 文章名**分层组织：

```
docs/.vuepress/public/
├── bg.svg                          # 全局资源（非文章配图，勿动）
├── logo.svg                        # 全局资源（非文章配图，勿动）
├── notes/
│   ├── database/
│   │   └── database-normal-forms/  # 以文章 permalink 名称命名的目录
│   │       ├── 1nf-comparison.svg
│   │       ├── 2nf-comparison.svg
│   │       ├── 3nf-comparison.svg
│   │       ├── bcnf-comparison.svg
│   │       ├── normal-forms-overview.svg
│   │       └── normal-forms-tradeoff.svg
│   └── java-pickup/
│       └── java-thread-synchronization/
│           ├── cas-and-aba-problem.svg
│           ├── condition-vs-wait-notify.svg
│           ├── coordination-tools-comparison.svg
│           ├── read-write-lock-mechanism.svg
│           ├── sync-overview.svg
│           ├── sync-selection-guide.svg
│           └── synchronized-vs-reentrantlock.svg
└── ai-study/
    └── harness/                    # 已有目录但暂无配图
```

### 1.2 目录命名规则

配图目录名 = **文章的 permalink 最后一段**（即文章的 URL 标识名）。

| 文章源文件 | permalink | 配图目录 |
|-----------|-----------|---------|
| `docs/notes/database/database-normal-forms.md` | `/notes/database-normal-forms/` | `public/notes/database/database-normal-forms/` |
| `docs/notes/java-pickup/java-thread-synchronization.md` | `/notes/java-thread-synchronization/` | `public/notes/java-pickup/java-thread-synchronization/` |

**规则：** 配图目录的层级路径与文章源文件所在目录保持一致，最末一级目录名为文章 permalink 标识。

### 1.3 新增文章配图时的操作步骤

1. 在 `public/` 下对应的栏目目录中创建以文章名命名的子目录
2. 将 SVG 配图放入该子目录
3. 在 Markdown 文章中通过绝对路径引用：`![描述](/notes/栏目/文章目录名/文件名.svg)`

---

## 2. 文件命名规则

### 2.1 命名格式

全部使用 **kebab-case**（小写字母 + 连字符），语义化描述图片内容。

```
{主题关键词}-{图表类型}.svg
```

### 2.2 图表类型后缀

| 后缀 | 含义 | 示例 |
|------|------|------|
| `-overview` | 总览图、全貌图 | `sync-overview.svg`、`normal-forms-overview.svg` |
| `-comparison` | 对比图（反例 vs 正例） | `1nf-comparison.svg`、`2nf-comparison.svg` |
| `-vs-{主题}` | 两方案对比图 | `synchronized-vs-reentrantlock.svg`、`condition-vs-wait-notify.svg` |
| `-mechanism` | 机制原理图 | `read-write-lock-mechanism.svg` |
| `-guide` | 选型决策图、指引图 | `sync-selection-guide.svg` |
| `-tradeoff` | 权衡关系图 | `normal-forms-tradeoff.svg` |
| `-{问题名}` | 特定问题/概念图 | `cas-and-aba-problem.svg`、`coordination-tools-comparison.svg` |

### 2.3 命名原则

- 文件名应能直接推断图片内容，避免 `fig1.svg`、`image01.svg` 等无意义命名
- 同一文章下的配图文件名前缀可保持一致性（如 `sync-` 前缀标识同系列）
- 使用英文命名，不使用中文

---

## 3. SVG 生成风格规范

### 3.1 画布与基础设置

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {宽} {高}"
     font-family="'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif">
```

| 属性 | 规范 |
|------|------|
| `viewBox` | 宽度 700~840，高度 300~580，根据内容调整 |
| `font-family` | 固定为 `'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`（兼容 macOS/Windows/Linux 中英文渲染） |

### 3.2 配色体系

采用 **Tailwind CSS 色板** 为基础，保持全局统一。

#### 3.2.1 背景色

| 元素 | 颜色值 | 用途 |
|------|--------|------|
| 画布背景 | `#f8fafc` (slate-50) | 所有 SVG 的最外层背景 |
| 卡片/面板背景 | `#ffffff` (white) | 内容区域白底 |
| 信息面板背景 | `#f1f5f9` (slate-100) | 底部注释区、次要信息区 |

#### 3.2.2 语义色

| 语义 | 主色 (Tailwind) | 浅色填充 | 深色文字 | 边框色 | 典型用途 |
|------|-----------------|----------|----------|--------|---------|
| 蓝色（信息/方案A） | `#3b82f6` (blue-500) | `#dbeafe` (blue-100) | `#1d4ed8` (blue-700) | `#93c5fd` (blue-300) | 主要方案、synchronized |
| 绿色（正确/方案B） | `#10b981` (emerald-500) | `#d1fae5` (emerald-100) / `#dcfce7` (green-100) | `#047857` (emerald-700) | `#86efac` (green-300) | 正确做法、ReentrantLock |
| 黄色（警告/决策） | `#f59e0b` (amber-500) | `#fef3c7` (amber-100) | `#92400e` (amber-800) | `#fbbf24` (amber-400) | 注意事项、决策节点 |
| 红色（错误/问题） | `#ef4444` (red-500) | `#fee2e2` (red-100) | `#991b1b` (red-800) | `#fca5a5` (red-300) | 反例、错误、问题 |
| 紫色（轻量/特性） | `#8b5cf6` (violet-500) | `#ede9fe` (violet-100) | `#5b21b6` (violet-800) | `#c4b5fd` (violet-300) | volatile 等轻量方案 |
| 靛蓝（起始节点） | `#6366f1` (indigo-500) | — | — | — | 决策图起始节点 |

#### 3.2.3 文字色

| 层级 | 颜色值 | 用途 |
|------|--------|------|
| 标题 | `#1e293b` (slate-800) | 图表标题 |
| 正文 | `#475569` (slate-600) / `#374151` (gray-700) | 内容文字 |
| 辅助说明 | `#64748b` (slate-500) | 次要说明、属性描述 |
| 浅色辅助 | `#94a3b8` (slate-400) | 坐标轴标注、时间线标注 |

### 3.3 渐变色

用于卡片头部、标签等需要视觉强调的区域。统一使用 `linearGradient`，从浅到深：

```xml
<!-- 蓝色渐变 -->
<linearGradient id="blueG" x1="0%" y1="0%" x2="0%" y2="100%">
  <stop offset="0%" style="stop-color:#60a5fa;stop-opacity:1" />
  <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
</linearGradient>

<!-- 绿色渐变 -->
<linearGradient id="greenG" x1="0%" y1="0%" x2="0%" y2="100%">
  <stop offset="0%" style="stop-color:#34d399;stop-opacity:1" />
  <stop offset="100%" style="stop-color:#10b981;stop-opacity:1" />
</linearGradient>

<!-- 黄色渐变 -->
<linearGradient id="amberG" x1="0%" y1="0%" x2="100%" y2="100%">
  <stop offset="0%" style="stop-color:#fbbf24;stop-opacity:1" />
  <stop offset="100%" style="stop-color:#f59e0b;stop-opacity:1" />
</linearGradient>

<!-- 红色渐变 -->
<linearGradient id="redG" x1="0%" y1="0%" x2="0%" y2="100%">
  <stop offset="0%" style="stop-color:#f87171;stop-opacity:1" />
  <stop offset="100%" style="stop-color:#ef4444;stop-opacity:1" />
</linearGradient>
```

**规则：**
- 渐变 id 命名：`{颜色名}G` 或 `g{序号}`（多色场景）
- 方向：纵向（y1→y2）用于标题栏，对角线（x1+y2）用于标签/圆形

### 3.4 阴影

所有卡片、面板统一使用投影效果：

```xml
<filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
  <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.12"/>
</filter>
```

较强调的阴影（用于主卡片）：

```xml
<filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
  <feDropShadow dx="0" dy="3" stdDeviation="5" flood-opacity="0.15"/>
</filter>
```

使用方式：`<g filter="url(#shadow)"><rect .../></g>`

### 3.5 箭头

统一使用 SVG marker 定义箭头：

```xml
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="7" markerHeight="7" orient="auto-start-auto">
  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
</marker>
```

**变体：**
| id | fill 色 | 用途 |
|----|---------|------|
| `arrow` | `#94a3b8` (slate-400) | 通用箭头 |
| `arrowY` | `#f59e0b` (amber-500) | "是"分支箭头 |
| `arrowN` | `#64748b` (slate-500) | "否"分支箭头 |
| `arrowG` | `#10b981` (emerald-500) | 绿色/成功箭头 |
| `arrowR` | `#ef4444` (red-500) | 红色/失败箭头 |

### 3.6 圆角规范

| 元素 | 圆角 rx | 说明 |
|------|---------|------|
| 画布背景 | 12~16 | 最外层 |
| 卡片/面板 | 10~12 | 主要内容区 |
| 标签/按钮 | 4~8 | 小型元素 |
| 底部提示条 | 6~13 | 视情况调整 |

### 3.7 字号规范

| 元素 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 图表标题 | 18~22 | 700 | `#1e293b` |
| 副标题 | 13~15 | 600~700 | `#475569` |
| 卡片标题 | 14~18 | 600~700 | 根据语义色 |
| 正文内容 | 10~13 | 400~500 | `#374151` / `#64748b` |
| 辅助标注 | 8~10 | 400~600 | `#94a3b8` / 语义色 |
| 底部提示 | 10~11 | 400~500 | `#64748b` / 语义色 |

---

## 4. 图表类型与布局模板

### 4.1 总览/层次图（overview）

适用于展示某主题下多个方案的分类全貌。

**布局特征：**
- 顶部标题 + 副标题
- 左侧分类标签（可见性/原子性/互斥/协调等）
- 右侧按层级排列的方案卡片
- 底部实践建议提示条

**参考示例：** `sync-overview.svg`、`normal-forms-overview.svg`

### 4.2 对比图（comparison / vs）

适用于两种方案或反例与正例的对比。

**布局特征：**
- 左右两栏布局（反例❌ / 正例✅ 或 方案A / 方案B）
- 中间用 VS 圆圈或箭头连接
- 各栏顶部有渐变色标题栏
- 底部列出优势/局限

**参考示例：** `1nf-comparison.svg`、`synchronized-vs-reentrantlock.svg`、`condition-vs-wait-notify.svg`

### 4.3 机制原理图（mechanism）

适用于展示某技术的工作流程或内部机制。

**布局特征：**
- 分步骤展示流程
- 用箭头连接各步骤
- 关键判断用黄色高亮
- 成功/失败分支用绿/红色区分

**参考示例：** `cas-and-aba-problem.svg`、`read-write-lock-mechanism.svg`

### 4.4 决策图（guide）

适用于展示选型决策逻辑。

**布局特征：**
- 顶部起始节点（圆角胶囊形，靛蓝渐变）
- 纵向排列的菱形/矩形决策节点（黄色边框）
- "是"分支向右或向下（黄色/绿色箭头）
- "否"分支继续向下（灰色箭头）
- 结果节点为绿色圆角矩形

**参考示例：** `sync-selection-guide.svg`

### 4.5 权衡/曲线图（tradeoff）

适用于展示两个维度之间的权衡关系。

**布局特征：**
- 坐标轴体系（X/Y 轴带标签）
- 网格虚线
- 曲线用 `<path>` 贝塞尔曲线
- 最佳实践区域用绿色虚线框标注
- 底部提示条

**参考示例：** `normal-forms-tradeoff.svg`

---

## 5. Markdown 引用规范

### 5.1 引用格式

```markdown
![图表描述](/notes/{栏目}/{文章目录名}/{文件名}.svg)
```

- 使用**绝对路径**（以 `/` 开头），不以 `..` 或 `./` 相对路径引用
- alt 文本需用中文描述图片内容

### 5.2 插入位置

| 图表类型 | 推荐插入位置 |
|---------|------------|
| overview（总览图） | 章节开头，介绍完背景之后 |
| comparison（对比图） | 对比表格之前或之后 |
| mechanism（机制图） | 代码示例之前，用于先建立直觉 |
| guide（决策图） | 选型建议章节开头 |
| tradeoff（权衡图） | 总结/注意事项部分 |

### 5.3 引用示例

```markdown
Java 提供了从轻量到重量级的多种同步方案，适用于不同场景。

![Java线程同步方案总览](/notes/java-pickup/java-thread-synchronization/sync-overview.svg)
```

---

## 6. SVG 代码规范

### 6.1 结构顺序

SVG 文件内部元素按以下顺序组织：

1. `<defs>` — 渐变、滤镜、箭头 marker
2. 背景矩形 `<rect>`
3. 标题 `<text>`
4. 内容区域（卡片、流程、对比等）
5. 底部提示条

### 6.2 注释要求

每个主要区域使用 XML 注释标注用途：

```xml
<!-- ===== Left: Anti-pattern ===== -->
<!-- ===== Right: Correct ===== -->
<!-- Barrier line -->
<!-- Properties -->
```

### 6.3 尺寸建议

| 图表类型 | 推荐宽度 | 推荐高度范围 |
|---------|---------|------------|
| 对比图（双栏） | 780~800 | 340~480 |
| 总览图 | 800~820 | 520~580 |
| 机制图 | 800 | 380~420 |
| 决策图 | 800~820 | 500~560 |
| 权衡图 | 700 | 380~400 |

### 6.4 避免事项

- ❌ 不使用 `<foreignObject>`（兼容性问题）
- ❌ 不引用外部字体或资源（保持自包含）
- ❌ 不使用 JavaScript 或动画
- ❌ 不使用中文文件名
- ❌ 不在 SVG 内使用 `<style>` 标签（内联样式为主）

---

## 7. 完整 SVG 模板

以下是最小可用的 SVG 模板，生成新配图时以此为基础：

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" font-family="'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif">
  <defs>
    <linearGradient id="blueG" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#60a5fa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.12"/>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
    </marker>
  </defs>

  <!-- Background -->
  <rect width="800" height="400" rx="12" fill="#f8fafc"/>

  <!-- Title -->
  <text x="400" y="35" text-anchor="middle" font-size="20" font-weight="700" fill="#1e293b">图表标题</text>
  <text x="400" y="55" text-anchor="middle" font-size="12" fill="#94a3b8">副标题说明</text>

  <!-- Content Card -->
  <g filter="url(#shadow)">
    <rect x="30" y="75" width="340" height="280" rx="12" fill="white" stroke="#3b82f6" stroke-width="2"/>
  </g>
  <rect x="30" y="75" width="340" height="40" rx="12" fill="url(#blueG)"/>
  <rect x="30" y="95" width="340" height="20" fill="url(#blueG)"/>
  <text x="200" y="100" text-anchor="middle" font-size="15" font-weight="700" fill="white">卡片标题</text>

  <!-- Card content here -->

  <!-- Bottom tip -->
  <rect x="200" y="370" width="400" height="26" rx="13" fill="#f0fdf4" stroke="#bbf7d0" stroke-width="1"/>
  <text x="400" y="387" text-anchor="middle" font-size="11" fill="#15803d">💡 实践建议</text>
</svg>
```
