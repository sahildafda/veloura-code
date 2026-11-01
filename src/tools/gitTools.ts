import { z } from "zod";
import { AgentTool } from "./registry.js";
import { GitManager } from "../git/git.js";

export function createGitTools(gitManager: GitManager): AgentTool[] {
  const gitStatusTool: AgentTool = {
    name: "git_status",
    description: "Returns the current Git working tree status (modified, staged, untracked files).",
    permission: "read",
    schema: z.object({}),
    execute: async () => {
      const status = await gitManager.getStatus();
      return status;
    },
  };

  const gitDiffTool: AgentTool = {
    name: "git_diff",
    description: "Returns uncommitted unified diff changes in the repository.",
    permission: "read",
    schema: z.object({
      file_path: z.string().optional().describe("Optional specific file to diff"),
    }),
    execute: async (input) => {
      const diffText = await gitManager.getDiff(input.file_path);
      return { diff: diffText };
    },
  };

  const gitLogTool: AgentTool = {
    name: "git_log",
    description: "Returns recent Git commit history.",
    permission: "read",
    schema: z.object({
      limit: z.number().int().min(1).max(50).optional().default(10),
    }),
    execute: async (input) => {
      const commits = await gitManager.getLog(input.limit);
      return { commits };
    },
  };

  const gitCheckpointTool: AgentTool = {
    name: "git_checkpoint",
    description: "Creates a safe local checkpoint of current project state without pushing to remote.",
    permission: "write",
    schema: z.object({
      description: z.string().describe("Description of what was done up to this checkpoint"),
    }),
    execute: async (input, ctx) => {
      const checkpointId = await gitManager.createCheckpoint(input.description, ctx.taskId);
      return { success: true, checkpoint_id: checkpointId, description: input.description };
    },
  };

  const gitRollbackTool: AgentTool = {
    name: "git_rollback",
    description: "Restores project files to a previous checkpoint.",
    permission: "destructive",
    schema: z.object({
      checkpoint_id: z.string().optional().describe("Checkpoint ID to roll back to (defaults to latest)"),
    }),
    execute: async (input) => {
      const res = await gitManager.rollback(input.checkpoint_id);
      return res;
    },
  };

  return [gitStatusTool, gitDiffTool, gitLogTool, gitCheckpointTool, gitRollbackTool];
}
