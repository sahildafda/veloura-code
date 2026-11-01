#!/usr/bin/env node
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import boxen from "boxen";

import { ConfigManager } from "./config/config.js";
import { CredentialManager } from "./auth/credentials.js";
import { LocalDatabase } from "./db/database.js";
import { ModelRegistry } from "./ai/models.js";
import { ModelRouter } from "./ai/router.js";
import { OpenRouterClient } from "./ai/openrouter.js";
import { PrivacyManager } from "./security/privacy.js";
import { PathGuard } from "./security/pathGuard.js";
import { CommandGuard } from "./security/commandGuard.js";
import { FileEditor } from "./fs/editor.js";
import { FileSearchEngine } from "./fs/search.js";
import { TerminalRunner } from "./terminal/runner.js";
import { GitManager } from "./git/git.js";
import { ProjectDetector } from "./project/detector.js";
import { ProjectMapper } from "./project/mapper.js";
import { ToolRegistry } from "./tools/registry.js";
import { createFileTools } from "./tools/fileTools.js";
import { createTerminalTools } from "./tools/terminalTools.js";
import { createGitTools } from "./tools/gitTools.js";
import { createProjectTools } from "./tools/projectTools.js";
import { AgentEngine } from "./agent/engine.js";
import { ContextManager } from "./agent/context.js";
import { App } from "./ui/App.js";
import { VelouraWebServer } from "./server/webServer.js";

function bootstrapAgent(projectRoot = process.cwd(), overrides: { model?: string; strict?: boolean } = {}) {
  const configManager = new ConfigManager();
  const config = configManager.get();

  if (overrides.strict !== undefined) {
    config.privacyMode = overrides.strict ? "strict" : "standard";
  }

  const credentialManager = new CredentialManager();
  const apiKey = credentialManager.getApiKey() || "";

  const db = new LocalDatabase();
  const privacyManager = new PrivacyManager(config, configManager.getPaths(), projectRoot);
  const commandGuard = new CommandGuard(config.allowedCommands, config.deniedCommands);
  const terminalRunner = new TerminalRunner(projectRoot, commandGuard);
  const editor = new FileEditor(projectRoot, privacyManager, db);
  const searchEngine = new FileSearchEngine(projectRoot, privacyManager);
  const gitManager = new GitManager(projectRoot, db);
  const detector = new ProjectDetector(projectRoot);
  const mapper = new ProjectMapper(projectRoot, privacyManager);
  const contextManager = new ContextManager(privacyManager, config);
  const registry = new ModelRegistry();
  const modelRouter = new ModelRouter(registry, db, config);

  const toolRegistry = new ToolRegistry();
  const fileTools = createFileTools(editor, searchEngine);
  const terminalTools = createTerminalTools(terminalRunner, detector);
  const gitTools = createGitTools(gitManager);
  const projectTools = createProjectTools(detector, projectRoot);

  for (const t of [...fileTools, ...terminalTools, ...gitTools, ...projectTools]) {
    toolRegistry.register(t);
  }

  const openRouterClient = new OpenRouterClient({
    apiKey,
    db,
    config,
  });

  const engine = new AgentEngine({
    projectRoot,
    config,
    db,
    toolRegistry,
    modelRouter,
    openRouterClient,
    projectMapper: mapper,
    gitManager,
    contextManager,
  });

  return {
    configManager,
    config,
    credentialManager,
    db,
    registry,
    gitManager,
    detector,
    mapper,
    privacyManager,
    engine,
  };
}

const program = new Command();

program
  .name("veloura")
  .description("Veloura Code - Autonomous Local AI Coding Agent & ChatGPT Interface")
  .version("1.0.0")
  .argument("[task]", "Autonomous coding task to execute")
  .option("-m, --model <model-id>", "Override the AI model")
  .option("-r, --resume", "Resume the last task in this project")
  .option("--cli", "Force terminal interactive mode instead of ChatGPT Web UI")
  .option("--no-auto-approve", "Require approval for all tool actions")
  .option("--strict-privacy", "Run in strict privacy mode")
  .option("--non-interactive", "Run in headless / scripting mode")
  .option("-p, --port <number>", "Port for the Web UI", "3456")
  .action(async (taskArg, options) => {
    const projectRoot = process.cwd();
    const { config, credentialManager, configManager, db, registry, engine, detector, gitManager } = bootstrapAgent(projectRoot, {
      model: options.model,
      strict: options.strictPrivacy,
    });

    const apiKey = credentialManager.getApiKey();
    if (!apiKey) {
      console.log(
        chalk.yellow(
          "\n⚠️  No OpenRouter API key found. Run 'veloura auth' to configure your API key, or set OPENROUTER_API_KEY.\n"
        )
      );
    }

    let taskToRun = taskArg;
    if (options.resume && !taskToRun) {
      const latestTask = db.getLatestTask(projectRoot);
      if (latestTask) {
        taskToRun = latestTask.description;
        console.log(chalk.cyan(`Resuming previous task: "${taskToRun}"`));
      } else {
        console.log(chalk.red("No previous task found to resume."));
        return;
      }
    }

    const projectName = path.basename(projectRoot);
    const initialModel = options.model || config.defaultModel;

    // 1. Direct / non-interactive execution
    if (options.nonInteractive || (taskToRun && !options.cli)) {
      if (!taskToRun) {
        console.error(chalk.red("Error: Task argument is required in non-interactive mode."));
        process.exit(1);
      }
      console.log(chalk.cyan(`Veloura Code [Executing Task]`));
      console.log(chalk.gray(`Project: ${projectName} | Model: ${initialModel}`));
      console.log(chalk.white(`Executing: "${taskToRun}"...\n`));

      try {
        const summary = await engine.runTask(taskToRun, {
          manualModel: options.model,
          autoApprove: options.autoApprove,
        });

        console.log(chalk.green(`\n✓ Task Finished (${summary.state})`));
        console.log(`Iterations: ${summary.iterations} | Tools: ${summary.toolsExecuted}`);
        if (summary.filesModified.length > 0) {
          console.log(chalk.yellow(`Modified Files: ${summary.filesModified.join(", ")}`));
        }
        console.log(`\n${summary.finalResponse}`);
      } catch (err: any) {
        console.error(chalk.red(`\n✕ Execution error: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    // 2. Terminal CLI mode if explicitly requested
    if (options.cli) {
      render(
        <App
          engine={engine}
          projectName={projectName}
          initialModel={initialModel}
          privacyMode={options.strictPrivacy ? "strict" : config.privacyMode}
          initialTask={taskToRun}
          maxIterations={config.maxIterations}
        />
      );
      return;
    }

    // 3. Default: Launch the full ChatGPT-style Web Interface!
    const port = parseInt(options.port || "3456", 10);
    console.log(chalk.bold.cyan("\n✦ VELOURA CODE (ChatGPT Web Interface)"));
    console.log(chalk.gray(`  Workspace: ${projectRoot}`));
    console.log(chalk.gray(`  Model:     ${initialModel}`));
    console.log(chalk.green(`  URL:       http://localhost:${port}`));
    console.log(chalk.white(`\nOpening ChatGPT-style Web UI in your default browser...`));
    console.log(chalk.gray(`Press Ctrl+C to stop the server.\n`));

    const webServer = new VelouraWebServer({
      port,
      engine,
      db,
      registry,
      detector,
      gitManager,
      config,
      configManager,
      credentialManager,
      projectRoot,
      autoOpenBrowser: true,
    });
    await webServer.start();
  });

// === SUBCOMMAND: veloura ui / veloura web ===
program
  .command("ui")
  .description("Launch the ChatGPT-style Web UI in your browser")
  .option("-p, --port <number>", "Port number for the Web UI", "3456")
  .action(async (options) => {
    const projectRoot = process.cwd();
    const { config, credentialManager, configManager, db, registry, engine, detector, gitManager } = bootstrapAgent(projectRoot);
    const port = parseInt(options.port || "3456", 10);

    console.log(chalk.bold.cyan("\n✦ VELOURA CODE (ChatGPT Web Interface)"));
    console.log(chalk.green(`  URL: http://localhost:${port}`));
    console.log(chalk.white(`\nOpening ChatGPT-style Web UI in your default browser...`));

    const webServer = new VelouraWebServer({
      port,
      engine,
      db,
      registry,
      detector,
      gitManager,
      config,
      configManager,
      credentialManager,
      projectRoot,
      autoOpenBrowser: true,
    });
    await webServer.start();
  });

// === SUBCOMMAND: veloura init ===
program
  .command("init")
  .description("Initialize Veloura Code configuration and guidelines in the current project")
  .action(async () => {
    const projectRoot = process.cwd();
    const velouraDir = path.join(projectRoot, ".veloura");
    const instructionsFile = path.join(velouraDir, "instructions.md");
    const ignoreFile = path.join(projectRoot, ".velouraignore");

    const fs = await import("node:fs/promises");
    await fs.mkdir(velouraDir, { recursive: true });

    if (!(await import("node:fs")).existsSync(instructionsFile)) {
      const template = `# Project Instructions for Veloura Code\n\nAdd project-specific rules, architecture notes, and conventions here.\n`;
      await fs.writeFile(instructionsFile, template, "utf8");
    }

    if (!(await import("node:fs")).existsSync(ignoreFile)) {
      const defaultIgnore = `# Veloura Code ignore patterns\n*.log\nsecrets/\n`;
      await fs.writeFile(ignoreFile, defaultIgnore, "utf8");
    }

    console.log(chalk.green("✓ Initialized Veloura Code in current project:"));
    console.log(`  - ${instructionsFile}`);
    console.log(`  - ${ignoreFile}`);
  });

// === SUBCOMMAND: veloura auth ===
program
  .command("auth")
  .description("Authenticate with OpenRouter and manage credentials")
  .option("--clear", "Remove stored OpenRouter credentials")
  .action(async (options) => {
    const credentialManager = new CredentialManager();

    if (options.clear) {
      credentialManager.clearApiKey();
      console.log(chalk.green("✓ OpenRouter API key removed successfully."));
      return;
    }

    const status = credentialManager.getStatus();
    console.log(chalk.cyan("\n--- Veloura Code Authentication ---"));
    console.log(`Status: ${status.hasKey ? chalk.green("Key Configured") : chalk.yellow("Not Configured")}`);
    console.log(`Storage: ${chalk.gray(status.storageDescription)}`);
    if (status.maskedKey) {
      console.log(`Active Key: ${chalk.white(status.maskedKey)}`);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      chalk.white("\nEnter OpenRouter API Key (sk-or-v1-...): "),
      (key) => {
        rl.close();
        const trimmed = key.trim();
        if (!trimmed) {
          console.log(chalk.gray("No changes made."));
          return;
        }

        try {
          credentialManager.setApiKey(trimmed);
          console.log(chalk.green("\n✓ API key securely saved!"));
          console.log(chalk.gray("Credentials are saved in the local OS vault / encrypted machine store."));
        } catch (err: any) {
          console.error(chalk.red(`\n✕ Failed to save credentials: ${err.message}`));
        }
      }
    );
  });

// === SUBCOMMAND: veloura models ===
program
  .command("models")
  .description("List, search, refresh, or select AI models from OpenRouter")
  .option("--free", "Show only free models")
  .option("--refresh", "Force refresh model list from OpenRouter API")
  .option("--test", "Test connection with current active model")
  .option("--set <model-id>", "Set the default AI model in configuration")
  .action(async (options) => {
    const { configManager, credentialManager, registry } = bootstrapAgent();

    if (options.set) {
      configManager.setDefaultModel(options.set);
      console.log(chalk.green(`✓ Default model set to: ${options.set}`));
      return;
    }

    const apiKey = credentialManager.getApiKey();
    console.log(chalk.cyan("Fetching models from OpenRouter..."));

    try {
      const models = await registry.fetchModels(apiKey, options.refresh);
      const filtered = options.free ? models.filter((m) => m.isFree) : models;

      console.log(
        chalk.green(`\nFound ${filtered.length} models ${options.free ? "(Free Tier)" : ""}:\n`)
      );

      for (const m of filtered.slice(0, 30)) {
        const badge = m.isFree ? chalk.bgGreen.black(" FREE ") : chalk.bgBlue.black(" PAID ");
        const toolsBadge = m.supportsTools ? chalk.cyan("[tools]") : "";
        console.log(`${badge} ${toolsBadge} ${chalk.bold.white(m.id)} - ${chalk.gray(m.name)}`);
        console.log(`     Context: ${m.context_length.toLocaleString()} tokens`);
      }

      if (filtered.length > 30) {
        console.log(chalk.gray(`\n... and ${filtered.length - 30} more models.`));
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed to fetch models: ${err.message}`));
    }
  });

// === SUBCOMMAND: veloura config ===
program
  .command("config")
  .description("View or manage local configuration")
  .option("--reset", "Reset configuration to defaults")
  .action((options) => {
    const { configManager } = bootstrapAgent();

    if (options.reset) {
      const resetConfig = configManager.reset();
      console.log(chalk.green("✓ Configuration reset to defaults:"));
      console.log(JSON.stringify(resetConfig, null, 2));
      return;
    }

    console.log(chalk.cyan("Veloura Code Configuration:"));
    console.log(chalk.gray(`File: ${configManager.getPaths().configFile}`));
    console.log(JSON.stringify(configManager.get(), null, 2));
  });

// === SUBCOMMAND: veloura privacy ===
program
  .command("privacy")
  .description("Inspect and set local privacy architecture")
  .option("--strict", "Enable strict privacy mode (requires approval before sending code)")
  .option("--standard", "Enable standard privacy mode (automatic secret redaction)")
  .action((options) => {
    const { configManager, privacyManager } = bootstrapAgent();

    if (options.strict) {
      configManager.setPrivacyMode("strict");
      console.log(chalk.green("✓ Switched to STRICT Privacy Mode."));
    } else if (options.standard) {
      configManager.setPrivacyMode("standard");
      console.log(chalk.green("✓ Switched to STANDARD Privacy Mode."));
    }

    const report = privacyManager.getPrivacyReport();
    console.log(
      boxen(
        chalk.bold.cyan("VELOURA CODE PRIVACY REPORT\n\n") +
          `${chalk.bold("Active Mode:")} ${report.mode === "strict" ? chalk.magenta("STRICT") : chalk.green("STANDARD")}\n` +
          `${chalk.bold("Code Approval Required:")} ${report.requiresApproval ? chalk.yellow("YES") : chalk.gray("NO")}\n` +
          `${chalk.bold("Local Storage Path:")} ${report.localDataPath}\n` +
          `${chalk.bold("Config Path:")} ${report.configPath}\n` +
          `${chalk.bold("External AI Provider:")} ${report.aiProvider}\n\n` +
          `${chalk.bold.green("Stored Strictly Locally:")}\n` +
          report.storedLocally.map((s) => `  • ${s}`).join("\n") +
          `\n\n${chalk.bold.yellow("Sent to External AI Provider:")}\n` +
          report.sentExternally.map((s) => `  • ${s}`).join("\n"),
        { padding: 1, borderColor: "cyan", borderStyle: "round" }
      )
    );
  });

// === SUBCOMMAND: veloura history ===
program
  .command("history")
  .description("View recent tasks, conversations, and file modifications")
  .option("--clear", "Delete all local conversation and task history")
  .action((options) => {
    const { db } = bootstrapAgent();

    if (options.clear) {
      db.clearAllConversations();
      console.log(chalk.green("✓ Local task and conversation history cleared."));
      return;
    }

    const tasks = db.listTasks(process.cwd(), 10);
    console.log(chalk.cyan(`\nRecent Tasks for ${process.cwd()}:\n`));

    if (tasks.length === 0) {
      console.log(chalk.gray("No previous tasks recorded."));
      return;
    }

    for (const t of tasks) {
      const date = new Date(t.created_at).toLocaleString();
      const stateBadge =
        t.state === "Completed"
          ? chalk.green(`[${t.state}]`)
          : t.state === "Failed"
          ? chalk.red(`[${t.state}]`)
          : chalk.yellow(`[${t.state}]`);

      console.log(`${stateBadge} ${chalk.bold.white(t.description)}`);
      console.log(chalk.gray(`    ID: ${t.id} | Date: ${date} | Iterations: ${t.iteration_count}`));
    }
  });

// === SUBCOMMAND: veloura diff ===
program
  .command("diff")
  .description("Show uncommitted changes or recent agent modifications")
  .action(async () => {
    const { gitManager } = bootstrapAgent();
    const diffText = await gitManager.getDiff();
    if (!diffText || diffText.trim().length === 0) {
      console.log(chalk.gray("No uncommitted changes in current project."));
      return;
    }
    console.log(diffText);
  });

// === SUBCOMMAND: veloura checkpoint ===
program
  .command("checkpoint [description]")
  .description("Create a safe local checkpoint")
  .action(async (description = "Manual checkpoint") => {
    const { gitManager } = bootstrapAgent();
    const id = await gitManager.createCheckpoint(description);
    console.log(chalk.green(`✓ Created checkpoint: ${id} ("${description}")`));
  });

// === SUBCOMMAND: veloura rollback ===
program
  .command("rollback [id]")
  .description("Roll back project files to a previous checkpoint")
  .action(async (id) => {
    const { gitManager } = bootstrapAgent();
    const res = await gitManager.rollback(id);
    if (res.success) {
      console.log(chalk.green(`✓ ${res.message}`));
    } else {
      console.error(chalk.red(`✕ ${res.message}`));
    }
  });

// === SUBCOMMAND: veloura status ===
program
  .command("status")
  .description("Show current project status, git branch, and agent health")
  .action(async () => {
    const { config, detector, gitManager } = bootstrapAgent();
    const meta = detector.detect();
    const gitStatus = await gitManager.getStatus();

    console.log(chalk.cyan("\n--- Veloura Code Project Status ---"));
    console.log(`Directory: ${process.cwd()}`);
    console.log(`Project Type: ${meta.projectType}`);
    console.log(`Languages: ${meta.languages.join(", ") || "None"}`);
    console.log(`Package Manager: ${meta.packageManager}`);
    console.log(`Default Model: ${config.defaultModel}`);
    console.log(`Privacy Mode: ${config.privacyMode.toUpperCase()}`);

    if (gitStatus.isGit) {
      console.log(`Git Branch: ${gitStatus.branch || "HEAD"}`);
      console.log(
        `Modified Files: ${gitStatus.modified.length} | Untracked: ${gitStatus.not_added.length}`
      );
    } else {
      console.log(`Git: Not a git repository (local database snapshot tracking active)`);
    }
  });

// === SUBCOMMAND: veloura doctor ===
program
  .command("doctor")
  .description("Perform diagnostic health check of the environment, credentials, and database")
  .action(async () => {
    console.log(chalk.cyan("\nRunning Veloura Code Doctor Diagnostics...\n"));

    const { credentialManager, db, registry, gitManager } = bootstrapAgent();

    // 1. Check Node
    console.log(`[✓] Node.js version: ${process.version}`);

    // 2. Check Database
    try {
      db.listConversations(1);
      console.log(`[✓] SQLite database: Operational (${db})`);
    } catch (e: any) {
      console.log(chalk.red(`[✕] SQLite database error: ${e.message}`));
    }

    // 3. Check Credentials
    const credStatus = credentialManager.getStatus();
    if (credStatus.hasKey) {
      console.log(`[✓] API Key: Configured (${credStatus.maskedKey})`);
      console.log(`[✓] Credential Storage: ${credStatus.storageDescription}`);
    } else {
      console.log(chalk.yellow(`[!] API Key: Not configured (run 'veloura auth')`));
    }

    // 4. Check Git
    const isGit = await gitManager.isGitRepository();
    if (isGit) {
      console.log(`[✓] Git Repository: Active`);
    } else {
      console.log(chalk.gray(`[-] Git: Not a git repo (using database checkpoints)`));
    }

    // 5. Test Models Cache
    const cached = registry.getCachedModels();
    console.log(`[✓] Models Registry: ${cached.length} models cached`);

    console.log(chalk.green("\nAll core systems healthy.\n"));
  });

program.parse(process.argv);
