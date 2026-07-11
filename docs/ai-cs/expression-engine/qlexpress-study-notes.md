---
title: QLExpress4表达式引擎
tags:
  - QLExpress
  - QLExpress4
  - 表达式引擎
  - 规则引擎
  - 阿里
  - 客服系统
excerpt: QLExpress4 是阿里巴巴开源的轻量级表达式引擎的最新演进版本，基于 ANTLR4 重写了解析引擎（4.1.2 起移除 ANTLR4 依赖），新增了函数式编程、原生 JSON、表达式追踪等特性。本文从表达式引擎的基本概念出发，系统梳理 QLExpress4 的语法体系、运行机制、扩展能力与实战用法，并结合 AI 客服系统场景探讨其落地实践。
createTime: 2026/07/07 14:00:00
updateTime: 2026/07/11 16:00:00
permalink: /ai-cs/qlexpress-study-notes/
---

# QLExpress4表达式引擎

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

![主流表达式引擎对比](/ai-cs/expression-engine/qlexpress-study-notes/expression-engine-comparison.svg)

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
| `avoidNullPointer` | 避免空指针异常 | 脚本中访问不存在的变量/函数时返回 null 而非抛异常 |
| `maxArrLength` | 限制数组最大长度 | `-1` 不限制，生产环境建议设置防止内存耗尽 |
| `shortCircuitDisable` | 关闭短路计算 | 默认 false（开启短路），设 true 时 `false && (1/0)` 会抛异常 |

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

### 3.4 多种执行方式

QLExpress4 提供了四种 `execute` 方法，适配不同的上下文构造场景：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 方式一：Map 作为上下文（最常用）
Map<String, Object> mapContext = new HashMap<>();
mapContext.put("a", 1);
mapContext.put("b", 2);
runner.execute("a + b", mapContext, QLOptions.DEFAULT_OPTIONS);

// 方式二：Java 对象字段作为上下文
// 脚本中的变量名对应该对象的 public 字段名
public class MyObj {
    public int a;
    public String b;
}
MyObj myObj = new MyObj();
myObj.a = 1;
myObj.b = "test";
runner.execute("a + b", myObj, QLOptions.DEFAULT_OPTIONS).getResult();  // "1test"

// 方式三：@QLAlias 注解对象作为上下文（适合中文脚本，详见 8.6 节）
runner.executeWithAliasObjects("用户.是vip ? 订单.金额 * 0.8 : 订单.金额",
    QLOptions.DEFAULT_OPTIONS, order, user);

// 方式四：自定义 ExpressContext（最灵活，支持动态变量等高级特性）
ExpressContext customContext = new MapExpressContext(mapContext);
runner.execute("a + b", customContext, QLOptions.DEFAULT_OPTIONS);
```

| 方法 | 说明 | 适用场景 |
|------|------|---------|
| `execute(String, Map, QLOptions)` | Map 作为上下文 | 最常用，外部业务数据构造 Map 传入 |
| `execute(String, Object, QLOptions)` | 对象字段作为上下文 | 已有 DTO/POJO，直接传入 |
| `executeWithAliasObjects(String, QLOptions, Object...)` | `@QLAlias` 注解对象 | 中文脚本、领域语言规则 |
| `execute(String, ExpressContext, QLOptions)` | 自定义上下文 | 动态变量、按需计算等高级场景 |

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

`in` 和 `like` 的使用示例：

```java
// in：判断元素是否在集合中
runner.execute("'ab' in ['cc', 'dd', 'ff']", context, QLOptions.DEFAULT_OPTIONS).getResult();  // false
runner.execute("1 in [1, 2, 3]", context, QLOptions.DEFAULT_OPTIONS).getResult();  // true

// like：SQL 风格的字符串模糊匹配（% 匹配任意数量的字符）
runner.execute("'test' like 't%'", context, QLOptions.DEFAULT_OPTIONS).getResult();  // true
runner.execute("'hello' like 'h_llo'", context, QLOptions.DEFAULT_OPTIONS).getResult();  // true
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

#### 方式四：`@QLFunction` 注解批量注册（推荐）

当需要注册大量函数时，可以通过 `@QLFunction` 注解批量注册，避免逐个 `addFunction`：

```java
import com.alibaba.qlexpress4.annotation.QLFunction;

public class MyFunctionUtil {
    // 支持多个别名
    @QLFunction({"myAdd", "iAdd"})
    public int add(int a, int b) {
        return a + b;
    }

    @QLFunction("arr3")
    public static int[] array3(int a, int b, int c) {
        return new int[]{a, b, c};
    }

    // 支持可变参数
    @QLFunction("addAll")
    public List<Object> addAll(List<Object> list, Object... obs) {
        list.addAll(Arrays.asList(obs));
        return list;
    }
}

// 注册实例方法
BatchAddFunctionResult addResult = runner.addObjFunction(new MyFunctionUtil());
// 注册静态方法
runner.addStaticFunction(MyFunctionUtil.class);

// 使用
runner.execute("myAdd(1,2) + iAdd(5,6)", new HashMap<>(), QLOptions.DEFAULT_OPTIONS).getResult();  // 14
runner.execute("arr3(5,9,10)[2]", new HashMap<>(), QLOptions.DEFAULT_OPTIONS).getResult();  // 10
```

::: tip 批量注册返回值
`addObjFunction` 和 `addStaticFunction` 返回 `BatchAddFunctionResult`，包含 `getSucc()` 和 `getFail()` 列表，可以检查哪些函数注册成功、哪些因名称冲突而失败。
:::

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

![QLExpress执行流程](/ai-cs/expression-engine/qlexpress-study-notes/qlexpress-execution-flow.svg)

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

QLExpress4 独有的表达式追踪功能，可以在返回计算结果的同时，返回一颗表达式追踪树。追踪树的结构类似语法树，不同之处在于它会在每个节点上记录本次执行的**中间结果值**——这让"表达式到底是怎么算出来的"变得完全透明。

![表达式追踪树结构](/ai-cs/expression-engine/qlexpress-study-notes/expression-trace-tree.svg)

#### 7.5.1 基本用法

开启追踪需要**两处同时设置** `traceExpression(true)`：创建 `Express4Runner` 时（`InitOptions`）和每次执行时（`QLOptions`）：

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

每一行的格式为 `类型 Token 值`，缩进表示父子层级关系。通过这棵树，可以清楚地看到 `a` 为 `true`、`myTest(11)` 为 `true`、取反后为 `false`、与 `false` 或运算仍为 `false`、最终与 `a` 做与运算得到 `false` 的完整推导链路。

#### 7.5.2 短路场景

如果中间发生短路导致部分表达式未被计算，则对应节点的 `evaluated` 字段会被设置为 `false`：

```text
// 短路场景：将 a 设为 false，右侧表达式未被计算
OPERATOR && false
  | VARIABLE a false
  | OPERATOR ||       ← evaluated: false（被短路）
      | OPERATOR ! 
          | FUNCTION myTest 
              | VALUE 11 
      | VALUE false 
```

被短路节点的 `value` 为空——因为它们根本没有被执行。这一信息在归因分析中极为关键：**你可以精确区分"条件计算后不满足"和"条件根本没被计算"两种情况**。

#### 7.5.3 ExpressionTrace 类结构

追踪树的每个节点都是一个 `ExpressionTrace` 对象，其核心字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `TraceType` | 节点类型（运算符、变量、函数等） |
| `token` | `String` | 节点对应的源码文本片段 |
| `value` | `Object` | 本次执行的中间结果值（短路时为 null） |
| `evaluated` | `boolean` | 是否被实际计算（短路时为 false） |
| `children` | `List<ExpressionTrace>` | 子节点列表 |
| `line` | `int` | 对应源码行号 |
| `col` | `int` | 对应源码列号 |
| `position` | `int` | 对应源码字符偏移量 |

其中 `line`、`col`、`position` 提供了精确的源码定位信息，可以用于在编辑器中高亮对应表达式片段，或在上层系统中生成可读的诊断报告。

#### 7.5.4 TraceType 节点类型

`TraceType` 枚举定义了追踪树中所有可能的节点类型：

| 类型 | 说明 | 典型场景 |
|------|------|---------|
| `OPERATOR` | 运算符节点 | `+`、`-`、`*`、`&&`、`\|\|`、`!`、`>`、`<`、`==` 等 |
| `FUNCTION` | 函数调用节点 | 自定义函数、内置函数调用 |
| `METHOD` | 方法调用节点 | 对象方法调用（需安全策略允许） |
| `FIELD` | 字段访问节点 | 对象属性访问 |
| `VARIABLE` | 变量引用节点 | Context 中传入的变量 |
| `VALUE` | 常量值节点 | 数字、字符串、布尔值等字面量 |
| `LIST` | 列表节点 | `[1, 2, 3]` 列表字面量 |
| `MAP` | 映射节点 | `{"key": value}` JSON/字典字面量 |
| `IF` | if 语句节点 | `if-else` 控制流 |
| `SWITCH` | switch 语句节点 | `switch-case` 控制流 |
| `RETURN` | return 语句节点 | `return` 提前返回 |
| `BLOCK` | 代码块节点 | `{ ... }` 语句块 |
| `DEFINE_FUNCTION` | 函数定义节点 | `function` 关键字定义的函数 |
| `DEFINE_MACRO` | 宏定义节点 | 宏定义 |
| `PRIMARY` | 基础表达式节点 | 括号包裹的子表达式 |
| `STATEMENT` | 语句节点 | 顶层语句 |

#### 7.5.5 编程式遍历追踪树

`toPrettyString()` 适合调试输出，但在实际应用中，往往需要**编程式遍历**追踪树来提取结构化信息：

```java
/**
 * 递归遍历追踪树，提取所有被实际计算的函数调用节点
 */
public void analyzeTrace(ExpressionTrace trace, int depth) {
    // 只关注被实际计算的节点（排除短路节点）
    if (trace.isEvaluated()) {
        TraceType type = trace.getType();
        String token = trace.getToken();
        Object value = trace.getValue();

        // 例如：提取所有函数调用及其结果
        if (type == TraceType.FUNCTION) {
            System.out.printf("函数 %s 执行结果: %s (行:%d 列:%d)%n",
                token, value, trace.getLine(), trace.getCol());
        }

        // 递归处理子节点
        for (ExpressionTrace child : trace.getChildren()) {
            analyzeTrace(child, depth + 1);
        }
    } else {
        // 短路节点：记录哪些条件被跳过
        System.out.printf("短路跳过: %s %s (行:%d)%n",
            trace.getType(), trace.getToken(), trace.getLine());
    }
}

// 使用
List<ExpressionTrace> traces = result.getExpressionTraces();
for (ExpressionTrace trace : traces) {
    analyzeTrace(trace, 0);
}
```

::: tip 构建归因报告
结合 `line`/`col` 源码定位信息，可以将追踪数据转换为可读的归因报告——例如"用户张三路由到通用通道，原因是第 3 行的 `user.level >= 5` 计算结果为 false"。这种端到端的可解释性是 QLExpress4 区别于其他表达式引擎的核心竞争力。
:::

#### 7.5.6 性能影响与生产策略

表达式追踪功能会记录每个节点的中间值，带来额外的内存和 CPU 开销。以下是不同场景下的建议策略：

| 场景 | `traceExpression` | 说明 |
|------|-------------------|------|
| **生产环境高频执行** | `false`（默认） | 追踪有额外开销，高频路径不建议开启 |
| **调试/开发环境** | `true` | 快速定位规则为什么返回了意外的结果 |
| **线上抽样诊断** | `true`（按比例） | 对万分之一请求开启追踪，收集归因样本 |
| **规则异常时触发** | `true`（条件触发） | 结果不符合预期时重新执行并开启追踪 |
| **AI 归因分析** | `true` | 需要追踪树数据支撑 AI 诊断和规则优化 |

```java
// 生产环境抽样追踪示例
private static final Express4Runner RUNNER = new Express4Runner(
    InitOptions.builder().traceExpression(true).build());  // Runner 层面开启

public Object executeWithSampling(String express, Map<String, Object> context) {
    // 万分之一的请求开启追踪
    boolean enableTrace = ThreadLocalRandom.current().nextInt(10000) == 0;

    QLResult result = RUNNER.execute(express, context,
        QLOptions.builder()
            .cache(true)
            .timeoutMillis(1000L)
            .traceExpression(enableTrace)  // 按需开启
            .build());

    if (enableTrace) {
        // 异步发送追踪数据到分析平台
        sendToAnalysisPlatform(result.getExpressionTraces());
    }

    return result.getResult();
}
```

::: warning InitOptions 与 QLOptions 的双重控制
追踪功能受两层控制：`InitOptions.traceExpression` 是总开关，`QLOptions.traceExpression` 是单次执行开关。**两者都为 `true` 时追踪才生效**。如果 `InitOptions` 未开启，即使 `QLOptions` 设置了 `traceExpression(true)` 也不会产生追踪数据。这种设计使得同一个 Runner 既可以执行需要追踪的请求，也可以执行不需要追踪的高频请求。
:::

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

### 8.5 import 与 Java 类调用

当安全策略设为开放模式时，可以在脚本中直接使用 Java 类。QLExpress4 提供了两种方式：

#### 在脚本中使用 `import` 语句

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build());

Map<String, Object> params = new HashMap<>();
params.put("a", 1);
params.put("b", 2);

// 在脚本中 import Java 类并调用静态方法
Object result = runner.execute(
    "import com.alibaba.qlexpress4.QLImportTester; QLImportTester.add(a,b)",
    params, QLOptions.DEFAULT_OPTIONS).getResult();  // 3
```

::: warning import 必须在脚本开头
`import` 语句必须位于脚本的**最前面**，不能在其他语句之后，否则会抛出语法错误。
:::

#### 创建 Runner 时默认导入

如果不想在脚本中写 `import` 语句，可以在创建 Runner 时通过 `InitOptions` 默认导入：

```java
import com.alibaba.qlexpress4.aparser.ImportManager;

Express4Runner runner = new Express4Runner(InitOptions.builder()
    .addDefaultImport(Collections.singletonList(
        ImportManager.importCls("com.alibaba.qlexpress4.QLImportTester")))
    .securityStrategy(QLSecurityStrategy.open())
    .build());

// 脚本中直接使用，无需 import
runner.execute("QLImportTester.add(1,2)",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // 3
```

`ImportManager` 提供了多种导入方式：

| 方法 | 说明 |
|------|------|
| `importCls(className)` | 导入单个类 |
| `importPack(packageName)` | 导入包下所有类 |
| `importInnerCls(class)` | 导入给定类的内部类 |
| `importClsAlias(class, alias)` | 为类指定别名，**特别适用于代码混淆场景** |

::: tip 默认已导入的包
QLExpress4 默认导入了以下 Java 包：`java.lang`、`java.util`、`java.math`、`java.util.stream`、`java.util.function`。脚本中可以直接使用这些包下的类（需开放安全策略）。
:::

### 8.6 `@QLAlias` 注解与中文脚本

QLExpress4 支持通过 `@QLAlias` 注解给 Java 类、字段和方法添加中文别名，让非技术人员也能用自然语言编写规则脚本——这在客服系统等业务场景中极为实用。

#### 定义别名

```java
import com.alibaba.qlexpress4.annotation.QLAlias;

@QLAlias("用户")
public class User {
    @QLAlias("是vip")
    private boolean vip;

    @QLAlias("用户名")
    private String name;

    public boolean isVip() { return vip; }
    public void setVip(boolean vip) { this.vip = vip; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}

@QLAlias("订单")
public class Order {
    @QLAlias("订单号")
    private String orderNum;

    @QLAlias("金额")
    private int amount;

    // getter/setter 省略...
}
```

#### 使用 `executeWithAliasObjects` 执行

```java
Order order = new Order();
order.setAmount(100);

User user = new User();
user.setVip(true);

Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build());

// 脚本中直接使用中文别名
Number result = (Number) runner.executeWithAliasObjects(
    "用户.是vip ? 订单.金额 * 0.8 : 订单.金额",
    QLOptions.DEFAULT_OPTIONS, order, user
).getResult();  // 80
```

::: tip @QLAlias 的价值
`@QLAlias` 让运营人员可以用 `"用户.是vip ? 订单.金额 * 0.8 : 订单.金额"` 这样的中文脚本编写规则，而无需了解 Java 字段名。这在客服系统的规则配置场景中可以大幅降低使用门槛。
:::

### 8.7 关键字与操作符别名

除了 `@QLAlias` 注解给对象添加别名外，QLExpress4 还支持通过 `addAlias` 方法给**关键字、操作符和函数**添加别名，进一步让脚本贴近自然语言：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 添加自定义函数
runner.addFunction("zero", (String ignore) -> 0);

// 关键字别名
runner.addAlias("如果", "if");
runner.addAlias("则", "then");
runner.addAlias("否则", "else");
runner.addAlias("返回", "return");

// 操作符别名
runner.addAlias("大于", ">");

// 函数别名
runner.addAlias("零", "zero");

Map<String, Object> context = new HashMap<>();
context.put("语文", 90);
context.put("数学", 90);
context.put("英语", 90);

// 完全中文化的脚本
Object result = runner.execute(
    "如果 (语文 + 数学 + 英语 大于 270) 则 {返回 1;} 否则 {返回 零();}",
    context, QLOptions.DEFAULT_OPTIONS
).getResult();  // 0
```

支持别名关键字包括：`if`、`then`、`else`、`for`、`while`、`break`、`continue`、`return`、`function`、`macro`、`new`、`null`、`true`、`false`。

::: tip 操作符和函数默认支持别名
所有操作符（如 `in`、`like`、`>`、`+`）和自定义函数默认就支持通过 `addAlias` 添加别名。`in` 操作符也可以添加中文别名：`runner.addAlias("属于", "in")`。
:::

### 8.8 脚本依赖分析工具

QLExpress4 提供了一组实用的分析方法，可以在**不执行脚本**的情况下，解析出脚本所需的外部变量、属性和函数——这在规则引擎场景中非常有价值，可以在执行前检查脚本依赖是否满足。

#### `getOutVarNames`：解析外部变量

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 解析脚本中需要从外部传入的变量
Set<String> outVarNames = runner.getOutVarNames(
    "int a = 1, b = 10;\n" +
    "c = 11\n" +
    "e = a + b + c + d\n" +  // d 是外部变量
    "f+e"                     // f 是外部变量
);
// 结果: ["d", "f"]  —— a、b、c 在脚本内定义，不是外部变量
```

#### `getOutVarAttrs`：解析外部变量属性路径

`getOutVarAttrs` 是 `getOutVarNames` 的增强版，不仅返回外部变量名，还返回变量上的属性访问路径：

```java
Set<List<String>> outVarAttrs = runner.getOutVarAttrs("a.b.c + a.b.d * c.m");
// 结果: [["a","b","c"], ["a","b","d"], ["c","m"]]
```

#### `getOutFunctions`：解析外部函数

```java
Set<String> outFunctions = runner.getOutFunctions("time('2025-09-8') + sum(1, sub(3,2))");
// 结果: ["time", "sum", "sub"]
```

::: tip 生产环境应用
这些分析工具可以用于：
- **规则校验**：在保存规则前检查是否引用了不存在的变量或函数
- **依赖预加载**：根据分析结果提前加载所需的上下文数据
- **安全审计**：检查脚本是否引用了不应访问的变量
:::

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

![QLExpress4 AI客服系统完整集成架构](/ai-cs/expression-engine/qlexpress-study-notes/integration-architecture.svg)

整体架构分为三层：

- **输入层**：规则配置中心（数据库/配置文件存储表达式规则）和用户上下文（Map 承载运行时数据），分别提供规则和数据
- **引擎层**：`Express4Runner` 作为核心，集成表达式解析、执行引擎、结果缓存和表达式追踪四大能力，通过 `InitOptions` 和 `QLOptions` 控制安全策略、超时、精确计算等运行参数
- **输出层**：智能路由（路由分流与知识过滤）、优先级评分（动态评分与权重计算）、归因分析（追踪树与决策路径可视化）三大业务能力

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

## 十一、补充说明

本节收录 QLExpress4 中较少使用的特性，供有特殊需求的场景参考。

### 11.1 宏（Macro）

宏是一种**指令级别的文本替换**机制，在编译时将宏名替换为指定指令序列。与函数不同，宏在编译期展开，没有运行时调用开销：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 定义宏：将 "sayHello" 替换为字符串 "hello"
runner.addInstructionMacro("sayHello", new QLOptions.InstructionMacro(
    new LoadAttribute("hello")));

// 使用宏
runner.execute("sayHello + \" world\"",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "hello world"
```

::: warning 宏的局限性
宏是基于指令的替换，不是简单的文本替换。需要了解 QLExpress4 内部指令集才能正确使用，适合框架开发者或高级用户。大多数场景下，自定义函数是更好的选择。
:::

### 11.2 动态变量（DynamicVariableContext）

动态变量允许在脚本执行时**按需计算**变量值，而非提前将所有变量放入上下文。适用于变量值计算开销大、且不一定每次都需要的场景：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 创建动态上下文
DynamicContextContext dynamicContext = new DynamicContextContext(
    "expensiveVar", () -> {
        // 模拟耗时计算
        Thread.sleep(1000);
        return 42;
    }
);

// 如果脚本不引用 expensiveVar，该 lambda 不会被调用
runner.execute("1 + 2", dynamicContext, QLOptions.DEFAULT_OPTIONS);  // 不会触发计算

// 引用时才计算
runner.execute("expensiveVar + 1", dynamicContext,
    QLOptions.DEFAULT_OPTIONS).getResult();  // 43，触发了 lambda
```

### 11.3 `replaceDefaultOperator` 替换内置运算符

可以替换 QLExpress4 内置运算符的行为，例如自定义 `+` 的语义：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 替换 + 运算符：字符串拼接时用空格分隔
runner.replaceDefaultOperator("+", (a, b) -> {
    if (a instanceof String && b instanceof String) {
        return a + " " + b;
    }
    // 数字仍走默认逻辑
    return QLConvert.asInt(a) + QLConvert.asInt(b);
});

runner.execute("\"hello\" + \"world\"",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "hello world"
```

::: warning 谨慎使用
替换内置运算符会影响所有使用该运算符的脚本，容易产生意想不到的副作用。仅在确有全局定制需求时使用。
:::

### 11.4 `QLFunctionalVarargs` 一对象三用

`QLFunctionalVarargs` 是一个特殊接口，注册后可以同时作为**函数调用**、**可变参数函数**和**运算符**使用：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 注册一个 QLFunctionalVarargs
runner.addFunction("myFunc", new QLFunctionalVarargs() {
    @Override
    public Object call(Object... objects) {
        return Arrays.stream(objects).reduce(0,
            (a, b) -> QLConvert.asInt(a) + QLConvert.asInt(b));
    }
});

// 用法一：普通函数调用
runner.execute("myFunc(1,2,3)",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // 6

// 用法二：运算符形式
runner.execute("1 myFunc 2",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // 3
```

### 11.5 `addFunctionOfServiceMethod` 注册服务方法

可以将 Java 对象的指定方法注册为脚本函数，适合已有 Service 层代码的快速接入：

```java
public class UserService {
    public String getUserName(Long userId) {
        return "用户" + userId;
    }

    public boolean isVip(Long userId) {
        return userId % 2 == 0;
    }
}

UserService userService = new UserService();
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 注册指定方法
runner.addFunctionOfServiceMethod("getUserName",
    userService, "getUserName", new Class[]{Long.class});
runner.addFunctionOfServiceMethod("isVip",
    userService, "isVip", new Class[]{Long.class});

runner.execute("getUserName(100) + (isVip(100) ? ' (VIP)' : '')",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // "用户100 (VIP)"
```

### 11.6 `addFunctionsDefinedInScript` 脚本函数批量注册

可以将一段脚本中通过 `function` 定义的函数批量注册到 Runner，供后续脚本复用：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

// 定义一组函数
String scriptFunctions =
    "function add(a, b) { return a + b; }\n" +
    "function sub(a, b) { return a - b; }\n" +
    "function mul(a, b) { return a * b; }";

// 批量注册
List<String> registered = runner.addFunctionsDefinedInScript(scriptFunctions);
// registered: ["add", "sub", "mul"]

// 后续脚本中直接使用
runner.execute("add(1, sub(3, 2)) * mul(2, 3)",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();  // 12
```

### 11.7 占位符（Selector）机制

QLExpress4 支持在字符串中使用 `${}` 占位符，在**编译时**对占位符内的表达式进行解析和替换：

```java
Express4Runner runner = new Express4Runner(InitOptions.DEFAULT_OPTIONS);

Map<String, Object> context = new HashMap<>();
context.put("name", "张三");
context.put("count", 5);

// 动态字符串插值
runner.execute("\"你好，${name}！您有${count}条消息\"",
    context, QLOptions.DEFAULT_OPTIONS).getResult();
// "你好，张三！您有5条消息"
```

::: tip 与普通字符串拼接的区别
`${}` 插值在编译时解析，比运行时字符串拼接更高效。可以通过 `InterpolationMode.DISABLE` 关闭此特性。
:::

### 11.8 `@class` JSON 复杂对象创建

在 JSON 对象中可以通过 `@class` 字段指定 Java 类型，创建复杂嵌套对象：

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder().securityStrategy(QLSecurityStrategy.open()).build());

// 使用 @class 创建带类型信息的对象
Object result = runner.execute(
    "{'@class':'com.example.MyConfig', 'name':'test', 'value':42, " +
    "'nested':{'@class':'com.example.SubConfig', 'flag':true}}",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS).getResult();
```

::: warning 需要开放安全策略
`@class` 机制会实例化 Java 对象，需要安全策略为 open 模式。在沙箱环境中不可用。
:::

### 11.9 Spring 集成

QLExpress4 官方提供了 Spring 集成方式，但**官方文档明确不推荐**在生产环境使用。建议直接使用 `Express4Runner` API 自行管理生命周期。

如确需集成，核心思路是通过 Spring Bean 注入 Runner 实例：

```java
@Configuration
public class QLExpressConfig {
    @Bean
    public Express4Runner express4Runner() {
        return new Express4Runner(InitOptions.DEFAULT_OPTIONS);
    }
}
```

::: warning 官方建议
QLExpress 官方文档指出 Spring 集成方式**不推荐使用**，建议开发者直接通过 `Express4Runner` API 集成。Runner 是线程安全的，全局单例即可。
:::

### 11.10 Debug 模式

在开发调试阶段，可以开启 Debug 模式查看详细的执行指令和中间状态：

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder().debug(true).build());

// Debug 模式下，控制台会输出编译后的指令序列和执行过程
runner.execute("1 + 2 * 3",
    Collections.emptyMap(), QLOptions.DEFAULT_OPTIONS);
```

也可以通过 `QLOptions` 获取更详细的执行追踪信息（参见 7.5 节表达式计算追踪）。

### 11.11 关闭字符串插值（`InterpolationMode.DISABLE`）

如果脚本中需要使用 `${}` 字面量而不希望被解析为插值表达式，可以关闭插值：

```java
// 默认行为：${} 会被解析
runner.execute("\"${name}\"",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // "张三"

// 关闭插值：${} 保持字面量
runner.execute("\"${name}\"",
    context, QLOptions.builder()
        .interpolationMode(QLOptions.InterpolationMode.DISABLE)
        .build()).getResult();  // "${name}"
```

### 11.12 数字字面量更多格式

除了普通的十进制数字外，QLExpress4 还支持多种数字字面量格式：

```java
// 十六进制（0x 前缀）
runner.execute("0xFF", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 255

// 二进制（0b 前缀）
runner.execute("0b1010", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 10

// 八进制（0 前缀）
runner.execute("010", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 8

// 类型后缀
runner.execute("100L", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 100L (long)
runner.execute("3.14f", context, QLOptions.DEFAULT_OPTIONS).getResult();  // 3.14f (float)
runner.execute("1000000s", context, QLOptions.DEFAULT_OPTIONS).getResult();  // short
runner.execute("100b", context, QLOptions.DEFAULT_OPTIONS).getResult();  // byte
```

### 11.13 列表切片

类似 Python 的切片语法，可以从列表中截取子列表：

```java
runner.execute("[1,2,3,4,5][1:3]",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // [2, 3]

runner.execute("[1,2,3,4,5][:2]",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // [1, 2]

runner.execute("[1,2,3,4,5][3:]",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // [4, 5]
```

### 11.14 `allowPrivateAccess` 访问私有成员

默认情况下，QLExpress4 只能访问 Java 对象的 `public` 字段和方法。在需要时可以开放私有成员访问：

```java
Express4Runner runner = new Express4Runner(
    InitOptions.builder()
        .securityStrategy(QLSecurityStrategy.open())
        .allowPrivateAccess(true)
        .build());

// 此时脚本中可以访问 private 字段和方法
```

::: warning 安全风险
开启 `allowPrivateAccess` 会破坏 Java 的封装性，存在安全风险。仅在受控环境下使用。
:::

### 11.15 特殊字符变量名

QLExpress4 支持在变量名中使用中文字符、Unicode 字符等特殊字符：

```java
Map<String, Object> context = new HashMap<>();
context.put("姓名", "张三");
context.put("年龄", 25);
context.put("π", 3.14);

runner.execute("姓名 + '的年龄是' + 年龄",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // "张三的年龄是25"

runner.execute("π * 2",
    context, QLOptions.DEFAULT_OPTIONS).getResult();  // 6.28
```

### 11.16 `throw` 语句

可以在脚本中主动抛出异常，用于规则不满足时中断执行：

```java
runner.execute(
    "if (amount < 0) { throw '金额不能为负数'; }\n" +
    "amount * 0.8",
    context, QLOptions.DEFAULT_OPTIONS);
// 当 amount < 0 时抛出 QLException: 金额不能为负数
```

`throw` 可以抛出字符串（包装为 `QLException`）或 Java `Exception` 对象。

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
