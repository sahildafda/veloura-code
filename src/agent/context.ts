import OpenAI from "openai";
import { PrivacyManager } from "../security/privacy.js";
import { SecretDetector } from "../security/secrets.js";
import { VelouraConfig } from "../config/config.js";

export class ContextManager {
  private privacyManager: PrivacyManager;
  private config: VelouraConfig;

  constructor(privacyManager: PrivacyManager, config: VelouraConfig) {
    this.privacyManager = privacyManager;
    this.config = config;
  }

  /**
   * Sanitizes all outgoing messages, removing sensitive credentials and limiting tokens.
   */
  public sanitizeMessages(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const sanitized: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        const { sanitized: cleanText } = SecretDetector.redact(msg.content);
        sanitized.push({
          ...msg,
          content: cleanText,
        });
      } else {
        sanitized.push(msg);
      }
    }

    return this.pruneContext(sanitized, this.config.maxContextTokens);
  }

  /**
   * Rough token estimation (1 token ≈ 4 characters).
   */
  public estimateTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content === "string") {
        totalChars += m.content.length;
      }
      if ("tool_calls" in m && Array.isArray(m.tool_calls)) {
        totalChars += JSON.stringify(m.tool_calls).length;
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Prunes conversation history intelligently when token limits are reached.
   * 
   * Strategy:
   * 1. Preserves the system prompt (messages[0]).
   * 2. Finds the LATEST user message (the active user prompt) and ensures it is NEVER pruned!
   * 3. Prunes older completed conversation turns from the beginning.
   * 4. Truncates overly massive tool outputs (> 8,000 chars) in the active turn to avoid
   *    swamping the context window while preserving the user's instructions.
   */
  private pruneContext(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    maxTokens: number
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    if (messages.length <= 2) {
      return messages;
    }

    // Always keep system prompt
    const system = messages[0];

    // Find the index of the latest user message
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 1; i--) {
      if (messages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) {
      // Fallback if no user message found
      return messages;
    }

    // Split into:
    // - olderHistory: messages from index 1 up to lastUserIndex - 1
    // - activeTurn: messages from lastUserIndex to the end (must be preserved!)
    let olderHistory = messages.slice(1, lastUserIndex);
    const activeTurn = messages.slice(lastUserIndex);

    // Truncate any single overly large tool message in the active turn (> 8000 chars)
    const sanitizedActiveTurn = activeTurn.map((m) => {
      if (m.role === "tool" && typeof m.content === "string" && m.content.length > 8000) {
        return {
          ...m,
          content:
            m.content.slice(0, 8000) +
            "\n\n... [Content truncated by Veloura: Remaining lines omitted to fit context window. Use start_line/end_line to inspect specific sections]",
        };
      }
      return m;
    });

    // Check if system + sanitizedActiveTurn already fits
    let currentCandidate = [system, ...olderHistory, ...sanitizedActiveTurn];
    if (this.estimateTokens(currentCandidate) <= maxTokens) {
      return currentCandidate;
    }

    // If context is still too large, drop oldest turns from olderHistory
    while (olderHistory.length > 0 && this.estimateTokens([system, ...olderHistory, ...sanitizedActiveTurn]) > maxTokens) {
      // Drop one message from older history
      olderHistory.shift();

      // Ensure we don't start olderHistory with an orphaned tool message
      while (olderHistory.length > 0 && olderHistory[0].role === "tool") {
        olderHistory.shift();
      }
    }

    return [system, ...olderHistory, ...sanitizedActiveTurn];
  }
}
