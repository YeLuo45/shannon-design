---
title: Worker Package
---

# Worker Package

## 概述

`apps/worker/` 包含 Temporal Worker 和完整的渗透测试 pipeline 逻辑。是 Shannon 的核心引擎，负责执行 5 阶段安全测试。

## 目录结构

```
apps/worker/src/
├── paths.ts              # 集中式路径常量
├── session-manager.ts    # Agent 定义 (AGENTS 记录)
├── config-parser.ts      # YAML 配置解析 + JSON Schema 验证
├── ai/
│   ├── claude-executor.ts    # Claude Agent SDK 集成 + 重试
│   ├── progress-manager.ts   # 进度管理
│   ├── message-handlers.ts   # SDK 消息处理
│   ├── settings-writer.ts    # 写入 Claude settings.json (权限规则)
│   ├── models.ts             # 模型配置
│   ├── types.ts              # AI 层类型定义
│   └── queue-schemas.ts      # Exploitation Queue JSON Schema
├── services/             # 业务逻辑层 (Temporal 无关)
│   ├── agent-execution.ts     # Agent 执行生命周期
│   ├── error-handling.ts      # 错误分类
│   ├── container.ts          # 容器操作
│   ├── prompt-manager.ts      # Prompt 模板管理
│   ├── findings-renderer.ts   # 发现结果渲染 (exploit=false 时)
│   ├── preflight.ts          # 前置检查
│   └── reporting.ts          # 报告生成
├── audit/
│   ├── workflow-logger.ts    # Workflow 级别日志
│   ├── log-stream.ts         # 共享日志流
│   ├── audit-session.ts      # 审计会话
│   └── metrics-tracker.ts   # 指标追踪
├── temporal/
│   ├── workflows.ts          # 主 Workflow (pentestPipelineWorkflow)
│   ├── activities.ts        # Activity 包装器 (心跳 + 错误分类)
│   ├── worker.ts             # Worker + Client 入口
│   ├── shared.ts            # 共享类型、接口、查询定义
│   ├── summary-mapper.ts     # PipelineSummary → WorkflowSummary
│   ├── activity-logger.ts   # ActivityLogger 实现
│   ├── pipeline.ts          # Pipeline 状态机
│   └── workspaces.ts        # 工作区管理
├── types/
│   ├── result.ts             # Result&lt;T,E&gt; 类型
│   ├── errors.ts            # ErrorCode 枚举
│   ├── config.ts            # 配置类型 (VulnClass 等)
│   ├── agents.ts            # AgentName、AgentDefinition 等
│   ├── audit.ts             # 审计类型
│   └── metrics.ts           # 指标类型
└── utils/                   # 共享工具
```

## Temporal 编排

### Workflow 定义

```typescript
// apps/worker/src/temporal/workflows.ts
// pentestPipelineWorkflow
//
// 1. Pre-Reconnaissance (sequential)
// 2. Reconnaissance (sequential)
// 3-4. Vulnerability + Exploitation (5 pipelined pairs in parallel)
//      Each pair: vuln agent → queue check → conditional exploit
//      No synchronization barrier - exploits start when their vuln finishes
// 5. Reporting (sequential)
```

### Activity 包装

Activities 是薄封装层，仅包含：
- 心跳循环 (heartbeat loop)
- 错误分类 (error classification)
- 容器生命周期

实际业务逻辑委托给 `services/` 层。

```typescript
// 重试配置 (生产环境)
const PRODUCTION_RETRY = {
  initialInterval: '5 minutes',
  maximumInterval: '30 minutes',
  backoffCoefficient: 2,
  maximumAttempts: 50,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'PermissionError',
    'InvalidRequestError',
    'RequestTooLargeError',
    'ConfigurationError',
    'InvalidTargetError',
    'ExecutionLimitError',
  ],
};
```

### 任务队列隔离

每次扫描创建唯一的任务队列名：
```typescript
const taskQueue = `shannon-${randomSuffix()}`;
```

Temporal 通过队列名将 Activities 路由到正确的 Worker，确保每个扫描的 Activities 不会落到错误仓库挂载的 Worker 上。

### 进度追踪

Workflow 提供 `getProgress()` 查询接口，返回当前阶段和 Agent 状态：

```typescript
interface PipelineProgress {
  phase: 'pre-recon' | 'recon' | 'vuln' | 'exploit' | 'report' | 'done';
  agents: Record&lt;AgentName, AgentStatus&gt;;
  currentAgent?: AgentName;
}
```

## Agent 执行

### Agent 定义

```typescript
// apps/worker/src/types/agents.ts
export const ALL_AGENTS = [
  'pre-recon',
  'recon',
  'injection-vuln',
  'xss-vuln',
  'auth-vuln',
  'ssrf-vuln',
  'authz-vuln',
  'injection-exploit',
  'xss-exploit',
  'auth-exploit',
  'ssrf-exploit',
  'authz-exploit',
  'report',
] as const;

export type AgentName = (typeof ALL_AGENTS)[number];
```

### 5 攻击域 Agent

| Agent | 攻击域 | 方法 |
|---|---|---|
| injection-vuln/exploit | 注入 | Source → Sink 污染追踪 |
| xss-vuln/exploit | 跨站脚本 | Sink → Source 污染追踪 |
| auth-vuln/exploit | 认证 | 安全控制验证 |
| authz-vuln/exploit | 授权 | 访问控制验证 |
| ssrf-vuln/exploit | SSRF | HTTP 客户端 URL 控制验证 |

### Agent 执行服务

```typescript
// apps/worker/src/services/agent-execution.ts
// AgentExecutionService.execute()
//
// 1. 验证前置 Agent 完成
// 2. 加载 Prompt 模板
// 3. 变量替换: TARGET_URL, CONFIG_CONTEXT
// 4. 执行 Claude Agent SDK
// 5. 解析输出
// 6. 验证交付物
// 7. 更新 session.json
// 8. 错误分类和重试
```

### 重试逻辑

- 每次 Agent 执行最多 3 次重试
- 错误分类：可重试 vs 不可重试
- 账单错误 (RateLimit, Billing) 自动退避

## AI 集成

### Claude Agent SDK

```typescript
// apps/worker/src/ai/claude-executor.ts
// 使用 @anthropic-ai/claude-agent-sdk
// - maxTurns: 10_000
// - bypassPermissions: true (代码路径规则由 settings-writer 控制)
// - 浏览器自动化: playwright-cli (-s=&lt;session&gt;)
```

### Prompt 管理

```typescript
// apps/worker/src/services/prompt-manager.ts
// 变量替换: &#123;&#123;TARGET_URL&#125;&#125;, &#123;&#123;CONFIG_CONTEXT&#125;&#125;, &#123;&#123;LOGIN_INSTRUCTIONS&#125;&#125;
// 共享部分: shared/_code-path-rules.txt, shared/_rules-of-engagement.txt
```

### 代码路径权限

`apps/worker/src/ai/settings-writer.ts` 将配置的 `rules.avoid` 写入 `~/.claude/settings.json` 的 `permissions.deny`，SDK 在 `bypassPermissions` 模式下仍强制执行这些规则。

### 浏览器自动化

- Playwright CLI 用于无头浏览器操作
- 5 个独立 Session 用于并行 Agent
- 隔离的 `.playwright-cli/` 目录

## 配置系统

### YAML 配置

```yaml
auth:
  credentials:
    username: "user"
    password: "pass"
  mfa_enabled: true
  totp_secret: "SECRET"

rules:
  avoid:
    - "/test/"
    - "*.test.ts"
  focus:
    - "/api/"

vuln_classes: [injection, xss, auth, authz, ssrf]
exploit: true
rules_of_engagement: "Allowed to test /api/ endpoints only"

report:
  min_severity: medium
  min_confidence: 0.7
  guidance: "Focus on findings affecting production"
```

### JSON Schema 验证

`apps/worker/src/config-parser.ts` 使用 JSON Schema (`config-schema.json`) 验证配置，支持：
- 类型检查
- 枚举约束 (VulnClass)
- 必填字段验证

## 类型系统

### Result&lt;T,E&gt; 类型

```typescript
// apps/worker/src/types/result.ts
export type Result&lt;T, E&gt; = Ok&lt;T&gt; | Err&lt;E&gt;;

export interface Ok&lt;T&gt; {
  readonly ok: true;
  readonly value: T;
}

export interface Err&lt;E&gt; {
  readonly ok: false;
  readonly error: E;
}
```

### 错误码

```typescript
// apps/worker/src/types/errors.ts
export enum ErrorCode {
  AuthenticationError = 'AuthenticationError',
  PermissionError = 'PermissionError',
  InvalidRequestError = 'InvalidRequestError',
  ConfigurationError = 'ConfigurationError',
  InvalidTargetError = 'InvalidTargetError',
  ExecutionLimitError = 'ExecutionLimitError',
  // ...
}
```

## Exploitation Queue

Vuln Agent 输出结构化 JSON 文件，列出待利用的漏洞：

```json
{
  "vulnerabilities": [
    {
      "type": "injection",
      "location": "/path/to/file:123",
      "method": "POST",
      "parameter": "username",
      "evidence": "User input reaches SQL query without sanitization",
      "payload": "' OR '1'='1"
    }
  ]
}
```

Exploit Agent 消费此队列，分类结果：
- `EXPLOITED`：成功利用，有证据
- `POTENTIAL`：可能存在，留作记录
- `FALSE_POSITIVE`：误报

仅 `EXPLOITED` 状态进入最终报告。

## 工作区和恢复

```typescript
// apps/worker/src/temporal/workspaces.ts
// 工作区命名: -w &lt;name&gt; 或自动从 URL+时间戳生成
// 恢复检测: loadResumeState() 验证 session.json
// 交付物检查: deliverable 存在性验证
```

`-w` 选项支持自动续跑：相同命令重复执行会恢复已有工作区状态。
