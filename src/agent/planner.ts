export interface PlanStep {
  id: number;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export class Planner {
  /**
   * Parses or extracts plan steps from model output.
   */
  public static extractPlan(text: string): PlanStep[] {
    const lines = text.split("\n");
    const steps: PlanStep[] = [];
    let stepId = 1;

    for (const line of lines) {
      const match = line.match(/^\s*(?:\d+[\.\)]|\- \[[ x]\]|\*)\s+(.+)$/i);
      if (match && match[1].trim().length > 5) {
        steps.push({
          id: stepId++,
          description: match[1].trim(),
          status: "pending",
        });
      }
    }

    return steps;
  }
}
