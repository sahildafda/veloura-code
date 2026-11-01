import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { CommandGuard, CommandAnalysis } from "../security/commandGuard.js";

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  analysis: CommandAnalysis;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  bypassApproval?: boolean;
}

export class TerminalRunner {
  private projectRoot: string;
  private commandGuard: CommandGuard;

  constructor(projectRoot: string, commandGuard?: CommandGuard) {
    this.projectRoot = path.resolve(projectRoot);
    this.commandGuard = commandGuard || new CommandGuard();
  }

  public getCommandGuard(): CommandGuard {
    return this.commandGuard;
  }

  /**
   * Executes a terminal command safely within the project root.
   */
  public async execute(
    command: string,
    options: RunCommandOptions = {}
  ): Promise<CommandResult> {
    const analysis = this.commandGuard.analyze(command);

    if (analysis.isBlocked) {
      throw new Error(
        `Command blocked for security: ${analysis.reason || "Dangerous system operation"}`
      );
    }

    if (analysis.requiresApproval && !options.bypassApproval) {
      throw new Error(
        `Command requires user approval: ${analysis.reason || "High-risk command"}`
      );
    }

    const timeoutMs = options.timeoutMs || 60_000;
    const maxOutputChars = options.maxOutputChars || 50_000;
    const startTime = Date.now();

    const isWindows = process.platform === "win32";
    const shell = isWindows
      ? process.env.ComSpec || "cmd.exe"
      : process.env.SHELL || "/bin/sh";

    const shellArgs = isWindows ? ["/d", "/s", "/c", command] : ["-c", command];

    return new Promise<CommandResult>((resolve) => {
      let stdoutAcc = "";
      let stderrAcc = "";
      let timedOut = false;
      let killed = false;
      let finished = false;

      const child: ChildProcess = spawn(shell, shellArgs, {
        cwd: this.projectRoot,
        env: {
          ...process.env,
          ...options.env,
          CI: "true",
          FORCE_COLOR: "0",
        },
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        if (!finished) {
          timedOut = true;
          this.killProcess(child);
        }
      }, timeoutMs);

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          if (!finished) {
            killed = true;
            this.killProcess(child);
          }
        });
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdoutAcc.length < maxOutputChars) {
          stdoutAcc += chunk.toString("utf8");
          if (stdoutAcc.length > maxOutputChars) {
            stdoutAcc = stdoutAcc.slice(0, maxOutputChars) + "\n... [Output truncated by Veloura]";
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderrAcc.length < maxOutputChars) {
          stderrAcc += chunk.toString("utf8");
          if (stderrAcc.length > maxOutputChars) {
            stderrAcc = stderrAcc.slice(0, maxOutputChars) + "\n... [Stderr truncated by Veloura]";
          }
        }
      });

      child.on("error", (err: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          command,
          exitCode: -1,
          stdout: stdoutAcc,
          stderr: stderrAcc + `\nProcess spawn error: ${err.message}`,
          durationMs,
          timedOut,
          killed,
          analysis,
        });
      });

      child.on("close", (code: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          command,
          exitCode: code ?? (timedOut ? -2 : -1),
          stdout: stdoutAcc.trim(),
          stderr: stderrAcc.trim(),
          durationMs,
          timedOut,
          killed,
          analysis,
        });
      });
    });
  }

  private killProcess(child: ChildProcess): void {
    try {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", child.pid.toString(), "/t", "/f"], {
          windowsHide: true,
        });
      } else if (child.pid) {
        child.kill("SIGKILL");
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
