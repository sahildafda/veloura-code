import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  modelName: string;
  projectName: string;
  privacyMode: string;
  gitBranch?: string;
  isGitClean?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  modelName,
  projectName,
  privacyMode,
  gitBranch,
  isGitClean,
}) => {
  const shortModel = modelName.includes("/") ? modelName.split("/")[1] : modelName;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={0}
        flexDirection="column"
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="cyanBright">
            ✦ VELOURA CODE
          </Text>
          <Text color="gray">v1.0.0 • OpenRouter Free</Text>
        </Box>

        <Box flexDirection="row" gap={2} marginTop={0}>
          <Text>
            <Text color="gray">Model: </Text>
            <Text bold color="greenBright">
              {shortModel}
            </Text>
          </Text>
          <Text color="gray">•</Text>
          <Text>
            <Text color="gray">Project: </Text>
            <Text bold color="yellow">
              {projectName}
            </Text>
          </Text>
          <Text color="gray">•</Text>
          <Text>
            <Text color="gray">Privacy: </Text>
            <Text color={privacyMode === "strict" ? "magentaBright" : "blueBright"}>
              {privacyMode.toUpperCase()}
            </Text>
          </Text>
          {gitBranch && (
            <>
              <Text color="gray">•</Text>
              <Text>
                <Text color="gray">Git: </Text>
                <Text color="cyan">{gitBranch}</Text>
                <Text color={isGitClean ? "green" : "yellow"}>
                  {isGitClean ? " (clean)" : " (modified)"}
                </Text>
              </Text>
            </>
          )}
        </Box>
      </Box>

      <Box flexDirection="row" gap={1} paddingX={1}>
        <Text color="gray">
          Commands: <Text color="yellow">/model</Text> switch model  •  <Text color="cyan">/diff</Text> view changes  •  <Text color="magenta">/help</Text> help  •  <Text color="red">/exit</Text> quit
        </Text>
      </Box>
    </Box>
  );
};
