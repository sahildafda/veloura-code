import React, { useState, useEffect } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { Header } from "./Header.js";
import { ChatMessage, ChatTurn, ToolLogItem } from "./ChatMessage.js";
import { ModelPicker, POPULAR_FREE_MODELS } from "./ModelPicker.js";
import { HelpView } from "./HelpView.js";
import { AgentEngine } from "../agent/engine.js";
import { AgentState } from "../agent/state.js";

export interface AppProps {
  engine: AgentEngine;
  projectName: string;
  initialModel: string;
  privacyMode: string;
  initialTask?: string;
  maxIterations: number;
}

export const App: React.FC<AppProps> = ({
  engine,
  projectName,
  initialModel,
  privacyMode,
  initialTask,
  maxIterations,
}) => {
  const { exit } = useApp();
  const [activeModel, setActiveModel] = useState<string>(initialModel);
  const [agentState, setAgentState] = useState<AgentState>("Idle");
  const [currentActivity, setCurrentActivity] = useState<string>("");
  const [currentIteration, setCurrentIteration] = useState(0);
  const [inputText, setInputText] = useState("");
  const [completedTurns, setCompletedTurns] = useState<ChatTurn[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Live tool invocations for the currently active turn
  const [activeTurnTools, setActiveTurnTools] = useState<ToolLogItem[]>([]);

  // Pending user approval for destructive commands / privacy
  const [pendingApproval, setPendingApproval] = useState<{
    type: "tool" | "privacy";
    description: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // Git status info
  const [gitStatus, setGitStatus] = useState<{ branch?: string; isClean?: boolean }>({});

  useEffect(() => {
    // Initial Git check
    engine.getGitManager().getStatus().then((status) => {
      if (status.isGit) {
        setGitStatus({
          branch: status.branch,
          isClean: status.modified.length === 0 && status.not_added.length === 0,
        });
      }
    });

    if (initialTask) {
      handleUserSubmit(initialTask);
    }
  }, []);

  // Keyboard navigation & approval keys
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      engine.cancel();
      exit();
      return;
    }

    if (key.escape) {
      if (showModelPicker) setShowModelPicker(false);
      if (showHelp) setShowHelp(false);
      return;
    }

    if (pendingApproval) {
      if (input.toLowerCase() === "y") {
        pendingApproval.resolve(true);
        setPendingApproval(null);
      } else if (input.toLowerCase() === "n") {
        pendingApproval.resolve(false);
        setPendingApproval(null);
      }
    }
  });

  const handleUserSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;

    setInputText("");

    // 1. Check for Slash Commands
    if (trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      return;
    }

    // 2. Normal User Prompt Execution
    const turnId = Math.random().toString();
    setIsProcessing(true);
    setActiveTurnTools([]);
    setCurrentIteration(0);
    setAgentState("Planning");
    setCurrentActivity("Analyzing project context...");

    // Setup dynamic callbacks for this turn
    engine.setCallbacks({
      onStateChange: (state: AgentState, message?: string) => {
        setAgentState(state);
        if (message) setCurrentActivity(message);
        if (state === "Executing") {
          setCurrentIteration((i) => i + 1);
        }
      },
      onModelSelected: (decision) => {
        setActiveModel(decision.selectedModel.id);
      },
      onModelSwitch: (fromModel, toModel, reason) => {
        setActiveModel(toModel);
        setCompletedTurns((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            systemNotice: `⚠️ Rate limit / timeout: Switched from ${fromModel.split("/")[1] || fromModel} to ${toModel.split("/")[1] || toModel} (${reason})`,
            timestamp: Date.now(),
          },
        ]);
      },
      onThinking: (chunk: string) => {
        const line = chunk.trim().split("\n")[0];
        if (line) setCurrentActivity(line.slice(0, 70));
      },
      onToolStart: (toolName: string, args: any) => {
        const summary = Object.keys(args)
          .map((k) => `${k}=${JSON.stringify(args[k])?.slice(0, 20)}`)
          .join(", ");
        setActiveTurnTools((prev) => [
          ...prev,
          {
            toolName,
            argsSummary: summary || "no args",
            status: "running",
          },
        ]);
      },
      onToolComplete: (toolName: string, result: any, success: boolean, durationMs: number) => {
        setActiveTurnTools((prev) => {
          const updated = [...prev];
          const last = updated.reverse().find((t) => t.toolName === toolName && t.status === "running");
          if (last) {
            last.status = success ? "success" : "failure";
            last.durationMs = durationMs;
          }
          return [...updated];
        });
      },
      onApprovalRequired: (toolName: string, description: string, params: any) => {
        return new Promise<boolean>((resolve) => {
          setPendingApproval({
            type: "tool",
            description: `Tool '${toolName}' requires confirmation: ${description}\nArgs: ${JSON.stringify(params)}`,
            resolve,
          });
        });
      },
      onStrictPrivacyPrompt: (preview: string) => {
        return new Promise<boolean>((resolve) => {
          setPendingApproval({
            type: "privacy",
            description: `Strict Privacy Notice: Context payload preview:\n${preview}`,
            resolve,
          });
        });
      },
    });

    try {
      const summary = await engine.runTask(trimmed, {
        manualModel: activeModel,
      });

      // Complete this turn and push into permanent static list
      const completedTurn: ChatTurn = {
        id: turnId,
        userPrompt: trimmed,
        assistantReply: summary.finalResponse,
        toolLogs: [...activeTurnTools],
        filesModified: summary.filesModified,
        modelUsed: activeModel,
        timestamp: Date.now(),
      };

      setCompletedTurns((prev) => [...prev, completedTurn]);

      // Refresh git clean status
      engine.getGitManager().getStatus().then((status) => {
        if (status.isGit) {
          setGitStatus({
            branch: status.branch,
            isClean: status.modified.length === 0 && status.not_added.length === 0,
          });
        }
      });
    } catch (err: any) {
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: turnId,
          userPrompt: trimmed,
          systemNotice: `✕ Error executing turn: ${err.message}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsProcessing(false);
      setAgentState("Idle");
      setCurrentActivity("");
      setActiveTurnTools([]);
    }
  };

  const handleSlashCommand = async (cmd: string) => {
    const parts = cmd.split(" ");
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    if (command === "/help") {
      setShowHelp((prev) => !prev);
      return;
    }

    if (command === "/clear") {
      setCompletedTurns([]);
      setShowHelp(false);
      setShowModelPicker(false);
      return;
    }

    if (command === "/exit" || command === "/quit") {
      exit();
      return;
    }

    if (command === "/model") {
      if (!arg) {
        setShowModelPicker(true);
        return;
      }

      // Check if user entered a number 1..6
      const num = parseInt(arg, 10);
      if (!isNaN(num) && num >= 1 && num <= POPULAR_FREE_MODELS.length) {
        const picked = POPULAR_FREE_MODELS[num - 1].value;
        setActiveModel(picked);
        engine.setActiveModel(picked);
        setCompletedTurns((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            systemNotice: `Active model switched to: ${picked}`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // Model ID string
      setActiveModel(arg);
      engine.setActiveModel(arg);
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: `Active model switched to: ${arg}`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (command === "/free") {
      const list = POPULAR_FREE_MODELS.map((m) => `  ${m.label}`).join("\n");
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: `Available Free OpenRouter Models:\n${list}\n  Type '/model <number>' to switch.`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (command === "/diff") {
      const diffText = await engine.getGitManager().getDiff();
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: diffText ? `Active Session Code Diff:\n${diffText}` : "No uncommitted code changes.",
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (command === "/checkpoint") {
      const desc = arg || "Manual checkpoint";
      const id = await engine.getGitManager().createCheckpoint(desc);
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: `✔ Created local Git checkpoint '${id}' ("${desc}")`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (command === "/rollback") {
      const res = await engine.getGitManager().rollback(arg || undefined);
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: res.message,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (command === "/status") {
      const meta = engine.getProjectMapper().getMetadata();
      const status = await engine.getGitManager().getStatus();
      setCompletedTurns((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          systemNotice: `Project: ${meta.projectType} (${meta.languages.join(", ")})\n  Package Manager: ${meta.packageManager}\n  Git: ${status.branch || "none"} (${status.modified.length} modified, ${status.not_added.length} untracked)`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    setCompletedTurns((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        systemNotice: `Unknown command '${command}'. Type /help for available commands.`,
        timestamp: Date.now(),
      },
    ]);
  };

  const shortModel = activeModel.includes("/") ? activeModel.split("/")[1] : activeModel;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Top Header Card */}
      <Header
        modelName={activeModel}
        projectName={projectName}
        privacyMode={privacyMode}
        gitBranch={gitStatus.branch}
        isGitClean={gitStatus.isClean}
      />

      {/* Model Picker Modal if toggled */}
      {showModelPicker && (
        <ModelPicker
          currentModel={activeModel}
          onSelect={(selected) => {
            setActiveModel(selected);
            engine.setActiveModel(selected);
            setShowModelPicker(false);
            setCompletedTurns((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                systemNotice: `Active model switched to: ${selected}`,
                timestamp: Date.now(),
              },
            ]);
          }}
          onCancel={() => setShowModelPicker(false)}
        />
      )}

      {/* Help Card if toggled */}
      {showHelp && <HelpView />}

      {/*
        STATIC CHAT HISTORY (ZERO-FLICKER):
        Ink renders completed turns ONCE to stdout and never recalculates or clears them!
      */}
      <Static items={completedTurns}>
        {(turn) => <ChatMessage key={turn.id} turn={turn} />}
      </Static>

      {/* Dynamic Processing Status (Only this 1-2 line box redraws during thinking) */}
      {isProcessing && (
        <Box flexDirection="column" marginY={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color="cyanBright">
              <Spinner type="dots" />
            </Text>
            <Text bold color="cyanBright">
              [{agentState.toUpperCase()}]
            </Text>
            {currentIteration > 0 && (
              <Text color="gray">
                ({currentIteration}/{maxIterations})
              </Text>
            )}
            <Text color="white">{currentActivity}</Text>
          </Box>

          {/* Real-time active tool stream */}
          {activeTurnTools.length > 0 && (
            <Box flexDirection="column" marginLeft={2} marginTop={0}>
              {activeTurnTools.slice(-2).map((tl, i) => (
                <Box key={i} flexDirection="row" gap={1}>
                  <Text color={tl.status === "running" ? "cyan" : tl.status === "success" ? "green" : "red"}>
                    {tl.status === "running" ? "●" : tl.status === "success" ? "✔" : "✖"}
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
        </Box>
      )}

      {/* Pending Approval Confirmation (Only shown when a destructive command needs user approval) */}
      {pendingApproval && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellowBright"
          paddingX={2}
          paddingY={1}
          marginY={1}
        >
          <Text bold color="yellowBright">
            ⚠️ CONFIRMATION REQUIRED
          </Text>
          <Text color="white">{pendingApproval.description}</Text>
          <Box marginTop={1}>
            <Text bold color="greenBright">
              Approve action? Press [Y] for Yes / [N] for No:
            </Text>
          </Box>
        </Box>
      )}

      {/*
        DYNAMIC PROMPT BAR (Only this single line redraws on keystrokes - ZERO FLICKER!):
      */}
      {!isProcessing && !showModelPicker && (
        <Box flexDirection="row" alignItems="center" marginTop={1}>
          <Text bold color="cyanBright">
            ❯{" "}
          </Text>
          <TextInput
            value={inputText}
            onChange={setInputText}
            onSubmit={handleUserSubmit}
            placeholder={`Ask Veloura (${shortModel}) or /help...`}
          />
        </Box>
      )}
    </Box>
  );
};
