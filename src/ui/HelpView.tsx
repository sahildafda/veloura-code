import React from "react";
import { Box, Text } from "ink";

export const HelpView: React.FC = () => {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyanBright">
          ✦ VELOURA CODE COMMANDS
        </Text>
      </Box>

      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/model</Text>
          </Box>
          <Text color="gray">Open interactive model selector</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/model 1-6</Text>
          </Box>
          <Text color="gray">Quick-switch by number (1: Qwen, 2: Llama, 3: Gemini, etc.)</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/free</Text>
          </Box>
          <Text color="gray">List all available free OpenRouter models</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/diff</Text>
          </Box>
          <Text color="gray">View code changes made during this session</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/checkpoint</Text>
          </Box>
          <Text color="gray">Create a safe Git commit checkpoint</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/rollback</Text>
          </Box>
          <Text color="gray">Roll back working tree to previous checkpoint</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/status</Text>
          </Box>
          <Text color="gray">Show detected languages, framework & Git branch</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/clear</Text>
          </Box>
          <Text color="gray">Clear terminal screen history</Text>
        </Box>
        <Box flexDirection="row">
          <Box width={20}>
            <Text bold color="yellow">/exit</Text>
          </Box>
          <Text color="gray">Exit Veloura Code</Text>
        </Box>
      </Box>
    </Box>
  );
};
