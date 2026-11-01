import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export interface ModelOption {
  label: string;
  value: string;
  description: string;
}

export const POPULAR_FREE_MODELS: ModelOption[] = [
  {
    label: "1. Qwen 2.5 Coder 32B  [SOTA Coding & Editing]",
    value: "qwen/qwen-2.5-coder-32b-instruct:free",
    description: "Specialized for deep programming and targeted edits",
  },
  {
    label: "2. Llama 3.3 70B       [Deep Reasoning & Architecture]",
    value: "meta-llama/llama-3.3-70b-instruct:free",
    description: "Flagship 70B open weights model for complex logic",
  },
  {
    label: "3. Gemini 2.0 Flash    [Fastest & 1M Context]",
    value: "google/gemini-2.0-flash-exp:free",
    description: "Google ultra-low latency model with massive context",
  },
  {
    label: "4. DeepSeek R1         [Math & Algorithmic Reasoning]",
    value: "deepseek/deepseek-r1:free",
    description: "Advanced chain-of-thought mathematical reasoning",
  },
  {
    label: "5. Mistral Small 24B   [Compact & Fast Refactoring]",
    value: "mistralai/mistral-small-24b-instruct-2501:free",
    description: "Efficient and concise instruction-following model",
  },
  {
    label: "6. OpenRouter Free     [Dynamic Automatic Router]",
    value: "openrouter/free",
    description: "Automatically routes to healthy available free models",
  },
];

interface ModelPickerProps {
  currentModel: string;
  onSelect: (modelId: string) => void;
  onCancel: () => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  currentModel,
  onSelect,
  onCancel,
}) => {
  const items = POPULAR_FREE_MODELS.map((m) => ({
    label: `${m.label} ${m.value === currentModel ? "★ (Active)" : ""}`,
    value: m.value,
  }));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="magentaBright">
          ✦ SELECT FREE AI MODEL
        </Text>
        <Text color="gray">[Esc to Cancel]</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          Press [↑/↓] arrows to choose, then [Enter] to switch model:
        </Text>
      </Box>

      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
    </Box>
  );
};
