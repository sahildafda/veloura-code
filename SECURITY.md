# Veloura Code Security Policy & Threat Model

This document outlines the security architecture, controls, threat mitigations, and best practices implemented in **Veloura Code**.

---

## 1. Threat Model & Security Boundaries

Veloura Code operates with full shell and filesystem capabilities within a user's development workspace. Untrusted code, malicious project dependencies, prompt injection attacks, and inadvertent secret disclosure represent real security risks.

```
[Untrusted Project / Input]
             │
             ▼
     ┌───────────────┐
     │   PathGuard   │ ──► Prevents escaping project directory
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │ CommandGuard  │ ──► Blocks or flags dangerous shell commands
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │ SecretDetector│ ──► Sanitizes API keys, tokens & credentials
     └───────┬───────┘
             │
             ▼
[Sanitized OpenRouter Request]
```

---

## 2. Security Controls

### 2.1 Path Traversal Prevention (`PathGuard`)
- All file operations (`read_file`, `write_file`, `edit_file`, `delete_file`, `move_file`) pass through `PathGuard.resolveSafe()`.
- Rejects paths containing null bytes (`\0`).
- Resolves symlinks using `fs.realpathSync` to prevent symlink bypass attacks pointing outside the project root.
- Rejects parent directory traversal (`../`) and absolute paths outside the active repository.

### 2.2 Command Interception (`CommandGuard`)
Terminal execution differentiates risk levels:
1. **Critical (Blocked Instantly)**:
   - Disk formatting (`format`, `diskpart`, `mkfs`)
   - Raw disk manipulation (`dd if=...`)
   - Piping untrusted remote scripts to shells (`curl ... | sh`, `Invoke-Expression`)
2. **High-Risk (Requires Explicit Terminal Approval)**:
   - Recursive deletion (`rm -rf`, `del /s`, `Remove-Item -Recurse`)
   - Remote Git pushes (`git push`, `git push --force`)
   - Destructive Git resets (`git reset --hard`)
   - Administrative elevation (`sudo`, `runas`)
   - Global package installations (`npm i -g`, `pip install --user`)
3. **User-Configured Allowlist / Denylist**:
   - Custom rules defined in `config.allowedCommands` and `config.deniedCommands`.

### 2.3 Secret Detection & Redaction (`SecretDetector`)
Before any message is transmitted to OpenRouter:
- Analyzes text with high-coverage regex patterns for:
  - OpenRouter API keys (`sk-or-v1-...`)
  - OpenAI / Anthropic keys (`sk-...`, `sk-ant-...`)
  - AWS Access Keys & Secrets (`AKIA...`, `aws_secret_access_key`)
  - GitHub Personal Access Tokens (`ghp_...`, `github_pat_...`)
  - Private RSA / EC Keys (`-----BEGIN RSA PRIVATE KEY-----`)
  - JWT Tokens (`eyJ...`)
  - Database connection URIs (`postgres://user:pass@host/db`)
- Automatically redacts matched secrets to `[REDACTED: <type>]`.
- Filters out `.env`, `.env.*`, `id_rsa`, and certificate files from file listings and context.

### 2.4 Protection Against Untrusted Project Instructions
- Instructions inside project files (`README.md`, `AGENT.md`, comments) are treated as **untrusted data**.
- Security policies, path boundaries, and command guard rules are enforced in native TypeScript code and cannot be overridden by model instructions.

### 2.5 Credential Storage
- API keys are never stored in plain text configuration files or committed to Git.
- On Windows: stored in **Windows Credential Manager** (`PasswordVault`).
- Fallback: encrypted using **AES-256-GCM** with a key derived from machine and user profile entropy via PBKDF2/scrypt.

---

## 3. Reporting a Vulnerability

If you discover a security issue or vulnerability in Veloura Code, please report it via private disclosure rather than opening a public issue.
