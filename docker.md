# Docker Architecture

Shannon uses Docker for infrastructure isolation. The architecture separates the long-running Temporal server from ephemeral per-scan worker containers.

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| `shannon-temporal` | `docker-compose` service | Temporal server (port 7233 gRPC, 8233 Web UI) |
| `shannon-worker-*` | Ephemeral `docker run` container | Per-scan worker that executes the pipeline |

## Network

All components share the `shannon-net` Docker network:

```
┌──────────────────────────────────────────────────────────────────┐
│                     shannon-net                                   │
│                                                                  │
│   ┌─────────────────────┐         ┌──────────────────────────┐ │
│   │  shannon-temporal    │         │   shannon-worker-a1b2     │ │
│   │  (docker-compose)   │◄────────│   (docker run --rm)       │ │
│   │  port: 7233, 8233   │ gRPC    │   task-queue: shannon-...  │ │
│   └─────────────────────┘         └──────────────────────────┘ │
│                                                                  │
│                  ┌───────────────────────────────────┐           │
│                  │         Target Repository          │           │
│                  │  /repo/:ro  .shannon/:rw         │           │
│                  └───────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### Network Configuration

The `shannon-net` network is created by `docker compose`. In npx mode it uses the bundled compose file; in local mode it uses `docker-compose.yml` at the repo root.

On Linux without Podman, the CLI adds `--add-host host.docker.internal:host-gateway` to enable the worker container to reach the host machine.

## Docker Compose (Infrastructure)

### Services

**Temporal Server (`shannon-temporal`)**
- Image: `temporalio/auto-setup:latest`
- Ports: `7233` (gRPC), `8233` (Web UI)
- Environment: Default Temporal auto-setup configuration
- Volumes: `temporal-db` (SQLite persistence)

```yaml
services:
  temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "7233:7233"
      - "8233:8233"
    environment:
      - DB=sqlite
      - DB_PATH=/tmp/temporal
    volumes:
      - temporal-db:/tmp/temporal
    networks:
      - shannon-net

volumes:
  temporal-db:

networks:
  shannon-net:
    name: shannon-net
```

### Starting Infrastructure

```bash
# The CLI automatically starts infrastructure on `start` command
./shannon start -u https://example.com -r ./my-repo

# Or manually
docker compose -f compose.yml up -d
docker compose -f docker-compose.yml up -d  # local mode
```

## Worker Containers (Ephemeral)

Each scan spawns a **new ephemeral container** that is destroyed on exit:

```bash
docker run --rm \
  --name shannon-worker-a1b2c3d4 \
  --network shannon-net \
  --add-host host.docker.internal:host-gateway \
  -v /path/to/workspaces:/app/workspaces \
  -v /path/to/repo:/repo:ro \
  -v /path/to/workspace/deliverables:/repo/.shannon/deliverables \
  --shm-size 2gb \
  --security-opt seccomp=unconfined \
  keygraph/shannon:latest \
  node worker/dist/temporal/worker.js \
  https://example.com /repo \
  --task-queue shannon-queue-a1b2c3d4 \
  --workspace my-workspace
```

### Container Lifecycle

| Event | Action |
|-------|--------|
| Scan starts | CLI spawns worker via `docker run --rm -d` |
| Scan completes | Worker exits, container auto-destroyed (`--rm`) |
| Scan crashes | Container dies, Temporal reschedules workflow on new worker |
| CLI interrupted | Worker continues running; resume with same command |

### Volume Mounts

| Mount | Mode | Purpose |
|-------|------|---------|
| `/app/workspaces` | rw | Audit logs, session.json, workspace data |
| `/repo` (target) | ro | Target codebase (read-only to prevent accidental modification) |
| `/repo/.shannon/deliverables` | rw | Agent outputs, checkpoints, git repo |
| `/repo/.shannon/scratchpad` | rw | Scratch data for agent operations |
| `/repo/.shannon/.playwright-cli` | rw | Playwright session data |
| `/app/prompts` | ro | Prompt templates (local mode only, live-editable) |
| `/app/credentials/google-sa-key.json` | ro | GCP credentials (if configured) |
| `/app/output` | rw | Final deliverables copy destination |

### Container Resources

```bash
--shm-size 2gb              # Shared memory for Playwright
--security-opt seccomp=unconfined  # Required for Playwright browser automation
```

## Build

### Worker Image

The worker image is built using a 2-stage Dockerfile:

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: Runtime (Chainguard Wolfi)
FROM cgr.dev/chainguard/wolfi-base:latest
COPY --from=builder /app/worker/dist /app/worker/dist
COPY --from=builder /app/worker/prompts /app/worker/prompts
WORKDIR /app
CMD ["node", "worker/dist/temporal/worker.js"]
```

### Local Build (Local Mode)

```bash
./shannon build           # Build shannon-worker image
./shannon build --no-cache
```

### NPX Mode (Docker Hub)

```bash
# No local build needed; CLI pulls from Docker Hub
npx @keygraph/shannon start -u https://example.com -r ./my-repo
```

The CLI checks for the image before spawning. In local mode, it auto-builds if missing. In npx mode, it pulls `keygraph/shannon:latest`.

## Cleanup

### Stop Workers

```bash
./shannon stop              # Stop workers, preserve workflow data
./shannon stop --clean      # Full cleanup including volumes
```

### Stop Infrastructure

```bash
docker compose -f compose.yml down      # npx mode
docker compose -f docker-compose.yml down              # local mode
docker compose -f docker-compose.yml down -v           # with volumes
```

### Image Pruning

Old `keygraph/shannon` image tags are automatically pruned on each pull to save disk space.

## Security Considerations

### Read-Only Codebase

The target repository is mounted **read-only** (`/:ro`). Agent write operations go to `.shannon/deliverables/` which is a separate rw mount overlaid onto the repo.

### Container Isolation

- Workers run with `--network shannon-net` (isolated from other networks)
- No privileged mode required
- `seccomp=unconfined` only needed for Playwright browser automation
- Shared memory size increased for Playwright stability

### Host Access

On Linux, `--add-host host.docker.internal:host-gateway` enables the worker to reach services on the host machine (e.g., a local dev server).

## Environment Variables

Workers receive environment variables from the CLI:

| Variable | Purpose |
|----------|---------|
| `SHANNON_WORKER_ROOT` | Worker root for resolving relative paths |
| `SHANNON_HOST_UID` | Host user ID (for permission mapping on Linux bind mounts) |
| `SHANNON_HOST_GID` | Host group ID (for permission mapping on Linux bind mounts) |
| `ANTHROPIC_API_KEY` | API key for LLM provider |
| `SHANNON_LOCAL` | Set to `1` for local development mode |
