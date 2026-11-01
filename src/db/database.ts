import Database from "better-sqlite3";
import crypto from "node:crypto";
import { SCHEMA_V1 } from "./schema.js";
import { getVelouraPaths, VelouraPaths } from "../config/paths.js";

export interface ConversationRecord {
  id: string;
  project_path: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: number;
}

export interface TaskRecord {
  id: string;
  conversation_id: string;
  project_path: string;
  description: string;
  state: string;
  plan: string | null;
  current_step: number;
  max_iterations: number;
  iteration_count: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  error: string | null;
}

export interface FileChangeRecord {
  id: string;
  task_id: string | null;
  file_path: string;
  project_path: string;
  old_hash: string | null;
  new_hash: string | null;
  diff: string | null;
  description: string | null;
  created_at: number;
}

export interface CheckpointRecord {
  id: string;
  task_id: string | null;
  project_path: string;
  git_hash: string | null;
  stash_ref: string | null;
  snapshot_data: string | null;
  description: string;
  created_at: number;
}

export interface ProjectMemoryRecord {
  id: string;
  project_path: string;
  category: string;
  key: string;
  value: string;
  updated_at: number;
}

export interface ModelMetricRecord {
  model_id: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  avg_latency_ms: number;
  last_used: number;
  last_error: string | null;
}

export class LocalDatabase {
  private db: Database.Database;

  constructor(customPath?: string) {
    const paths = getVelouraPaths();
    const dbPath = customPath || paths.dbFile;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA_V1);
  }

  public close(): void {
    this.db.close();
  }

  // === Conversation Methods ===

  public createConversation(projectPath: string, title?: string): ConversationRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, project_path, title, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `);
    stmt.run(id, projectPath, title || "New Conversation", now, now);
    return {
      id,
      project_path: projectPath,
      title: title || "New Conversation",
      created_at: now,
      updated_at: now,
      status: "active",
    };
  }

  public getConversation(id: string): ConversationRecord | null {
    const stmt = this.db.prepare("SELECT * FROM conversations WHERE id = ?");
    return (stmt.get(id) as ConversationRecord) || null;
  }

  public listConversations(limit = 20): ConversationRecord[] {
    const stmt = this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?");
    return stmt.all(limit) as ConversationRecord[];
  }

  public updateConversationStatus(id: string, status: string): void {
    const stmt = this.db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?");
    stmt.run(status, Date.now(), id);
  }

  public updateConversationTitle(id: string, title: string): void {
    const stmt = this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?");
    stmt.run(title, Date.now(), id);
  }

  public deleteConversation(id: string): void {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM tasks WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM tool_executions WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  public clearAllConversations(): void {
    this.db.exec("DELETE FROM conversations; DELETE FROM tasks; DELETE FROM file_changes;");
  }

  // === Message Methods ===

  public addMessage(
    conversationId: string,
    role: "system" | "user" | "assistant" | "tool",
    content: string | null,
    options: {
      tool_calls?: any[];
      tool_call_id?: string;
      model?: string;
      prompt_tokens?: number;
      completion_tokens?: number;
    } = {}
  ): MessageRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const toolCallsJson = options.tool_calls ? JSON.stringify(options.tool_calls) : null;

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, model, prompt_tokens, completion_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      conversationId,
      role,
      content,
      toolCallsJson,
      options.tool_call_id || null,
      options.model || null,
      options.prompt_tokens || 0,
      options.completion_tokens || 0,
      now
    );

    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);

    return {
      id,
      conversation_id: conversationId,
      role,
      content,
      tool_calls: toolCallsJson,
      tool_call_id: options.tool_call_id || null,
      model: options.model || null,
      prompt_tokens: options.prompt_tokens || 0,
      completion_tokens: options.completion_tokens || 0,
      created_at: now,
    };
  }

  public getMessages(conversationId: string): MessageRecord[] {
    const stmt = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
    return stmt.all(conversationId) as MessageRecord[];
  }

  // === Task Methods ===

  public createTask(
    conversationId: string,
    projectPath: string,
    description: string,
    maxIterations = 50
  ): TaskRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, conversation_id, project_path, description, state, plan, current_step, max_iterations, iteration_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Idle', NULL, 0, ?, 0, ?, ?)
    `);
    stmt.run(id, conversationId, projectPath, description, maxIterations, now, now);
    return {
      id,
      conversation_id: conversationId,
      project_path: projectPath,
      description,
      state: "Idle",
      plan: null,
      current_step: 0,
      max_iterations: maxIterations,
      iteration_count: 0,
      created_at: now,
      updated_at: now,
      completed_at: null,
      error: null,
    };
  }

  public updateTask(
    id: string,
    updates: Partial<Omit<TaskRecord, "id" | "conversation_id" | "project_path" | "created_at">>
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const values: any[] = [Date.now()];

    if (updates.state !== undefined) {
      sets.push("state = ?");
      values.push(updates.state);
    }
    if (updates.plan !== undefined) {
      sets.push("plan = ?");
      values.push(updates.plan);
    }
    if (updates.current_step !== undefined) {
      sets.push("current_step = ?");
      values.push(updates.current_step);
    }
    if (updates.iteration_count !== undefined) {
      sets.push("iteration_count = ?");
      values.push(updates.iteration_count);
    }
    if (updates.completed_at !== undefined) {
      sets.push("completed_at = ?");
      values.push(updates.completed_at);
    }
    if (updates.error !== undefined) {
      sets.push("error = ?");
      values.push(updates.error);
    }

    values.push(id);
    const sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  public getTask(id: string): TaskRecord | null {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    return (stmt.get(id) as TaskRecord) || null;
  }

  public getLatestTask(projectPath?: string): TaskRecord | null {
    if (projectPath) {
      const stmt = this.db.prepare("SELECT * FROM tasks WHERE project_path = ? ORDER BY updated_at DESC LIMIT 1");
      return (stmt.get(projectPath) as TaskRecord) || null;
    }
    const stmt = this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 1");
    return (stmt.get() as TaskRecord) || null;
  }

  public listTasks(projectPath?: string, limit = 20): TaskRecord[] {
    if (projectPath) {
      const stmt = this.db.prepare("SELECT * FROM tasks WHERE project_path = ? ORDER BY updated_at DESC LIMIT ?");
      return stmt.all(projectPath, limit) as TaskRecord[];
    }
    const stmt = this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?");
    return stmt.all(limit) as TaskRecord[];
  }

  // === Tool Execution Methods ===

  public recordToolExecution(params: {
    taskId?: string;
    conversationId: string;
    toolName: string;
    input: any;
    output?: any;
    error?: string;
    status: "success" | "failure" | "denied" | "timeout";
    durationMs: number;
  }): void {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO tool_executions (id, task_id, conversation_id, tool_name, input_params, output_result, error, status, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.taskId || null,
      params.conversationId,
      params.toolName,
      JSON.stringify(params.input),
      params.output !== undefined ? (typeof params.output === "string" ? params.output : JSON.stringify(params.output)) : null,
      params.error || null,
      params.status,
      params.durationMs,
      now
    );
  }

  // === File Change Methods ===

  public recordFileChange(params: {
    taskId?: string;
    filePath: string;
    projectPath: string;
    oldHash?: string;
    newHash?: string;
    diff?: string;
    description?: string;
  }): FileChangeRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO file_changes (id, task_id, file_path, project_path, old_hash, new_hash, diff, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.taskId || null,
      params.filePath,
      params.projectPath,
      params.oldHash || null,
      params.newHash || null,
      params.diff || null,
      params.description || null,
      now
    );
    return {
      id,
      task_id: params.taskId || null,
      file_path: params.filePath,
      project_path: params.projectPath,
      old_hash: params.oldHash || null,
      new_hash: params.newHash || null,
      diff: params.diff || null,
      description: params.description || null,
      created_at: now,
    };
  }

  public getFileChanges(taskId: string): FileChangeRecord[] {
    const stmt = this.db.prepare("SELECT * FROM file_changes WHERE task_id = ? ORDER BY created_at ASC");
    return stmt.all(taskId) as FileChangeRecord[];
  }

  public getFileChangesForProject(projectPath: string, limit = 50): FileChangeRecord[] {
    const stmt = this.db.prepare("SELECT * FROM file_changes WHERE project_path = ? ORDER BY created_at DESC LIMIT ?");
    return stmt.all(projectPath, limit) as FileChangeRecord[];
  }

  // === Checkpoints ===

  public recordCheckpoint(params: {
    taskId?: string;
    projectPath: string;
    gitHash?: string;
    stashRef?: string;
    snapshotData?: string;
    description: string;
  }): CheckpointRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, task_id, project_path, git_hash, stash_ref, snapshot_data, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.taskId || null,
      params.projectPath,
      params.gitHash || null,
      params.stashRef || null,
      params.snapshotData || null,
      params.description,
      now
    );
    return {
      id,
      task_id: params.taskId || null,
      project_path: params.projectPath,
      git_hash: params.gitHash || null,
      stash_ref: params.stashRef || null,
      snapshot_data: params.snapshotData || null,
      description: params.description,
      created_at: now,
    };
  }

  public getLatestCheckpoint(projectPath: string): CheckpointRecord | null {
    const stmt = this.db.prepare("SELECT * FROM checkpoints WHERE project_path = ? ORDER BY created_at DESC LIMIT 1");
    return (stmt.get(projectPath) as CheckpointRecord) || null;
  }

  public listCheckpoints(projectPath: string, limit = 20): CheckpointRecord[] {
    const stmt = this.db.prepare("SELECT * FROM checkpoints WHERE project_path = ? ORDER BY created_at DESC LIMIT ?");
    return stmt.all(projectPath, limit) as CheckpointRecord[];
  }

  // === Project Memory ===

  public setMemory(projectPath: string, category: string, key: string, value: string): void {
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO project_memory (id, project_path, category, key, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_path, category, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(id, projectPath, category, key, value, now);
  }

  public getMemory(projectPath: string, category?: string): ProjectMemoryRecord[] {
    if (category) {
      const stmt = this.db.prepare("SELECT * FROM project_memory WHERE project_path = ? AND category = ? ORDER BY key ASC");
      return stmt.all(projectPath, category) as ProjectMemoryRecord[];
    }
    const stmt = this.db.prepare("SELECT * FROM project_memory WHERE project_path = ? ORDER BY category, key ASC");
    return stmt.all(projectPath) as ProjectMemoryRecord[];
  }

  public clearProjectMemory(projectPath: string): void {
    const stmt = this.db.prepare("DELETE FROM project_memory WHERE project_path = ?");
    stmt.run(projectPath);
  }

  // === Model Metrics ===

  public recordModelUsage(params: {
    modelId: string;
    success: boolean;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    error?: string;
  }): void {
    const now = Date.now();
    const existing = this.getModelMetrics(params.modelId);

    if (!existing) {
      const stmt = this.db.prepare(`
        INSERT INTO model_metrics (model_id, total_calls, successful_calls, failed_calls, total_prompt_tokens, total_completion_tokens, avg_latency_ms, last_used, last_error)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        params.modelId,
        params.success ? 1 : 0,
        params.success ? 0 : 1,
        params.promptTokens,
        params.completionTokens,
        params.latencyMs,
        now,
        params.error || null
      );
    } else {
      const totalCalls = existing.total_calls + 1;
      const successfulCalls = existing.successful_calls + (params.success ? 1 : 0);
      const failedCalls = existing.failed_calls + (params.success ? 0 : 1);
      const totalPrompt = existing.total_prompt_tokens + params.promptTokens;
      const totalCompletion = existing.total_completion_tokens + params.completionTokens;
      const newAvgLatency = (existing.avg_latency_ms * existing.total_calls + params.latencyMs) / totalCalls;

      const stmt = this.db.prepare(`
        UPDATE model_metrics SET
          total_calls = ?,
          successful_calls = ?,
          failed_calls = ?,
          total_prompt_tokens = ?,
          total_completion_tokens = ?,
          avg_latency_ms = ?,
          last_used = ?,
          last_error = ?
        WHERE model_id = ?
      `);
      stmt.run(
        totalCalls,
        successfulCalls,
        failedCalls,
        totalPrompt,
        totalCompletion,
        newAvgLatency,
        now,
        params.error || existing.last_error,
        params.modelId
      );
    }
  }

  public getModelMetrics(modelId: string): ModelMetricRecord | null {
    const stmt = this.db.prepare("SELECT * FROM model_metrics WHERE model_id = ?");
    return (stmt.get(modelId) as ModelMetricRecord) || null;
  }

  public getAllModelMetrics(): ModelMetricRecord[] {
    const stmt = this.db.prepare("SELECT * FROM model_metrics ORDER BY total_calls DESC");
    return stmt.all() as ModelMetricRecord[];
  }
}
