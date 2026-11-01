import { z } from "zod";
import { AgentTool } from "./registry.js";
import { FileEditor } from "../fs/editor.js";
import { FileSearchEngine } from "../fs/search.js";

export function createFileTools(
  editor: FileEditor,
  searchEngine: FileSearchEngine
): AgentTool[] {
  const listFilesTool: AgentTool = {
    name: "list_files",
    description: "Lists files and subdirectories in a directory path, respecting ignore rules.",
    permission: "read",
    schema: z.object({
      directory: z.string().optional().default(".").describe("Directory path relative to project root"),
      max_depth: z.number().int().min(1).max(10).optional().default(3).describe("Maximum directory depth to traverse"),
    }),
    execute: async (input) => {
      const entries = await searchEngine.listFiles(input.directory, input.max_depth);
      return entries.map((e) => ({
        path: e.relativePath,
        type: e.isDirectory ? "directory" : "file",
        size: e.size,
      }));
    },
  };

  const readFileTool: AgentTool = {
    name: "read_file",
    description: "Reads the content of a file within the project. Supports optional line range.",
    permission: "read",
    schema: z.object({
      path: z.string().describe("Relative path of the file to read"),
      start_line: z.number().int().min(1).optional().describe("First line to read (1-indexed)"),
      end_line: z.number().int().min(1).optional().describe("Last line to read (inclusive)"),
    }),
    execute: async (input) => {
      const res = await editor.readFile(input.path, {
        startLine: input.start_line,
        endLine: input.end_line,
      });
      return {
        path: res.relativePath,
        total_lines: res.totalLines,
        hash: res.hash,
        content: res.content,
      };
    },
  };

  const searchCodeTool: AgentTool = {
    name: "search_code",
    description: "Searches for a text string or regular expression across project source files.",
    permission: "read",
    schema: z.object({
      query: z.string().describe("Text or regex pattern to search for"),
      is_regex: z.boolean().optional().default(false).describe("Whether query is a regex"),
      file_pattern: z.string().optional().default("**/*").describe("Glob pattern to restrict search files"),
      max_results: z.number().int().min(1).max(200).optional().default(50),
    }),
    execute: async (input) => {
      const matches = await searchEngine.searchCode(input.query, {
        isRegex: input.is_regex,
        fileFilter: input.file_pattern,
        maxResults: input.max_results,
      });
      return matches;
    },
  };

  const writeFileTool: AgentTool = {
    name: "write_file",
    description: "Creates a new file or overwrites an entire existing file with content.",
    permission: "write",
    schema: z.object({
      path: z.string().describe("Relative file path to write to"),
      content: z.string().describe("Complete content to write into the file"),
      description: z.string().optional().describe("Summary of what was created or replaced"),
    }),
    execute: async (input, ctx) => {
      const result = await editor.writeFile(input.path, input.content, {
        taskId: ctx.taskId,
        description: input.description,
      });
      return {
        path: result.relativePath,
        success: result.success,
        new_hash: result.newHash,
        lines_added: result.linesAdded,
        lines_removed: result.linesRemoved,
      };
    },
  };

  const editFileTool: AgentTool = {
    name: "edit_file",
    description: "Performs surgical search-and-replace modification in an existing file.",
    permission: "write",
    schema: z.object({
      path: z.string().describe("Relative path of the file to edit"),
      target: z.string().describe("Exact string or block of code to find and replace"),
      replacement: z.string().describe("New code to replace the target block with"),
      expected_hash: z.string().optional().describe("Hash of file from earlier read_file to avoid conflicts"),
      description: z.string().optional().describe("Reason for this edit"),
    }),
    execute: async (input, ctx) => {
      const result = await editor.editFile(input.path, input.target, input.replacement, {
        taskId: ctx.taskId,
        expectedHash: input.expected_hash,
        description: input.description,
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to locate target block in file");
      }
      return {
        path: result.relativePath,
        success: result.success,
        diff: result.diff,
        lines_added: result.linesAdded,
        lines_removed: result.linesRemoved,
      };
    },
  };

  const applyPatchTool: AgentTool = {
    name: "apply_patch",
    description: "Applies a unified diff patch directly to an existing file.",
    permission: "write",
    schema: z.object({
      path: z.string().describe("Relative path of the file to patch"),
      patch: z.string().describe("Standard unified diff string"),
      description: z.string().optional().describe("Summary of changes"),
    }),
    execute: async (input, ctx) => {
      const result = await editor.applyPatch(input.path, input.patch, {
        taskId: ctx.taskId,
        description: input.description,
      });
      if (!result.success) {
        throw new Error(result.error || "Patch failed to apply");
      }
      return {
        path: result.relativePath,
        success: result.success,
        lines_added: result.linesAdded,
        lines_removed: result.linesRemoved,
      };
    },
  };

  const deleteFileTool: AgentTool = {
    name: "delete_file",
    description: "Deletes a file within the project.",
    permission: "destructive",
    schema: z.object({
      path: z.string().describe("Relative path of the file to delete"),
    }),
    execute: async (input, ctx) => {
      const res = await editor.deleteFile(input.path, { taskId: ctx.taskId });
      return { success: true, deleted: res.relativePath };
    },
  };

  const moveFileTool: AgentTool = {
    name: "move_file",
    description: "Moves or renames a file within the project directory.",
    permission: "write",
    schema: z.object({
      source_path: z.string().describe("Source file path"),
      destination_path: z.string().describe("Destination file path"),
    }),
    execute: async (input, ctx) => {
      const res = await editor.moveFile(input.source_path, input.destination_path, {
        taskId: ctx.taskId,
      });
      return { success: true, source: res.source, destination: res.destination };
    },
  };

  return [
    listFilesTool,
    readFileTool,
    searchCodeTool,
    writeFileTool,
    editFileTool,
    applyPatchTool,
    deleteFileTool,
    moveFileTool,
  ];
}
