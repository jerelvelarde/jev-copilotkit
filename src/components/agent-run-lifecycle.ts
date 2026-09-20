import type { AbstractAgent } from "@ag-ui/client";

type AgentRunLifecycleOptions<State> = {
  agent: AbstractAgent;
  runId: string;
  currentState: () => State;
  isTerminal: (state: State) => boolean;
  interrupt: (state: State, error?: string) => State;
  run: () => Promise<unknown>;
  isCancelled: () => boolean;
  onError: (message: string) => void;
  onFallback: (state: State) => void;
  failureMessage: string;
  incompleteMessage: string;
};

/** CopilotKit may resolve on RUN_ERROR or transport failure; require terminal state. */
export async function runWithAgentLifecycle<State>({
  agent,
  runId,
  currentState,
  isTerminal,
  interrupt,
  run,
  isCancelled,
  onError,
  onFallback,
  failureMessage,
  incompleteMessage,
}: AgentRunLifecycleOptions<State>): Promise<void> {
  let failure: string | null = null;
  const fail = (message: string) => {
    if (isCancelled()) return;
    failure ??= message;
    onError(failure);
    onFallback(interrupt(currentState(), failure));
  };
  const subscription = agent.subscribe({
    onRunErrorEvent: ({ event, input }) => {
      if (input.runId === runId) fail(event.message);
    },
    onRunFailed: ({ error, input }) => {
      if (input.runId === runId) fail(error.message);
    },
  });

  try {
    await run();
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : failureMessage);
  } finally {
    subscription.unsubscribe();
    const current = currentState();
    if (!isTerminal(current)) {
      if (isCancelled()) onFallback(interrupt(current));
      else fail(failure ?? incompleteMessage);
    }
  }
}
