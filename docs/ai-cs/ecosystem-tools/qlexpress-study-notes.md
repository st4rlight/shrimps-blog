---
title: QLExpress4表达式引擎学习笔记
tags:
  - QLExpress
  - QLExpress4
  - 表达式引擎
  - 规则引擎
  - 阿里
  - 客服系统
excerpt: QLExpress4 是阿里巴巴开源的轻量级表达式引擎的最新演进版本，基于 ANTLR4 重写了解析引擎（4.1.2 起移除 ANTLR4 依赖），新增了函数式编程、原生 JSON、表达式追踪等特性。本文从表达式引擎的基本概念出发，系统梳理 QLExpress4 的语法体系、运行机制、扩展能力与实战用法，并结合 AI 客服系统场景探讨其落地实践。
createTime: 2026/07/07 14:00:00
updateTime: 2026/07/11 10:00:00
permalink: /ai-cs/qlexpress-study-notes/
---

# QLExpress4表达式引擎学习笔记

> 当你的系统里开始出现大量 `if-else`，而且这些判断逻辑还在频繁变化——比如客服路由规则、VIP 等级判定、促销活动条件——你需要的不是更多的 `if`，而是一个**表达式引擎**。QLExpress4 就是阿里巴巴在经历了多年双 11 考验后，全新重写开源的新一代表达式引擎。

[[TOC]]

---

## 一、什么是表达式引擎

### 1.1 问题背景

假设你在构建一个 AI 客服系统，需要根据用户属性决定路由策略：

```java
// 硬编码方式：每次改规则都要改代码、测试、上线
public String routeSession(User user) {
    if (user.getLevel() >= 5 && user.getOrderCount() > 100) {
        return "VIP专属通道";
    } else if (user.getLevel() >= 3 && "electronics".equals(user.getCategory())) {
        return "数码专项客服";
    } else if (user.isNew() && user.getHour() >= 9 && user.getHour() <= 18) {
        return "新手引导通道";
    } else if (user.getComplaintCount() > 5) {
        return "投诉优先通道";
    }
    return "通用通道";
}
```

这段代码的问题很明显：

| 问题 | 说明 |
|------|------|
| **变更成本高** | 每次规则调整都要改代码、走发布流程 |
| **测试困难** | 规则散落在代码里，难以集中管理和测试 |
| **无法动态调整** | 运营想临时加一条规则？等下次发版吧 |
| **可维护性差** | 规则越积越多，`if-else` 嵌套越来越深 |

### 1.2 表达式引擎的解决思路

表达式引擎的核心思想是：**把业务规则从代码中抽离出来，用表达式字符串描述，由引擎在运行时动态解析和执行**。

```java
// 表达式引擎方式：规则是数据，不是代码
String rule = "user.level >= 5 && user.orderCount > 100 ? 'VIP专属通道' : '通用通道'";
Object result = express4Runner.execute(rule, context, QLOptions.DEFAULT_OPTIONS).getResult();
```

这样带来的好处：

- **动态性**：规则存储在数据库或配置中心，修改不需要重新发版
- **可管理**：规则集中管理，支持版本控制和审计
- **灵活性**：运营人员可以自行调整规则，无需开发介入
- **可测试**：表达式可以独立测试，不依赖应用上下文

### 1.3 表达式引擎 vs 规则引擎

两者经常被混为一谈，但有区别：

| 维度 | 表达式引擎 | 规则引擎 |
|------|----------|---------|
| 粒度 | 单条表达式求值 | 多条规则的模式匹配与推理 |
| 复杂度 | 轻量，嵌入式 | 重量级，独立组件 |
| 典型代表 | QLExpress4、Aviator、MVEL | Drools、Easy Rules |
| 语法 | 类自然语言表达式 | DRL 等规则定义语言 |
| 推理能力 | 无（直接求值） | 有（前向/反向链推理） |
| 适用场景 | 条件判断、计算、脚本 | 复杂业务规则集、决策表 |

QLExpress4 定位是**表达式引擎**，但它支持 `if-else`、`for`、`while`、`switch`、`try-catch` 等控制流，还新增了 Lambda 表达式和函数式编程能力，因此也能胜任轻量级的规则引擎场景。

### 1.4 主流表达式引擎对比

![主流表达式引擎对比](/ai-cs/ecosystem-tools/qlexpress-study-notes/expression-engine-comparison.svg)

| 引擎 | 出品方 | 性能 | 语法风格 | 特点 |
|------|--------|------|---------|------|
| **QLExpress4** | 阿里巴巴 | 高 | 类 Java + 函数式 | 原生 JSON、Lambda、表达式追踪，阿里大规模验证 |
| **Aviator** | 淘宝（dennis） | 极高 | 函数式 | 编译为字节码，性能最优 |
| **MVEL** | Mike Brock | 中 | 类 Java | 支持运行时字节码生成 |
| **JEXL** | Apache | 中 | 类 JS | Apache 出品，社区活跃 |
| **SpEL** | Spring | 中 | 类 EL | Spring 生态原生支持 |
| **Janino** | Janino | 高 | 纯 Java | 运行时编译 Java 代码片段 |

QLExpress4 的独特优势在于：**语法最接近 Java 且拥抱函数式编程；原生支持 JSON 语法；独一无二的表达式追踪能力；默认安全的沙箱策略；阿里多年双 11 验证，稳定性有保障**。

---

## 二、QLExpress4 简介

### 2.1 项目背景

QLExpress 由阿里巴巴电商研发部开发，最早用于淘宝的交易系统，解决促销规则、价格计算、风控策略等动态规则问题。2012 年开源。

QLExpress4 作为 QLExpress 的最新演进版本，基于 ANTLR4 重写了解析引擎（v4.1.2 起移除了 ANTLR4 依赖，自研解析器进一步降低内存占用），将原先的优点进一步发扬光大，新增了大量特色功能，彻底拥抱函数式编程，在性能和表达能力上都进行了进一步增强。

> 如果项目还在使用旧版本 QLExpress 3.x，可以跳转 [branch_version_3.x.x](https://github.com/alibaba/QLExpress/tree/branch_version_3.x.x) 维护分支查看旧版文档。如需升级可以参考本文 [附录：从 3.x 升级指南](#附录-从-3-x-升级指南) 章节。

### 2.2 核心特性

| 特性 | 说明 |
|------|------|
| **类 Java 语法 + 函数式** | 兼容 Java 8 语法，新增 Lambda 表达式、函数式接口支持 |
| **轻量嵌入** | 单 JAR 依赖，无需独立服务，API 简洁 |
| **原生 JSON 支持** | 直接在表达式中书写 JSON 数组和对象，快捷定义复杂数据结构 |
| **动态字符串** | 支持 `` `${expression}` `` 模板字符串插值 |
| **支持控制流** | `if-else`、`for`、`while`、`switch`、`try-catch`、`break`、`continue` |
| **函数定义** | 支持 `function` 关键字定义函数和 Lambda 表达式 |
| **表达式追踪** | 独一无二的表达式计算追踪功能，支持 AI 归因分析 |
| **默认安全** | 默认隔离策略，不允许脚本访问 Java 对象字段和方法 |
| **高精度计算** | 自动使用 BigDecimal 保证计算精度 |
| **高性能** | 表达式编译缓存、可序列化预编译缓存，4.1.2 移除 ANTLR4 后内存降低 90%+ |
| **线程安全** | `Express4Runner` 线程安全，可全局复用 |
| **自定义 ClassLoader** | 支持插件化架构，可指定类加载器 |

### 2.3 Maven 依赖

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>qlexpress4</artifactId>
    <version>4.1.2</version>
</dependency>
```

::: tip 版本说明
QLExpress4 的 artifactId 从 `QLExpress` 变更为 `qlexpress4`，groupId 保持 `com.alibaba` 不变。`4.1.2` 是当前最新稳定版本（2026 年 6 月发布）。环境要求 JDK 8 或更高版本。
:::

::: warning 与 3.x 的坐标变化
注意，QLExpress 3.x 的坐标是 `com.alibaba:QLExpress:3.3.4`，而 QLExpress 4 的坐标是 `com.alibaba:qlexpress4:4.1.2`。两者可以共存，但建议新项目直接使用 4.x。
:::

---

## 三、快速上手

### 3.1 Hello World

```java
import com.alibaba.qlexpress4.runtime.Express4Runner;
import com.alibaba.qlexpress4.runtime.InitOptions;
import com.alibaba.qlexpress4.runtime.QLOptions;

import java.util.HashMap;
import java.util.Map;

public class QuickStart {
    public static void main(String[] args) {
        // 1. 创建 Express4Runner（线程安全，全局复用）
        Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

        // 2. 创建上下文（绑定变量，普通 Map 即可）
        Map<String, Object> context = new HashMap<>();
        context.put("a", 10);
        context.put("b", 20);

        // 3. 执行表达式
        Object result = runner.execute("a + b * 2", context, QLOptions.DEFAULT_OPTIONS).getResult();
        System.out.println("结果: " + result);  // 输出: 结果: 50
    }
}
```

就这三步：创建 Runner → 绑定变量 → 执行表达式。相比 3.x 版本，QLExpress4 的 API 更加简洁——上下文直接使用 `Map<String, Object>`，执行结果通过 `QLResult` 对象的 `getResult()` 方法获取。

### 3.2 `execute` 方法参数详解

```java
// QLExpress4 的核心执行方法
QLResult result = runner.execute(
    String express,                    // 表达式字符串
    Map<String, Object> context,       // 上下文（变量绑定，普通 Map）
    QLOptions options                  // 执行选项（缓存、超时、追踪等）
);

// QLResult 包含执行结果和追踪信息
Object value = result.getResult();
List<ExpressionTrace> traces = result.getExpressionTraces();
```

`QLOptions` 是 QLExpress4 新引入的执行选项构建器，通过 Builder 模式灵活配置：

```java
QLOptions options = QLOptions.builder()
    .cache(true)                // 是否缓存编译结果（推荐 true）
    .timeoutMillis(5000L)       // 超时时间（毫秒），防止死循环
    .traceExpression(true)      // 是否输出表达式追踪树
    .precise(true)              // 是否开启高精度计算
    .shortCircuitDisable(false) // 是否关闭短路计算
    .polluteUserContext(false)  // 是否将脚本变量写回 context
    .build();
```

| 选项 | 说明 | 建议 |
|------|------|------|
| `cache` | 缓存编译结果 | **true**——避免重复编译 |
| `timeoutMillis` | 脚本执行超时时间 | 生产环境建议设置，防止死循环 |
| `traceExpression` | 表达式追踪 | 调试/归因分析时 true，生产环境可按需 |
| `precise` | 高精度计算 | 涉及金额计算时建议开启 |
| `polluteUserContext` | 变量写回 context | 默认 false（安全），兼容 3.x 时可设 true |

::: warning Express4Runner 的复用
`Express4Runner` 是线程安全的，创建开销较大。**全局只创建一个实例**，通过不同的 `Map` 上下文实现变量隔离。不要每次执行都 new 一个 Runner。
:::

### 3.3 基本数据类型与运算

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);
Map<String, Object> context = new HashMap<>();
context.put("name", "张三");
context.put("age", 25);
context.put("price", 99.9);
context.put("isActive", true);

// 算术运算
runner.execute("age + 5", context, QLOptions.DEFAULT_OPTIONS).getResult();           // 30
runner.execute("price * 0.8", context, QLOptions.DEFAULT_OPTIONS).getResult();       // 79.92（八折）

// 字符串拼接
runner.execute("name + '，你好！'", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 张三，你好！

// 逻辑运算
runner.execute("age > 18 && isActive", context, QLOptions.DEFAULT_OPTIONS).getResult(); // true

// 三元运算
runner.execute("age >= 18 ? '成年' : '未成年'", context, QLOptions.DEFAULT_OPTIONS).getResult(); // 成年
```

QLExpress4 还支持动态字符串（模板字符串），可以直接在字符串中嵌入表达式：

```java
context.put("a", 123);
// 使用 ${expression} 进行字符串插值
runner.execute("\"hello,${a-1}\"", context, QLOptions.DEFAULT_OPTIONS).getResult(); // "hello,122"
```

---

## 四、语法体系

### 4.1 运算符

QLExpress4 支持的运算符与 Java 高度一致，并新增了一些便捷运算符：

#### 算术运算符

```text
+    加法（数字） / 字符串拼接
-    减法
*    乘法
/    除法
%    取模
++   自增（前/后）
--   自减（前/后）
```

#### 关系运算符

```text
>    大于
<    小于
>=   大于等于
<=   小于等于
==   等于
!=   不等于
```

#### 逻辑运算符

```text
&&   逻辑与（短路）
||   逻辑或（短路）
!    逻辑非
```

#### 位运算符

```text
&    按位与
|    按位或
^    按位异或
~    按位取反
<<   左移
>>   右移
>>>  无符号右移
```

#### 赋值运算符

```text
=    赋值
+=   加赋值
-=   减赋值
*=   乘赋值
/=   除赋值
%=   模赋值
```

#### QLExpress4 新增运算符

```text
->   Lambda 箭头（函数式编程）
*.   展开操作符（列表/映射批量取属性）
in   成员判断（元素是否在集合中）
like   模式匹配（SQL 风格的字符串模糊匹配）
```

### 4.2 数据类型与自动类型推断

QLExpress4 会根据数字所属范围自动从 `int`、`long`、`BigInteger`、`double`、`BigDecimal` 中选择最合适的类型：

```java
// 自动类型推断
runner.execute("2147483647", context, QLOptions.DEFAULT_OPTIONS).getResult()     // Integer
runner.execute("9223372036854775807", context, QLOptions.DEFAULT_OPTIONS).getResult() // Long
runner.execute("18446744073709552000", context, QLOptions.DEFAULT_OPTIONS).getResult() // BigInteger
runner.execute("0.25", context, QLOptions.DEFAULT_OPTIONS).getResult()           // Double（可精确表示）
runner.execute("2.7976931348623157E308", context, QLOptions.DEFAULT_OPTIONS).getResult() // BigDecimal
```

::: tip 高精度计算
QLExpress 内部会用 BigDecimal 表示所有无法用 double 精确表示的数字。例如 `0.1 + 0.2` 在 Java 中不等于 `0.3`，但在 QLExpress4 中会自动识别并使用 BigDecimal 确保结果精确等于 `0.3`。还可通过 `QLOptions.builder().precise(true).build()` 开启全量高精度模式。
:::

### 4.3 原生 JSON 支持

QLExpress4 原生支持 JSON 语法，可以快捷定义复杂数据结构——这是 3.x 版本没有的能力：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// List（JSON 数组）
Object listResult = runner.execute("[1, 2, 3]", new HashMap<>(), QLOptions.DEFAULT_OPTIONS).getResult();
// 底层是 ArrayList
assert listResult instanceof ArrayList;  // true

// Map（JSON 对象）
Object mapResult = runner.execute(
    "{\"aa\": 10, \"bb\": {\"cc\": \"cc1\", \"dd\": \"dd1\"}}",
    new HashMap<>(), QLOptions.DEFAULT_OPTIONS
).getResult();
// 底层是 LinkedHashMap
assert mapResult instanceof LinkedHashMap;  // true

// 空映射
runner.execute("{:}", new HashMap<>(), QLOptions.DEFAULT_OPTIONS); // 空 LinkedHashMap
```

### 4.4 集合操作与 `*.` 展开操作符

QLExpress4 对集合操作做了语法糖支持，并新增了 `*.` 展开操作符：

```java
Map<String, Object> context = new HashMap<>();

// List 操作
context.put("list", Arrays.asList("Apple", "Banana", "Cherry"));
runner.execute("list[0]", context, QLOptions.DEFAULT_OPTIONS).getResult();        // Apple
runner.execute("list[-1]", context, QLOptions.DEFAULT_OPTIONS).getResult();       // Cherry（负索引）
runner.execute("list.size()", context, QLOptions.DEFAULT_OPTIONS).getResult();    // 3

// Map 操作
Map<String, Object> map = new HashMap<>();
map.put("name", "张三");
map.put("age", 25);
context.put("user", map);
runner.execute("user.name", context, QLOptions.DEFAULT_OPTIONS).getResult();      // 张三
runner.execute("user['name']", context, QLOptions.DEFAULT_OPTIONS).getResult();   // 张三

// *. 展开操作符：批量取列表元素属性
context.put("users", Arrays.asList(
    Map.of("name", "Li", "age", 10),
    Map.of("name", "Wang", "age", 15)
));
runner.execute("users*.age", context, QLOptions.DEFAULT_OPTIONS).getResult();     // [10, 15]
runner.execute("users*.name", context, QLOptions.DEFAULT_OPTIONS).getResult();    // ["Li", "Wang"]

// *. 支持多级嵌套列表自动展平（v4.1.0+）
context.put("nested", Arrays.asList(
    Arrays.asList(Map.of("a", 10), Map.of("a", 12)),
    Arrays.asList(Map.of("a", 13)),
    Arrays.asList(Map.of("a", 14))
));
runner.execute("nested*.a", context, QLOptions.DEFAULT_OPTIONS).getResult();      // [10, 12, 13, 14]
```

::: tip `*.` 展开操作符
`*.` 操作符可以快捷地对列表和映射进行处理：对列表元素批量取属性，或获取映射的 key/value 列表。v4.1.0 起还支持多层级嵌套列表的自动展平。这是 QLExpress4 独有的便捷语法。
:::

### 4.5 动态字符串（模板字符串）

QLExpress4 新引入了动态字符串能力，支持 `` `${expression}` `` 格式在字符串中插入表达式计算结果：

```java
Map<String, Object> context = new HashMap<>();
context.put("a", 123);

// 字符串插值
runner.execute("\"hello,${a-1}\"", context, QLOptions.DEFAULT_OPTIONS).getResult();  // "hello,122"

// 复杂表达式插值
context.put("b", "test");
runner.execute("\"m xx ${if (b like 't%') { 'YYY' } }\"",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // "m xx YYY"
```

还可以通过 `executeTemplate` 方法直接将 QLExpress4 作为轻量级模板引擎使用：

```java
Map<String, Object> ctx = new HashMap<>();
ctx.put("a", 1);
ctx.put("b", 2);

// 模板渲染（无需手动添加字符串引号）
runner.executeTemplate("a ${a};b ${b+2}", ctx, QLOptions.DEFAULT_OPTIONS).getResult();
// 结果: "a 1;b 4"
```

### 4.6 方法调用

::: warning 默认安全策略
QLExpress4 默认采用隔离安全策略，**不允许脚本直接访问 Java 对象的字段和方法**。如果要调用对象方法，需要先配置安全策略为"开放"模式，或通过自定义函数封装。
:::

```java
// 开放安全策略后，可以直接调用对象方法
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build()
);

Map<String, Object> context = new HashMap<>();
context.put("str", "Hello World");

runner.execute("str.length()", context, QLOptions.DEFAULT_OPTIONS).getResult();         // 11
runner.execute("str.substring(0, 5)", context, QLOptions.DEFAULT_OPTIONS).getResult();  // Hello
runner.execute("str.toUpperCase()", context, QLOptions.DEFAULT_OPTIONS).getResult();    // HELLO WORLD
```

::: tip 推荐做法
建议保持默认的隔离安全策略，通过**自定义函数**的方式封装需要调用的 Java 方法。这样既保证了安全性，又提供了更好的用户体验。
:::

---

## 五、控制流

QLExpress4 不仅仅是表达式——它支持完整的脚本控制流，并新增了 `switch` 和 `try-catch` 语法。这是它区别于 Aviator 等纯表达式引擎的重要特征。

### 5.1 if-else

QLExpress4 采用表达式优先的设计，`if` 语句本身就是一个表达式：

```java
String express = ""
    + "if (score >= 90) {"
    + "    return '优秀';"
    + "} else if (score >= 80) {"
    + "    return '良好';"
    + "} else if (score >= 60) {"
    + "    return '及格';"
    + "} else {"
    + "    return '不及格';"
    + "}";

context.put("score", 85);
Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 良好
```

还支持类似规则引擎的 `if ... then ... else ...` 写法：

```java
// if ... then ... else ... 写法
runner.execute("if (a == 11) then true else false",
    context, QLOptions.DEFAULT_OPTIONS).getResult();

// if 作为表达式
runner.execute("if (11 == 11) { 10 } else { 20 + 2 } + 1",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // 11
```

### 5.2 switch 语句与表达式（v4.1.0+）

QLExpress4 新增了 `switch` 语法，既支持语句形式，也支持表达式形式：

```java
// switch 语句形式
String express = ""
    + "switch (day) {"
    + "  case 1: dayName = 'Monday'; break"
    + "  case 2: dayName = 'Tuesday'; break"
    + "  case 3: dayName = 'Wednesday'; break"
    + "  default: dayName = 'Unknown'"
    + "}";

// switch 表达式形式（使用 -> 标记）
String express2 = ""
    + "result = switch (score) {"
    + "    case 90, 100 -> '优秀'"
    + "    case 60, 70, 80 -> '及格'"
    + "    default -> '不及格'"
    + "}";
```

switch 表达式特点：
- 使用 `->` 语法，每个 case 可以返回一个表达式的值
- 支持多个 case 值用逗号分隔
- **不会 fall-through**，执行完一个 case 后自动跳出
- 可以作为表达式使用，赋值给变量或用于其他表达式中

### 5.3 try-catch（新增）

QLExpress4 新增了 `try-catch` 语法，可以优雅地处理异常：

```java
// try-catch 作为表达式
String express = ""
    + "1 + try {"
    + "    100 + 1/0"
    + "} catch(e) {"
    + "    11"
    + "}";
// 结果: 12（除零异常被捕获，返回 11）
```

### 5.4 for 循环

```java
// 传统 for 循环
String express = ""
    + "sum = 0;"
    + "for (i = 0; i < list.size(); i++) {"
    + "    sum = sum + list[i];"
    + "}"
    + "return sum;";

context.put("list", Arrays.asList(1, 2, 3, 4, 5));
Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 15

// 增强 for 循环
String express2 = ""
    + "sum = 0;"
    + "for (item : list) {"
    + "    sum = sum + item;"
    + "}"
    + "return sum;";
```

### 5.5 while 循环

```java
String express = ""
    + "result = 1;"
    + "n = 5;"
    + "while (n > 0) {"
    + "    result = result * n;"
    + "    n = n - 1;"
    + "}"
    + "return result;";

Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 120 (5!)
```

### 5.6 break 与 continue

```java
// 找到第一个大于3的元素
String express = ""
    + "target = null;"
    + "for (item : list) {"
    + "    if (item > 3) {"
    + "        target = item;"
    + "        break;"
    + "    }"
    + "}"
    + "return target;";

context.put("list", Arrays.asList(1, 2, 3, 4, 5));
Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 4
```

### 5.7 return 语句

`return` 用于提前结束表达式执行并返回结果：

```java
String express = ""
    + "if (user.age < 18) {"
    + "    return '未成年人禁止访问';"
    + "}"
    + "if (user.status != 'active') {"
    + "    return '账户未激活';"
    + "}"
    + "return '欢迎访问';";
```

### 5.8 分号可省略

QLExpress4 支持省略分号，让表达式更加简洁：

```java
// 以下脚本的返回值为 2（最后一个表达式的计算结果）
String express = "a = 1\nb = 2\n1+1";
Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 2
```

::: warning 严格换行模式
由于分号可省略，QLExpress4 对换行的处理比 3.x 更严格。如果要将表达式拆成多行，建议将**操作符保留在当前行尾**，而非下一行行首。如需兼容 3.x 的换行行为，可通过 `InitOptions.builder().strictNewLines(false).build()` 关闭严格模式。
:::

---

## 六、函数系统

### 6.1 Lambda 表达式（新增）

QLExpress4 中函数被提升为第一等公民，支持 Lambda 表达式，可以作为变量传递或返回：

```java
// Lambda 定义
Map<String, Object> context = new HashMap<>();
String express = ""
    + "add = (a, b) -> {"
    + "  return a + b;"
    + "};"
    + "return add(1, 2);";

Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 3
```

### 6.2 列表过滤与映射

利用 Lambda 表达式，可以方便地对列表进行函数式操作：

```java
// 内置 filter / map 方法（比 Stream API 更简洁）
String express = ""
    + "l = ['a-111', 'a-222', 'b-333', 'c-888'];"
    + "return l.filter(i -> i.startsWith('a-'))"
    + "        .map(i -> i.split('-')[1]);";
// 结果: ["111", "222"]
```

### 6.3 function 关键字定义函数

```java
// 使用 function 关键字定义函数
String express = ""
    + "function sub(a, b) {"
    + "    return a - b;"
    + "}"
    + "return sub(3, 1);";

Object result = runner.execute(express, context, QLOptions.DEFAULT_OPTIONS).getResult();  // 2
```

### 6.4 自定义函数

QLExpress4 提供了多种自定义函数的方式，比 3.x 更加灵活。

#### 方式一：Java Lambda 快速定义（推荐）

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 最简单的方式：通过 Java Lambda 快速定义函数
runner.addVarArgsFunction("join",
    params -> Arrays.stream(params).map(Object::toString).collect(Collectors.joining(",")));

Object result = runner.execute("join(1,2,3)",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "1,2,3"
```

#### 方式二：继承 `CustomFunction` 类

```java
import com.alibaba.qlexpress4.runtime.function.CustomFunction;
import com.alibaba.qlexpress4.runtime.QContext;
import com.alibaba.qlexpress4.runtime.Parameters;

// 自定义函数：计算VIP折扣
public class VipDiscountFunction implements CustomFunction {
    @Override
    public Object call(QContext qContext, Parameters parameters) throws Throwable {
        double price = ((Number) parameters.getValue(0)).doubleValue();
        int level = ((Number) parameters.getValue(1)).intValue();

        double discount = switch (level) {
            case 1 -> 0.95;
            case 2 -> 0.9;
            case 3 -> 0.8;
            case 4 -> 0.7;
            case 5 -> 0.6;
            default -> 1.0;
        };
        return price * discount;
    }
}

// 注册函数
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);
runner.addFunction("vipDiscount", new VipDiscountFunction());

// 使用
Map<String, Object> context = new HashMap<>();
context.put("price", 100.0);
context.put("level", 3);
Object result = runner.execute("vipDiscount(price, level)",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // 80.0
```

#### 方式三：延迟参数求值函数（LazyArgCustomFunction）

QLExpress4 新增了 `LazyArgCustomFunction` 接口，支持短路求值语义——可以控制参数的求值时机：

```java
// 实现类似 IF 函数：当条件为 false 时，不执行第三个参数
runner.addFunction("IF", new LazyArgCustomFunction() {
    @Override
    public boolean isLazyArg(int argIndex) {
        return 1 == argIndex || 2 == argIndex;  // 第2、3个参数延迟求值
    }

    @Override
    public Object call(QContext qContext, Parameters parameters) {
        Boolean condition = (Boolean) call(parameters.getValue(0));
        if (condition) {
            return call(parameters.getValue(1));  // 只在条件为 true 时求值
        }
        return call(parameters.getValue(2));  // 只在条件为 false 时求值
    }

    private Object call(Object obj) {
        if (obj instanceof QLambda) {
            return ((QLambda) obj).get();  // 手动触发求值
        }
        return obj;
    }
});

// 当 b == 0 时，a/b 不会被求值，因此不会触发除零异常
runner.execute("IF(b == 0, 0, a / b)", context, QLOptions.DEFAULT_OPTIONS);
```

### 6.5 自定义运算符

```java
// 通过 Java Lambda 快速定义二元运算符
runner.addOperatorBiFunction("join", (left, right) -> left + "," + right);

// 使用
Object result = runner.execute("1 join 2 join 3",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "1,2,3"
```

### 6.6 扩展函数

QLExpress4 新增了扩展函数能力，可以给 Java 类添加额外的成员方法（仅在 QLExpress 脚本中有效）：

```java
// 给 String 类添加 hello() 扩展函数
runner.addExtendFunction("hello", String.class,
    params -> "Hello," + params[0]);

// 使用
runner.execute("'jack'.hello()",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "Hello,jack"

// 给 Number 类添加 add() 扩展函数
runner.addExtendFunction("add", Number.class,
    params -> ((Number) params[0]).intValue() + ((Number) params[1]).intValue());

runner.execute("1.add(2)",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // 3
```

### 6.7 附件透传机制（新增）

QLExpress4 新增了附件（attachments）机制，可以将额外信息传递给自定义函数，而不暴露给脚本用户：

```java
// 自定义函数通过 attachment 获取额外信息
public class HelloFunction implements CustomFunction {
    @Override
    public Object call(QContext qContext, Parameters parameters) throws Throwable {
        // 从附件中获取租户信息（脚本用户无法直接访问）
        String tenant = (String) qContext.attachment().get("tenant");
        return "hello," + tenant;
    }
}

runner.addFunction("hello", new HelloFunction());

// 通过 QLOptions 传入附件
Object result = runner.execute("hello()",
    Collections.emptyMap(),
    QLOptions.builder().attachments(Collections.singletonMap("tenant", "jack")).build()
).getResult();  // "hello,jack"
```

::: tip 附件 vs Context
附件机制适用于传递租户名、密码等敏感信息——这些信息不希望脚本用户通过变量直接引用到，但自定义函数需要使用。这比 3.x 版本将所有信息都放入 Context 更加安全。
:::

---

## 七、运行机制深度解析

### 7.1 执行流程

QLExpress4 的执行流程分为三个阶段：**词法分析 → 语法分析 → 指令执行**。

![QLExpress执行流程](/ai-cs/ecosystem-tools/qlexpress-study-notes/qlexpress-execution-flow.svg)

```text
表达式字符串
     │
     ▼
┌─────────────┐
│  1. 词法分析  │  将字符串拆分为 Token 流
│  (Lexer)    │  "a + b * 2" → [ID:a] [+] [ID:b] [*] [NUM:2]
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  2. 语法分析  │  构建 AST（抽象语法树）
│  (Parser)   │  Token 流 → AST 节点树
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  3. 指令执行  │  AST → 指令序列 → 虚拟机逐条执行
│  (Runner)   │  指令 + Context → QLResult
└─────────────┘
```

::: tip ANTLR4 与自研解析器
QLExpress4 最初基于 ANTLR4 重写了解析引擎。在 v4.1.2 版本中，移除了 ANTLR4 依赖，改用自研解析器，将常驻内存占用降低了 90% 以上（从 104.95MB 降至 45.57MB），并显著提升了首次编译性能。
:::

### 7.2 编译缓存

语法分析阶段会构建 AST，这个过程有一定开销。QLExpress4 支持编译缓存——当 `cache=true` 时，相同表达式的 AST 会被缓存：

```java
// 第一次执行：解析 + 编译 + 缓存 + 执行
runner.execute("a + b * 2", context1,
    QLOptions.builder().cache(true).build());

// 第二次执行：直接从缓存获取 AST + 执行（跳过解析和编译）
runner.execute("a + b * 2", context2,
    QLOptions.builder().cache(true).build());  // 更快
```

还可以在首次执行前预编译脚本，确保首次执行速度：

```java
// 预编译并缓存
runner.parseToDefinitionWithCache("a + b * 2");
```

::: tip 缓存以表达式字符串为 Key
编译缓存以**表达式字符串**作为缓存 Key。如果表达式是动态拼接的（如包含变量值），每次都是不同的字符串，缓存会失效。最佳实践是**保持表达式模板固定，变量通过 Context 传入**。缓存大小无限制，可调用 `clearCompileCache()` 定期清空。
:::

### 7.3 可序列化预编译缓存（v4.1.1+）

QLExpress4 新增了可序列化预编译缓存，支持在生产端预编译脚本，然后通过 JSON 分发到其他机器执行：

```java
// 生产端：预编译为可序列化缓存
Express4Runner producer = new Express4Runner(InitOptions.DEFAULT_OPTIONS);
SerializableParseCache cache = producer.parseToSerializableCache("price * count");

// 序列化为 JSON 传输
String json = JSON.toJSONString(cache);

// 消费端：反序列化后直接执行
SerializableParseCache parsed = JSON.parseObject(json, SerializableParseCache.class);
Express4Runner consumer = new Express4Runner(InitOptions.DEFAULT_OPTIONS);
Map<String, Object> context = new HashMap<>();
context.put("price", 5);
context.put("count", 3);
QLResult result = consumer.execute(parsed, context, QLOptions.DEFAULT_OPTIONS);
// 结果: 15
```

高频执行时可以先加载为 `LoadedParseCache`，避免每次执行都重新绑定类和运算符：

```java
LoadedParseCache loaded = consumer.loadSerializableCache(cache);
// 后续可直接复用 loaded 执行
consumer.execute(loaded, context, QLOptions.DEFAULT_OPTIONS);
```

::: tip 分布式部署利器
可序列化预编译缓存特别适合分布式部署场景——在中心节点预编译规则脚本，分发到各执行节点运行，既保证了性能，又实现了规则的集中管理。
:::

### 7.4 指令集执行

QLExpress4 在执行阶段先将 AST 转换为**指令序列**（Instruction Set），然后通过虚拟机逐条执行指令：

- **更高的执行效率**：指令序列比 AST 遍历更紧凑
- **支持跳转指令**：`if-else`、`for`、`switch` 等控制流通过跳转实现
- **可调试性**：`traceExpression=true` 时可以打印每条指令的执行轨迹

```text
AST → 指令序列 → 虚拟机执行

指令序列示例（a + b * 2）：
LOAD_VAR    a        ← 加载变量 a
LOAD_VAR    b        ← 加载变量 b
LOAD_CONST  2        ← 加载常量 2
MUL                  ← 乘法
ADD                  ← 加法
RETURN               ← 返回结果
```

### 7.5 表达式计算追踪（新增）

QLExpress4 独有的表达式追踪功能，可以在返回计算结果的同时，返回一颗表达式追踪树。追踪树的结构类似语法树，不同之处在于它会在每个节点上记录本次执行的**中间结果值**：

```java
// 创建 Runner 时开启追踪
Express4Runner runner = new Express4Runner(
    InitOptions.builder().traceExpression(true).build());

// 注册自定义函数
runner.addFunction("myTest", (Predicate<Integer>) i -> i > 10);

Map<String, Object> context = new HashMap<>();
context.put("a", true);

// 执行时也需开启追踪
QLResult result = runner.execute("a && (!myTest(11) || false)",
    context,
    QLOptions.builder().traceExpression(true).build());

// 获取追踪树
List<ExpressionTrace> traces = result.getExpressionTraces();
ExpressionTrace trace = traces.get(0);
System.out.println(trace.toPrettyString(0));
```

输出结果：

```text
OPERATOR && false
  | VARIABLE a true
  | OPERATOR || false
      | OPERATOR ! false
          | FUNCTION myTest true
              | VALUE 11 11
      | VALUE false false
```

如果中间发生短路导致部分表达式未被计算，则对应节点的 `evaluated` 字段会被设置为 `false`：

```text
// 短路场景：a 为 false 时，右侧表达式未被计算
OPERATOR && false
  | OPERATOR && false
      | VARIABLE a false
      | VALUE true 
  | OPERATOR ||       ← evaluated: false（被短路）
      | OPERATOR ! 
          | FUNCTION myTest 
              | VALUE 11 
      | VALUE false 
```

::: tip AI 归因分析
表达式追踪功能在 AI 客服系统中特别有价值：可以用于分析规则执行失败的原因——到底有多少用户被 VIP 条件拦截，又有多少用户因为其他条件被拦截？这些数据可以用于规则优化和业务决策，甚至支持 AI 自动诊断和修复规则。
:::

### 7.6 上下文与作用域

```java
Map<String, Object> context = new HashMap<>();

// QLExpress4 默认不会将脚本内变量写回 context
Object result = runner.execute("x = 10; y = 20; x + y",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // 30

// 执行后，context 中没有 x 和 y（默认不污染）
context.containsKey("x");  // false

// 如果需要兼容 3.x 的行为（变量写回 context）：
runner.execute("x = 10; y = 20; x + y",
    context,
    QLOptions.builder().polluteUserContext(true).build());
context.get("x");  // 10
```

::: warning Context 不是线程安全的
`Map` 上下文不是线程安全的。每次执行应使用独立的 Map 实例，不要在多线程间共享同一个 Context。
:::

---

## 八、沙箱安全

### 8.1 安全风险

表达式引擎本质上是**运行时动态执行代码**，如果不做安全限制，用户可以通过表达式调用任意 Java 方法，造成安全漏洞：

```java
// 危险！如果表达式来自用户输入
String evilExpress = "Runtime.getRuntime().exec('rm -rf /')";
// 在 QLExpress4 默认隔离策略下，会抛出 METHOD_NOT_FOUND 错误
```

### 8.2 四级安全策略

QLExpress4 提供了四种安全策略，默认采用最严格的隔离策略：

#### 1. 隔离策略（默认）

默认情况下，QLExpress4 采用隔离策略，**不允许访问任何 Java 对象的字段和方法**：

```java
// 默认隔离策略，无法访问字段和方法
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

Map<String, Object> context = new HashMap<>();
context.put("desk", desk);

runner.execute("desk.book1", context, QLOptions.DEFAULT_OPTIONS);
// 抛出异常: FIELD_NOT_FOUND

runner.execute("desk.getBook2()", context, QLOptions.DEFAULT_OPTIONS);
// 抛出异常: METHOD_NOT_FOUND
```

#### 2. 黑名单策略

通过黑名单策略，可以禁止访问特定的字段或方法，其他可以正常访问：

```java
Set<Member> memberList = new HashSet<>();
memberList.add(MyDesk.class.getMethod("getBook2"));

Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.blackList(memberList)).build());

// getBook2 被禁止
runner.execute("desk.book2", context, QLOptions.DEFAULT_OPTIONS);  // FIELD_NOT_FOUND
// book1 可以访问
runner.execute("desk.book1", context, QLOptions.DEFAULT_OPTIONS).getResult();  // "Thinking in Java"
```

#### 3. 白名单策略

通过白名单策略，只允许访问指定的字段或方法：

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.whiteList(memberList)).build());

// getBook2 可以访问
runner.execute("desk.getBook2()", context, QLOptions.DEFAULT_OPTIONS).getResult();  // "Effective Java"
// getBook1 被禁止
runner.execute("desk.getBook1()", context, QLOptions.DEFAULT_OPTIONS);  // METHOD_NOT_FOUND
```

#### 4. 开放策略

开放策略允许访问所有字段和方法，类似于 QLExpress 3.x 的行为：

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build());

runner.execute("desk.book1", context, QLOptions.DEFAULT_OPTIONS).getResult();      // 正常
runner.execute("desk.getBook2()", context, QLOptions.DEFAULT_OPTIONS).getResult(); // 正常
```

::: warning 生产环境安全建议
建议直接采用**默认隔离策略**，通过自定义函数和操作符的方式对脚本提供系统能力。这样能同时保证安全性和灵活性。如果确实需要访问 Java 对象，至少应使用**白名单策略**。开放策略不建议用于处理终端用户输入的脚本。
:::

### 8.3 语法校验

QLExpress4 新增了 `check` 方法，可以在不执行脚本的情况下校验语法正确性：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

try {
    runner.check("a+b;\n(a+b");
    fail();
} catch (QLSyntaxException e) {
    // 精确的错误位置提示
    assertEquals(2, e.getLineNo());      // 第 2 行
    assertEquals(5, e.getColNo());       // 第 5 列
    assertEquals("SYNTAX_ERROR", e.getErrorCode());
}
```

还支持更精细的校验规则配置：

```java
// 白名单方式限制可用操作符
Set<String> allowedOps = new HashSet<>(Arrays.asList("+", "*"));
CheckOptions checkOptions = CheckOptions.builder()
    .operatorCheckStrategy(OperatorCheckStrategy.whitelist(allowedOps))
    .build();
runner.check("a + b * c", checkOptions);  // 通过

// 禁用函数调用
CheckOptions options = CheckOptions.builder().disableFunctionCalls(true).build();
runner.check("Math.max(1, 2)", options);  // 抛出异常
```

### 8.4 超时控制

QLExpress4 新增了超时控制，防止死循环或资源耗尽：

```java
try {
    runner.execute("while (true) {\n 1+1 \n}",
        Collections.emptyMap(),
        QLOptions.builder().timeoutMillis(10L).build());  // 10ms 超时
} catch (QLTimeoutException e) {
    assertEquals(QLErrorCodes.SCRIPT_TIME_OUT.name(), e.getErrorCode());
}
```

---

## 九、AI 客服系统中的实战应用

### 9.1 智能路由规则引擎

AI 客服系统中最典型的应用——根据用户属性和上下文动态路由到不同的处理通道：

```java
public class SessionRouter {

    // 全局单例 Runner，默认隔离策略
    private static final Express4Runner RUNNER = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

    private static final String ROUTE_RULE = ""
        + "if (user.vipLevel >= 5 && user.orderAmount > 10000) {"
        + "    return 'VIP_DIAMOND_CHANNEL';"
        + "} else if (user.vipLevel >= 3) {"
        + "    return 'VIP_GOLD_CHANNEL';"
        + "} else if (user.complaintCount >= 3) {"
        + "    return 'COMPLAINT_PRIORITY_CHANNEL';"
        + "} else if (user.isNewUser == true) {"
        + "    return 'NEWBIE_GUIDE_CHANNEL';"
        + "} else if (message.intent == 'refund' && message.urgency == 'high') {"
        + "    return 'REFUND_EXPERT_CHANNEL';"
        + "} else {"
        + "    return 'GENERAL_CHANNEL';"
        + "}";

    public String route(User user, Message message) {
        Map<String, Object> context = new HashMap<>();
        context.put("user", user);
        context.put("message", message);

        try {
            QLResult result = RUNNER.execute(ROUTE_RULE, context,
                QLOptions.builder().cache(true).timeoutMillis(1000L).build());
            return (String) result.getResult();
        } catch (Exception e) {
            log.warn("路由规则执行错误: {}", e.getMessage());
            return "GENERAL_CHANNEL";  // 降级到通用通道
        }
    }
}
```

**优势**：路由规则存储在配置中心，运营可以随时调整，无需发版。

### 9.2 动态评分与优先级

客服系统需要对会话进行优先级评分，决定排队顺序：

```java
private static final String SCORING_RULE = ""
    + "score = 0;"
    + "score = score + user.vipLevel * 10;"        // VIP 等级权重"
    + "score = score + user.orderAmount * 0.01;"    // 消费金额权重"
    + "if (user.complaintCount > 0) {"
    + "    score = score + user.complaintCount * 20;"  // 投诉加急"
    + "}"
    + "if (message.urgency == 'high') {"
    + "    score = score * 1.5;"                    // 紧急消息加权"
    + "}"
    + "return score;";

// 执行评分（开启高精度计算避免金额误差）
Object score = RUNNER.execute(SCORING_RULE, context,
    QLOptions.builder().cache(true).precise(true).build()).getResult();
```

### 9.3 知识库条件过滤

根据用户画像动态过滤知识库内容：

```java
private static final String FILTER_RULE = ""
    + "article.visibleToNewUser == true || user.isNewUser == false"
    + " && (article.minVipLevel == 0 || user.vipLevel >= article.minVipLevel)"
    + " && (article.category == 'all' || article.category == user.category)";

// 对每篇知识库文章执行过滤
for (Article article : knowledgeBase) {
    context.put("article", article);
    Boolean match = (Boolean) RUNNER.execute(FILTER_RULE, context,
        QLOptions.DEFAULT_OPTIONS).getResult();
    if (match) {
        result.add(article);
    }
}
```

### 9.4 表达式追踪辅助归因分析

利用 QLExpress4 的表达式追踪功能，分析路由规则为什么将某个用户导向了通用通道：

```java
// 创建支持追踪的 Runner
Express4Runner traceRunner = new Express4Runner(
    InitOptions.builder().traceExpression(true).build());

// 执行并获取追踪树
QLResult result = traceRunner.execute(ROUTE_RULE, context,
    QLOptions.builder().traceExpression(true).timeoutMillis(1000L).build());

// 获取追踪树，分析每个条件的命中情况
List<ExpressionTrace> traces = result.getExpressionTraces();
for (ExpressionTrace trace : traces) {
    System.out.println(trace.toPrettyString(0));
}

// 可以将追踪数据发送到分析平台
// 用于统计：多少用户被 VIP 条件拦截？多少被投诉条件命中？
```

### 9.5 完整集成架构

```text
┌──────────────────────────────────────────────────────────┐
│                      AI 客服系统                           │
│                                                           │
│  ┌─────────────┐    ┌─────────────┐                     │
│  │  规则配置中心  │    │  用户上下文   │                     │
│  │  (数据库/配置) │    │  (Map)      │                     │
│  └──────┬──────┘    └──────┬──────┘                     │
│         │                  │                             │
│         ▼                  ▼                             │
│  ┌─────────────────────────────────┐                    │
│  │       Express4Runner             │                    │
│  │  (表达式解析 + 执行 + 缓存 + 追踪)  │                    │
│  └──────────────┬──────────────────┘                    │
│                 │                                         │
│     ┌───────────┼───────────┐                            │
│         │           │           │                        │
│         ▼           ▼           ▼                        │
│    智能路由    优先级评分    归因分析                       │
│    知识过滤    动态评分    追踪树                          │
│                                                           │
│  ✅ 规则与代码解耦，运营自助修改                            │
│  ✅ 无需发版，实时生效                                     │
│  ✅ 表达式追踪支持 AI 归因分析                             │
│  ✅ 默认安全策略，防止恶意代码                             │
└──────────────────────────────────────────────────────────┘
```

---

## 十、性能优化与最佳实践

### 10.1 Runner 复用

```java
// ❌ 错误：每次执行创建新 Runner
public Object badExecute(String express, Map<String, Object> params) {
    Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);  // 每次都创建！
    return runner.execute(express, params, QLOptions.DEFAULT_OPTIONS).getResult();
}

// ✅ 正确：全局单例 Runner
private static final Express4Runner RUNNER = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

public Object goodExecute(String express, Map<String, Object> params) {
    return RUNNER.execute(express, params, QLOptions.DEFAULT_OPTIONS).getResult();
}
```

### 10.2 表达式缓存策略

```java
// ❌ 错误：把变量值拼进表达式，缓存失效
String express = "10 + 20 * 2";  // 每次值不同，缓存失效
runner.execute(express, context, QLOptions.DEFAULT_OPTIONS);

// ✅ 正确：表达式模板固定，变量通过 Context 传入
String express = "a + b * 2";    // 表达式固定，缓存命中
context.put("a", 10);
context.put("b", 20);
runner.execute(express, context, QLOptions.builder().cache(true).build());
```

### 10.3 错误处理

```java
try {
    QLResult result = runner.execute(express, context,
        QLOptions.builder().cache(true).timeoutMillis(5000L).build());
    return result.getResult();
} catch (QLSyntaxException e) {
    // 语法错误
    log.error("表达式语法错误: line={}, col={}, code={}",
        e.getLineNo(), e.getColNo(), e.getErrorCode());
    return defaultValue;
} catch (QLTimeoutException e) {
    // 执行超时
    log.error("表达式执行超时: {}", express);
    return defaultValue;
} catch (QLException e) {
    // 其他运行时错误
    log.error("表达式执行错误: {}, code={}", e.getMessage(), e.getErrorCode());
    return defaultValue;
}
```

### 10.4 最佳实践总结

| 原则 | 说明 |
|------|------|
| **Runner 全局单例** | 线程安全，创建开销大，全局复用 |
| **Context 每次新建** | 非线程安全，通过独立 Map 隔离变量 |
| **表达式模板固定** | 变量通过 Context 传入，避免拼接导致缓存失效 |
| **设置超时时间** | `timeoutMillis` 防止死循环耗尽资源 |
| **默认安全策略** | 保持隔离策略，通过自定义函数提供系统能力 |
| **语法预校验** | 用 `check()` 方法提前校验用户输入的表达式 |
| **金额计算开精确** | `precise=true` 使用 BigDecimal 避免精度问题 |
| **规则版本管理** | 表达式存储在数据库，支持版本和回滚 |
| **利用追踪分析** | `traceExpression=true` 支持 AI 归因分析 |
| **分布式预编译** | 可序列化预编译缓存支持跨机器分发 |

---

## 附录：从 3.x 升级指南

QLExpress4 进行了大刀阔斧的升级，有意放弃了部分兼容性。如果系统已使用 3.x 版本，升级前**务必进行全面的回归测试**。以下是主要不同点：

### 坐标变更

```xml
<!-- 3.x -->
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>QLExpress</artifactId>
    <version>3.3.4</version>
</dependency>

<!-- 4.x -->
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>qlexpress4</artifactId>
    <version>4.1.2</version>
</dependency>
```

### API 变更对照

| 3.x | 4.x |
|-----|-----|
| `ExpressRunner` | `Express4Runner` |
| `DefaultContext<String, Object>` | `Map<String, Object>`（普通 HashMap） |
| `runner.execute(expr, ctx, errorList, isCache, isTrace)` | `runner.execute(expr, ctx, QLOptions).getResult()` |
| 继承 `Operator` 类 | 实现 `CustomFunction` 接口或 Java Lambda |
| `runner.addFunction(name, new Operator())` | `runner.addFunction(name, new CustomFunction())` 或 `runner.addVarArgsFunction(name, lambda)` |
| `ExpressRunner(false, true)` 严格模式 | `InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build()` |
| 变量自动写回 Context | 默认不写回，需 `polluteUserContext(true)` 兼容 |

### 默认安全策略变化

3.x 可以无限制地通过反射访问 Java 对象的任意字段和方法。4.x 默认采用隔离策略，如果需要兼容 3.x 行为：

```java
// 兼容 3.x 的开放行为
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build());
```

### 全局变量污染上下文

3.x 中脚本内定义的全局变量会自动写入 context。4.x 默认不会，如需兼容：

```java
runner.execute(express, context,
    QLOptions.builder().polluteUserContext(true).build());
```

### 其他变化

| 变化项 | 3.x | 4.x |
|--------|-----|-----|
| **单引号字符** | `'a'` 解析为 char | `'a'` 解析为 String（如需 char 用 `(char)'a'`） |
| **Map 创建** | `NewMap(key:value)` | 原生 JSON 语法 `{key:value}` |
| **分号** | 必须以分号结尾 | 可省略 |
| **换行** | 宽松 | 严格（可关闭 `strictNewLines(false)`） |
| **Lambda** | 不支持 | 支持 `(a, b) -> { ... }` |
| **JSON** | 不支持 | 原生支持 `[1,2,3]` 和 `{"k":"v"}` |
| **switch** | 不支持 | 支持语句和表达式形式 |
| **try-catch** | 不支持 | 支持 |
| **表达式追踪** | 不支持 | 支持 `traceExpression` |

---

## 总结

QLExpress4 的核心价值可以概括为一句话：**让业务规则成为数据，而非代码**。

相比 3.x，QLExpress4 带来了质的飞跃：

- **函数式编程**：Lambda 表达式、函数式接口、列表 filter/map
- **原生 JSON**：直接在表达式中书写 JSON 数组和对象
- **表达式追踪**：独一无二的计算追踪能力，支持 AI 归因分析
- **默认安全**：四级安全策略，默认隔离，无需额外配置
- **高精度计算**：自动 BigDecimal，解决 `0.1+0.2≠0.3` 问题
- **动态字符串**：模板字符串插值，可作为轻量级模板引擎
- **性能提升**：常见场景无编译缓存时接近 10 倍性能提升，v4.1.2 移除 ANTLR4 后内存降低 90%+
- **分布式友好**：可序列化预编译缓存支持跨机器分发
- **生产验证**：阿里巴巴多年双 11 大规模验证，稳定性有保障

在 AI 客服系统中，QLExpress4 可以灵活支撑智能路由、优先级评分、知识过滤等多种动态规则场景，其表达式追踪功能更是为 AI 归因分析提供了独特价值。结合配置中心，可以实现**规则与代码完全解耦**——运营在管理后台修改规则，客服系统实时生效，开发无需参与。

如果你正在寻找一个轻量、安全、功能完备且易上手的表达式引擎，QLExpress4 是 JVM 生态中最值得考虑的选择。

---

## 延伸阅读

- [QLExpress4 GitHub 仓库](https://github.com/alibaba/QLExpress) —— 官方源码和文档（main 分支为 4.x）
- [QLExpress 3.x 维护分支](https://github.com/alibaba/QLExpress/tree/branch_version_3.x.x) —— 旧版本文档
- [QLExpress4 性能对比](https://www.yuque.com/xuanheng-ffjti/iunlps/pgfzw46zel2xfnie) —— QLExpress4 与 3 性能对比报告
- [Aviator 文档](https://github.com/killme2008/aviator) —— 另一个阿里出品的高性能表达式引擎
- [Drools 文档](https://www.drools.org/) —— 功能完整的规则引擎，适合复杂规则场景
- [Spring Expression Language (SpEL)](https://docs.spring.io/spring-framework/reference/core/expressions.html) —— Spring 生态原生表达式语言
