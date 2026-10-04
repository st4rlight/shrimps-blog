---
title: DeepSeek Harness Cordis 运行时机制深度分析
tags:
  - DeepSeek
  - Cordis
  - Fiber
  - 事件总线
  - 源码分析
excerpt: 从 Fiber 生命周期状态机、Events 五种派发模式到 Logger 结构化日志体系，系统拆解 Cordis 框架运行时层面的技术实现。
createTime: 2026/10/02 14:30:00
permalink: /ai-study/deepseek-harness-inference-engine-analysis/
---

# DeepSeek Harness Cordis 运行时机制深度分析

> 源码分析版本：2026-10 · 核心仓库：`deepseek-ai/deepseek-harness`（master 分支）
> 核心包：`vendor/cordis/`（`@deepseek-ai/cordis` v4.0.5-alpha.1）
> 核心文件：`fiber.ts`、`events.ts`、`logger.ts`、`utils.ts`

---

## 背景与动机

上一篇 [《DeepSeek Harness 底层 Cordis 插件式框架核心架构分析》](./deepseek-v3-plugin-framework-analysis.md) 拆解了 Cordis 的"静态架构"——Context 代理、Registry 注册、Reflect 服务解析。本文则聚焦"动态运行时"：**当一个插件被 `ctx.plugin()` 加载后，Cordis 如何管理它的生命周期、事件分发和日志输出？**

Cordis 的运行时由三个核心机制支撑：

- **Fiber 生命周期**：六态状态机 + effect 副作用管理 + 依赖驱动的自动 reload
- **Events 事件总线**：五种派发模式 + Context 过滤 + 内部事件钩子
- **Logger 日志体系**：结构化日志 + 多 Exporter + Traceable 名称解析

这套实现虽然精巧，但每一个设计决策都直接关系到插件系统的可靠性和开发体验。本文从源码层面逐行拆解。

> 💡 **前置阅读**：本文假设读者已读过 [《Cordis 插件式框架核心架构分析》](./deepseek-v3-plugin-framework-analysis.md)，了解 Context 代理、Registry 插件注册和 Reflect 服务解析的基本概念。

---

## 运行时总览

![Cordis 运行时机制总览](/ai-study/harness/cordis-runtime-overview.svg)

Cordis 运行时的核心执行流如下：

| 阶段 | 入口 | 核心逻辑 | 涉及模块 |
|------|------|----------|----------|
| **插件加载** | `ctx.plugin()` | 创建 Fiber → 检查依赖 → 激活 → 执行 callback | `Fiber` |
| **副作用管理** | `ctx.effect()` | 注册 effect → 收集 disposer → 绑定 Fiber | `Fiber.effect()` |
| **事件分发** | `ctx.emit()` 等 | Context 过滤 → 派发到监听器 | `EventsService` |
| **依赖变更** | `notify()` | 重新检查依赖 → 触发 reload/unload | `Fiber._refresh()` |
| **日志输出** | `ctx.logger.info()` | 构造 Message → 分发到 Exporter | `LoggerService` |

---

## Fiber：插件生命周期状态机

### FiberState 六态状态机

Fiber 是每个插件运行的运行时实例，其生命周期由六个状态组成：

```ts
export const enum FiberState {
  PENDING,    // 等待依赖服务就绪
  LOADING,    // 插件 callback 正在执行
  ACTIVE,     // 已加载并正常运行
  FAILED,     // callback 或配置验证抛出异常
  DISPOSED,   // 已销毁，不可重启
  UNLOADING,  // 正在执行清理 disposers
}
```

![Fiber 生命周期状态机](/ai-study/harness/fiber-state-machine.svg)

状态转换路径：

| 起始状态 | 目标状态 | 触发条件 |
|---------|---------|----------|
| `(创建)` | `PENDING` | Fiber 构造完成，检查依赖 |
| `PENDING` | `LOADING` | 所有依赖服务就绪（epoch ≠ INACTIVE） |
| `LOADING` | `ACTIVE` | callback 执行成功 |
| `LOADING` | `FAILED` | callback 或配置验证抛出异常 |
| `ACTIVE` | `UNLOADING` | 依赖服务变更或 `dispose()` 被调用 |
| `FAILED` | `UNLOADING` | 依赖服务变更或 `dispose()` 被调用 |
| `UNLOADING` | `LOADING` | 卸载完成后依赖重新就绪 |
| `UNLOADING` | `DISPOSED` | `dispose()` 完成且不可重启 |
| `任何状态` | `DISPOSED` | `uid` 被清空 |

### Fiber 构造：从创建到激活

Fiber 构造函数处理两种场景——根 Fiber 和插件 Fiber：

```ts
constructor(
  public parent: Context,
  config: any,
  public inject: Dict<any>,        // 依赖声明（已 resolve）
  public runtime: Plugin.Runtime | null,  // null = 根 Fiber
  getOuterStack: () => string[],
) {
  this._config = config
  const collect = (dispose: Disposable) => {
    this._disposables.push(dispose)
  }

  if (runtime) {
    // 插件 Fiber
    this.uid = parent.registry.counter
    this.ctx = this.context = parent.extend({ fiber: this })

    // 将 inject 中的拦截配置写入 context
    const injectEntries = Object.entries(this.inject)
    if (injectEntries.length) {
      this.ctx[Context.intercept] = Object.create(parent[Context.intercept])
      for (const [name, config] of injectEntries) {
        if (isNullable(config)) continue
        this.ctx[Context.intercept][name] = config
      }
    }

    // 创建 effect runner
    this._runner = {
      epoch: INACTIVE,
      getOuterStack,
      execute: function () {
        if (isConstructor(runtime.callback)) {
          // 类插件：new + initHooks + [Symbol.init]
          const instance = new runtime.callback(this.ctx, this.config)
          for (const hook of instance?.[symbols.initHooks] ?? []) {
            hook()
          }
          return instance?.[symbols.init]?.()
        } else {
          // 函数插件：直接调用
          return runtime.callback(this.ctx, this.config)
        }
      },
      collect,
    }

    // 注册 dispose 到父 Fiber——父卸载时子自动卸载
    this.dispose = parent.fiber.effect(() => {
      const remove = runtime.fibers.push(this)
      return async () => {
        this.uid = null
        emitPluginDisposed(this.context, this)
        if (this.ctx.registry.has(runtime.callback)) {
          remove()
          if (!runtime.fibers.length) {
            this.ctx.registry.delete(runtime.callback)
          }
        }
        this._setEpoch(INACTIVE)
        if (!this.inertia) {
          this._updateState(() => {
            this.inertia = this._unload()
            return FiberState.UNLOADING
          })
        }
        while (this.inertia) {
          await this.inertia
        }
      }
    }, 'ctx.plugin()')

    // 通知 internal/plugin 事件
    this.context.emit('internal/plugin', this)

    // 检查依赖并尝试激活
    if (this.uid !== null && parent.fiber.state !== FiberState.UNLOADING) {
      for (const name of Object.keys(this.inject)) {
        this._checkImpl(name)
      }
      this._refresh()
    }
  } else {
    // 根 Fiber——始终 ACTIVE
    this.uid = 0
    this.ctx = this.context = parent
    this.state = FiberState.ACTIVE
    this.store = Object.create(null)
    this.dispose = () => this.restart()
  }
}
```

**关键设计**：

1. **Context 继承**：插件 Fiber 的 ctx 通过 `parent.extend({ fiber: this })` 创建子上下文，继承父的所有属性但拥有自己的 Fiber
2. **拦截配置注入**：`inject` 中声明的拦截配置被写入子上下文的 `intercept` 映射
3. **dispose 级联**：Fiber 的 dispose 注册为父 Fiber 的 effect，父卸载时子自动卸载
4. **类插件 vs 函数插件**：类插件用 `new` 构造并触发 `initHooks` 和 `[Symbol.init]`；函数插件直接调用
5. **internal/plugin 事件**：Fiber 创建后立即发出事件，允许其他插件观察插件生命周期

### 依赖检查与刷新

Fiber 通过 epoch 机制跟踪依赖状态：

```ts
_checkImpl(name: string) {
  const impl = this.ctx.reflect._getImpl(name, true)
  if (!impl) return delete this._store[name]
  try {
    if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) {
      return delete this._store[name]
    }
  } catch (error) {
    impl.fiber.ctx.logger.error(error)
    return delete this._store[name]
  }
  this._store[name] = impl
}

_refresh() {
  let epoch: string = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) {
      epoch = INACTIVE  // 依赖缺失→不激活
      break
    }
    epoch += ':' + impl.fiber.uid  // 依赖版本指纹
  }
  this._setEpoch(epoch)
}
```

> 🔑 **epoch 机制**：epoch 是一个字符串，由所有依赖服务的 Fiber uid 拼接而成。当任一依赖服务的 Fiber 变化（uid 改变）时，epoch 改变，触发 reload。这种设计使得**依赖变更检测只需一次字符串比较**，而非深度遍历。

### _setEpoch：状态转换驱动

```ts
private _setEpoch(epoch: string) {
  const oldEpoch = this._runner.epoch
  if (epoch === oldEpoch) return
  this._runner.epoch = epoch
  if (this.inertia) return  // 正在进行中的加载/卸载不重叠

  this._updateState(() => {
    if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
      // 从非激活→激活：开始加载
      this.inertia = this._reload()
      return FiberState.LOADING
    } else {
      // 从激活→非激活：开始卸载
      this.inertia = this._unload()
      return FiberState.UNLOADING
    }
  })
}
```

### _reload 与 _unload

```ts
private async _reload() {
  this.store = { ...this._store }
  const oldEpoch = this._runner.epoch
  try {
    await Promise.resolve()  // 微任务检查点——允许排队的 disposer 先执行
    if (this._runner.epoch === oldEpoch) {
      this.config = this._resolveConfig(this._config)
      await this._execute(this._runner)  // 执行插件 callback
      this._error = undefined
    }
  } catch (reason) {
    this.ctx.logger.error(reason)
    this._error = reason
    this._runner.epoch = INACTIVE
  }
  this._updateState(() => {
    if (this._runner.epoch === oldEpoch) {
      this.inertia = undefined
    } else {
      // epoch 在加载期间变了——需要卸载后重新加载
      this.inertia = this._unload()
      return FiberState.UNLOADING
    }
  })
}

private async _unload() {
  // 逆序执行所有 disposables
  await Promise.all(this._disposables.clear().map(async (dispose) => {
    try {
      await composeError(async (info) => {
        await Promise.resolve()
        info.error = new Error()
        await runDisposable(dispose)
      }, this._runner.getOuterStack)
    } catch (reason) {
      this.ctx.logger.error(reason)
    }
  }))
  this.store = undefined
  this._updateState(() => {
    if (this._runner.epoch === INACTIVE) {
      this.inertia = undefined
    } else {
      // 依赖重新就绪——重新加载
      this.inertia = this._reload()
      return FiberState.LOADING
    }
  })
}
```

> 💡 **epoch 竞态处理**：`_reload` 和 `_unload` 都在执行后检查 epoch 是否变化。如果加载期间依赖变更，加载完成后会立即触发卸载；如果卸载期间依赖恢复，卸载完成后会立即触发重新加载。这种 **inertia 链式驱动** 确保了依赖变更的最终一致性。

### update()：配置热更新

Fiber 支持 `update()` 方法进行配置热更新，它走 `internal/update` waterfall：

```ts
update(config: any, noSave = false) {
  this.assertActive()
  this._config = config
  if (this.state !== FiberState.ACTIVE) {
    // 非 ACTIVE 状态：延迟到激活时再生效
    this._error = undefined
    this._setEpoch(INACTIVE)
    this._refresh()
    return
  }
  config = this._resolveConfig(config)
  this.context.waterfall(this, 'internal/update', config, noSave, () => {
    this.config = config
    this._error = undefined
    return this.restart()
  })
}
```

`internal/update` waterfall 允许 HMR 插件拦截更新——可以选择跳过 `next()` 来阻止重启，或修改配置后再继续。

---

## effect()：副作用注册与清理

### Effect 的多种形态

`ctx.effect()` 是 Cordis 副作用管理的核心 API，支持多种返回形态：

```ts
export type Effect<T = any> =
  | SyncEffect<T>      // 同步：Disposable | Iterable<Disposable>
  | AsyncEffect<T>     // 异步：Promise<Disposable> | AsyncIterable<Disposable>

type SyncEffect<T = any> =
  | Disposable<T>                      // 返回一个清理函数
  | Iterable<Disposable<T>, void, void> // 生成器：yield 多个清理函数

type AsyncEffect<T = any> =
  | Promise<Disposable<T>>              // 异步返回一个清理函数
  | AsyncIterable<Disposable<T>, void, void>  // 异步生成器
```

### effect() 实现核心

`effect()` 方法是 Cordis 中最复杂的方法之一，它处理同步/异步 effect、setup 竞态、重入清理等边界情况：

```ts
effect(execute: () => Effect, label = 'anonymous'): AsyncDisposable {
  this.assertActive()
  if (this.state === FiberState.UNLOADING) {
    throw new CordisError('INACTIVE_EFFECT')
  }

  const disposables: Disposable[] = []
  let disposing = false
  let disposalTask: void | Promise<void>

  const dispose = () => {
    if (disposing) return disposalTask  // 幂等——多次调用返回同一个 Promise
    disposing = true
    let task!: void | Promise<void>
    // 逆序执行 disposables
    for (const disposable of disposables.splice(0).reverse()) {
      if (task) {
        task = task.then(() => runDisposable(disposable))
      } else {
        const result = runDisposable(disposable)
        if (isObject(result) && 'then' in result) {
          task = result as any
        }
      }
    }
    return disposalTask = task
  }

  // ... setup 竞态处理、async barrier、inFlight 追踪 ...

  const wrapper = defineProperty(() => {
    if (!runner.epoch) return setupFailed ? inFlight : undefined
    runner.epoch = false
    return finalizeDisposal(() => {
      if (executing) return disposeAfter(waitForSetup())
      return task ? disposeAfter(task) : dispose()
    })
  }, symbols.effect, meta) as AsyncDisposable

  // 先注册到 _disposables，再执行——允许重入的父级卸载看到这个 effect
  removeWrapper = this._disposables.push(wrapper)
  try {
    task = this._execute(runner)
  } catch (reason) {
    // 同步 setup 失败——清理并拒绝
    executing = false
    setupFailed = true
    runner.epoch = false
    let cleanup: void | Promise<void>
    try { cleanup = finalizeDisposal(dispose) }
    finally { rejectSetup?.(reason) }
    if (isObject(cleanup) && 'then' in cleanup) {
      cleanup.catch(error => this.ctx.logger.error(error))
    }
    throw reason
  }
  // ...
  return wrapper
}
```

**关键设计**：

1. **幂等 dispose**：多次调用返回同一个 `disposalTask`，避免重复清理
2. **逆序清理**：`disposables.splice(0).reverse()`——后注册的先清理，确保依赖顺序
3. **先注册后执行**：`removeWrapper = this._disposables.push(wrapper)` 在 `execute` 之前执行，确保重入的父级卸载能看到这个 effect
4. **setup 竞态**：`waitForSetup()` barrier 确保 async effect 的 setup 完成后再允许 dispose

### _execute：Effect 执行引擎

`_execute` 处理 Effect 的四种返回形态：

```ts
private _execute<T>(runner: EffectRunner<T>) {
  const oldEpoch = runner.epoch
  return composeError((info) => {
    const safeCollect = (dispose: void | Disposable) => {
      if (typeof dispose === 'function') {
        runner.collect(dispose)
      } else if (!isNullable(dispose)) {
        throw new TypeError('Invalid effect')
      }
    }
    const effect: Effect = runner.execute.call(this)
    if (typeof effect === 'function') {
      // 1. 同步返回 disposer
      return runner.collect(effect)
    } else if (isNullable(effect)) {
      // 2. 返回 null/undefined——无副作用
    } else if (!isObject(effect)) {
      throw new TypeError('Invalid effect')
    } else if ('then' in effect) {
      // 3. Promise——异步返回 disposer
      return effect.then(safeCollect)
    } else if (Symbol.iterator in effect) {
      // 4. 同步生成器——yield 多个 disposer
      info.error = new Error()
      const iter = effect[Symbol.iterator]()
      while (true) {
        const result = iter.next()
        safeCollect(result.value)
        if (result.done) return
      }
    } else if (Symbol.asyncIterator in effect) {
      // 5. 异步生成器——异步 yield 多个 disposer
      const iter = effect[Symbol.asyncIterator]()
      return (async () => {
        await Promise.resolve()
        info.error = new Error()
        while (true) {
          if (runner.epoch !== oldEpoch) return  // epoch 变了——中止
          const result = await iter.next()
          safeCollect(result.value)
          if (result.done) return
        }
      })()
    }
  }, runner.getOuterStack)
}
```

> 🔑 **生成器 Effect 的威力**：异步生成器允许 effect 在 yield 后继续执行异步操作，且每个 yield 的 disposer 都会被收集。如果 epoch 变化（依赖变更），生成器会中止——这是实现"响应式副作用"的基础。例如 `ReflectService.mixin` 就使用生成器 effect 来为每个 mixin key 注册独立的 accessor。

### Effect 诊断元数据

每个 effect 都携带诊断元数据，形成树状结构：

```ts
export interface EffectMeta {
  label: string         // 人类可读标签，如 'ctx.on("event")'
  children: EffectMeta[]  // 嵌套 effect 的元数据
}
```

通过 `fiber.getEffects()` 可以获取当前所有活跃 effect 的元数据树——这对调试插件生命周期问题非常有用。

---

## Events：五种派发模式

### 派发模式总览

Cordis 事件总线支持五种派发模式，覆盖了从"发射后不管"到"串行拦截"的全部需求：

| 模式 | 方法 | 行为 | 返回值 |
|------|------|------|--------|
| `emit` | `ctx.emit()` | 同步执行所有监听器，不等待 Promise | `void` |
| `parallel` | `ctx.parallel()` | 并发执行所有监听器，等待全部完成 | `Promise<void>` |
| `serial` | `ctx.serial()` | 串行执行，等待每个完成后继续，直到 bail | `Promise<any>` |
| `bail` | `ctx.bail()` | 同步串行执行，直到第一个非空返回 | `any` |
| `waterfall` | `ctx.waterfall()` | 瀑布流：每个监听器包装 `next()` | `any` |

### dispatch：监听器过滤与解析

所有派发模式共享 `dispatch()` 方法，它负责解析监听器并应用 Context 过滤：

```ts
dispatch(type: string, args: any[]) {
  // 第一个参数可以是 thisArg（用于 Context 过滤）
  const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function'
    ? args.shift() : null
  const name: string = args.shift()
  
  // 非内部事件触发 internal/dispatch 事件（用于诊断）
  if (!name.startsWith('internal/')) {
    this.emit('internal/dispatch', type, name, args, thisArg)
  }
  
  // Context 过滤：只通知与 thisArg 同作用域的监听器
  const filter = thisArg?.[Context.filter]
  return (this._hooks[name] || [])
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
    .map(hook => hook.callback.bind(thisArg))
}
```

> 💡 **Context 过滤**：事件分发时，如果 `thisArg` 携带了 `[Context.filter]` 函数，只有该函数返回 `true` 的监听器才会被调用。这使得事件可以限定在特定作用域内传播——不同隔离作用域的插件不会互相干扰。

### 五种派发实现

```ts
// emit：同步，不等待 Promise
emit(...args: any[]) {
  this.dispatch('emit', args).map(cb => cb(...args))
}

// parallel：并发，等待全部完成
async parallel(...args: any[]) {
  const results = await Promise.allSettled(
    this.dispatch('emit', args).map(async cb => cb(...args))
  )
  const errors = results.filter((r): r is PromiseRejectedResult => 
    r.status === 'rejected'
  )
  if (errors.length) throw new AggregateError(errors.map(e => e.reason))
}

// serial：串行，await 每个，直到 bail
async serial(...args: any[]) {
  for (const cb of this.dispatch('serial', args)) {
    const result = await cb(...args)
    if (isBailed(result)) return result
  }
}

// bail：同步串行，直到 bail
bail(...args: any[]) {
  for (const cb of this.dispatch('bail', args)) {
    const result = cb(...args)
    if (isBailed(result)) return result
  }
}

// waterfall：瀑布流，每个监听器包装 next
waterfall(...args: any[]) {
  const cbs = this.dispatch('waterfall', args)
  const inner = args.pop()  // 最内层的 next 回调
  const next = () => {
    const cb = cbs.shift() ?? inner
    return cb(...args)
  }
  args.push(next)
  return next()
}
```

**bail 判断**：

```ts
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}
```

### on()：监听器注册

`ctx.on()` 将监听器注册为 Fiber effect，自动随 Fiber 卸载清理：

```ts
on(name: string | symbol, listener: (...args: any) => any, 
   options?: boolean | EventOptions) {
  this.ctx.fiber.assertActive()
  // 通过 reflect.bind 包装——使监听器内的 this 绑定到注册时的 ctx
  listener = this.ctx.reflect.bind(listener)
  
  // internal/listener 事件允许自定义注册行为
  const result = this.bail(this.ctx, 'internal/listener', name, listener, options)
  if (result) return result
  
  const hooks = this._hooks[name] ||= []
  return this.register(`ctx.on(${JSON.stringify(name)})`, hooks, listener, options)
}

register(label: string, hooks: Hook[], callback: any, options: EventOptions) {
  const method = options.prepend ? 'unshift' : 'push'
  return this.ctx.fiber.effect(() => {
    hooks[method]({ ctx: this.ctx, callback, ...options })
    return () => this.unregister(hooks, callback)
  }, label)
}
```

**关键设计**：

1. **reflect.bind**：监听器通过 `reflect.bind` 包装，使调用时的 `this` 和参数都经过 Traceable 代理
2. **internal/listener 拦截**：`internal/listener` 是一个 bail 事件，允许其他插件替换监听器注册行为
3. **effect 绑定**：监听器注册为 Fiber effect，Fiber 卸载时自动移除

### 内部事件体系

Cordis 定义了一组内部事件，构成框架的扩展点：

| 事件 | 模式 | 触发时机 | 用途 |
|------|------|----------|------|
| `internal/plugin` | emit | Fiber 创建/销毁 | 观察插件生命周期 |
| `internal/status` | emit | Fiber 状态变更 | 诊断与监控 |
| `internal/config` | waterfall | 配置解析 | 配置变换/插值 |
| `internal/service` | emit | 服务注册/注销 | 服务发现 |
| `internal/update` | waterfall | Fiber 配置更新 | HMR、持久化 |
| `internal/get` | waterfall | 服务读取 | 服务访问拦截 |
| `internal/set` | waterfall | 服务写入 | 服务写入拦截 |
| `internal/listener` | bail | 监听器注册 | 自定义注册行为 |
| `internal/dispatch` | emit | 事件分发 | 事件诊断 |

> 🔑 **waterfall 内部事件**：`internal/config`、`internal/update`、`internal/get`、`internal/set` 都是 waterfall 模式——每个监听器可以包装 `next()` 来拦截或修改默认行为。例如 Loader 插件通过 `internal/config` 实现配置插值，通过 `internal/update` 实现配置持久化。

### internal/update 的特殊处理

`internal/update` 有一个特殊的钩子机制——Loader 通过 `internal/listener` 拦截它的注册：

```ts
// EventsService 构造函数中
this.on('internal/listener', function (this: Context, name, listener, options) {
  if (name === 'internal/update' && !options.global) {
    // 非 global 的 internal/update 监听器存储到 fiber._hooks
    const hooks = this.fiber._hooks['internal/update'] ??= new DisposableList()
    const method = options.prepend ? 'unshift' : 'push'
    return hooks[method](listener)  // bail 返回值替换默认注册
  }
})

// internal/update 的 waterfall 执行时先走 fiber 的 hooks
this.on('internal/update', function (config, noSave, next) {
  const cbs = [...this._hooks['internal/update'] || []]
  const _next = () => {
    const cb = cbs.shift() ?? next
    return cb.call(this, config, noSave, _next)
  }
  return _next()
}, { global: true, prepend: true })
```

这使得每个 Fiber 可以有自己的 `internal/update` 钩子链，且这些钩子在全局 waterfall 之前执行——HMR 插件利用这个机制在配置更新时决定是否需要热重载。

---

## Logger：结构化日志体系

### LoggerService 架构

Cordis 的日志系统是一个可调用的 Service，支持多种输出目标（Exporter）：

```ts
export class LoggerService {
  bufferSize = 1000
  buffer: Message[] = []           // 环形缓冲区
  _snMessage = 0                   // 消息序号
  _snExporter = 0                  // Exporter 序号
  exporters = new Map<number, Exporter>()

  constructor(ctx: Context) {
    // 创建可调用实例——ctx.logger(name) 返回 Logger
    const self = createCallable('logger', 
      joinPrototype(Object.getPrototypeOf(this), Function.prototype), 
      { property: 'ctx', noShadow: true }
    )
    // 注册默认 exporter（缓冲区）
    self.exporter({
      colors: 3,
      export: (message) => {
        self.buffer.push(message)
        if (self.buffer.length > self.bufferSize) {
          self.buffer = self.buffer.slice(-self.bufferSize)
        }
      },
    })
    return self
  }

  [symbols.invoke](name?: string): Logger {
    const config = this._resolveConfig()
    const fiber = ((this.ctx as any)[symbols.shadow] ?? this.ctx).fiber
    name ??= config.name
    name ??= hyphenate(fiber.name)  // 默认使用 Fiber 名称
    return new Logger({ name, level: config.level, meta: { fiber: new WeakRef(fiber) } }, this)
  }
}
```

> 🔑 **noShadow 设计**：LoggerService 是 `noShadow: true` 的服务——这意味着 Traceable 代理不会用调用者的 ctx 覆盖它的 ctx。日志名称始终来源于**注册 logger 的 Fiber**，而非调用 logger 的 Fiber。

### Logger 门面

`Logger` 是一个轻量门面，提供 `error/info/warn/debug` 四个方法：

```ts
export class Logger {
  constructor(options: LoggerOptions, private service: LoggerService) {
    Object.assign(this, options)
    this.error = this._method('error', LoggerLevel.ERROR)
    this.info = this._method('info', LoggerLevel.INFO)
    this.warn = this._method('warn', LoggerLevel.WARN)
    this.debug = this._method('debug', LoggerLevel.DEBUG)
  }

  private _method(type: LoggerType, level: number): LoggerMethod {
    return (...args: any[]) => {
      // Error 展开处理
      if (args.length === 1 && args[0] instanceof Error) {
        if (args[0].cause) {
          this[type](args[0].cause)  // 递归打印 cause 链
        } else if (isAggregateError(args[0])) {
          args[0].errors.forEach(error => this[type](error))
          return
        }
      }

      const sn = ++this.service._snMessage
      const ts = Date.now()
      // 分发到所有 Exporter
      for (const exporter of this.service.exporters.values()) {
        const targetLevel = exporter.levels?.[this.name] 
          ?? exporter.levels?.default 
          ?? this.level 
          ?? LoggerLevel.INFO
        if (targetLevel < level) continue  // 级别过滤
        const message: Message = { 
          sn, ts, type, level, name: this.name, ...this.meta, args 
        }
        exporter.export(message)
      }
    }
  }
}
```

### 日志级别与过滤

```ts
export const enum LoggerLevel {
  ERROR = 0,
  INFO = 1,
  WARN = 2,
  DEBUG = 3,
}
```

每个 Exporter 可以按 logger 名称设置不同的级别阈值：

```ts
export interface Exporter {
  colors?: number | false
  maxLength?: number
  levels?: Record<string, number>  // { default: 1, "loader": 3, "timer": 0 }
  formatters?: Record<string, Formatter>
  export(message: Message): void
}
```

### printf 格式化

Logger 支持 printf 风格的格式化，兼容 Node.js `console` 的使用习惯：

```ts
static format(exporter: Exporter, message: Message): string {
  const args = message.args.slice()
  if (args[0] instanceof Error) {
    args[0] = args[0].stack || args[0].message
    args.unshift('%s')
  } else if (typeof args[0] !== 'string') {
    args.unshift('%o')
  }

  let format: string = args.shift()
  format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
    if (match === '%%') return '%'
    const formatter = exporter.formatters?.[char] ?? defaultFormatters[char]
    if (typeof formatter === 'function') {
      const value = args.shift()
      return formatter(value, exporter, message)
    }
    return match
  })
  // ... 追加剩余参数 ...
  return format
}
```

内置格式化器：

| 占位符 | 描述 |
|--------|------|
| `%s` | `String(value)` |
| `%d` / `%i` | `Math.trunc(Number(value))` |
| `%f` | `Number(value)` |
| `%o` / `%O` | `JSON.stringify(value)` |
| `%c` / `%C` | 彩色输出（ANSI 颜色码） |

### Logger 名称着色

Logger 名称自动着色，基于名称哈希选择颜色：

```ts
static code(name: string, level?: false | number) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 3) - hash) + name.charCodeAt(i) + 13
    hash |= 0
  }
  const colors = !level ? [] : level >= 2 ? c256 : c16
  return colors[Math.abs(hash) % colors.length]
}
```

16 色和 256 色调色板使得不同名称的 logger 在终端中视觉上易于区分，无需手动配置颜色。

---

## composeError：长栈追踪

### 问题与方案

异步错误的一个核心问题是**栈追踪断裂**——`async/await` 中的错误堆栈只包含从 `await` 点到 `throw` 点的帧，丢失了调用方的上下文。Cordis 通过 `composeError` 解决这个问题。

### 实现

```ts
export function composeError<T>(
  callback: (info: StackInfo) => T, 
  getOuterStack = buildOuterStack()
): T {
  const info: StackInfo = { offset: 1, error: new Error() }

  try {
    const result: any = callback(info)
    if (isObject(result) && 'then' in result) {
      // Promise——在 rejection 时拼接外层栈
      return (result as any).then(undefined, (reason) => 
        handleError(info, reason, getOuterStack)
      ) as T
    }
    return result
  } catch (reason: any) {
    handleError(info, reason, getOuterStack)
  }
}

function handleError(info: StackInfo, reason: any, getOuterStack: () => string[]): never {
  const innerLines = info.error.stack!.split('\n')
  if (typeof reason?.stack !== 'string') {
    // 非 Error 对象——构造新 Error
    const outerError = new Error(reason)
    const lines = outerError.stack!.split('\n')
    lines.splice(1, Infinity, ...getOuterStack())
    outerError.stack = lines.join('\n')
    throw outerError
  }

  // 长栈追踪：找到内层栈与外层栈的交界点，替换为外层栈
  const lines: string[] = reason.stack.split('\n')
  let index = lines.indexOf(innerLines[2])  // 内层栈的起始帧
  if (index === -1) throw reason

  index -= info.offset
  while (index > 0) {
    if (!lines[index - 1].endsWith(' (<anonymous>)')) break
    index -= 1
  }
  lines.splice(index, Infinity, ...getOuterStack())  // 用外层栈替换内层栈
  reason.stack = lines.join('\n')
  throw reason
}
```

> 💡 **长栈追踪原理**：`composeError` 在 effect 执行时创建一个"标记 Error"（`info.error`），其堆栈包含外层调用帧。当 effect 内部抛出异步错误时，`handleError` 在错误堆栈中找到标记 Error 的帧位置，将该位置之后的所有帧替换为外层调用栈——从而将内层错误和外层调用上下文拼接成一条完整的栈追踪。

---

## 性能优化要点

### 1. DisposableList 的 O(1) 删除

```ts
push(value: T) {
  const sn = ++this.sn
  this.map.set(sn, value)
  this.weak.set(value, sn)  // WeakMap 反向索引
  return () => this.map.delete(sn)  // O(1) 删除
}
```

Map + WeakMap 双索引使得按值删除的时间复杂度为 O(1)，而非线性的 `indexOf + splice`。在插件频繁注册/注销副作用的场景下，这显著降低了清理开销。

### 2. epoch 字符串比较

依赖状态变更检测使用字符串比较而非深度遍历：

```ts
// 只需比较字符串——无需遍历所有依赖
if (epoch === oldEpoch) return
```

epoch 是所有依赖 Fiber uid 的拼接字符串，一次比较即可判断依赖是否变更。

### 3. Traceable 代理懒创建

```ts
function createTraceable(ctx: Context, value: any, tracker: Tracker) {
  const proxy = new Proxy(value, {
    get: (target, prop, receiver) => {
      // 只有在访问属性时才创建嵌套 Traceable
      const innerTracker = innerValue?.[symbols.tracker]
      if (innerTracker) {
        return createTraceable(ctx, innerValue, innerTracker)  // 懒创建
      }
      // ...
    },
  })
  return proxy
}
```

嵌套 Traceable 只在属性被访问时才创建，避免不必要的代理开销。

### 4. Logger 缓冲区

```ts
bufferSize = 1000
buffer: Message[] = []

// 默认 exporter 只写入缓冲区，不阻塞
export: (message) => {
  self.buffer.push(message)
  if (self.buffer.length > self.bufferSize) {
    self.buffer = self.buffer.slice(-self.bufferSize)  // 环形截断
  }
}
```

默认 exporter 只写入内存缓冲区，不产生 I/O。只有当用户注册了控制台 exporter（`@deepseek-ai/cordis-plugin-logger-console`）时才有实际输出。

---

## 与其他框架运行时的对比

| 特性 | Cordis | Node.js EventEmitter | Koa | NestJS Events |
|------|--------|----------------------|-----|---------------|
| 派发模式 | 5 种（emit/parallel/serial/bail/waterfall） | 1 种（emit） | 1 种（洋葱模型） | 2 种（sync/async） |
| Context 过滤 | Symbol-based 作用域 | 无 | 无 | 无 |
| 自动清理 | Fiber effect 绑定 | 手动 | 无 | 手动 |
| 生命周期状态机 | 6 态 FiberState | 无 | 无 | 简单 |
| 依赖驱动 reload | epoch 机制 | 无 | 无 | 无 |
| 长栈追踪 | composeError | 无 | 无 | 无 |
| 结构化日志 | Logger + Exporter | console | 无 | LoggerService |

Cordis 的独特之处在于 **epoch 机制驱动的依赖变更自动 reload**——当依赖服务变更时，Fiber 自动卸载并重新加载，无需手动重启。配合 `internal/update` waterfall，HMR 插件可以实现真正的热模块替换。

---

## 实践建议

![Cordis 插件开发指南](/ai-study/harness/cordis-plugin-guide.svg)

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| 注册事件监听 | `ctx.on()` | 自动随 Fiber 卸载清理，无需手动 `off()` |
| 注册定时器 | `ctx.effect(() => { const t = setTimeout(...); return () => clearTimeout(t) })` | effect 绑定确保定时器不会泄漏 |
| 注册服务 | `extends Service` 或 `ctx.provide()` | Service 基类自动注册、Callable 支持 |
| 声明依赖 | `inject: ['serviceA', 'serviceB']` | 依赖就绪前 callback 不会执行 |
| 配置拦截 | `ctx.intercept('logger', { level: 3 })` | 父级为子插件预设日志级别 |
| 服务隔离 | `ctx.isolate('database')` | 同名服务多实例互不干扰 |
| 热更新 | `fiber.update(newConfig)` | 走 `internal/update` waterfall，支持 HMR |
| 异步副作用 | `ctx.effect(function* () { yield disposer1; yield disposer2 })` | 生成器 effect 支持多个 disposer |
| 事件串行拦截 | `ctx.serial('event', ...)` | 适合需要按顺序处理的链式逻辑 |
| 事件瀑布流 | `ctx.waterfall('event', data, next)` | 适合中间件模式的请求处理 |

---

## 总结

本文从运行时视角拆解了 Cordis 框架的核心机制。核心要点回顾：

1. **Fiber 状态机**：六态生命周期（PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED），通过 epoch 机制驱动状态转换
2. **epoch 依赖追踪**：依赖服务的 Fiber uid 拼接为 epoch 字符串，一次比较即可检测变更，触发自动 reload
3. **effect 副作用管理**：支持函数/Promise/生成器/异步生成器四种形态，幂等 dispose，逆序清理，setup 竞态处理
4. **五种事件派发**：emit（同步不管）、parallel（并发等待）、serial（串行 await）、bail（同步串行拦截）、waterfall（瀑布流包装）
5. **Context 过滤**：事件分发按 `[Context.filter]` 限定作用域，不同隔离作用域的插件互不干扰
6. **内部事件扩展点**：9 个 internal/* 事件构成框架扩展点，waterfall 模式允许拦截默认行为
7. **Logger 体系**：Callable Service + 多 Exporter + printf 格式化 + 名称自动着色
8. **composeError 长栈追踪**：标记 Error + 栈帧拼接，解决 async/await 栈追踪断裂

> 🎯 **一句话总结**：Cordis 用 epoch 字符串比较实现 O(1) 依赖变更检测、用 inertia 链式驱动实现状态机最终一致性、用 DisposableList 双索引实现 O(1) 副作用清理、用 composeError 实现异步长栈追踪——四个机制协同，构建了一个声明式依赖注入、自动生命周期管理、开发体验友好的插件运行时。

结合上一篇架构分析，我们已经完整拆解了 Cordis 框架的"静态架构"和"动态运行时"。建议读者对照源码阅读，重点关注 `Fiber._setEpoch` 的状态转换逻辑、`effect()` 的 setup 竞态处理、以及 `dispatch()` 的 Context 过滤机制——这三处是理解整个运行时的关键。