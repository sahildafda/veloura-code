export type AgentState =
  | "Idle"
  | "Planning"
  | "Executing"
  | "WaitingForApproval"
  | "Verifying"
  | "Completed"
  | "Failed"
  | "Cancelled";

export interface AgentStateEvent {
  previousState: AgentState;
  currentState: AgentState;
  message?: string;
  timestamp: number;
}

export type StateChangeListener = (event: AgentStateEvent) => void;

export class TaskStateMachine {
  private currentState: AgentState = "Idle";
  private listeners: StateChangeListener[] = [];

  constructor(initialState: AgentState = "Idle") {
    this.currentState = initialState;
  }

  public getState(): AgentState {
    return this.currentState;
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public transition(nextState: AgentState, message?: string): void {
    if (this.currentState === nextState) return;

    // Validate valid state transitions
    const validTransitions: Record<AgentState, AgentState[]> = {
      Idle: ["Planning", "Executing", "Cancelled"],
      Planning: ["Executing", "WaitingForApproval", "Cancelled", "Failed"],
      Executing: ["WaitingForApproval", "Verifying", "Completed", "Failed", "Cancelled"],
      WaitingForApproval: ["Executing", "Cancelled", "Failed"],
      Verifying: ["Executing", "Completed", "Failed", "Cancelled"],
      Completed: ["Idle", "Planning"],
      Failed: ["Idle", "Planning"],
      Cancelled: ["Idle", "Planning"],
    };

    const allowed = validTransitions[this.currentState] || [];
    if (!allowed.includes(nextState)) {
      // In emergency or cancellation, allow transitioning to Cancelled / Failed regardless
      if (nextState !== "Cancelled" && nextState !== "Failed") {
        throw new Error(
          `Invalid state transition: cannot move from '${this.currentState}' to '${nextState}'`
        );
      }
    }

    const event: AgentStateEvent = {
      previousState: this.currentState,
      currentState: nextState,
      message,
      timestamp: Date.now(),
    };

    this.currentState = nextState;

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Prevent listener failures from crashing the engine
      }
    }
  }
}
