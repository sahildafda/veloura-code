import { z } from "zod";
import OpenAI from "openai";

export type PermissionLevel = "read" | "write" | "execute" | "destructive";

export interface ToolExecutionContext {
  taskId?: string;
  conversationId: string;
  autoApprove?: boolean;
  onApprovalRequest?: (toolName: string, description: string, params: any) => Promise<boolean>;
}

export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  permission: PermissionLevel;
  timeoutMs?: number;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  public register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  public getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Converts all registered tools into OpenAI function calling format.
   */
  public getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((tool) => {
      const jsonSchema = this.zodToJsonSchema(tool.schema);
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      };
    });
  }

  /**
   * Executes a registered tool safely with argument validation and permission checks.
   */
  public async executeTool(
    name: string,
    rawArguments: any,
    context: ToolExecutionContext
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: '${name}'. You may only invoke tools that are explicitly registered.`,
      };
    }

    // Validate inputs
    let validatedInput: any;
    try {
      validatedInput = tool.schema.parse(rawArguments);
    } catch (err: any) {
      return {
        success: false,
        error: `Invalid arguments for tool '${name}': ${err.message}`,
      };
    }

    // Permission check for destructive actions
    if (tool.permission === "destructive" && !context.autoApprove) {
      if (context.onApprovalRequest) {
        const approved = await context.onApprovalRequest(
          tool.name,
          tool.description,
          validatedInput
        );
        if (!approved) {
          return {
            success: false,
            error: `Tool execution denied: User rejected approval for '${tool.name}'`,
          };
        }
      } else {
        return {
          success: false,
          error: `Tool execution denied: '${tool.name}' requires explicit approval.`,
        };
      }
    }

    // Execute with timeout
    const timeoutMs = tool.timeoutMs || 60_000;
    try {
      const result = await Promise.race([
        tool.execute(validatedInput, context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      return {
        success: true,
        data: result,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Tool error: ${err.message}`,
      };
    }
  }

  /**
   * Converts basic Zod schemas to JSON Schema for OpenAI tools.
   */
  private zodToJsonSchema(schema: z.ZodType<any>): Record<string, any> {
    // Generate standard JSON schema object
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, propSchema] of Object.entries(shape)) {
        properties[key] = this.zodPropertyToJson(propSchema as z.ZodType<any>);
        if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodDefault)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required,
      };
    }

    return { type: "object", properties: {} };
  }

  private zodPropertyToJson(prop: z.ZodType<any>): Record<string, any> {
    if (prop instanceof z.ZodOptional || prop instanceof z.ZodDefault) {
      return this.zodPropertyToJson(prop._def.innerType);
    }
    if (prop instanceof z.ZodString) {
      return { type: "string", description: prop.description };
    }
    if (prop instanceof z.ZodNumber) {
      return { type: "number", description: prop.description };
    }
    if (prop instanceof z.ZodBoolean) {
      return { type: "boolean", description: prop.description };
    }
    if (prop instanceof z.ZodArray) {
      return {
        type: "array",
        items: this.zodPropertyToJson(prop.element),
        description: prop.description,
      };
    }
    if (prop instanceof z.ZodEnum) {
      return {
        type: "string",
        enum: prop._def.values,
        description: prop.description,
      };
    }
    return { type: "string" };
  }
}
