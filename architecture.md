---
title: 架构概览
---

# 架构概览

## Monorepo 结构

```
shannon/
├── apps/
│   ├── cli/           # @keygraph/shannon (npx发布)
│   └── worker/        # @shannon/worker (私有，Temporal worker + pipeline逻辑)
├── assets/           # 静态资源 (banner、screenshot)
├── workspaces/       # 扫描工作区
└── repos/            # 本地扫描目标仓库
```

## CLI Package

`apps/cli/` 作为 `@keygraph/shannon` 发布到 npm，仅包含 Docker 编排逻辑，不含 Temporal SDK、业务逻辑或 Prompts。

| 模块 | 职责 |
|---|---|
| `index.ts` | CLI 调度器 (setup/start/stop/logs/workspaces/status/build/uninstall/info) |
| `mode.ts` | 自动检测：local 模式 (SHANNON_LOCAL=1) vs npx 模式 |
| `docker.ts` | Compose 生命周期、镜像拉取/构建、容器启动 |
| `home.ts` | 状态目录管理 (npx: ~/.shannon/，local: ./workspaces/) |
| `env.ts` | .env 加载，TOML 配置降级 (npx 模式) |
| `config/resolver.ts` | 级联配置：环境变量 → ~/.shannon/config.toml |
| `config/writer.ts` | TOML 序列化，安全文件持久化 (0o600) |
| `commands/` | 各命令处理器 |
| `infra/compose.yml` | npx 模式绑定的 Temporal compose 文件 |

## Worker Package

`apps/worker/` 包含 Temporal Worker 和完整的渗透测试 pipeline 逻辑。

| 模块 | 职责 |
|---|---|
| `paths.ts` | 集中式路径常量 (PROMPTS_DIR, CONFIGS_DIR, WORKSPACES_DIR) |
| `session-manager.ts` | Agent 定义 (AGENTS 记录) |
| `config-parser.ts` | YAML 配置解析 + JSON Schema 验证 |
| `ai/claude-executor.ts` | Claude Agent SDK 集成 + 重试逻辑 |
| `services/` | 业务逻辑层 (Temporal 无关)，Activities 委托至此 |
| `types/` | 集中类型定义：Result&lt;T,E&gt;、ErrorCode、AgentName、ActivityLogger |
| `utils/` | 共享工具 (文件 I/O、格式化、并发) |

## Docker 架构

```
┌─────────────────────────────────────────────────────────┐
│                      Host Machine                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │              shannon-net (Docker Network)         │   │
│  │  ┌─────────────────┐  ┌────────────────────┐   │   │
│  │  │ shannon-temporal │  │  shannon-worker-*  │   │   │
│  │  │   (Port 7233)    │  │  (Ephemeral per    │   │   │
│  │  │   Temporal       │  │   scan, --rm)      │   │   │
│  │  └─────────────────┘  └────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

- **Infra 容器**：仅运行 Temporal 服务 (shannon-temporal)，端口 7233/8233
- **Worker 容器**： Ephemeral `docker run --rm`，每次扫描独立容器
- **网络隔离**：专用 shannon-net，Linux 下通过 `--add-host` 访问宿主机
- **镜像来源**：npx 模式从 Docker Hub 拉取 (keygraph/shannon)，local 模式本地构建

## 5 阶段 Pipeline

```
Phase 1        Phase 2        Phase 3              Phase 4           Phase 5
Pre-Recon   →   Recon      →   Vuln Analysis  →   Exploitation  →   Reporting
(sequential)    (sequential)    (5 parallel)        (5 parallel,      (sequential)
                                                    conditional)
```

| 阶段 | Agent | 并行度 | 说明 |
|---|---|---|---|
| Pre-Recon | pre-recon | 1 | 源代码静态分析，构建架构基线 |
| Recon | recon | 1 | 攻击面映射，浏览器自动化验证 |
| Vuln Analysis | injection/xss/auth/authz/ssrf | 5 | 攻击域分析，生成 Exploitation Queue |
| Exploitation | injection/xss/auth/authz/ssrf | 5 | 条件触发，仅对 Queue 非空的漏洞进行利用 |
| Reporting | report | 1 | 执行摘要 + 技术报告 + 可操作建议 |

## Temporal 编排特性

- **持久化状态**：Crash recovery，Workflow 执行不丢失
- **查询式进度**：`getProgress()` 查询当前阶段状态
- **智能重试**：瞬态/账单错误自动退避重试 (最长30分钟间隔)
- **错误分类**：认证错误、权限错误等不可重试错误立即终止
- **流水线并行**：Vuln Agent 完成后立即启动对应 Exploit Agent，无需等待全部完成

## 双 CLI 模式

| | **npx** | **Local** |
|---|---|---|
| 安装 | 零安装 via npm | Clone repo |
| 镜像 | Docker Hub (keygraph/shannon) | 本地构建 (shannon-worker) |
| 状态目录 | ~/.shannon/ | ./workspaces/ |
| 凭证 | ~/.shannon/config.toml | ./.env |
| Prompts | 打包在 Docker 镜像 | 从 ./apps/worker/prompts/ 挂载 (可编辑) |
