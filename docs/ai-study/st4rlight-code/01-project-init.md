---
title: 01. 项目初始化
tags:
  - st4rlight-code
  - TypeScript
  - CLI
  - 项目初始化
excerpt: 从零初始化一个 TypeScript CLI 项目，作为构建类 Claude Code 编码助手的地基。记录技术选型、工程配置、以及从 tsx 演进到 Node 原生运行 TS 的完整过程。
createTime: 2026/08/16 10:00:00
permalink: /ai-study/st4rlight-code/01-project-init/
---

# 01. 项目初始化

构建一个类似于 Claude Code 的项目，第一步自然是把工程地基打好。这一篇记录我如何初始化一个 TypeScript CLI 项目，以及过程中经历的技术选型演进。

## 目标

- 用 TypeScript 搭建一个可作为 CLI 运行的项目
- 支持后续逐步添加 Agent 循环、工具调用等能力
- 保持依赖精简、工程配置合理

## 技术选型

| 项 | 选型 | 说明 |
|----|------|------|
| 语言 | TypeScript 5.x | 严格模式 |
| 模块 | ESM | `"type": "module"`，现代 Node 风格 |
| 运行 | Node 原生运行 TS | 无编译步骤，见下文演进 |
| 包管理 | npm | 简单直接 |

## 初始化步骤

### 1. 创建 package.json

```json
{
  "name": "st4rlight-code",
  "version": "0.1.0",
  "description": "一个类似于 Claude Code 的 AI 编码助手 CLI",
  "type": "module",
  "bin": {
    "st4rlight": "./src/index.ts"
  },
  "scripts": {
    "dev": "node src/index.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

### 2. 创建 tsconfig.json

采用严格模式，并针对"Node 原生运行 TS"做了特殊配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

这里有两个关键配置：

- `noEmit: true` — 因为我们直接用 Node 跑 TS，不需要编译产物
- `allowImportingTsExtensions: true` — 允许源码里用 `./xxx.ts` 后缀导入（Node 原生运行需要）

### 3. 创建入口文件

```ts
// src/index.ts
#!/usr/bin/env node

async function main(): Promise<void> {
  console.log("st4rlight-code: 项目已初始化，等待功能开发...");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## 运行方式的演进

这一部分很有意思，我经历了两次调整。

### 阶段一：用 tsx 运行

最初我引入了 `tsx` 来运行 TS。`tsx` 基于 esbuild，可以完整转译 TS，包括 `enum`、`namespace` 等语法。

```bash
npm install -D tsx
npm run dev  # → tsx src/index.ts
```

### 阶段二：移除 tsx，改用 Node 原生

后来发现 Node 22.6+ 已经支持**原生运行 TypeScript**（类型剥离 strip-only），于是移除了 tsx：

```bash
npm uninstall tsx
npm run dev  # → node src/index.ts
```

这个改动让依赖更精简（去掉了 tsx 及其间接依赖 esbuild）。

### 阶段三：踩坑——enum 不被支持

移除 tsx 后立刻踩到一个坑：

```
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
TypeScript enum is not supported in strip-only mode
```

**原因**：Node 的原生 TS 支持是 **strip-only**（只剥离类型），它只支持纯类型语法，不支持 `enum`、`namespace`、带默认值的参数属性等**需要生成运行时代码**的语法。而 `enum` 会编译成真正的 JS 对象。

**解决**：用 `as const` 对象 + 联合类型替代 enum：

```ts
// ❌ enum（不兼容 strip-only）
export enum Role {
  System = "system",
  User = "user",
}

// ✅ as const 对象（兼容）
export const Role = {
  System: "system",
  User: "user",
} as const;
export type Role = (typeof Role)[keyof typeof Role];
```

这也是 TypeScript 社区推荐的做法。

## 踩坑总结

| 坑 | 原因 | 解决 |
|----|------|------|
| `enum` 报错 | Node strip-only 不支持运行时语法 | 改用 `as const` + 联合类型 |
| `.ts` 扩展名导入报错 | 默认不允许 | 开启 `allowImportingTsExtensions` |

## 关键约定

基于这次初始化，我确立了后续开发必须遵守的约束：

1. **不可用 `enum`、`namespace`、带默认值的参数属性** — Node strip-only 不支持
2. **源码导入用 `.ts` 后缀** — Node 原生运行需要
3. **`.env` 不入库** — 敏感配置本地管理

## 小结

一个 CLI 项目的地基搭好了。关键收获是理解了 **Node 原生运行 TS 的 strip-only 限制**，这直接决定了后续代码风格的走向（能用 `as const` 就不用 `enum`）。

接下来，就是实现最简单的 Agent 循环，让这个项目"活"起来。
