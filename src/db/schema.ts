export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL -- active, completed, cancelled, failed
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- system, user, assistant, tool
  content TEXT,
  tool_calls TEXT, -- JSON array of tool calls
  tool_call_id TEXT,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL, -- Idle, Planning, Executing, WaitingForApproval, Verifying, Completed, Failed, Cancelled
  plan TEXT, -- JSON array of steps
  current_step INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 50,
  iteration_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  conversation_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_params TEXT NOT NULL,
  output_result TEXT,
  error TEXT,
  status TEXT NOT NULL, -- success, failure, denied, timeout
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  file_path TEXT NOT NULL,
  project_path TEXT NOT NULL,
  old_hash TEXT,
  new_hash TEXT,
  diff TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  project_path TEXT NOT NULL,
  git_hash TEXT,
  stash_ref TEXT,
  snapshot_data TEXT, -- JSON fallback snapshot if not git
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  category TEXT NOT NULL, -- architecture, conventions, tech_stack, instructions, notes
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_path, category, key)
);

CREATE TABLE IF NOT EXISTS model_metrics (
  model_id TEXT PRIMARY KEY,
  total_calls INTEGER DEFAULT 0,
  successful_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  total_prompt_tokens INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  avg_latency_ms REAL DEFAULT 0,
  last_used INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_exec_task ON tool_executions(task_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_proj ON file_changes(project_path);
CREATE INDEX IF NOT EXISTS idx_project_memory_proj ON project_memory(project_path);
`;
