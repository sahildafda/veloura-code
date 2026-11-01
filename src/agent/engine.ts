import OpenAI from "openai";
import { TaskStateMachine, AgentState } from "./state.js";
import { ContextManager } from "./context.js";
import { ToolRegistry, ToolExecutionContext } from "../tools/registry.js";
import { OpenRouterClient, ModelCompletionResult } from "../ai/openrouter.js";
import { ModelRouter, RoutingDecision } from "../ai/router.js";
import { getSystemPrompt } from "../ai/prompts.js";
import { ProjectMapper } from "../project/mapper.js";
import { GitManager } from "../git/git.js";
import { LocalDatabase, TaskRecord, ConversationRecord } from "../db/database.js";
import { VelouraConfig } from "../config/config.js";

export interface AgentEventCallbacks {
  onStateChange?: (state: AgentState, message?: string) => void;
  onModelSelected?: (decision: RoutingDecision) => void;
  onModelSwitch?: (fromModel: string, toModel: string, reason: string) => void;
  onThinking?: (text: string) => void;
  onToolStart?: (toolName: string, args: any) => void;
  onToolComplete?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
  onApprovalRequired?: (toolName: string, description: string, params: any) => Promise<boolean>;
  onStrictPrivacyPrompt?: (contextPreview: string) => Promise<boolean>;
  onError?: (err: Error) => void;
  onComplete?: (summary: AgentRunSummary) => void;
}

export interface AgentRunSummary {
  taskId: string;
  conversationId: string;
  state: AgentState;
  iterations: number;
  toolsExecuted: number;
  filesModified: string[];
  finalResponse: string;
  totalDurationMs: number;
  checkpointId?: string;
}

export interface AgentEngineOptions {
  projectRoot: string;
  config: VelouraConfig;
  db: LocalDatabase;
  toolRegistry: ToolRegistry;
  modelRouter: ModelRouter;
  openRouterClient: OpenRouterClient;
  projectMapper: ProjectMapper;
  gitManager: GitManager;
  contextManager: ContextManager;
  callbacks?: AgentEventCallbacks;
}

export class AgentEngine {
  private projectRoot: string;
  private config: VelouraConfig;
  private db: LocalDatabase;
  private toolRegistry: ToolRegistry;
  private modelRouter: ModelRouter;
  private openRouterClient: OpenRouterClient;
  private projectMapper: ProjectMapper;
  private gitManager: GitManager;
  private contextManager: ContextManager;
  private callbacks: AgentEventCallbacks;
  private stateMachine: TaskStateMachine;
  private abortController: AbortController | null = null;

  // Multi-turn conversation state
  private currentConversationId: string | null = null;
  private activeModelId: string | null = null;
  private activeMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  constructor(options: AgentEngineOptions) {
    this.projectRoot = options.projectRoot;
    this.config = options.config;
    this.db = options.db;
    this.toolRegistry = options.toolRegistry;
    this.modelRouter = options.modelRouter;
    this.openRouterClient = options.openRouterClient;
    this.projectMapper = options.projectMapper;
    this.gitManager = options.gitManager;
    this.contextManager = options.contextManager;
    this.callbacks = options.callbacks || {};
    this.stateMachine = new TaskStateMachine("Idle");

    this.stateMachine.onStateChange((e) => {
      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange(e.currentState, e.message);
      }
    });
  }

  public getState(): AgentState {
    return this.stateMachine.getState();
  }

  public setCallbacks(callbacks: AgentEventCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public getActiveConversationId(): string | null {
    return this.currentConversationId;
  }

  public setActiveConversationId(id: string | null): void {
    this.currentConversationId = id;
    this.activeMessages = [];
  }

  public getActiveModel(): string {
    return this.activeModelId || this.config.defaultModel || "openrouter/free";
  }

  public setActiveModel(modelId: string): void {
    this.activeModelId = modelId;
  }

  public updateCredentials(apiKey: string, baseUrl?: string): void {
    this.openRouterClient.updateCredentials(apiKey, baseUrl);
  }

  public clearConversation(): void {
    this.currentConversationId = null;
    this.activeMessages = [];
    this.stateMachine.transition("Idle", "Conversation cleared");
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getGitManager(): GitManager {
    return this.gitManager;
  }

  public getDatabase(): LocalDatabase {
    return this.db;
  }

  public getProjectMapper(): ProjectMapper {
    return this.projectMapper;
  }

  public getModelRouter(): ModelRouter {
    return this.modelRouter;
  }

  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.stateMachine.transition("Cancelled", "Task cancelled by user");
  }

  /**
   * Runs the autonomous agent loop for a user turn within a persistent conversation.
   */
  public async runTask(
    taskDescription: string,
    options: {
      conversationId?: string;
      taskId?: string;
      manualModel?: string;
      autoApprove?: boolean;
    } = {}
  ): Promise<AgentRunSummary> {
    const startTime = Date.now();
    this.abortController = new AbortController();

    // 1. Maintain or establish conversation
    let conv: ConversationRecord;
    const targetConvId = options.conversationId || this.currentConversationId;

    if (targetConvId) {
      const existing = this.db.getConversation(targetConvId);
      conv = existing || this.db.createConversation(this.projectRoot, taskDescription.slice(0, 50));
    } else {
      conv = this.db.createConversation(this.projectRoot, taskDescription.slice(0, 50));
    }
    this.currentConversationId = conv.id;

    // 2. Create task record for this turn
    let task: TaskRecord;
    if (options.taskId) {
      const existing = this.db.getTask(options.taskId);
      task = existing || this.db.createTask(conv.id, this.projectRoot, taskDescription, this.config.maxIterations);
    } else {
      task = this.db.createTask(conv.id, this.projectRoot, taskDescription, this.config.maxIterations);
    }

    this.stateMachine.transition("Planning", `Analyzing context for: "${taskDescription.slice(0, 60)}"`);

    // 3. Create checkpoint if enabled
    let checkpointId: string | undefined;
    if (this.config.autoCheckpoint) {
      try {
        checkpointId = await this.gitManager.createCheckpoint(
          `Turn checkpoint: ${taskDescription.slice(0, 40)}`,
          task.id
        );
      } catch {
        // Continue even if checkpoint fails
      }
    }

    // 4. Model Selection & Routing
    const modelToUse = options.manualModel || this.activeModelId || undefined;
    const routingDecision = this.modelRouter.selectModel(taskDescription, modelToUse);
    this.activeModelId = routingDecision.selectedModel.id;

    if (this.callbacks.onModelSelected) {
      this.callbacks.onModelSelected(routingDecision);
    }

    // 5. Initialize system prompt if starting new conversation
    if (this.activeMessages.length === 0) {
      const projectSummary = this.projectMapper.buildProjectContextSummary();
      const privacyNotice =
        this.config.privacyMode === "strict"
          ? "[PRIVACY NOTICE: Strict Mode active. Context is sent with user consent.]"
          : "[PRIVACY NOTICE: Standard Mode. Secrets and unnecessary files are strictly filtered.]";

      const systemPromptText = getSystemPrompt(projectSummary, privacyNotice);
      this.activeMessages.push({ role: "system", content: systemPromptText });
      this.db.addMessage(conv.id, "system", systemPromptText);
    }

    // 6. Strict Privacy Check
    if (this.config.privacyMode === "strict" && this.callbacks.onStrictPrivacyPrompt) {
      const preview = `Model: ${routingDecision.selectedModel.id}\nPrompt: ${taskDescription}\nProject Root: ${this.projectRoot}`;
      const approved = await this.callbacks.onStrictPrivacyPrompt(preview);
      if (!approved) {
        this.stateMachine.transition("Cancelled", "Strict privacy approval denied by user");
        this.db.updateTask(task.id, { state: "Cancelled" });
        return {
          taskId: task.id,
          conversationId: conv.id,
          state: "Cancelled",
          iterations: 0,
          toolsExecuted: 0,
          filesModified: [],
          finalResponse: "Action cancelled: You did not approve sending context to OpenRouter.",
          totalDurationMs: Date.now() - startTime,
        };
      }
    }

    // 7. Append User Prompt to Conversation
    this.activeMessages.push({ role: "user", content: taskDescription });
    this.db.addMessage(conv.id, "user", taskDescription);

    const openAITools = this.toolRegistry.getOpenAITools();
    let iterationCount = 0;
    let toolsExecutedCount = 0;
    let finalAssistantResponse = "";
    let verificationAttempted = false;

    // 8. Main Agent Iterative Loop for this Turn
    while (iterationCount < this.config.maxIterations) {
      if (this.abortController.signal.aborted) {
        this.stateMachine.transition("Cancelled", "Task interrupted");
        this.db.updateTask(task.id, { state: "Cancelled", iteration_count: iterationCount });
        break;
      }

      iterationCount++;
      this.stateMachine.transition("Executing", `Processing step ${iterationCount}/${this.config.maxIterations}`);
      this.db.updateTask(task.id, { state: "Executing", iteration_count: iterationCount });

      // Sanitize context messages before sending
      const cleanMessages = this.contextManager.sanitizeMessages(this.activeMessages);

      let completion: ModelCompletionResult;
      try {
        completion = await this.openRouterClient.completeWithFallback({
          messages: cleanMessages,
          tools: openAITools,
          primaryModel: routingDecision.selectedModel.id,
          fallbackChain: routingDecision.fallbackChain,
          abortSignal: this.abortController.signal,
        });
      } catch (err: any) {
        if (this.abortController.signal.aborted) break;
        this.stateMachine.transition("Failed", `OpenRouter API error: ${err.message}`);
        this.db.updateTask(task.id, { state: "Failed", error: err.message, iteration_count: iterationCount });
        throw err;
      }

      if (completion.content) {
        finalAssistantResponse = completion.content;
        if (this.callbacks.onThinking) {
          this.callbacks.onThinking(completion.content);
        }
      }

      // Record assistant message
      this.activeMessages.push({
        role: "assistant",
        content: completion.content || null,
        tool_calls: completion.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });

      this.db.addMessage(conv.id, "assistant", completion.content || null, {
        tool_calls: completion.toolCalls,
        model: completion.modelUsed,
        prompt_tokens: completion.promptTokens,
        completion_tokens: completion.completionTokens,
      });

      // If no tool calls requested, model considers step or task completed
      if (completion.toolCalls.length === 0) {
        // Auto-verify if files were modified in this turn
        const modifiedFiles = this.db.getFileChanges(task.id);
        if (this.config.autoVerify && modifiedFiles.length > 0 && !verificationAttempted) {
          verificationAttempted = true;
          this.stateMachine.transition("Verifying", "Running automated verification...");

          const meta = this.projectMapper.getMetadata();
          if (meta.testScript || meta.buildScript) {
            const verifyCmd = meta.testScript || meta.buildScript!;
            const verifyTool = this.toolRegistry.get("run_command");
            if (verifyTool) {
              const execRes = await this.toolRegistry.executeTool(
                "run_command",
                { command: verifyCmd },
                {
                  taskId: task.id,
                  conversationId: conv.id,
                  autoApprove: true,
                }
              );

              if (execRes.success && execRes.data?.exit_code !== 0) {
                // Test failed! Feed output back to model so it can fix the error
                this.activeMessages.push({
                  role: "user",
                  content: `Verification check failed with exit code ${execRes.data?.exit_code}:\nCommand: ${verifyCmd}\nStderr: ${execRes.data?.stderr}\nStdout: ${execRes.data?.stdout}\nPlease analyze this error and fix the code.`,
                });
                continue;
              }
            }
          }
        }

        // Turn complete!
        this.stateMachine.transition("Completed", "Finished response");
        this.db.updateTask(task.id, {
          state: "Completed",
          completed_at: Date.now(),
          iteration_count: iterationCount,
        });
        break;
      }

      // Execute tool calls sequentially
      for (const toolCall of completion.toolCalls) {
        if (this.abortController.signal.aborted) break;

        if (this.callbacks.onToolStart) {
          this.callbacks.onToolStart(toolCall.name, toolCall.arguments);
        }

        const toolStart = Date.now();
        const execContext: ToolExecutionContext = {
          taskId: task.id,
          conversationId: conv.id,
          autoApprove: options.autoApprove ?? !this.config.requireCodeApproval,
          onApprovalRequest: this.callbacks.onApprovalRequired,
        };

        const result = await this.toolRegistry.executeTool(
          toolCall.name,
          toolCall.arguments,
          execContext
        );

        const durationMs = Date.now() - toolStart;
        toolsExecutedCount++;

        if (this.callbacks.onToolComplete) {
          this.callbacks.onToolComplete(
            toolCall.name,
            result.data || result.error,
            result.success,
            durationMs
          );
        }

        // Record in SQLite tool execution log
        this.db.recordToolExecution({
          taskId: task.id,
          conversationId: conv.id,
          toolName: toolCall.name,
          input: toolCall.arguments,
          output: result.data,
          error: result.error,
          status: result.success ? "success" : "failure",
          durationMs,
        });

        const toolOutputContent = result.success
          ? typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data, null, 2)
          : `Error: ${result.error}`;

        // Return tool result to model in activeMessages
        this.activeMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolOutputContent,
        });

        this.db.addMessage(conv.id, "tool", toolOutputContent, {
          tool_call_id: toolCall.id,
        });
      }
    }

    const modified = this.db.getFileChanges(task.id).map((f) => f.file_path);
    const uniqueFiles = Array.from(new Set(modified));

    const summary: AgentRunSummary = {
      taskId: task.id,
      conversationId: conv.id,
      state: this.stateMachine.getState(),
      iterations: iterationCount,
      toolsExecuted: toolsExecutedCount,
      filesModified: uniqueFiles,
      finalResponse: finalAssistantResponse || "Ready for your next instruction.",
      totalDurationMs: Date.now() - startTime,
      checkpointId,
    };

    if (this.callbacks.onComplete) {
      this.callbacks.onComplete(summary);
    }

    return summary;
  }
}
