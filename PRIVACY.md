# Veloura Code Privacy Architecture & Boundary Statement

**Veloura Code** is built on a local-first privacy architecture. This document defines what data stays local, what data is transmitted, and the exact boundary with external AI providers.

---

## 1. Local-Only Storage Guarantee

The following information is stored exclusively on your local computer in your user data directory (`%LOCALAPPDATA%/veloura-code` on Windows, `~/.local/share/veloura-code` on Linux/macOS):

- OpenRouter API keys (stored in OS Credential Manager or local AES-256-GCM encrypted vault)
- Full conversation history and user prompts
- Complete task execution logs and state transitions
- Local SQLite database files (`veloura.sqlite`)
- All tool execution arguments, outputs, and latencies
- Local Git checkpoints, shadow commits, and file diffs
- Project intelligence summaries and architectural memory
- Model performance metrics

### Privacy Rules Enforced by Code:
1. **No External Databases**: Never uploads conversation history to remote cloud databases (Firebase, Supabase, MongoDB Atlas, etc.).
2. **No Cloud Sync**: No background synchronization of repositories or states.
3. **No Telemetry**: Zero analytics, telemetry, or user behavior tracking libraries.
4. **No Crash Reporting**: No automatic sending of error traces to third-party endpoints.
5. **No Whole-Repo Uploads**: Never sends entire projects or directories in bulk.

---

## 2. External AI Provider Boundary (OpenRouter)

> [!WARNING]
> AI models run on remote servers hosted or routed by OpenRouter (`https://openrouter.ai/api/v1`).
> Prompts, tool results, and code snippets selected for the task **leave your local machine** over encrypted HTTPS.

Veloura Code does **not** claim that external AI requests are local. We enforce strict data minimization before any payload leaves your machine.

### Minimization Pipeline:
1. **Targeted Context Only**: Only files explicitly read by the agent or directly relevant to the task are included.
2. **Secret Redaction**: Every outgoing message is scanned by `SecretDetector` to remove API keys, JWTs, and passwords.
3. **Ignore Rules**: Files matching `.gitignore` and `.velouraignore` are excluded from indexing and prompt context.
4. **Secret File Exclusion**: Files named `.env*`, `id_rsa*`, `*.pem`, `*.key` are strictly barred from being fed into model context.

---

## 3. Privacy Modes

### Standard Mode (Default)
- Automatically sanitizes and redacts secrets.
- Sends minimal, relevant context directly to OpenRouter.
- Fast, autonomous workflow for everyday development.

### Strict Privacy Mode
- Enabled via `veloura privacy --strict` or `veloura --strict-privacy "<task>"`.
- **Requires explicit user terminal approval (`y/n`)** before transmitting any source code or prompt to OpenRouter.
- Displays a preview of the model ID and context payload before dispatching.

---

## 4. Privacy Inspection Command

You can inspect the active privacy configuration at any time:

```bash
veloura privacy
```

To switch privacy modes:
```bash
veloura privacy --strict
veloura privacy --standard
```

To clear all local history and memory:
```bash
veloura history --clear
```
