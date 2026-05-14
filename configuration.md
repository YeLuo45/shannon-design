# Configuration System

Shannon uses YAML configuration files with JSON Schema validation. Configuration controls the pipeline scope, authentication, rules of engagement, and reporting thresholds.

## Configuration File

### Location

| Mode | Config Path |
|------|-------------|
| Local | `-c <file>` or default config |
| NPX | `-c <file>` or `~/.shannon/config.yaml` |

### Schema

Full schema is validated via the config-parser against the JSON Schema.

### Full Configuration Reference

```yaml
# ─────────────────────────────────────────────────────────────
# Scope — which vulnerability classes to analyze
# ─────────────────────────────────────────────────────────────
vuln_classes:
  - injection    # SQL, NoSQL, OS, LDAP injection
  - xss          # Cross-site scripting
  - auth         # Authentication weaknesses
  - authz        # Authorization bypass
  - ssrf         # Server-side request forgery

# ─────────────────────────────────────────────────────────────
# Exploitation — whether to run exploit agents
# ─────────────────────────────────────────────────────────────
exploit: true    # or false to skip exploitation phase

# ─────────────────────────────────────────────────────────────
# Rules — focus or avoid specific targets
# ─────────────────────────────────────────────────────────────
rules:
  avoid:
    - type: code_path
      value: /vendor/
      description: "Third-party code — out of scope"
    - type: code_path
      value: /node_modules/
      description: "Dependencies — out of scope"
    - type: url_path
      value: /assets/
      description: "Static assets — unlikely to have vulnerabilities"
  focus:
    - type: url_path
      value: /api/
      description: "API endpoints — primary attack surface"
    - type: code_path
      value: /src/
      description: "Application source code"

# ─────────────────────────────────────────────────────────────
# Authentication — target login credentials
# ─────────────────────────────────────────────────────────────
authentication:
  login_type: form          # form | sso | api | basic
  login_url: https://example.com/login
  credentials:
    username: test@example.com
    password: supersecretpassword
    totp_secret: JBSWY3DPEHPK3PXP   # Optional TOTP for MFA
  login_flow:
    - step: navigate
      url: "&#123;&#123;TARGET_URL&#125;&#125;/login"
    - step: fill
      selector: "#username"
      value: "&#123;&#123;CRED_USERNAME&#125;&#125;"
    - step: fill
      selector: "#password"
      value: "&#123;&#123;CRED_PASSWORD&#125;&#125;"
    - step: submit
      selector: "button[type=submit]"
  success_condition:
    type: url_contains      # url_contains | element_present | url_equals_exactly | text_contains
    value: /dashboard

# ─────────────────────────────────────────────────────────────
# Pipeline — execution parameters
# ─────────────────────────────────────────────────────────────
pipeline:
  retry_preset: default     # default | subscription
  max_concurrent_pipelines: 5

# ─────────────────────────────────────────────────────────────
# Reporting — output filtering and guidance
# ─────────────────────────────────────────────────────────────
report:
  min_severity: medium      # low | medium | high | critical
  min_confidence: medium    # low | medium | high
  guidance: "Focus on vulnerabilities exploitable without special privileges"

# ─────────────────────────────────────────────────────────────
# Rules of Engagement — free-form scope description
# ─────────────────────────────────────────────────────────────
rules_of_engagement: |
  This assessment is limited to the main application at https://example.com.
  Testing is restricted to business hours (9am-5pm UTC).
  No social engineering or physical security testing.
  Rate limiting must not be triggered.
```

## Configuration Fields

### `vuln_classes`

Array of vulnerability classes to analyze. Omit or use empty array to run all five.

| Value | Description |
|-------|-------------|
| `injection` | SQL, NoSQL, OS command, LDAP injection |
| `xss` | Reflected, stored, DOM-based XSS |
| `auth` | Authentication mechanism weaknesses |
| `authz` | Authorization bypass and privilege escalation |
| `ssrf` | Server-side request forgery |

### `exploit`

Boolean (as string `"true"` or `"false"` in YAML) controlling whether exploitation agents run.

| Value | Behavior |
|-------|----------|
| `true` | Run vuln agents → queue check → exploit if actionable |
| `false` | Run vuln agents → deterministically render findings → skip exploits |

### `rules`

Scope definition with `avoid` and `focus` rules. Rules are additive — `focus` narrows scope, `avoid` expands it.

#### Rule Types

| Type | Applies To | Example |
|------|------------|---------|
| `code_path` | Files/directories in source | `/vendor/`, `/node_modules/` |
| `url_path` | URL path prefixes | `/api/`, `/admin/` |
| `subdomain` | Subdomain patterns | `api.*`, `*.internal` |
| `domain` | Exact domains | `cdn.example.com` |
| `method` | HTTP methods | `GET`, `POST` |
| `header` | HTTP header values | `Content-Type` |
| `parameter` | Query/body parameters | `session_id` |

#### SDK Enforcement

`code_path` avoid rules are written into `~/.claude/settings.json` `permissions.deny` by `syncCodePathDenyRules` activity. The SDK enforces these at the tool layer even in `bypassPermissions` mode, ensuring agents cannot read or edit blocked paths regardless of agent configuration.

### `authentication`

Target application credentials for authenticated testing.

#### `login_type`

| Value | Description |
|-------|-------------|
| `form` | HTML form-based login |
| `sso` | Single Sign-On (SAML/OIDC) |
| `api` | API key or token-based auth |
| `basic` | HTTP Basic Authentication |

#### `totp_secret`

Base32-encoded TOTP secret for MFA-protected accounts. When provided, Shannon generates time-based one-time passwords automatically during login flows.

#### `success_condition`

How Shannon determines successful authentication:

| Type | Description |
|------|-------------|
| `url_contains` | Redirected URL contains substring |
| `url_equals_exactly` | URL matches exactly |
| `element_present` | DOM element exists |
| `text_contains` | Page contains text substring |

### `pipeline`

#### `retry_preset`

Controls activity retry behavior:

| Preset | Initial Interval | Max Interval | Max Attempts | Timeout |
|--------|------------------|--------------|--------------|---------|
| `default` | 5 min | 30 min | 50 | 2 hours |
| `subscription` | 5 min | 6 hours | 100 | 8 hours |

Use `subscription` for high-volume or long-running assessments with rolling rate limit windows.

#### `max_concurrent_pipelines`

Concurrency limit for vuln/exploit pair execution. Default: `5`. Lower values reduce resource usage.

### `report`

Filters applied during report assembly.

| Field | Values | Description |
|-------|--------|-------------|
| `min_severity` | `low`, `medium`, `high`, `critical` | Minimum severity to include |
| `min_confidence` | `low`, `medium`, `high` | Minimum confidence to include |
| `guidance` | string | Free-text guidance passed to report agent |

### `rules_of_engagement`

Free-form text describing the scope and constraints of the assessment. This is passed to agent prompts and included in the final report.

## Environment Variables

Configuration can be overridden or provided via environment variables.

### Credential Resolution

| Mode | Resolution Order |
|------|------------------|
| Local | `ANTHROPIC_API_KEY` env var → `./.env` file |
| NPX | `ANTHROPIC_API_KEY` env var → `~/.shannon/config.toml` (via `shn setup`) |

### Provider Configuration

```bash
# Anthropic (default)
ANTHROPIC_API_KEY=sk-ant-...

# AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
ANTHROPIC_API_KEY=...  # Required even for Bedrock (model selection)

# Google Vertex AI
GCP_PROJECT_ID=my-project
GCP_REGION=us-central1
# Credentials via GOOGLE_APPLICATION_CREDENTIALS env var or /app/credentials/google-sa-key.json mount

# OpenAI-compatible
ANTHROPIC_API_KEY=...   # Ignored; use auth_token
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_AUTH_TOKEN=sk-...
```

### Other Variables

| Variable | Purpose |
|----------|---------|
| `SHANNON_LOCAL` | Set to `1` for local development mode |
| `CLAUDE_ADAPTIVE_THINKING` | Set to `false` to disable adaptive thinking |
| `SHANNON_WORKER_ROOT` | Override worker root for path resolution |

## JSON Schema

The full JSON Schema (`config-schema.json`) is the authoritative reference for all configuration fields:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "vuln_classes": {
      "type": "array",
      "items": { "enum": ["injection", "xss", "auth", "authz", "ssrf"] }
    },
    "exploit": { "type": "string", "enum": ["true", "false"] },
    "rules": {
      "type": "object",
      "properties": {
        "avoid": { "type": "array", "items": { "$ref": "#/definitions/rule" } },
        "focus": { "type": "array", "items": { "$ref": "#/definitions/rule" } }
      }
    },
    "authentication": { "$ref": "#/definitions/authentication" },
    "pipeline": { "$ref": "#/definitions/pipeline" },
    "report": { "$ref": "#/definitions/report" },
    "rules_of_engagement": { "type": "string" }
  }
}
```

## Credential Storage (NPX Mode)

In NPX mode, credentials are stored securely in `~/.shannon/config.toml` with `0o600` permissions (owner read/write only). This file is created by the `shn setup` interactive wizard or can be written directly:

```toml
[credentials]
api_key = "sk-ant-..."

[providers.bedrock]
aws_region = "us-east-1"
aws_access_key_id = "..."
aws_secret_access_key = "..."

[providers.vertex]
gcp_project_id = "my-project"
gcp_region = "us-central1"
```

## Config Validation

Configuration is validated at two stages:

1. **Parse time** — YAML is parsed and validated against JSON Schema before the workflow starts. Invalid config throws `ConfigurationError` (non-retryable) immediately.

2. **Runtime** — Preflight validation (`runPreflightValidation`) checks repo accessibility, credential validity, and target URL reachability before committing to agent execution.
