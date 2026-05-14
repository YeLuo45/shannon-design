# Temporal Orchestration

Shannon uses [Temporal](https://temporal.io) for durable workflow orchestration. Temporal provides crash recovery, queryable progress, intelligent retry, and parallel execution — critical properties for long-running penetration tests.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Temporal Server                             │
│                   (shannon-temporal:7233)                        │
│                                                                  │
│  ┌────────────── Workflow ──────────────────────────────────┐   │
│  │  pentestPipeline(input: PipelineInput): PipelineState     │   │
│  │                                                          │   │
│  │  1. Preflight Validation                                  │   │
│  │  2. Pre-Recon ─────────────────────────────────────►    │   │
│  │  3. Recon ────────────────────────────────────────►     │   │
│  │  4. [5x Vuln→Exploit Pipelines in parallel] ─────────►   │   │
│  │  5. Report ─────────────────────────────────────────►   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────── Queryable State ──────────────────────────┐   │
│  │  getProgress() → PipelineProgress                        │   │
│  │  (status, currentPhase, currentAgent, completedAgents)   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Worker 1 │    │ Worker 2 │    │ Worker N │
        │ Queue A │    │ Queue B  │    │ Queue N  │
        └──────────┘    └──────────┘    └──────────┘
```

## Workflows

### Main Workflow: `pentestPipeline`

The core workflow function `pentestPipeline(input: PipelineInput): Promise<PipelineState>` orchestrates the entire pipeline.

**Key properties:**
- **Queryable** — External callers can poll `getProgress()` for real-time status without blocking
- **Retryable** — Automatic retry with backoff for transient/billing errors
- **Crash-safe** — Workflow state is durable; a worker crash does not lose progress
- **Parallel** — Vuln/exploit pairs execute concurrently with configurable concurrency limits

**Workflow-level retry configuration (production):**
```typescript
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

**Alternative presets:**
- `subscription` — Extended timeouts for 5h+ rolling rate limit windows (up to 100 attempts, 8h timeout)
- Testing (`--pipeline-testing`) — Fast 10s intervals, 5 attempts max

### Workflow Entry Point

```typescript
export async function pentestPipelineWorkflow(input: PipelineInput): Promise<PipelineState> {
  return pentestPipeline(input);
}
```

## Activities

Activities are the **thin Temporal wrappers** around service calls. Each activity handles:

1. **Heartbeat loop** — 2-second interval signals worker liveness to the Temporal server
2. **Error classification** — Maps errors to retryable vs. non-retryable `ApplicationFailure`
3. **Container lifecycle** — Gets or creates the per-scan container
4. **Audit logging** — Records phase transitions and agent completion

**Business logic is deliberately NOT in activities.** All non-Temporal logic lives in the services layer. Activities only handle Temporal-specific concerns.

### Activity Categories

| Category | Activities | Description |
|----------|------------|-------------|
| **Agent Execution** | `runPreReconAgent`, `runReconAgent`, `runInjectionVulnAgent`, `runXssVulnAgent`, `runAuthVulnAgent`, `runSsrfVulnAgent`, `runAuthzVulnAgent`, `runInjectionExploitAgent`, `runXssExploitAgent`, `runAuthExploitAgent`, `runSsrfExploitAgent`, `runAuthzExploitAgent`, `runReportAgent` | Execute individual agents via the SDK |
| **Container** | `syncCodePathDenyRules`, `initDeliverableGit` | Container setup before agent runs |
| **Validation** | `runPreflightValidation` | Pre-flight checks (repo, config, credentials, URL) |
| **Queue** | `checkExploitationQueue`, `mergeFindingsIntoQueue` | Exploitation readiness assessment |
| **Reporting** | `assembleReportActivity`, `injectReportMetadataActivity`, `generateReportOutputActivity` | Report assembly and enrichment |
| **Resume** | `loadResumeState`, `restoreGitCheckpoint`, `recordResumeAttempt`, `persistOrValidateRunScope` | Resume and checkpoint management |
| **Checkpoint** | `saveCheckpoint` | Pipeline state persistence |
| **Logging** | `logPhaseTransition`, `logWorkflowComplete` | Audit trail |

## Worker

### Ephemeral Per-Scan Workers

Each scan spawns an **ephemeral worker container** (`docker run --rm`), which:
- Has a **unique task queue** (e.g., `shannon-queue-a1b2c3d4`)
- Connects to the shared Temporal server
- Processes only activities for that specific scan
- Self-destructs on completion (`--rm` flag)

This architecture ensures:
- **Isolation** — No cross-scan state pollution
- **Parallelism** — Multiple scans can run concurrently without interference
- **Reproducibility** — Each scan has a pristine environment

### Worker Entry Point

The worker binary is the container entrypoint. It:
1. Connects to Temporal server at `localhost:7233`
2. Registers workflow and activity handlers
3. Polls its task queue indefinitely
4. Cleans up on SIGTERM

## Crash Recovery

### What Survives a Crash

| Component | Durability | Notes |
|-----------|------------|-------|
| Workflow state | ✅ Temporal Server | Workflow continues from last checkpoint on any worker |
| Agent deliverables | ✅ Disk (workspaces/) | Written before agent completes; restored on resume |
| Git checkpoints | ✅ Deliverables git | Created after each agent; reset to latest on resume |
| session.json | ✅ Disk | Tracks completed agents and resume metadata |

### Resume Flow

```
1. loadResumeState(workspaceName)
   ├── Validate session.json exists and URL matches
   ├── Cross-check completed agents against deliverable files on disk
   └── Return ResumeState { completedAgents, checkpointHash, originalWorkflowId }

2. restoreGitCheckpoint(repoPath, checkpointHash, incompleteAgents)
   ├── git reset --hard to checkpointHash
   ├── git clean -fd to remove untracked files
   └── Delete partial deliverables for incomplete agents

3. persistOrValidateRunScope(vulnClasses, exploit)
   ├── First run: write scope into session.json
   └── Resume: validate scope matches; throw ScopeMismatchError if not

4. Re-run only incomplete agents (completed agents are skipped)
```

### Concurrency Control

Vuln/exploit pairs run with a configurable concurrency limit:

```typescript
const maxConcurrent = input.pipelineConfig?.max_concurrent_pipelines ?? 5;
const pipelineResults = await runWithConcurrencyLimit(pipelineThunks, maxConcurrent);
```

When `maxConcurrent >= 5` (default), all five vulnerability types run in parallel. Set lower to limit resource usage.

## Progress Query

External clients can poll workflow progress without blocking:

```typescript
export const getProgress = defineQuery<PipelineProgress>('getProgress');

// Returns:
interface PipelineProgress extends PipelineState {
  workflowId: string;
  elapsedMs: number;
}

interface PipelineState {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentPhase: string | null;
  currentAgent: string | null;
  completedAgents: string[];
  failedAgent: string | null;
  error: string | null;
  startTime: number;
  agentMetrics: Record<string, AgentMetrics>;
  summary: PipelineSummary | null;
}
```

The CLI `status` command and Temporal Web UI (`http://localhost:8233`) both use this query.

## Error Handling

Errors are classified at the activity boundary:

```typescript
// Retryable errors (transient/billing)
classifyErrorForTemporal(error) → { retryable: true, type: 'RateLimitError' }

// Non-retryable errors (permanent)
throw ApplicationFailure.nonRetryable(message, 'ConfigurationError', details)
```

The workflow catch block handles `isCancellation()` specially — returning a structured `cancelled` state rather than throwing, enabling graceful termination.
