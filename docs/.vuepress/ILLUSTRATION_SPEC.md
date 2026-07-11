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

> ⚠️ **阴影会扩展视觉边界约 5px**，排列相邻元素时需额外预留间距。

### 3.5 箭头

#### 3.5.1 Marker 定义（修正版）

> ⚠️ **旧版 marker 存在三个问题，已修正：**
> 1. `refX="9"` → 箭头尖端超出线段终点 1 个单位，刺入目标形状。修正为 `refX="10"`。
> 2. 默认 `markerUnits="strokeWidth"` → 不同 `stroke-width` 的线条箭头大小不一致。修正为 `markerUnits="userSpaceOnUse"`。
> 3. `orient="auto-start-auto"` → 在部分渲染器中对 `marker-end` 行为不一致。修正为 `orient="auto"`。

```xml
<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="8" markerHeight="8"
        markerUnits="userSpaceOnUse"
        orient="auto"
        preserveAspectRatio="xMidYMid meet">
  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
</marker>
```

**关键属性说明：**

| 属性 | 值 | 原因 |
|------|-----|------|
| `refX` | `10` | 箭头尖端正好对齐线段终点，不会刺入目标形状 |
| `refY` | `5` | 垂直居中 |
| `markerUnits` | `userSpaceOnUse` | 箭头大小固定为像素值，不受 `stroke-width` 影响，确保全局一致 |
| `orient` | `auto` | 仅根据线段方向旋转，行为最稳定 |
| `preserveAspectRatio` | `xMidYMid meet` | 防止 viewBox 到 markerWidth/Height 的缩放变形 |
| `markerWidth/Height` | `8` | 固定 8px，视觉清晰且不过大 |

#### 3.5.2 变体

每个 SVG 的 `<defs>` 中按需定义以下变体。**所有变体必须使用与 3.5.1 完全相同的属性结构**（仅 `id` 和 `fill` 不同）：

| id | fill 色 | 用途 |
|----|---------|------|
| `arrow` | `#94a3b8` (slate-400) | 通用箭头 |
| `arrowY` | `#f59e0b` (amber-500) | "是"分支箭头 |
| `arrowN` | `#64748b` (slate-500) | "否"分支箭头 |
| `arrowG` | `#10b981` (emerald-500) | 绿色/成功箭头 |
| `arrowR` | `#ef4444` (red-500) | 红色/失败箭头 |
| `arrowB` | `#3b82f6` (blue-500) | 蓝色/流程箭头 |

**变体定义示例：**

```xml
<marker id="arrowY" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="8" markerHeight="8"
        markerUnits="userSpaceOnUse"
        orient="auto"
        preserveAspectRatio="xMidYMid meet">
  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b"/>
</marker>
```

#### 3.5.3 箭头端点计算规则

> 箭头位置不正确的根本原因是**线段起止点坐标没有基于形状边界精确计算**。以下是强制规则。

**规则 1：线段终点必须停在目标形状边界外 4px**

箭头尖端（refX=10）正好在线段终点处，因此线段终点 = 目标形状边界 - 4px 间隙。

**规则 2：线段起点必须从源形状边界开始**

线段起点 = 源形状边界 + 0px（紧贴边界）。

**水平箭头（→）计算公式：**

```
源形状: x=src_x, y=src_y, width=src_w, height=src_h
目标形状: x=tgt_x, y=tgt_y, width=tgt_w, height=tgt_h

x1 = src_x + src_w          （源形状右边缘）
x2 = tgt_x - 4              （目标形状左边缘 - 4px gap）
y1 = y2 = (src_y + src_h/2)  （源形状垂直中心，必须 = 目标形状垂直中心）
```

**正确示例：**
```xml
<!-- 源形状: x=50, y=130, w=140, h=35 → 右边缘=190, 中心y=147 -->
<rect x="50" y="130" width="140" height="35" rx="6" fill="#dbeafe"/>
<!-- 目标形状: x=240, y=130, w=140, h=35 → 左边缘=240, 中心y=147 -->
<rect x="240" y="130" width="140" height="35" rx="6" fill="#dbeafe"/>
<!-- 箭头: 从 190 到 236（240-4），y=147 -->
<line x1="190" y1="147" x2="236" y2="147" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>
```

**垂直箭头（↓）计算公式：**

```
y1 = src_y + src_h          （源形状下边缘）
y2 = tgt_y - 4              （目标形状上边缘 - 4px gap）
x1 = x2 = (src_x + src_w/2)  （源形状水平中心，必须 = 目标形状水平中心）
```

**对角箭头：**

- 必须使用 `<path>` 而非 `<line>`
- 起点和终点必须经过手动计算，确保在形状边界上
- 优先考虑使用**折线路径**（L 形或 Z 形）替代斜线，视觉更整洁：

```xml
<!-- L 形折线: 水平再垂直 -->
<path d="M 190 147 L 220 147 L 220 200" stroke="#94a3b8" stroke-width="1.5"
      fill="none" marker-end="url(#arrow)"/>
```

#### 3.5.4 箭头标签放置规则

标签（如"是"/"否"/"成功"/"失败"）放置在箭头中点附近，**必须偏移以避免与线段重叠**：

| 箭头方向 | 标签位置 | text-anchor |
|---------|---------|-------------|
| 水平向右（→） | 中点上方 8~10px | `middle` |
| 水平向左（←） | 中点上方 8~10px | `middle` |
| 垂直向下（↓） | 中点右侧 8~10px | `start` |
| 垂直向上（↑） | 中点右侧 8~10px | `start` |
| 对角线 | 箭头线"外侧"（远离其他元素的一侧），偏移 8~10px | `start` 或 `middle` |

**水平箭头标签示例：**
```xml
<!-- 箭头中点 x = (190+236)/2 = 213，y = 147 -->
<line x1="190" y1="147" x2="236" y2="147" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#arrowY)"/>
<text x="213" y="139" text-anchor="middle" font-size="10" fill="#f59e0b" font-weight="600">是</text>
```

**垂直箭头标签示例：**
```xml
<!-- 箭头中点 y = (190+236)/2 = 213，x = 410 -->
<line x1="410" y1="190" x2="410" y2="236" stroke="#f59e0b" stroke-width="1.5" marker-end="url(#arrowY)"/>
<text x="418" y="216" text-anchor="start" font-size="10" fill="#f59e0b" font-weight="600">是</text>
```

#### 3.5.5 箭头使用禁忌

- ❌ 禁止线段终点落在形状内部（箭头会刺入形状）
- ❌ 禁止线段起点在形状内部（线会从形状中间画出）
- ❌ 禁止对角线段两端都不在形状边界上
- ❌ 禁止箭头标签与线段重叠（标签必须偏移 8~10px）
- ❌ 禁止用极短线段（<15px）承载箭头（箭头占比过大，视觉不协调）
- ❌ 禁止水平箭头的 `y1 ≠ y2`（会导致箭头歪斜）
- ❌ 禁止垂直箭头的 `x1 ≠ x2`（会导致箭头歪斜）

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

### 3.8 防重叠与间距规范

#### 3.8.1 最小间距要求

| 元素关系 | 最小间距 | 说明 |
|---------|---------|------|
| 卡片与卡片（水平并列） | 20px | 左右相邻的卡片之间 |
| 卡片与卡片（垂直排列） | 16px | 上下相邻的卡片之间 |
| 形状与画布边缘 | 25~30px | 所有内容元素距画布边界 |
| 文字与卡片内边距 | 10~12px | 文字距卡片边缘的安全距离 |
| 箭头终点与目标形状 | 4px | 箭头尖端与目标形状之间的视觉间隙 |
| 箭头标签与箭头线 | 8~10px | 标签不压在线上 |
| 标题与内容区 | 15~20px | 标题下方到第一个内容元素的间距 |
| 带阴影的形状之间 | 额外 +5px | 阴影扩展视觉边界，需预留空间 |

#### 3.8.2 布局网格系统

所有坐标尽量对齐到 **5px 网格**（坐标值为 5 的倍数），关键元素对齐到 **10px 网格**。

**好处：**
- 避免坐标计算误差导致的 1~2px 重叠
- 视觉上更整齐
- 便于心算验证间距

**示例：**
```xml
<!-- ✅ 好：坐标对齐到 10px 网格，间距 = 20px -->
<rect x="30" y="75" width="340" height="280" rx="12" .../>
<rect x="390" y="75" width="380" height="280" rx="12" .../>
<!-- 30 + 340 + 20(gap) = 390 ✓ -->

<!-- ❌ 坏：随意坐标，间距不均 -->
<rect x="32" y="73" width="338" height="282" rx="12" .../>
<rect x="389" y="76" width="381" height="279" rx="12" .../>
<!-- 间距 = 389 - (32+338) = 19px，不可控 -->
```

#### 3.8.3 文字防重叠规则

1. **每行文字的 y 坐标间距** ≥ `font-size + 4px`
   - 例：12px 字号 → 行距 ≥ 16px
   - 例：10px 字号 → 行距 ≥ 14px

2. **多行文字使用 `<tspan>`** 而非多个独立 `<text>`，确保行距一致：
   ```xml
   <text x="200" y="120" font-size="11" fill="#64748b">
     <tspan x="200" dy="0">第一行文字</tspan>
     <tspan x="200" dy="16">第二行文字</tspan>
     <tspan x="200" dy="16">第三行文字</tspan>
   </text>
   ```

3. **文字宽度预估**（防止溢出容器）：
   - 中文字符宽度 ≈ `font-size`（如 12px 字号 → 每字约 12px 宽）
   - 英文字符宽度 ≈ `0.55 × font-size`（如 12px 字号 → 每字约 7px 宽）
   - 预估总宽度后确保不超出容器内宽（容器宽度 - 2 × 内边距）

4. **长文本必须折行**：如果预估文字宽度超过容器内宽，拆成多行。

#### 3.8.4 形状防重叠规则

1. **嵌套形状**（如标题栏在卡片上）：内层形状的 x/y/width/height 必须在外层形状范围内
2. **并列形状**：相邻形状的边界之间必须留有最小间距（见 3.8.1）
3. **绘制顺序**：先画大背景，再画小元素；先画无阴影元素，再画有阴影元素
4. **阴影预留**：`<filter>` 阴影会扩展视觉边界约 5px，排列时需额外预留

### 3.9 坐标对齐规范

#### 3.9.1 水平居中对齐

同一行内的多个形状，如果需要视觉上水平居中对齐，它们的**垂直中心 y 坐标必须相同**：

```
形状中心 y = shape_y + shape_height / 2
→ 所有同行形状的中心 y 必须相等
```

**示例：** 两个高度不同的形状水平排列时，调整 y 使中心对齐：
```
形状A: height=35 → y=130, 中心y=147
形状B: height=45 → y=125, 中心y=147  ← 调整 y 使中心一致
```

#### 3.9.2 垂直居中对齐

同一列内的多个形状，如果需要视觉上垂直居中对齐，它们的**水平中心 x 坐标必须相同**：

```
形状中心 x = shape_x + shape_width / 2
→ 所有同列形状的中心 x 必须相等
```

#### 3.9.3 箭头连接对齐

- **水平箭头**：`y1 = y2 = 源形状中心 y = 目标形状中心 y`
  - 如果两个形状高度不同，调整 y 使中心一致，或使用折线
- **垂直箭头**：`x1 = x2 = 源形状中心 x = 目标形状中心 x`
  - 如果两个形状宽度不同，调整 x 使中心一致，或使用折线
- **非对齐形状**：如果源/目标形状中心不在同一条水平/垂直线上，**必须使用折线 `<path>`** 而非直线 `<line>`

**折线路径示例（L 形）：**
```xml
<!-- 从形状A右边缘(190,147) 水平到 x=220，再垂直向下到 目标形状上方(220,236) -->
<path d="M 190 147 L 220 147 L 220 236"
      stroke="#94a3b8" stroke-width="1.5" fill="none"
      marker-end="url(#arrow)"/>
```

#### 3.9.4 坐标整数化

所有 `x`、`y`、`width`、`height` 值必须为**整数**。

- ❌ 禁止 `x="45.5"`、`y="73.2"` 等小数坐标
- 小数坐标会导致渲染模糊和亚像素对齐问题
- 如果计算结果为小数，四舍五入到最近整数

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
- ❌ 不使用小数坐标（如 `x="45.5"`），所有坐标必须为整数
- ❌ 不使用默认 `markerUnits`（必须显式设置 `markerUnits="userSpaceOnUse"`）
- ❌ 不使用 `refX="9"`（必须用 `refX="10"`，箭头尖端对齐线段终点）
- ❌ 不使用 `orient="auto-start-auto"`（必须用 `orient="auto"`）
- ❌ 不让线段终点落在形状内部（箭头会刺入形状）
- ❌ 不让线段起点在形状内部（线段会从形状中间画出）
- ❌ 不使用极短线段（<15px）承载箭头
- ❌ 不让箭头标签与箭头线段重叠
- ❌ 不在未预估文字宽度的情况下放置长文本（可能溢出容器）
- ❌ 不让水平箭头 `y1 ≠ y2` 或垂直箭头 `x1 ≠ x2`（会导致箭头歪斜）
- ❌ 不用 `<line>` 连接中心不在同一条水平/垂直线上的形状（应使用 `<path>` 折线）

---

## 7. 完整 SVG 模板

以下是最小可用的 SVG 模板，生成新配图时以此为基础：

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" font-family="'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif">
  <defs>
    <!-- Gradients -->
    <linearGradient id="blueG" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#60a5fa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
    </linearGradient>

    <!-- Shadow filter -->
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.12"/>
    </filter>

    <!-- Arrow markers (userSpaceOnUse for consistent size) -->
    <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="8" markerHeight="8"
            markerUnits="userSpaceOnUse"
            orient="auto"
            preserveAspectRatio="xMidYMid meet">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
    </marker>
  </defs>

  <!-- ===== Background ===== -->
  <rect width="800" height="400" rx="12" fill="#f8fafc"/>

  <!-- ===== Title ===== -->
  <text x="400" y="35" text-anchor="middle" font-size="20" font-weight="700" fill="#1e293b">图表标题</text>
  <text x="400" y="55" text-anchor="middle" font-size="12" fill="#94a3b8">副标题说明</text>

  <!-- ===== Content Card ===== -->
  <g filter="url(#shadow)">
    <rect x="30" y="75" width="340" height="280" rx="12" fill="white" stroke="#3b82f6" stroke-width="2"/>
  </g>
  <!-- Card header (gradient bar) -->
  <rect x="30" y="75" width="340" height="40" rx="12" fill="url(#blueG)"/>
  <rect x="30" y="95" width="340" height="20" fill="url(#blueG)"/>
  <text x="200" y="100" text-anchor="middle" font-size="15" font-weight="700" fill="white">卡片标题</text>

  <!-- ===== Card content ===== -->
  <!-- Shape A: x=50, y=130, w=140, h=35 → right edge=190, center y=147 -->
  <rect x="50" y="130" width="140" height="35" rx="6" fill="#dbeafe" stroke="#93c5fd" stroke-width="1"/>
  <text x="120" y="152" text-anchor="middle" font-size="11" fill="#1d4ed8">步骤 A</text>

  <!-- Arrow A→B: from shape A right edge(190) to shape B left edge(240) minus 4px gap(236) -->
  <line x1="190" y1="147" x2="236" y2="147" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- Shape B: x=240, y=130, w=140, h=35 → left edge=240, center y=147 -->
  <rect x="240" y="130" width="140" height="35" rx="6" fill="#dbeafe" stroke="#93c5fd" stroke-width="1"/>
  <text x="310" y="152" text-anchor="middle" font-size="11" fill="#1d4ed8">步骤 B</text>

  <!-- ===== Bottom tip ===== -->
  <rect x="200" y="370" width="400" height="26" rx="13" fill="#f0fdf4" stroke="#bbf7d0" stroke-width="1"/>
  <text x="400" y="387" text-anchor="middle" font-size="11" fill="#15803d">💡 实践建议</text>
</svg>
```

**模板要点：**
- 箭头 marker 使用 `markerUnits="userSpaceOnUse"` + `refX="10"` + `orient="auto"` + `preserveAspectRatio="xMidYMid meet"`
- 箭头线段起点紧贴源形状右边缘（`x1=190`），终点距目标形状左边缘 4px（`x2=236`）
- 两个形状中心 y 对齐（均为 147），箭头水平居中（`y1=y2=147`）
- 所有坐标为整数，对齐到 10px 网格

---

## 8. 生成后自检清单

> 生成 SVG 配图后，**必须逐项检查以下清单**，发现问题立即修正后再输出。

### 8.1 箭头检查

- [ ] 所有 marker 定义使用 `markerUnits="userSpaceOnUse"`、`refX="10"`、`orient="auto"`、`preserveAspectRatio="xMidYMid meet"`
- [ ] 箭头线段终点不在任何形状内部（距目标形状边界 4px）
- [ ] 箭头线段起点不在任何形状内部（从源形状边界开始）
- [ ] 水平箭头的 `y1 == y2`（两端 y 坐标相同）
- [ ] 垂直箭头的 `x1 == x2`（两端 x 坐标相同）
- [ ] 中心不在同一条水平/垂直线上的形状之间使用 `<path>` 折线而非 `<line>`
- [ ] 箭头标签不与线段重叠（偏移 8~10px）
- [ ] 无极短线段（<15px）承载箭头

### 8.2 重叠检查

- [ ] 任何两个形状之间无重叠（逐一检查 x/y/width/height 是否有交集）
- [ ] 文字不超出其容器边界（预估文字宽度 = 字符数 × 字号）
- [ ] 箭头线段不穿过任何形状（除非设计意图）
- [ ] 带阴影（filter）的形状与相邻元素间距 ≥ 最小间距 + 5px
- [ ] 多行文字行距 ≥ `font-size + 4px`
- [ ] 标题/副标题不与内容区重叠（间距 ≥ 15px）

### 8.3 对齐检查

- [ ] 同行形状的垂直中心 y 相同
- [ ] 同列形状的水平中心 x 相同
- [ ] 所有坐标为整数（无小数）
- [ ] 关键坐标对齐到 10px 网格
- [ ] 箭头与连接的形状中心对齐

### 8.4 视觉检查

- [ ] 配色符合 3.2 语义色规范
- [ ] 字号符合 3.7 字号规范
- [ ] 圆角符合 3.6 圆角规范
- [ ] SVG 结构顺序符合 6.1（defs → 背景 → 标题 → 内容 → 底部提示）
- [ ] 无 `<foreignObject>`、无 `<style>` 标签、无 JavaScript
- [ ] marker 变体的属性结构与 3.5.1 完全一致（仅 id 和 fill 不同）
