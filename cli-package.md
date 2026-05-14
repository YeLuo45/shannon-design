---
title: CLI Package
---

# CLI Package

## 概述

`apps/cli/` 作为 `@keygraph/shannon` 发布到 npm，是用户与 Shannon 交互的唯一入口。CLI 仅负责 Docker 编排，不包含任何 Temporal SDK、业务逻辑或 Prompts。

## 命令列表

| 命令 | 模式 | 说明 |
|---|---|---|
| `setup` | npx only | 交互式凭证配置向导 |
| `start -u &lt;url&gt; -r &lt;repo&gt;` | both | 启动渗透测试扫描 |
| `stop [--clean]` | both | 停止容器 (--clean 清理卷) |
| `logs &lt;workspace&gt;` | both | 尾随 Workflow 日志 |
| `workspaces` | both | 列出所有工作区 |
| `status` | both | 显示运行中的 Worker |
| `build [--no-cache]` | local only | 构建 Worker 镜像 |
| `uninstall` | npx only | 删除 ~/.shannon/ 及所有数据 |
| `info` | both | 显示启动画面 |

### start 命令选项

```
-u, --url &lt;url&gt;           目标 URL (必填)
-r, --repo &lt;path&gt;         仓库路径或裸名 (必填)
-c, --config &lt;path&gt;       YAML 配置文件
-o, --output &lt;path&gt;       交付物输出目录
-w, --workspace &lt;name&gt;    命名工作区 (自动续跑)
    --pipeline-testing     使用最小化 Prompts，快速测试
    --debug                退出后保留 Worker 容器用于日志检查
```

## 双模式机制

Shannon 支持两种 CLI 模式，根据当前工作目录自动检测：

```typescript
// apps/cli/src/mode.ts
export function getMode(): 'local' | 'npx' {
  return process.env.SHANNON_LOCAL === '1' ? 'local' : 'npx';
}
```

**Local 模式激活条件**：`SHANNON_LOCAL=1` 环境变量由 `./shannon` 入口点设置。否则为 npx 模式。

| 特性 | npx | Local |
|---|---|---|
| 镜像来源 | Docker Hub (keygraph/shannon:version) | 本地构建 (shannon-worker) |
| 状态目录 | ~/.shannon/ | ./workspaces/ |
| 凭证 | ~/.shannon/config.toml (via shn setup) | ./.env |
| Prompts | 打包在镜像中 | 从 ./apps/worker/prompts/ 挂载 |
| build 命令 | 不可用 | 构建本地镜像 |
| setup 命令 | 可用 | 不可用 (使用 .env) |

## 状态管理

### npx 模式 (`~/.shannon/`)

```
~/.shannon/
├── config.toml          # 凭证和配置 (smol-toml 解析)
├── workspaces/          # 扫描工作区
│   └── {hostname}_{sessionId}/
│       ├── session.json
│       ├── workflow.log
│       └── deliverables/
└── .claude/             # Claude SDK 设置
```

### Local 模式 (`./workspaces/`)

```
./workspaces/
└── {hostname}_{sessionId}/
    ├── session.json
    ├── workflow.log
    └── deliverables/
```

凭证优先级 (npx)：环境变量 → ~/.shannon/config.toml

凭证优先级 (local)：环境变量 → ./.env

## 配置解析

### 级联配置 (npx 模式)

```typescript
// apps/cli/src/config/resolver.ts
// 优先级: 环境变量 > ~/.shannon/config.toml
```

配置写入使用安全的 `0o600` 权限，仅所有者可读写。

### YAML 配置 (共享)

```yaml
# 认证配置
auth:
  totp_secret: "SECRET"
  mfa_enabled: true

# URL/代码规则
rules:
  avoid:
    - "/test/"
    - "*.test.ts"
  focus:
    - "/api/"

# 扫描范围
vuln_classes: [injection, xss, auth, authz, ssrf]
exploit: true

# 报告过滤
report:
  min_severity: medium
  min_confidence: 0.7
```

配置通过 JSON Schema (`config-schema.json`) 进行验证。

## Docker 编排

### 镜像管理

```typescript
// apps/cli/src/docker.ts
export function ensureImage(version: string): void {
  const image = getWorkerImage(version);
  if (exists) return;
  // npx: docker pull; local: auto build
}
```

### Worker 容器启动

每个扫描启动一个独立的 Ephemeral Worker 容器：

```typescript
spawnWorker({
  version,
  url,
  repo: { hostPath, containerPath },
  workspacesDir,
  taskQueue: `shannon-${randomSuffix()}`,  // 每次扫描独立队列
  containerName: `shannon-worker-${randomSuffix()}`,
  envFlags,
  config,
  pipelineTesting,
  debug,
})
```

关键参数：
- `--network shannon-net`：加入专用网络
- `--shm-size 2gb`：共享内存 2GB
- `--security-opt seccomp=unconfined`：允许完整系统调用
- Linux：`--add-host host.docker.internal:host-gateway`

### 卷挂载策略

```
宿主机                          容器内
─────────────────────────────────────────────
{workspacesDir}        →  /app/workspaces       (读写)
{repo.hostPath}        →  {repo.containerPath}  (只读，代码)
workspace/deliverables →  {repo}/.shannon/deliverables  (可写覆盖)
workspace/scratchpad  →  {repo}/.shannon/scratchpad    (可写覆盖)
workspace/.playwright-cli → {repo}/.shannon/.playwright-cli
[local mode] prompts  →  /app/apps/worker/prompts (只读，可编辑)
[config]              →  {config.containerPath}  (只读)
[output]              →  /app/output             (交付物复制)
```

## 凭证处理

### npx 模式

交互式 TUI 向导 (`@clack/prompts`) 引导用户配置：
- API Provider 选择 (Anthropic 等)
- API Key 输入
- 可选：Google SaaS Key (用于 TOTP 生成)

配置持久化为 TOML 文件。

### Local 模式

直接使用 `.env` 文件：

```bash
ANTHROPIC_API_KEY=your-key
GOOGLE_SA_KEY=/path/to/google-sa-key.json  # 可选
```

## 开发相关

### 构建 TypeScript (开发)

```bash
pnpm run build     # 通过 Turborepo 构建所有包
pnpm run check     # 类型检查
pnpm biome         # Lint + Format + Import 排序
pnpm biome:fix     # 自动修复
```

### Biome 配置

- 单引号
- 分号
- 尾随逗号
- 2 空格缩进
- 120 字符行宽
