import React from "react";
import { Box, Text } from "ink";

export interface ToolLogItem {
  toolName: string;
  argsSummary: string;
  status: "running" | "success" | "failure";
  durationMs?: number;
}

export interface ChatTurn {
  id: string;
  userPrompt?: string;
  assistantReply?: string;
  systemNotice?: string;
  toolLogs?: ToolLogItem[];
  filesModified?: string[];
  modelUsed?: string;
  timestamp: number;
}

export const ChatMessage: React.FC<{ turn: ChatTurn }> = ({ turn }) => {
  // If it's a system notice (e.g. model switch, diff, checkpoint)
  if (turn.systemNotice) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="cyanBright">✦</Text>
          <Text color="gray">{turn.systemNotice}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {/* User Prompt */}
      {turn.userPrompt && (
        <Box flexDirection="row" gap={1} marginBottom={0}>
          <Text bold color="cyanBright">
            ❯
          </Text>
          <Text bold color="white">
            {turn.userPrompt}
          </Text>
        </Box>
      )}

      {/* Tool executions summary */}
      {turn.toolLogs && turn.toolLogs.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginY={0}>
          {turn.toolLogs.map((tl, i) => (
            <Box key={i} flexDirection="row" gap={1}>
              <Text color={tl.status === "success" ? "green" : tl.status === "failure" ? "red" : "cyan"}>
                {tl.status === "success" ? "✔" : tl.status === "failure" ? "✖" : "●"}
              </Text>
              <Text bold color="gray">
                {tl.toolName}
              </Text>
              <Text color="gray">({tl.argsSummary})</Text>
              {tl.durationMs !== undefined && <Text color="gray">[{tl.durationMs}ms]</Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* Files modified badge */}
      {turn.filesModified && turn.filesModified.length > 0 && (
        <Box flexDirection="row" gap={1} marginLeft={2} marginY={0}>
          <Text color="yellow">✏ Modified:</Text>
          <Text bold color="yellowBright">
            {turn.filesModified.join(", ")}
          </Text>
        </Box>
      )}

      {/* Assistant Reply */}
      {turn.assistantReply && (
        <Box flexDirection="column" marginTop={0}>
          <Box flexDirection="row" gap={1}>
            <Text bold color="greenBright">
              ✦ Veloura
            </Text>
            {turn.modelUsed && (
              <Text color="gray">({turn.modelUsed.split("/")[1] || turn.modelUsed})</Text>
            )}
          </Box>
          <Box marginLeft={2}>
            <Text color="white">{turn.assistantReply}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
