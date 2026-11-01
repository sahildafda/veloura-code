import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { AgentState } from "../agent/state.js";

interface StatusViewProps {
  state: AgentState;
  currentActivity?: string;
  iteration: number;
  maxIterations: number;
}

export const StatusView: React.FC<StatusViewProps> = ({
  state,
  currentActivity,
  iteration,
  maxIterations,
}) => {
  const getStateColor = (s: AgentState) => {
    switch (s) {
      case "Planning":
        return "yellow";
      case "Executing":
        return "cyanBright";
      case "WaitingForApproval":
        return "magentaBright";
      case "Verifying":
        return "blueBright";
      case "Completed":
        return "greenBright";
      case "Failed":
      case "Cancelled":
        return "redBright";
      default:
        return "gray";
    }
  };

  const isActive =
    state === "Planning" ||
    state === "Executing" ||
    state === "Verifying" ||
    state === "WaitingForApproval";

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {isActive && (
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
        )}
        <Box
          paddingX={1}
          borderColor={getStateColor(state)}
          borderStyle="single"
        >
          <Text bold color={getStateColor(state)}>
            [{state.toUpperCase()}]
          </Text>
        </Box>
        {iteration > 0 && (
          <Text color="gray">
            ({iteration}/{maxIterations})
          </Text>
        )}
        {currentActivity && <Text color="white">{currentActivity}</Text>}
      </Box>
    </Box>
  );
};
