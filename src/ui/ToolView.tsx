import React from "react";
import { Box, Text } from "ink";

export interface ToolLogEntry {
  id: string;
  toolName: string;
  argsSummary: string;
  status: "running" | "success" | "failure";
  durationMs?: number;
}

interface ToolViewProps {
  entries: ToolLogEntry[];
}

export const ToolView: React.FC<ToolViewProps> = ({ entries }) => {
  if (entries.length === 0) return null;

  // Show last 5 tool invocations
  const visible = entries.slice(-5);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="gray">
        Tool Invocations:
      </Text>
      {visible.map((item) => {
        let icon = "•";
        let color = "gray";

        if (item.status === "running") {
          icon = "⟳";
          color = "cyan";
        } else if (item.status === "success") {
          icon = "✓";
          color = "green";
        } else if (item.status === "failure") {
          icon = "✕";
          color = "red";
        }

        return (
          <Box key={item.id} flexDirection="row" gap={1}>
            <Text color={color}>{icon}</Text>
            <Text bold color="white">
              {item.toolName}
            </Text>
            <Text color="gray">({item.argsSummary})</Text>
            {item.durationMs !== undefined && (
              <Text color="gray">[{item.durationMs}ms]</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
