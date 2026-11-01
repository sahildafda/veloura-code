# Veloura Code

> **Autonomous Local AI CLI Coding Agent powered by OpenRouter (Free Models First)**

Veloura Code is a production-grade, terminal-native autonomous coding agent. It operates directly inside your local repositories and workspaces to analyze architectures, implement features, fix bugs, run builds, execute tests, and autonomously iterate until code is verified—with a local-first privacy architecture.

```
╭──────────────────────────────────────────╮
│ Veloura Code                             │
│ Local AI Coding Agent                    │
╰──────────────────────────────────────────╯
Model: OpenRouter Free
Project: my-react-app
Privacy: STANDARD

> Add user registration and password hashing

[Planning]   Analyzing authentication dependencies...
[Executing]  Reading src/auth.ts
[Executing]  Editing src/controllers/user.ts
[Verifying]  Running automated tests...
✓ Task Finished (Completed)
```

---

## Key Features

- **Autonomous Agent Loop**: Understands projects, generates multi-step plans, executes tools, evaluates outcomes, and self-heals failing tests iteratively (up to 50 iterations by default).
- **OpenRouter & Free Models**: Connects to OpenRouter (`https://openrouter.ai/api/v1`) with dynamic discovery of 0-cost free models (`qwen/qwen-2.5-coder-32b-instruct:free`, `meta-llama/llama-3.3-70b-instruct:free`, `deepseek/deepseek-r1:free`, `openrouter/free`).
- **Intelligent Model Router**: Classifies tasks (planning, code generation, editing, debugging, testing, refactoring) and automatically fails over across a fallback chain when encountering rate limits (HTTP 429) or timeouts.
- **Surgical File Editing Engine**: Targeted replacements and unified diff patching. SHA-256 concurrency tracking prevents overwriting your active changes.
- **Local-First Privacy Architecture**: No telemetry, no cloud sync, no remote database. Conversation history, memory, logs, and audit trails reside exclusively in a local SQLite database (`%LOCALAPPDATA%/veloura-code` on Windows, `~/.local/share/veloura-code` on Linux/macOS).
- **Dual Privacy Modes**:
  - **Standard**: Automatic redaction of secrets, API keys, passwords, and `.env` files.
  - **Strict**: Requires explicit user confirmation before any prompt or code snippet is transmitted to OpenRouter.
- **Git Checkpoints & Rollback**: Automatically creates local commit checkpoints before mutating files. Roll back changes at any point without touching unrelated work.
- **Native Cross-Platform UI**: Interactive Ink (React for terminal) interface with live state badges, tool spinners, token counters, and prompt inputs, plus a headless `--non-interactive` mode for CI/CD scripting.

---

## Installation

### Run Instantly with NPX (No Install Required)
```bash
npx veloura
```

### Install Globally via NPM
```bash
npm install -g veloura-code
```

### Or Use as a TypeScript/JavaScript Library in Your Project
```bash
npm install veloura-code
```

---

## Quick Start & OpenRouter Authentication

### 1. Configure OpenRouter API Key
Get a free API key from [OpenRouter.ai](https://openrouter.ai/keys). Then run:

```bash
veloura auth
```

Paste your OpenRouter API key when prompted. The key is securely stored in your operating system's native credential store (Windows Credential Manager / macOS Keychain / Linux Secret Service) with a machine-bound AES-256-GCM encrypted local fallback.

Alternatively, set the environment variable:
```bash
# Windows PowerShell
$env:OPENROUTER_API_KEY="sk-or-v1-..."

# Bash / Zsh
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 2. Verify System Health
Run the built-in diagnostic doctor:
```bash
veloura doctor
```

### 3. Launch an Autonomous Coding Task
Navigate to any project directory (React, Node, Express, Python, Rust, Java, etc.) and run:

```bash
# Interactive Mode
veloura

# Direct Prompt Execution
veloura "Create a React modal component with TypeScript props"

# Override Model
veloura --model qwen/qwen-2.5-coder-32b-instruct:free "Refactor database queries"

# Strict Privacy Mode (inspect and approve every outgoing request)
veloura --strict-privacy "Analyze authentication logic"

# Non-Interactive / Scripting Mode
veloura --non-interactive "Run build and fix any syntax errors"
```

---

## Dynamic Free Models Discovery

Veloura dynamically discovers free models via the OpenRouter API:

```bash
# View available free models
veloura models --free

# Force refresh model catalog from OpenRouter
veloura models --refresh

# Set a persistent default model
veloura models --set qwen/qwen-2.5-coder-32b-instruct:free
```

### Supported Free Models
- `openrouter/free` (Automatic OpenRouter routing)
- `qwen/qwen-2.5-coder-32b-instruct:free` (Specialized in programming & code review)
- `meta-llama/llama-3.3-70b-instruct:free` (Broad reasoning & architecture analysis)
- `google/gemini-2.0-flash-exp:free` (Ultra-low latency & 1M context window)
- `deepseek/deepseek-r1:free` (Complex mathematical & algorithmic reasoning)
- `mistralai/mistral-small-24b-instruct-2501:free` (Concise refactoring)

---

## Interactive Continuous Chat & Model Switcher

When you run `veloura` inside any project directory, it launches a persistent, continuous full-terminal chat workspace:

```
╭────────────────────────────────────────────────────────────────────────────╮
│  ✦ VELOURA CODE  ─  Autonomous AI Engineering Environment                  │
│  Model: qwen-2.5-coder-32b [FREE]  │  Project: my-app  │  Privacy: STANDARD │
╰────────────────────────────────────────────────────────────────────────────╯
[Enter] Send  │  [/model] Switch Model  │  [/diff] View Changes  │  [/help] Help  │  [Ctrl+C] Exit

✦ Welcome to Veloura Code! Ready in my-app. Type your prompt or /help for commands.

╭─ 👤 YOU ───────────────────────────────────────────────────────────────────
│ Create a fastify server with a health check endpoint
╰────────────────────────────────────────────────────────────────────────────

╭─ ✦ VELOURA (qwen-2.5-coder-32b:free) ──────────────────────────────────────
│ I'll inspect dependencies and create server.ts with a /health check route.
│ 
│ Executed Tools:
│   ✔ detect_project () [2ms]
│   ✔ write_file (path="src/server.ts") [15ms]
│   ✔ run_lint () [850ms]
│ 
│ ✏ Modified: src/server.ts
│ 
│ The Fastify server is created and ready!
╰────────────────────────────────────────────────────────────────────────────

✦ veloura (qwen-2.5-coder-32b:free) > Add Swagger documentation to the server...
```

### In-Chat Slash Commands
Type slash commands directly in the interactive prompt anytime:

- `/model` - Open interactive free model selector (navigate with arrow keys & Enter)
- `/model <id_or_number>` - Immediately switch model (e.g. `/model 1`, `/model llama`, `/model deepseek/deepseek-r1:free`)
- `/free` - Show the list of available free OpenRouter models with numbers
- `/diff` - View uncommitted changes made during your session
- `/checkpoint [message]` - Create a safe local Git commit checkpoint
- `/rollback [id]` - Revert project files to a previous checkpoint
- `/status` - Show project intelligence, language detection, and Git branch status
- `/clear` - Clear the terminal chat screen
- `/help` - Show command cheat-sheet
- `/exit` or `/quit` - Cleanly exit the chat session

---

## Privacy Notice & Data Boundary

> [!IMPORTANT]
> **OpenRouter is an external service.**
> When using Veloura Code, prompts, code snippets relevant to the task, and tool output are transmitted across HTTPS to `https://openrouter.ai/api/v1`.
> 
> While Veloura Code enforces **local-first privacy** (all conversations, database records, and logs remain on your local disk), data submitted to AI models leaves your machine.

### Local-Only Safeguards:
1. **Secret Redaction**: Every outgoing message passes through `SecretDetector` regex filters, masking API keys, JWTs, private RSA keys, and database connection strings.
2. **File Boundary**: Respects `.gitignore` and `.velouraignore`. Never reads `.env` files, certificates, or keys into model context.
3. **Strict Privacy Mode**: Toggle with `veloura privacy --strict` to require explicit `[y/n]` terminal approval before any source code leaves your computer.
4. **Zero Telemetry**: No tracking, analytics, or background telemetry.

---

## Architecture Overview

```
Terminal User
     │
┌────▼─────────────────────────────────────────────────┐
│              Veloura Code CLI / Ink React UI         │
└────┬─────────────────────────────────────────────┬───┘
     │                                             │
┌────▼──────────────────────┐         ┌────────────▼──────────────┐
│  Autonomous Agent Engine  │         │   Privacy & Security Guard │
│  - Task State Machine     │         │   - Path Traversal Guard   │
│  - Multi-turn Planner     │         │   - Secret Redactor        │
│  - Self-Healing Verifier  │         │   - Destructive Cmd Guard  │
└────┬──────────────────────┘         └───────────────────────────┘
     │
┌────▼──────────────────────┐         ┌───────────────────────────┐
│   Agent Tools (17 Tools)  │         │   Intelligent Model Router│
│   - Filesystem & Diff     │◄────────┤   - Task Classification   │
│   - Terminal Execution    │         │   - Fallback Chain        │
│   - Git Checkpoints       │         │   - Rate Limit Recovery   │
│   - Project Intelligence  │         └────────────┬──────────────┘
└────┬──────────────────────┘                      │
     │                                ┌────────────▼──────────────┐
┌────▼──────────────────────┐         │   OpenRouter API Client   │
│   Local SQLite Database   │         │   (https://openrouter.ai) │
│   - History & Messages    │         └───────────────────────────┘
│   - Checkpoints & Diffs   │
│   - Project Memory        │
└───────────────────────────┘
```

---

## Programmatic Library Usage

You can import and use Veloura Code directly in your Node.js or TypeScript applications:

```typescript
import {
  AgentEngine,
  ConfigManager,
  CredentialManager,
  LocalDatabase,
  ProjectDetector,
  GitManager,
  OpenRouterClient,
  ModelRouter,
  ModelRegistry,
  ToolRegistry,
  FileEditor,
  FileSearchEngine,
  TerminalRunner,
  ProjectMapper,
  ContextManager,
  createFileTools,
  createTerminalTools,
  createGitTools,
  createProjectTools,
} from "veloura-code";

// 1. Initialize configuration and local database
const projectRoot = process.cwd();
const configManager = new ConfigManager();
const config = configManager.get();
const credManager = new CredentialManager();
const apiKey = credManager.getApiKey() || process.env.OPENROUTER_API_KEY!;
const db = new LocalDatabase();

// 2. Set up tool registry and security
const privacy = new PrivacyManager(config, configManager.getPaths(), projectRoot);
const editor = new FileEditor(projectRoot, privacy, db);
const search = new FileSearchEngine(projectRoot, privacy);
const runner = new TerminalRunner(projectRoot);
const gitManager = new GitManager(projectRoot, db);
const detector = new ProjectDetector(projectRoot);

const toolRegistry = new ToolRegistry();
for (const t of [
  ...createFileTools(editor, search),
  ...createTerminalTools(runner, detector),
  ...createGitTools(gitManager),
  ...createProjectTools(detector, projectRoot),
]) {
  toolRegistry.register(t);
}

// 3. Instantiate AI Client & Autonomous Engine
const registry = new ModelRegistry();
const modelRouter = new ModelRouter(registry, db, config);
const openRouterClient = new OpenRouterClient({ apiKey, db, config });

const engine = new AgentEngine({
  projectRoot,
  config,
  db,
  toolRegistry,
  modelRouter,
  openRouterClient,
  projectMapper: new ProjectMapper(projectRoot, privacy),
  gitManager,
  contextManager: new ContextManager(privacy, config),
});

// 4. Run an autonomous task programmatically
const result = await engine.runTask("Analyze this project and write tests for auth service");
console.log(`Task state: ${result.state}`);
console.log(`Final response: ${result.finalResponse}`);
console.log(`Files modified: ${result.filesModified.join(", ")}`);
```

---

## Development & Testing

```bash
# Run unit and integration tests (Vitest)
npm test

# Type checking
npm run lint

# Compile production bundle (tsup)
npm run build
```

---

## License

MIT License. Designed and built for autonomous, local-first engineering workflows.
