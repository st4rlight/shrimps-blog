---
title: QLExpress表达式引擎学习笔记
tags:
  - QLExpress
  - 表达式引擎
  - 规则引擎
  - 阿里
  - 客服系统
excerpt: QLExpress 是阿里巴巴开源的轻量级表达式引擎，广泛应用于电商风控、营销规则、动态定价等场景。本文从表达式引擎的基本概念出发，系统梳理 QLExpress 的语法体系、运行机制、扩展能力与实战用法，并结合 AI 客服系统场景探讨其落地实践。
createTime: 2026/07/07 14:00:00
permalink: /ai-cs/qlexpress-study-notes/
---

# QLExpress表达式引擎学习笔记

> 当你的系统里开始出现大量 `if-else`，而且这些判断逻辑还在频繁变化——比如客服路由规则、VIP 等级判定、促销活动条件——你需要的不是更多的 `if`，而是一个**表达式引擎**。QLExpress 就是阿里巴巴在经历了多年双 11 考验后开源出来的那一个。

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
String result = (String) expressRunner.execute(rule, context, null, true, false);
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
| 典型代表 | QLExpress、Aviator、MVEL | Drools、Easy Rules |
| 语法 | 类自然语言表达式 | DRL 等规则定义语言 |
| 推理能力 | 无（直接求值） | 有（前向/反向链推理） |
| 适用场景 | 条件判断、计算、脚本 | 复杂业务规则集、决策表 |

QLExpress 定位是**表达式引擎**，但它支持 `if-else`、`for` 等控制流，所以也能胜任轻量级的规则引擎场景。

### 1.4 主流表达式引擎对比

![主流表达式引擎对比](/ai-cs/ecosystem-tools/qlexpress-study-notes/expression-engine-comparison.svg)

| 引擎 | 出品方 | 性能 | 语法风格 | 特点 |
|------|--------|------|---------|------|
| **QLExpress** | 阿里巴巴 | 高 | 类 Java | 支持脚本控制流，阿里大规模验证 |
| **Aviator** | 淘宝（dennis） | 极高 | 函数式 | 编译为字节码，性能最优 |
| **MVEL** | Mike Brock | 中 | 类 Java | 支持运行时字节码生成 |
| **JEXL** | Apache | 中 | 类 JS | Apache 出品，社区活跃 |
| **SpEL** | Spring | 中 | 类 EL | Spring 生态原生支持 |
| **Janino** | Janino | 高 | 纯 Java | 运行时编译 Java 代码片段 |

QLExpress 的独特优势在于：**语法最接近 Java，学习成本最低；支持完整的脚本控制流；阿里多年双 11 验证，稳定性有保障**。

---

## 二、QLExpress 简介

### 2.1 项目背景

QLExpress 由阿里巴巴电商研发部开发，最早用于淘宝的交易系统，解决促销规则、价格计算、风控策略等动态规则问题。2012 年开源，目前在 GitHub 上有数千 Star。

它的名字来源于 **QL**（Query Language）+ **Express**（表达式），但实际能力远超查询——它是一个**完整的轻量级脚本引擎**。

### 2.2 核心特性

| 特性 | 说明 |
|------|------|
| **类 Java 语法** | 熟悉 Java 的开发者零学习成本 |
| **轻量嵌入** | 单 JAR 依赖，无需独立服务，API 简洁 |
| **支持控制流** | `if-else`、`for`、`while`、`break`、`continue` |
| **函数定义** | 支持在表达式中自定义函数 |
| **运算符重载** | 支持自定义运算符 |
| **沙箱安全** | 可限制可访问的类和方法，防止恶意代码 |
| **高性能** | 表达式编译缓存，避免重复解析 |
| **线程安全** | `ExpressRunner` 线程安全，可全局复用 |

### 2.3 Maven 依赖

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>QLExpress</artifactId>
    <version>3.3.3</version>
</dependency>
```

::: tip 版本说明
QLExpress 3.3.x 是当前稳定的版本线。建议使用最新稳定版，旧版本存在一些沙箱安全漏洞。
:::

---

## 三、快速上手

### 3.1 Hello World

```java
import com.ql.util.express.ExpressRunner;
import com.ql.util.express.DefaultContext;

public class QuickStart {
    public static void main(String[] args) throws Exception {
        // 1. 创建 ExpressRunner（线程安全，全局复用）
        ExpressRunner runner = new ExpressRunner();

        // 2. 创建上下文（绑定变量）
        DefaultContext<String, Object> context = new DefaultContext<>();
        context.put("a", 10);
        context.put("b", 20);

        // 3. 执行表达式
        Object result = runner.execute("a + b * 2", context, null, true, false);
        System.out.println("结果: " + result);  // 输出: 结果: 50
    }
}
```

就这三步：创建 Runner → 绑定变量 → 执行表达式。

### 3.2 `execute` 方法参数详解

```java
public Object execute(
    String express,           // 表达式字符串
    IExpressContext context,  // 上下文（变量绑定）
    List<String> errorList,   // 错误信息收集列表（可为 null）
    boolean isCache,          // 是否缓存编译结果（推荐 true）
    boolean isTrace          // 是否输出执行轨迹（调试用）
) throws Exception
```

| 参数 | 说明 | 建议 |
|------|------|------|
| `express` | 表达式字符串 | 从数据库/配置中心读取 |
| `context` | 变量上下文 | 每次执行新建，不要复用 |
| `errorList` | 收集错误信息 | 生产环境传入非 null 列表 |
| `isCache` | 缓存编译结果 | **true**——避免重复编译 |
| `isTrace` | 打印执行轨迹 | 生产环境 false，调试时 true |

::: warning ExpressRunner 的复用
`ExpressRunner` 是线程安全的，创建开销较大（涉及类加载器初始化）。**全局只创建一个实例**，通过不同的 `DefaultContext` 实现变量隔离。不要每次执行都 new 一个 Runner。
:::

### 3.3 基本数据类型与运算

```java
DefaultContext<String, Object> context = new DefaultContext<>();
context.put("name", "张三");
context.put("age", 25);
context.put("price", 99.9);
context.put("isActive", true);

// 算术运算
runner.execute("age + 5", context, null, true, false);           // 30
runner.execute("price * 0.8", context, null, true, false);       // 79.92（八折）

// 字符串拼接
runner.execute("name + '，你好！'", context, null, true, false);  // 张三，你好！

// 逻辑运算
runner.execute("age > 18 && isActive", context, null, true, false); // true

// 三元运算
runner.execute("age >= 18 ? '成年' : '未成年'", context, null, true, false); // 成年
```

---

## 四、语法体系

### 4.1 运算符

QLExpress 支持的运算符与 Java 高度一致：

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

### 4.2 数据类型

```java
// 整数
int a = 10;
long b = 100L;

// 浮点数
double c = 3.14;
float d = 2.5f;

// 布尔
boolean e = true;

// 字符串
String f = "hello";

// null
Object g = null;

// 集合（QLExpress 原生支持）
List list = new ArrayList();
Map map = new HashMap();
```

### 4.3 集合操作

QLExpress 对集合操作做了语法糖支持，比 Java 原生更简洁：

```java
// List 操作
DefaultContext<String, Object> context = new DefaultContext<>();
context.put("list", Arrays.asList("Apple", "Banana", "Cherry"));

runner.execute("list[0]", context, null, true, false);        // Apple（索引访问）
runner.execute("list.size()", context, null, true, false);    // 3
runner.execute("list.length", context, null, true, false);    // 3（length 属性）

// Map 操作
Map<String, Object> map = new HashMap<>();
map.put("name", "张三");
map.put("age", 25);
context.put("user", map);

runner.execute("user.name", context, null, true, false);      // 张三（点号访问）
runner.execute("user['name']", context, null, true, false);   // 张三（中括号访问）
runner.execute("user.age + 5", context, null, true, false);   // 30
```

::: tip 集合语法糖
QLExpress 对 `List` 支持 `[index]` 索引访问，对 `Map` 支持 `.key` 点号访问和中括号 `['key']` 访问。这让表达式写起来更自然，类似 JavaScript 的体验。
:::

### 4.4 方法调用

表达式可以直接调用对象的方法：

```java
DefaultContext<String, Object> context = new DefaultContext<>();
context.put("str", "Hello World");
context.put("list", new ArrayList<>(Arrays.asList(1, 2, 3)));

runner.execute("str.length()", context, null, true, false);         // 11
runner.execute("str.substring(0, 5)", context, null, true, false);  // Hello
runner.execute("str.toUpperCase()", context, null, true, false);    // HELLO WORLD
runner.execute("str.indexOf('World')", context, null, true, false); // 6

// 集合方法
runner.execute("list.add(4)", context, null, true, false);  // true
runner.execute("list.size()", context, null, true, false);  // 4
```

---

## 五、控制流

QLExpress 不仅仅是表达式——它支持完整的脚本控制流，这是它区别于 Aviator 等纯表达式引擎的重要特征。

### 5.1 if-else

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
Object result = runner.execute(express, context, null, true, false);  // 良好
```

### 5.2 for 循环

```java
// 遍历集合
String express = ""
    + "sum = 0;"
    + "for (i = 0; i < list.size(); i++) {"
    + "    sum = sum + list[i];"
    + "}"
    + "return sum;";

context.put("list", Arrays.asList(1, 2, 3, 4, 5));
Object result = runner.execute(express, context, null, true, false);  // 15

// 增强for循环
String express2 = ""
    + "sum = 0;"
    + "for (item : list) {"
    + "    sum = sum + item;"
    + "}"
    + "return sum;";
```

### 5.3 while 循环

```java
String express = ""
    + "result = 1;"
    + "n = 5;"
    + "while (n > 0) {"
    + "    result = result * n;"
    + "    n = n - 1;"
    + "}"
    + "return result;";

Object result = runner.execute(express, context, null, true, false);  // 120 (5!)
```

### 5.4 break 与 continue

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
Object result = runner.execute(express, context, null, true, false);  // 4
```

### 5.5 return 语句

`return` 用于提前结束表达式执行并返回结果：

```java
String express = ""
    + "if (user.age < 18) {"
    + "    return '未成年人禁止访问';"
    + "}"
    + "if (user.status != 'active') {"
    + "    return '账户未激活';"
    + "}"
    + "return '欢迎访问';"
```

---

## 六、函数系统

### 6.1 内置函数

QLExpress 提供了一些常用内置函数：

```java
// 类型转换
runner.execute("Integer.parseInt('123')", context, null, true, false);  // 123
runner.execute("String.valueOf(100)", context, null, true, false);      // "100"

// 数学运算
runner.execute("Math.max(10, 20)", context, null, true, false);         // 20
runner.execute("Math.round(3.6)", context, null, true, false);          // 4

// 字符串
runner.execute("new String('hello').toUpperCase()", context, null, true, false);
```

### 6.2 自定义函数

QLExpress 提供了两种自定义函数的方式。

#### 方式一：实现 `Operator` 类

```java
import com.ql.util.express.Operator;

// 自定义函数：计算VIP折扣
public class VipDiscountFunction extends Operator {
    @Override
    public Object executeInner(Object[] list) throws Exception {
        double price = (Double) list[0];
        int level = (Integer) list[1];

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
ExpressRunner runner = new ExpressRunner();
runner.addFunction("vipDiscount", new VipDiscountFunction());

// 使用
context.put("price", 100.0);
context.put("level", 3);
Object result = runner.execute("vipDiscount(price, level)", context, null, true, false);
// 结果: 80.0
```

#### 方式二：通过 Java 反射注册

```java
// 将现有 Java 方法注册为表达式函数
public class MathUtils {
    public static double round2(double value) {
        return Math.round(value * 100) / 100.0;
    }
}

runner.addFunctionOfClassMethod(
    "round2",                              // 表达式中使用的函数名
    "com.example.MathUtils",               // 类全名
    "round2",                              // 方法名
    new String[] {"double"}                // 参数类型
);

// 使用
Object result = runner.execute("round2(3.14159)", context, null, true, false); // 3.14
```

### 6.3 自定义运算符

除了函数，QLExpress 还支持自定义运算符：

```java
// 自定义运算符：判断字符串是否包含子串
public class ContainsOperator extends Operator {
    @Override
    public Object executeInner(Object[] list) throws Exception {
        String str = (String) list[0];
        String sub = (String) list[1];
        return str.contains(sub);
    }
}

// 注册运算符（指定符号和优先级）
runner.addOperator("contains", new ContainsOperator());

// 使用
context.put("text", "Hello World");
Object result = runner.execute("text contains 'World'", context, null, true, false); // true
```

---

## 七、运行机制深度解析

### 7.1 执行流程

QLExpress 的执行流程分为三个阶段：**词法分析 → 语法分析 → 指令执行**。

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
│  (Runner)   │  指令 + Context → 结果
└─────────────┘
```

### 7.2 编译缓存

语法分析阶段会构建 AST，这个过程有一定开销。QLExpress 支持编译缓存——当 `isCache=true` 时，相同表达式的 AST 会被缓存，后续执行直接复用：

```java
// 第一次执行：解析 + 编译 + 缓存 + 执行
runner.execute("a + b * 2", context1, null, true, false);

// 第二次执行：直接从缓存获取 AST + 执行（跳过解析和编译）
runner.execute("a + b * 2", context2, null, true, false);  // 更快
```

::: tip 缓存以表达式字符串为 Key
编译缓存以**表达式字符串**作为缓存 Key。如果表达式是动态拼接的（如包含变量值），每次都是不同的字符串，缓存会失效。最佳实践是**保持表达式模板固定，变量通过 Context 传入**。
:::

### 7.3 指令集执行

QLExpress 在执行阶段并非直接遍历 AST，而是先将 AST 转换为**指令序列**（Instruction Set），然后通过虚拟机逐条执行指令。这种设计带来了：

- **更高的执行效率**：指令序列比 AST 遍历更紧凑
- **支持跳转指令**：`if-else`、`for` 等控制流通过跳转实现
- **可调试性**：`isTrace=true` 时可以打印每条指令的执行轨迹

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

### 7.4 上下文与作用域

```java
DefaultContext<String, Object> context = new DefaultContext<>();

// 表达式内部定义的变量也会存入 context
runner.execute("x = 10; y = 20; x + y", context, null, true, false);

// 执行后，context 中有了 x 和 y
System.out.println(context.get("x"));  // 10
System.out.println(context.get("y"));  // 20
```

::: warning Context 不是线程安全的
`DefaultContext` 不是线程安全的。每次执行应使用独立的 Context 实例，不要在多线程间共享同一个 Context。
:::

---

## 八、沙箱安全

### 8.1 安全风险

表达式引擎本质上是**运行时动态执行代码**，如果不做安全限制，用户可以通过表达式调用任意 Java 方法，造成安全漏洞：

```java
// 危险！如果表达式来自用户输入
String evilExpress = "Runtime.getRuntime().exec('rm -rf /')";
runner.execute(evilExpress, context, null, true, false);  // 系统命令被执行！
```

### 8.2 安全控制措施

QLExpress 提供了多种安全控制手段：

#### 1. 限制可访问的类

```java
ExpressRunner runner = new ExpressRunner();

// 白名单方式：只允许访问特定类
runner.addFunctionOfClassMethod(
    "max", "java.lang.Math", "max", new String[]{"int", "int"});

// 黑名单方式：禁止访问特定类（QLExpress 默认已禁用部分危险类）
// Runtime、Process、System 等
```

#### 2. 使用严格沙箱模式

```java
// isPrecise: 精确模式（类型严格匹配）
// isStrict:  严格沙箱模式
ExpressRunner runner = new ExpressRunner(false, true);

// 严格模式下，只有明确注册的类和方法才能被访问
```

#### 3. 自定义安全策略

```java
// 通过重写 Runner 的方法来控制安全策略
runner.setSecurityRiskEvaluator(new SecurityRiskEvaluator() {
    @Override
    public boolean check(Class<?> clazz) {
        // 禁止访问 Runtime、ProcessBuilder 等危险类
        if (clazz == Runtime.class || clazz == ProcessBuilder.class) {
            return false;
        }
        return true;
    }
});
```

::: warning 生产环境必须配置安全策略
如果你的表达式来自用户输入或外部配置，**必须**配置沙箱安全策略。默认的 QLExpress 虽然禁用了一些危险类，但不能完全依赖默认配置。建议采用**白名单**方式，只允许访问业务需要的类和方法。
:::

---

## 九、AI 客服系统中的实战应用

### 9.1 智能路由规则引擎

AI 客服系统中最典型的应用——根据用户属性和上下文动态路由到不同的处理通道：

```java
public class SessionRouter {

    private static final ExpressRunner runner = new ExpressRunner();
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

    public String route(User user, Message message) throws Exception {
        DefaultContext<String, Object> context = new DefaultContext<>();
        context.put("user", user);
        context.put("message", message);

        List<String> errorList = new ArrayList<>();
        Object result = runner.execute(ROUTE_RULE, context, errorList, true, false);

        if (!errorList.isEmpty()) {
            log.warn("路由规则执行错误: {}", errorList);
            return "GENERAL_CHANNEL";  // 降级到通用通道
        }
        return (String) result;
    }
}
```

**优势**：路由规则存储在配置中心，运营可以随时调整，无需发版。

### 9.2 动态评分与优先级

客服系统需要对会话进行优先级评分，决定排队顺序：

```java
// 评分规则（可动态配置）
String SCORING_RULE = ""
    + "score = 0;"
    + "score = score + user.vipLevel * 10;"           // VIP 等级权重
    + "score = score + user.orderAmount * 0.01;"       // 消费金额权重"
    + "if (user.complaintCount > 0) {"
    + "    score = score + user.complaintCount * 20;" // 投诉加急"
    + "}"
    + "if (message.urgency == 'high') {"
    + "    score = score * 1.5;"                       // 紧急消息加权"
    + "}"
    + "return score;";

// 执行评分
Object score = runner.execute(SCORING_RULE, context, errorList, true, false);
```

### 9.3 知识库条件过滤

根据用户画像动态过滤知识库内容：

```java
// 动态过滤条件
String FILTER_RULE = ""
    + "article.visibleToNewUser == true || user.isNewUser == false"
    + " && (article.minVipLevel == 0 || user.vipLevel >= article.minVipLevel)"
    + " && (article.category == 'all' || article.category == user.category)";

// 对每篇知识库文章执行过滤
for (Article article : knowledgeBase) {
    context.put("article", article);
    Boolean match = (Boolean) runner.execute(FILTER_RULE, context, null, true, false);
    if (match) {
        result.add(article);
    }
}
```

### 9.4 完整集成架构

```text
┌──────────────────────────────────────────────────────┐
│                    AI 客服系统                        │
│                                                       │
│  ┌─────────────┐    ┌─────────────┐                 │
│  │  规则配置中心  │    │  用户上下文   │                 │
│  │  (数据库/配置) │    │  (Context)  │                 │
│  └──────┬──────┘    └──────┬──────┘                 │
│         │                  │                         │
│         ▼                  ▼                         │
│  ┌─────────────────────────────┐                    │
│  │     QLExpress Runner        │                    │
│  │  (表达式解析 + 执行 + 缓存)   │                    │
│  └──────────────┬──────────────┘                    │
│                 │                                     │
│         ┌───────┼───────┐                            │
│         │       │       │                            │
│         ▼       ▼       ▼                            │
│    智能路由  优先级评分  知识过滤                      │
│                                                       │
│  ✅ 规则与代码解耦，运营自助修改                        │
│  ✅ 无需发版，实时生效                                 │
│  ✅ 规则可版本管理和回滚                               │
└──────────────────────────────────────────────────────┘
```

---

## 十、性能优化与最佳实践

### 10.1 Runner 复用

```java
// ❌ 错误：每次执行创建新 Runner
public Object badExecute(String express, Map<String, Object> params) throws Exception {
    ExpressRunner runner = new ExpressRunner();  // 每次都创建！
    DefaultContext<String, Object> context = new DefaultContext<>();
    context.putAll(params);
    return runner.execute(express, context, null, true, false);
}

// ✅ 正确：全局单例 Runner
private static final ExpressRunner RUNNER = new ExpressRunner();

public Object goodExecute(String express, Map<String, Object> params) throws Exception {
    DefaultContext<String, Object> context = new DefaultContext<>();  // Context 每次新建
    context.putAll(params);
    return RUNNER.execute(express, context, null, true, false);
}
```

### 10.2 表达式缓存策略

```java
// ❌ 错误：把变量值拼进表达式，缓存失效
String express = "10 + 20 * 2";  // 每次值不同，缓存失效
runner.execute(express, context, null, true, false);

// ✅ 正确：表达式模板固定，变量通过 Context 传入
String express = "a + b * 2";    // 表达式固定，缓存命中
context.put("a", 10);
context.put("b", 20);
runner.execute(express, context, null, true, false);
```

### 10.3 错误处理

```java
List<String> errorList = new ArrayList<>();
Object result = runner.execute(express, context, errorList, true, false);

if (!errorList.isEmpty()) {
    // 记录错误日志，降级处理
    log.error("表达式执行错误: {}, 表达式: {}", errorList, express);
    return defaultValue;  // 返回降级值
}
```

### 10.4 最佳实践总结

| 原则 | 说明 |
|------|------|
| **Runner 全局单例** | 线程安全，创建开销大，全局复用 |
| **Context 每次新建** | 非线程安全，通过独立 Context 隔离变量 |
| **表达式模板固定** | 变量通过 Context 传入，避免拼接导致缓存失效 |
| **始终传 errorList** | 收集错误信息，做降级处理 |
| **生产关闭 Trace** | `isTrace=false`，避免性能开销 |
| **配置安全策略** | 白名单方式限制可访问的类和方法 |
| **规则版本管理** | 表达式存储在数据库，支持版本和回滚 |

---

## 总结

QLExpress 的核心价值可以概括为一句话：**让业务规则成为数据，而非代码**。

- **动态性**：规则存储在配置中心或数据库，修改实时生效，无需发版
- **低学习成本**：类 Java 语法，Java 开发者零门槛上手
- **功能完备**：支持控制流、函数定义、运算符重载，不局限于简单表达式
- **安全可控**：沙箱机制 + 白名单策略，防止恶意代码执行
- **生产验证**：阿里巴巴多年双 11 大规模验证，稳定性有保障

在 AI 客服系统中，QLExpress 可以灵活支撑智能路由、优先级评分、知识过滤等多种动态规则场景。结合配置中心，可以实现**规则与代码完全解耦**——运营在管理后台修改规则，客服系统实时生效，开发无需参与。

如果你正在寻找一个轻量、稳定、易上手的表达式引擎，QLExpress 是 JVM 生态中最稳妥的选择之一。

---

## 延伸阅读

- [QLExpress GitHub 仓库](https://github.com/alibaba/QLExpress) —— 官方源码和文档
- [Aviator 文档](https://github.com/killme2008/aviator) —— 另一个阿里出品的高性能表达式引擎
- [Drools 文档](https://www.drools.org/) —— 功能完整的规则引擎，适合复杂规则场景
- [Spring Expression Language (SpEL)](https://docs.spring.io/spring-framework/reference/core/expressions.html) —— Spring 生态原生表达式语言
