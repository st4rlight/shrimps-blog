---
title: DeepSeek Harness 底层 Cordis 插件式框架核心架构分析
tags:
  - DeepSeek
  - Cordis
  - 插件框架
  - 依赖注入
  - 源码分析
excerpt: 从 Context 代理模式、Registry 插件注册、Reflect 服务解析三大核心机制，系统拆解 DeepSeek Harness 底层 Cordis 插件式框架的架构设计哲学。
createTime: 2026/10/02 14:00:00
permalink: /ai-study/deepseek-v3-plugin-framework-analysis/
---

# DeepSeek Harness 底层 Cordis 插件式框架核心架构分析

> 源码分析版本：2026-10 · 核心仓库：`deepseek-ai/deepseek-harness`（master 分支）
> 核心包：`vendor/cordis/`（`@deepseek-ai/cordis` v4.0.5-alpha.1）
> 核心文件：`context.ts`、`registry.ts`、`reflect.ts`、`fiber.ts`、`events.ts`、`service.ts`

---

## 背景与动机

DeepSeek Harness（DSH）是 DeepSeek 开源的 AI Agent 应用框架，其口号是 **"Everything is a Plugin"**——万物皆插件。支撑这一设计哲学的，是底层的 **Cordis** 插件式框架。

Cordis 是一个 TypeScript 插件框架，为需要显式依赖注入、作用域服务、生命周期管理清理和可选配置驱动加载的应用程序而设计。它的核心包仅约 **2700 行代码**（9 个源文件），却提供了一套完整的插件系统：

- **Context 代理**：通过 `Proxy` 实现的服务解析容器
- **Registry 注册表**：插件形状归一化与生命周期入口
- **Reflect 反射层**：服务注册、属性访问、Mixin 混入
- **Fiber 纤维**：插件运行时实例与生命周期状态机
- **Events 事件总线**：五种派发模式的统一事件系统
- **Service 基类**：服务注册与拦截配置的标准抽象

本文从源码层面拆解 Cordis 的三大核心架构——Context 代理、Registry 注册、Reflect 服务解析——回答一个核心问题：**Cordis 如何用约 2700 行 TypeScript 代码，实现一个"万物皆插件"的框架？**

---

## 框架总览

![Cordis 插件式框架总览](/ai-study/harness/cordis-framework-overview.svg)

Cordis 核心包由 9 个源文件构成，每个文件承担一个清晰的职责：

| 文件 | 行数 | 职责 | 核心抽象 |
|------|------|------|----------|
| `context.ts` | 146 | 根上下文与作用域创建 | `Context` 类 + `extend()` / `isolate()` / `intercept()` |
| `registry.ts` | 337 | 插件注册与依赖注入 | `RegistryService` + `Plugin` 类型 + `Inject` 装饰器 |
| `reflect.ts` | 418 | 服务解析与属性代理 | `ReflectService` + `Proxy handler` + `Impl` 记录 |
| `fiber.ts` | 754 | 插件生命周期与副作用管理 | `Fiber` 类 + `FiberState` 状态机 + `effect()` |
| `events.ts` | 352 | 事件总线与五种派发模式 | `EventsService` + `emit/parallel/serial/bail/waterfall` |
| `service.ts` | 115 | 服务基类与拦截配置 | `Service` 抽象类 + `resolveConfig` |
| `logger.ts` | 271 | 日志门面与导出器 | `LoggerService` + `Logger` + `Exporter` |
| `utils.ts` | 287 | 共享工具与 Traceable 代理 | `DisposableList` + `createTraceable` + `composeError` |
| `index.ts` | 16 | 统一导出 | re-export |

**设计哲学**：用 **Context Proxy + Registry + Reflect** 三层架构实现插件式设计——Context 是所有操作的入口代理，Registry 管理插件注册与启动，Reflect 负责服务解析与属性混入。三者通过 `Fiber` 串联生命周期，形成一套**声明式依赖注入 + 自动清理**的插件系统。

---

## Context：代理驱动的依赖容器

### Context 是什么

Context 是 Cordis 的核心——它是所有插件代码的入口参数，是服务解析的代理容器，也是作用域隔离的基础。

```ts
// 每个插件的回调都接收一个 Context
function myPlugin(ctx: Context, config: any) {
  ctx.on('event', () => {})
  ctx.logger.info('hello')
  ctx.provide('myService', { hello: () => 'world' })
}
```

Context 的构造函数做了三件关键事情：

```ts
export class Context {
  constructor() {
    this[symbols.isolate] = Object.create(null)
    this[symbols.intercept] = Object.create(null)
    // 创建 Proxy 代理——所有属性访问经过 ReflectService.handler
    const self = new Proxy<this>(this, ReflectService.handler)
    this.root = self
    this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])
    this.reflect = new ReflectService(self)
    this.registry = new RegistryService(self)
    this.events = new EventsService(self)
    this.logger = new LoggerService(self)
    return self  // 返回代理而非原始对象
  }
}
```

> 🔑 **关键设计**：`new Context()` 返回的不是 `this`，而是一个 **Proxy 代理**。这意味着所有对 Context 的属性访问（`ctx.anyService`）都会经过 `ReflectService.handler` 的 `get` trap，实现自动服务解析。

### 三种作用域创建方式

Context 提供三种创建子作用域的方法，都不修改父上下文：

| 方法 | 作用 | 使用场景 |
|------|------|----------|
| `extend(meta)` | 原型继承父上下文，添加自有属性 | 内部实现的基础原语 |
| `isolate(name, label)` | 为服务 `name` 创建独立作用域 | 同一服务多实例隔离 |
| `intercept(name, config)` | 为服务 `name` 添加拦截配置 | 父级注入全局配置 |

**`isolate`** 实现服务隔离——同一服务名在不同作用域下解析到不同实现：

```ts
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

隔离映射 `isolate` 是一个 `Dict<symbol>`：服务名 → 作用域标签。当解析服务时，Cordis 通过作用域标签查找对应的 `Impl` 记录，而非直接按名称查找，从而实现同名服务的多实例隔离。

**`intercept`** 实现配置拦截——父上下文为子插件预设服务配置：

```ts
intercept(name: string, config: any) {
  const intercept = Object.create(this[symbols.intercept])
  intercept[name] = config
  return this.extend({ [symbols.intercept]: intercept })
}
```

拦截映射 `intercept` 使用原型链继承：子上下文的拦截配置通过 `Object.create(parent[symbols.intercept])` 继承父级配置，查找时沿原型链向上遍历。

### Context.is 跨域判断

```ts
static is(value: any): value is Context {
  return !!value?.[Context.is as any]
}

static {
  Context.is[Symbol.toPrimitive] = () => Symbol.for('cordis.is')
  Context.prototype[Context.is as any] = true
}
```

Cordis 使用全局 Symbol（`Symbol.for('cordis.is')`）作为 Context 的品牌标记，而非 `instanceof`。这使得 **跨 realm**（如 iframe、worker）和**多份 Cordis 副本**场景下也能正确判断 Context。

---

## Registry：插件注册与依赖注入

### 插件的三种形态

Cordis 支持三种插件入口形态，Registry 负责将它们归一化为统一的 callback：

```ts
export type Plugin<T = any> =
  | Plugin.Function<T>    // 函数插件：(ctx, config) => any
  | Plugin.Constructor<T> // 类插件：new (ctx, config) => any
  | Plugin.Object<T>      // 对象插件：{ apply(ctx, config) => any }
```

`resolve()` 方法将三种形态统一提取为可执行 callback：

```ts
resolve(plugin: Plugin): Function | undefined {
  try {
    if (typeof plugin === 'function') return plugin       // 函数/类
    if (isApplicable(plugin)) return plugin.apply          // 对象
  } catch {}
}

function isApplicable(object: Plugin) {
  return object && typeof object === 'object'
    && typeof object.apply === 'function'
}
```

### 插件元数据

每种插件形态都可以携带共享元数据：

```ts
export interface Base<T = any> {
  name?: string                    // 显示名称，用于日志和诊断
  Config?: StandardSchemaV1        // Standard Schema 配置验证器
  inject?: Inject                  // 依赖声明：所需服务列表
  provide?: string | string[]      // 提供的服务名
  intercept?: Dict<boolean>        // 声明消费的拦截配置
}
```

> 💡 **Standard Schema**：Cordis 使用 `@standard-schema/spec` 作为配置验证规范，兼容 Zod、Valibot、Schemastery 等多种 schema 库，而非绑定特定验证库。

### plugin() 方法：插件启动入口

`ctx.plugin()` 是启动插件的唯一入口，它创建 Runtime 记录和 Fiber 实例：

```ts
plugin(plugin: Plugin, config?: any, getOuterStack = buildOuterStack()) {
  // 1. 校验插件形态并提取 callback
  const callback = this.resolve(plugin)
  if (!callback) throw new Error('invalid plugin...')
  this.ctx.fiber.assertActive()

  // 2. 创建或复用 Runtime 记录
  let runtime = this._internal.get(callback)
  if (!runtime) {
    runtime = {
      name: plugin.name,
      callback,
      fibers: new DisposableList(),
      Config: plugin.Config,
    }
    this._internal.set(callback, runtime)
  }

  // 3. 创建 Fiber 并包装为 PromiseLike
  const fiber = new Fiber(
    this.ctx, config,
    Inject.resolve(plugin.inject),  // 解析依赖声明
    runtime, getOuterStack,
  )
  const wrapped = Object.create(fiber)
  wrapped.then = (onFulfilled, onRejected) => {
    return fiber.await().then(onFulfilled, onRejected)
  }
  return wrapped
}
```

**关键设计**：

1. **Runtime 复用**：同一个插件 callback 的多次 `plugin()` 调用共享同一个 Runtime 记录，但每个调用创建独立的 Fiber
2. **Inject.resolve**：将数组形式 `['serviceA']` 和对象形式 `{ serviceA: config }` 统一为 `Dict<any>`（服务名 → 拦截配置或 null）
3. **PromiseLike 包装**：Fiber 被 `Object.create` 包装后附加 `then` 方法，使其可被 `await`，但不是真正的 Promise（避免不必要的微任务）

### inject()：快捷依赖注入

`ctx.inject()` 是 `ctx.plugin()` 的快捷方式，适用于只需要等待服务就绪的场景：

```ts
inject(inject: Inject, callback: Plugin.Function<void>) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}
```

这等价于创建一个对象插件，其 `apply` 就是回调函数，`inject` 声明依赖。当依赖服务变更时，回调会自动重新执行。

### @Inject 装饰器

对于类插件，Cordis 提供 `@Inject` 装饰器声明依赖：

```ts
@Injectable
class MyPlugin {
  @Inject('database')
  declare ctx: Context  // 装饰器在类层面注入依赖

  @Inject('logger')
  initLogger() { ... }  // 装饰器在方法层面延迟执行
}
```

装饰器在类层面贡献 `inject` 映射，在方法层面注册 `initHooks`，在插件实例化后按需触发。

---

## Reflect：服务解析与属性代理

### Proxy Handler：Context 的灵魂

`ReflectService.handler` 是 Context 代理的核心——所有对 Context 的属性访问都经过这里：

```ts
static handler: ProxyHandler<Context> = {
  get: (target, prop, ctx: Context) => {
    // 1. Symbol/保留字/下划线属性直接返回
    if (isSpecialProperty(prop)) {
      return Reflect.get(target, prop, ctx)
    }
    // 2. 自有属性直接返回（如 reflect, registry, events）
    if (Reflect.has(target, prop)) {
      return getTraceable(ctx, Reflect.get(target, prop, ctx))
    }

    // 3. 访问器属性（Accessor）
    const def = target.reflect.props[prop]
    if (def?.type === 'accessor') {
      return def.get.call(ctx, ctx[symbols.receiver], error)
    }

    // 4. 服务解析——沿 Fiber 链向上查找
    return ctx.events.waterfall('internal/get', ctx, prop, error, () => {
      const key = target[symbols.isolate][prop]
      let fiber = (ctx[symbols.shadow] ?? ctx).fiber
      while (true) {
        const impl = fiber.store?.[prop]
        if (impl) return getTraceable(ctx, impl.value)
        if (prop in fiber.inject) {
          error.message = `cannot get required service "${prop}" in inactive context`
          throw error
        }
        if (!fiber.runtime) throw error
        if (fiber.parent[symbols.isolate][prop] !== key) throw error
        fiber = fiber.parent.fiber
      }
    })
  },
  // ... set, has traps
}
```

**服务解析算法**：

1. 检查是否为特殊属性（Symbol、保留字）——直接返回
2. 检查是否为 Context 自有属性——直接返回（带 Traceable 包装）
3. 检查是否为已声明的 Accessor——调用 getter
4. 进入 `internal/get` waterfall——允许其他插件拦截服务访问
5. **沿 Fiber 链向上查找**：从当前 Fiber 的 `store` 开始，沿 `parent.fiber` 链向上，直到找到提供该服务的 Fiber

> 🔑 **Fiber 链查找**：服务解析不是全局查找，而是沿着插件加载的 **Fiber 父子链** 向上查找。这意味着不同 Context 子树中的插件看到的服务实现可以不同——这就是 Cordis 作用域隔离的本质。

### provide()：服务注册

`ctx.provide()` 注册一个服务实现，它被实现为一个 Fiber effect：

```ts
provide(name: string, value?: any, check?: () => boolean) {
  return this.ctx.fiber.effect(() => {
    this.props[name] = { type: 'service' }
    this.ctx.root[symbols.isolate][name] ??= Symbol(name)
    const key = this.ctx[symbols.isolate][name]
    const impl: Impl = { name, value, fiber: this.ctx.fiber, check }
    if (this.store[key]) {
      throw new Error(`service "${name}" has been registered`)
    }
    this.store[key] = impl
    this.ctx.fiber.store![name] = impl
    // 如果 Fiber 已激活，通知依赖此服务的其他 Fiber
    if (this.ctx.fiber.state === FiberState.ACTIVE) {
      this.notify([name])
    }
    // 返回清理函数——Fiber 卸载时自动取消注册
    return async () => {
      delete this.store[key]
      const fibers = this.notify([name])
      await Promise.allSettled(fibers.map(fiber => fiber.await()))
      delete this.ctx.fiber.store![name]
    }
  }, `ctx.provide(${JSON.stringify(name)})`)
}
```

**关键设计**：

- **effect 绑定**：`provide` 通过 `fiber.effect()` 注册，当 Fiber 卸载时服务自动注销
- **isolate key**：服务存储按 `isolate` 映射中的 Symbol key 索引，而非直接按名称——同一名称在不同隔离作用域下指向不同 Impl
- **notify 通知**：服务注册/注销后，通知所有依赖此服务的 Fiber 重新检查依赖状态

### notify()：依赖变更通知

当服务注册或注销时，`notify()` 遍历所有注册的 Fiber，检查依赖状态变化：

```ts
notify(names: string[], filter = (ctx, name) => 
  ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]
) {
  const fibers: Fiber[] = []
  for (const runtime of this.ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      let hasUpdate = false
      for (const name of names) {
        if (!(name in fiber.inject)) continue    // 只检查声明的依赖
        if (!filter(fiber.ctx, name)) continue   // 只通知同作用域
        hasUpdate = true
        fiber._checkImpl(name)                   // 重新检查服务可用性
      }
      if (!hasUpdate) continue
      fiber._refresh()                            // 刷新依赖状态→可能触发 reload/unload
      fibers.push(fiber)
    }
  }
  // 发出 internal/service 事件
  for (const name of names) {
    this.ctx.events.emit(self, 'internal/service', name, this._getImpl(name, false)?.value)
  }
  return fibers
}
```

### mixin()：方法混入

`mixin` 将服务的方法直接暴露到 `ctx` 上，让插件代码可以 `ctx.on()` 而非 `ctx.events.on()`：

```ts
mixin(source: any, mixins: string[] | Dict<string>) {
  return this.ctx.fiber.effect(function* () {
    const entries = Array.isArray(mixins)
      ? mixins.map(key => [key, key])
      : Object.entries(mixins)
    for (const [key, value] of entries) {
      yield self.accessor(value, {
        get(receiver, error) {
          const service = this[source]
          if (isNullable(service)) return service
          const mixin = receiver ? withProps(receiver, service) : service
          const val = Reflect.get(service, key, mixin)
          if (typeof val !== 'function') return val
          return val.bind(mixin ?? service)  // 绑定 this 到服务
        },
        set(value, receiver, error) {
          const service = this[source]
          const mixin = receiver ? withProps(receiver, service) : service
          return Reflect.set(service, key, value, mixin)
        },
      })
    }
  }, `ctx.mixin(${JSON.stringify(source)})`)
}
```

Cordis 在构造 `ReflectService` 时就混入了核心服务的方法：

```ts
constructor(public ctx: Context) {
  this.mixin('reflect', ['get', 'set', 'provide', 'accessor', 'mixin'])
  this.mixin('fiber', ['runtime', 'effect'])
  this.mixin('registry', ['inject', 'plugin'])
  this.mixin('events', ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
}
```

这就是为什么 `ctx.on()`、`ctx.plugin()`、`ctx.provide()` 等 API 可用——它们都是通过 mixin 代理到对应服务的同名方法。

---

## Service：服务基类

### Service 抽象

`Service` 是所有 Cordis 服务的基类，子类调用 `super(ctx, name)` 即可自动注册：

```ts
export abstract class Service<out T = never> {
  declare [symbols.config]: T  // 拦截配置的幻影类型参数

  constructor(protected ctx: Context, name: string) {
    name ??= this.constructor['provide'] as string

    let self = this
    const tracker: Tracker = { associate: name, property: 'ctx' }
    // 如果服务有 invoke body，创建可调用实例
    if (self[symbols.invoke]) {
      self = createCallable(name, joinPrototype(
        Object.getPrototypeOf(this), Function.prototype
      ), tracker)
    }
    self.ctx = ctx
    self.name = name
    defineProperty(self, symbols.tracker, tracker)
    // 自动注册为服务
    self.ctx.reflect.provide(name, self, this[symbols.check])
    return self
  }
}
```

> 💡 **Callable Service**：如果服务定义了 `[Service.invoke]` 方法（如 `LoggerService`），`Service` 构造函数会通过 `createCallable` 将实例变为可调用函数——这就是为什么 `ctx.logger('name')` 可以直接调用。

### 拦截配置解析

Service 提供了 `[symbols.resolveConfig]` 方法，沿 Context 原型链收集拦截配置：

```ts
[symbols.resolveConfig](base?: T, head?: T): T {
  let intercept = this.ctx[Context.intercept]
  const configs: any[] = []
  // 沿原型链收集所有同名拦截配置
  while (this.name in intercept) {
    if (Object.hasOwn(intercept, this.name)) {
      configs.unshift(intercept[this.name])
    }
    intercept = Object.getPrototypeOf(intercept)
  }
  if (base) configs.unshift(base)
  if (head) configs.push(head)
  // 如果有 Config.merge 则使用，否则浅合并
  if (this['Config']?.merge) {
    return this['Config'].merge(...configs)
  }
  return Object.assign({}, ...configs)
}
```

### Service 的静态 Symbol

Service 通过一组 Symbol 定义服务契约：

| Symbol | 用途 |
|--------|------|
| `Service.init` | 类插件实例化后的异步初始化方法 |
| `Service.check` | 服务可用性谓词（依赖检查） |
| `Service.config` | 拦截配置的幻影类型参数 |
| `Service.invoke` | 使服务可调用的方法体 |
| `Service.extend` | 派生扩展服务实例的工厂方法 |
| `Service.tracker` | Traceable 代理的追踪元数据 |
| `Service.resolveConfig` | 拦截配置解析方法 |

---

## Traceable：上下文感知的代理

### 为什么需要 Traceable

Cordis 的服务方法需要感知调用者的 Context。例如：

```ts
// 插件 A 注册了一个事件监听器
ctx.on('event', function() {
  // 这个回调内部的 this 应该是插件 A 的 ctx
  this.logger.info('triggered')
})
```

但如果事件由插件 B 触发，监听器中的 `this` 默认指向插件 B 的 ctx。Traceable 代理解决了这个问题——它让服务方法自动绑定到**注册时**的 Context，而非调用时的 Context。

### createTraceable 实现

```ts
function createTraceable(ctx: Context, value: any, tracker: Tracker) {
  // 如果有 shadow 且不是 noShadow，回退到原始 ctx
  if (ctx[symbols.shadow] && !tracker.noShadow) {
    ctx = Object.getPrototypeOf(ctx)
  }
  const proxy = new Proxy(value, {
    get: (target, prop, receiver) => {
      if (prop === symbols.original) return target
      if (prop === tracker.property) return ctx  // 返回注册时的 ctx
      // ...
      const desc = getPropertyDescriptor(target, prop)
      if (desc && 'value' in desc) {
        innerValue = desc.value
      } else {
        // 创建 shadow：将 receiver 的属性覆盖到 ctx 上
        shadow = createShadow(ctx, target, tracker.property, receiver)
        innerValue = Reflect.get(target, prop, shadow)
      }
      // 嵌套 Traceable
      const innerTracker = innerValue?.[symbols.tracker]
      if (innerTracker) {
        return createTraceable(ctx, innerValue, innerTracker)
      } else if (!tracker.noShadow && typeof innerValue === 'function') {
        // 非 noShadow 的方法用 shadow 代理 this
        shadow ??= createShadow(ctx, target, tracker.property, receiver)
        return createShadowMethod(ctx, innerValue, receiver, shadow)
      }
      return innerValue
    },
    apply: (target, thisArg, args) => {
      return applyTraceable(proxy, target, thisArg, args)
    },
  })
  return proxy
}
```

> 🎯 **核心思想**：Traceable 是一层 Context 感知代理——它让服务方法在调用时自动使用注册时的 Context，而非调用者的 Context。这是 Cordis 实现插件隔离的关键机制之一。

---

## DisposableList：O(1) 删除的副作用收集器

Fiber 的所有副作用（effect、事件监听、服务注册）都注册到 `DisposableList` 中，卸载时按注册顺序的逆序执行：

```ts
export class DisposableList<T extends WeakKey> {
  private sn = 0
  private map = new Map<number, T>()
  private weak = new WeakMap<T, number>()

  push(value: T) {
    const sn = ++this.sn
    this.map.set(sn, value)
    this.weak.set(value, sn)
    return () => this.map.delete(sn)  // O(1) 删除
  }

  delete(value: T) {
    const sn = this.weak.get(value)
    if (!sn) return false
    return this.map.delete(sn)  // WeakMap 实现 O(1) 按值删除
  }

  clear() {
    const values = [...this.map.values()]
    this.map.clear()
    return values.reverse()  // 逆序返回——后注册的先清理
  }
}
```

**设计亮点**：

- **Map + WeakMap 双索引**：`Map<number, T>` 按序号存储，`WeakMap<T, number>` 反向索引，实现 O(1) 按值删除
- **WeakKey 约束**：`T extends WeakKey` 确保 WeakMap 可用（对象或函数）
- **push 返回删除器**：`push()` 返回一个 `() => boolean` 函数，调用即从列表中删除该条目
- **clear 逆序返回**：`clear()` 逆序返回所有值，确保后注册的副作用先清理

---

## Cordis 在 DSH 中的使用

### 真实插件示例：TimerService

`@deepseek-ai/cordis-plugin-timer` 是一个典型的 Cordis 服务插件：

```ts
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<TimerService, 
    'timeout' | 'interval' | 'throttle' | 'debounce'> {
    timer: TimerService
  }
}

export class TimerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
    // 将 TimerService 的方法混入到 ctx 上
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce'])
  }

  timeout(callback: () => void, delay: number): () => void {
    return this.ctx.effect(() => {
      const timer = setTimeout(() => { dispose(); callback() }, delay)
      return () => clearTimeout(timer)  // Fiber 卸载时自动清理
    }, 'ctx.timeout()')
  }
}
```

**使用方式**：

```ts
const ctx = new Context()
await ctx.plugin(TimerService)

// ctx.timeout() 自动在 Fiber 卸载时清理
const stop = ctx.timeout(() => console.log('fired'), 1000)
```

### DSH 中的插件生态

DSH 的 `packages/` 目录下有 60+ 个插件包，全部基于 Cordis 构建：

| 包 | 提供的服务 | 职责 |
|---|---------|------|
| `cordis-plugin-loader` | `loader` | 插件树管理与配置加载 |
| `cordis-plugin-include` | — | YAML/JSON 配置文件引用 |
| `cordis-plugin-hmr` | — | 热模块替换 |
| `settings` | `settings` | 配置表单与 schema 投影 |
| `webhook` | `webhook` | Webhook 事件处理 |
| `llm` | `llm` | LLM 调用抽象 |
| `session` | `session` | 会话管理 |
| `terminal` | `terminal` | 终端交互 |
| `mcp` | `mcp` | MCP 协议支持 |

每个插件都通过 `declare module '@deepseek-ai/cordis'` 扩展 `Context` 接口，声明自己提供的服务类型——这就是 DSH "万物皆插件"的实现基础。

---

## 设计哲学总结

| 设计决策 | 实现方式 | 收益 |
|----------|----------|------|
| Context 代理 | `Proxy` + `ReflectService.handler` | 服务访问透明化，`ctx.service` 自动解析 |
| 作用域隔离 | `isolate` Symbol 映射 + 原型链继承 | 同名服务多实例互不干扰 |
| 配置拦截 | `intercept` 原型链 + `resolveConfig` | 父级可为子插件预设配置 |
| 插件归一化 | `resolve()` 统一三种形态为 callback | 函数/类/对象插件统一管理 |
| Fiber 链查找 | 沿 `parent.fiber` 向上解析服务 | 服务可见性限定在加载子树内 |
| Mixin 混入 | `accessor` 代理服务方法到 `ctx` | `ctx.on()` 等快捷 API |
| Traceable 代理 | 服务方法自动绑定注册时 Context | 插件隔离的调用时上下文 |
| DisposableList | Map + WeakMap 双索引 | O(1) 注册与按值删除 |
| Standard Schema | `@standard-schema/spec` | 兼容多种验证库 |

> 🎯 **一句话总结**：Cordis 用 Proxy 代理实现透明的服务解析、用 Fiber 链限定服务的可见性作用域、用 Traceable 代理绑定调用时上下文、用 DisposableList 管理 O(1) 副作用清理——四层代理协同，构建了一个声明式依赖注入、自动生命周期管理的插件框架，让 DSH 的"万物皆插件"成为可能。

---

## 与其他插件框架的对比

| 维度 | Cordis | Tapable (webpack) | Koa | NestJS |
|------|--------|-------------------|-----|--------|
| 核心抽象 | Context + Fiber + Reflect | Hook | Middleware | Module + Provider |
| 插件形态 | 函数/类/对象 | Hook 插件 | 中间件函数 | Provider/Controller |
| 依赖注入 | `inject` 声明 + 自动解析 | 无 | 无 | 显式 DI 容器 |
| 作用域隔离 | `isolate` Symbol | 无 | 无 | Module 作用域 |
| 生命周期 | Fiber 状态机 + effect | Hook 拦截 | 洋葱模型 | OnModuleInit/Destroy |
| 配置验证 | Standard Schema | 无 | 无 | class-validator |
| 服务混入 | mixin accessor | 无 | 无 | 无 |
| 清理机制 | DisposableList 自动 | 手动 | 无 | 手动 |
| 适用场景 | 通用应用框架 | 构建工具 | Web 服务 | 后端服务 |

Cordis 的独特之处在于 **Context 代理 + Fiber 链查找**——这使得服务的可见性天然限定在加载子树内，无需额外的模块边界声明。同时，Traceable 代理让服务方法自动感知注册时的上下文，实现了插件间真正的运行时隔离。

---

## 总结

本文从源码层面拆解了 Cordis 插件式框架的核心架构。核心要点回顾：

1. **Context 代理**：`new Context()` 返回 Proxy 代理，所有属性访问经过 `ReflectService.handler` 的 `get` trap，实现自动服务解析
2. **三种作用域**：`extend` 原型继承、`isolate` 服务隔离、`intercept` 配置拦截——都不修改父上下文
3. **Registry 注册表**：`plugin()` 方法归一化三种插件形态，创建 Runtime 记录和 Fiber 实例
4. **Reflect 反射层**：`provide()` 注册服务为 effect，Fiber 链查找实现作用域可见性，`mixin` 暴露服务方法到 `ctx`
5. **Service 基类**：自动注册、Callable 支持、拦截配置解析
6. **Traceable 代理**：服务方法自动绑定注册时 Context，实现插件间运行时隔离
7. **DisposableList**：Map + WeakMap 双索引实现 O(1) 注册与按值删除

下一篇 [《DeepSeek Harness Cordis 运行时机制深度分析》](./deepseek-harness-inference-engine-analysis.md) 将聚焦 Fiber 生命周期状态机、Events 五种派发模式和 Logger 日志体系，拆解 Cordis 在"运行时"层面的技术实现。
