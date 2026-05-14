# Pipeline Architecture

Shannon executes a five-phase penetration testing pipeline, orchestrated by Temporal as a durable workflow. Each phase builds on the outputs of previous phases, progressively deepening the security analysis.

## Phase Overview

| Phase | Agent | Execution | Description |
|-------|-------|-----------|-------------|
| **Pre-Reconnaissance** | `pre-recon` | Sequential | Source code analysis to build the architectural baseline |
| **Reconnaissance** | `recon` | Sequential | Attack surface mapping from initial findings |
| **Vulnerability Analysis** | 5 parallel agents | Parallel | Injection, XSS, Auth, AuthZ, SSRF analysis |
| **Exploitation** | 5 parallel agents | Parallel (conditional) | Exploits confirmed vulnerabilities |
| **Reporting** | `report` | Sequential | Executive-level security report assembly |

## Data Flow

```
Target URL + Repo → Pre-Recon → Recon → [5x Vuln Analysis → Queue Check → Conditional Exploit] → Report
```

Each vulnerability type runs as an independent pipeline:
1. **Vuln agent** runs first, producing findings into an exploitation queue
2. **Queue check** determines if findings meet the exploitation threshold
3. **Exploit agent** runs conditionally only if `exploit=true` AND the queue contains actionable findings

Exploits begin immediately when their parent vulnerability analysis finishes — there is no global synchronization barrier. This pipelining maximizes throughput while respecting dependency order within each vulnerability class.

## Phase Details

### Phase 1: Pre-Reconnaissance

The `pre-recon` agent analyzes the target application's source code to establish an architectural baseline. It identifies:
- Framework and runtime components
- Authentication and authorization mechanisms
- Data flow patterns and entry points
- Third-party integrations

Output: `pre-recon.json` — structured findings about the application's attack surface topology.

### Phase 2: Reconnaissance

The `recon` agent builds on the pre-recon baseline to map the active attack surface:
- URL routing and parameter structures
- API endpoints and their expected inputs
- Session management implementation
- Input validation patterns

Output: `recon.json` — enumerated attack surface with categorized endpoints.

### Phase 3: Vulnerability Analysis (Parallel)

Five agents run concurrently, each specializing in one vulnerability class:

| Agent | Focus |
|-------|-------|
| `injection-vuln` | SQL, NoSQL, OS, and LDAP injection points |
| `xss-vuln` | Cross-site scripting in reflected, stored, and DOM contexts |
| `auth-vuln` | Authentication weaknesses and credential handling |
| `authz-vuln` | Authorization bypass and privilege escalation |
| `ssrf-vuln` | Server-side request forgery entry points |

Each agent reads the architectural baseline from `pre-recon.json` and `recon.json`, then performs deep analysis against the codebase. Output is written to `*_exploitation_queue.json` for consumption by the exploitation phase.

### Phase 4: Exploitation (Conditional)

For each vulnerability class, the pipeline checks if the exploitation queue contains actionable findings:

```typescript
interface ExploitationDecision {
  shouldExploit: boolean;
  vulnerabilityCount: number;
}
```

Exploitation is skipped when:
- `exploit=false` was set in configuration
- The queue contains no findings above the confidence threshold
- The agent previously completed successfully (resume case)

When enabled, the exploit agent attempts to demonstrate the vulnerability's real-world impact, writing `*_exploitation_evidence.md` as proof.

### Phase 5: Reporting

The reporting phase assembles the final deliverable:

1. **Queue rendering** — When `exploit=false`, each `*_exploitation_queue.json` is deterministically converted to `*_findings.md` (no LLM involved)
2. **Report assembly** — Per-class deliverables are concatenated into `pentest-report.md`
3. **Executive summary** — The `report` agent adds high-level narrative, risk ratings, and remediation guidance
4. **Metadata injection** — Model information, timing, and cost totals are stamped into the final document

Output: `pentest-report.md` in the deliverables directory.

## Resumability

The pipeline is fully resumable. Each agent writes its output to disk before completing, and the workflow state is persisted via Temporal's durable execution. If a scan is interrupted:

1. The workspace retains all completed deliverables
2. A git checkpoint is created after each agent completes
3. Resume reloads the workspace, restores the git checkpoint, and re-runs only incomplete agents

Workspaces are named via `-w <name>` or auto-generated from URL + timestamp. Use `./shannon workspaces` to list all workspaces and `./shannon logs <workspace>` to inspect progress.

## Configuration

Pipeline behavior is controlled via YAML configuration:

```yaml
vuln_classes: [injection, xss, auth, authz, ssrf]  # Run subset of vuln classes
exploit: true                                       # Enable exploitation phase
pipeline:
  retry_preset: default                             # or 'subscription' for extended timeouts
  max_concurrent_pipelines: 5                      # Concurrency limit for vuln/exploit pairs
report:
  min_severity: medium
  min_confidence: medium
rules:
  avoid:
    - type: code_path
      value: /vendor/
      description: "Third-party code"
  focus:
    - type: url_path
      value: /api/
      description: "API endpoints"
```

Run scope (vuln_classes + exploit) is locked into `session.json` on first execution. Resuming with a different scope throws a `ScopeMismatchError`.
