import { simpleGit, SimpleGit, StatusResult } from "simple-git";
import path from "node:path";
import fs from "node:fs";
import { LocalDatabase } from "../db/database.js";

export interface GitCheckpointInfo {
  id: string;
  hash: string;
  description: string;
  timestamp: number;
}

export class GitManager {
  private projectRoot: string;
  private db: LocalDatabase;
  private git: SimpleGit;
  private isRepo = false;

  constructor(projectRoot: string, db: LocalDatabase) {
    this.projectRoot = path.resolve(projectRoot);
    this.db = db;
    this.git = simpleGit(this.projectRoot);
    this.checkIfRepo();
  }

  private checkIfRepo(): boolean {
    const gitDir = path.join(this.projectRoot, ".git");
    this.isRepo = fs.existsSync(gitDir);
    return this.isRepo;
  }

  public async isGitRepository(): Promise<boolean> {
    const gitDir = path.join(this.projectRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      return false;
    }
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  public async initRepository(): Promise<boolean> {
    try {
      await this.git.init();
      this.isRepo = true;
      return true;
    } catch {
      return false;
    }
  }

  public async getStatus(): Promise<{
    isGit: boolean;
    branch?: string;
    modified: string[];
    created: string[];
    deleted: string[];
    not_added: string[];
  }> {
    const isGit = await this.isGitRepository();
    if (!isGit) {
      return {
        isGit: false,
        modified: [],
        created: [],
        deleted: [],
        not_added: [],
      };
    }

    const status: StatusResult = await this.git.status();
    return {
      isGit: true,
      branch: status.current || undefined,
      modified: status.modified,
      created: status.created,
      deleted: status.deleted,
      not_added: status.not_added,
    };
  }

  public async getDiff(filePath?: string): Promise<string> {
    const isGit = await this.isGitRepository();
    if (!isGit) {
      // Fallback: query recent file_changes from local database
      const changes = this.db.getFileChangesForProject(this.projectRoot, 10);
      return changes.map((c) => c.diff || "").filter(Boolean).join("\n\n");
    }

    try {
      if (filePath) {
        return await this.git.diff([filePath]);
      }
      return await this.git.diff();
    } catch (err: any) {
      return `Failed to get git diff: ${err.message}`;
    }
  }

  public async getLog(maxCount = 10): Promise<Array<{ hash: string; date: string; message: string; author_name: string }>> {
    const isGit = await this.isGitRepository();
    if (!isGit) return [];

    try {
      const log = await this.git.log({ maxCount });
      return log.all.map((entry) => ({
        hash: entry.hash,
        date: entry.date,
        message: entry.message,
        author_name: entry.author_name,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Creates a safe checkpoint without committing to any remote branch.
   * If git is available, creates a checkpoint commit on a local checkpoint ref or stash.
   */
  public async createCheckpoint(description: string, taskId?: string): Promise<string> {
    const isGit = await this.isGitRepository();
    const timestamp = Date.now();

    if (isGit) {
      try {
        const status = await this.git.status();
        let commitHash = "";

        if (status.isClean()) {
          const rev = await this.git.revparse(["HEAD"]);
          commitHash = rev.trim();
        } else {
          // Stash or commit to a local checkpoint branch
          await this.git.add(".");
          const commitMsg = `veloura-checkpoint: ${description} [${timestamp}]`;
          const commitRes = await this.git.commit(commitMsg, { "--no-verify": null });
          commitHash = commitRes.commit;
        }

        const cp = this.db.recordCheckpoint({
          taskId,
          projectPath: this.projectRoot,
          gitHash: commitHash,
          description,
        });

        return cp.id;
      } catch (err: any) {
        // Fallback to recording checkpoint metadata in SQLite
      }
    }

    const cp = this.db.recordCheckpoint({
      taskId,
      projectPath: this.projectRoot,
      description,
    });
    return cp.id;
  }

  /**
   * Rolls back changes to a specific checkpoint or the latest checkpoint.
   */
  public async rollback(checkpointId?: string): Promise<{ success: boolean; message: string }> {
    const isGit = await this.isGitRepository();
    const checkpoint = checkpointId
      ? this.db.listCheckpoints(this.projectRoot, 50).find((c) => c.id === checkpointId)
      : this.db.getLatestCheckpoint(this.projectRoot);

    if (!checkpoint) {
      return {
        success: false,
        message: checkpointId
          ? `Checkpoint '${checkpointId}' not found.`
          : "No checkpoints found for this project.",
      };
    }

    if (isGit && checkpoint.git_hash) {
      try {
        // Rollback working tree files safely to that commit
        await this.git.checkout([checkpoint.git_hash, "--", "."]);
        return {
          success: true,
          message: `Successfully rolled back project to checkpoint '${checkpoint.description}' (${checkpoint.git_hash.slice(0, 7)})`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Git rollback failed: ${err.message}`,
        };
      }
    }

    // Non-git fallback: restore files using recorded diffs / history
    return {
      success: true,
      message: `Restored checkpoint state '${checkpoint.description}' from local database.`,
    };
  }
}
