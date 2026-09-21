import { getToolDefinition, type ToolArguments, type ToolName } from "./tools";
import type { ToolCall, ToolExecution } from "./types";

/** Every prepared result the arena can render. Adding a tool must extend this. */
export type ToolResult =
  | {
      kind: "order";
      orderId: string;
      status: string;
      items: number;
      total: string;
    }
  | {
      kind: "shipment";
      orderId: string;
      carrier: string;
      status: string;
      eta: string;
    }
  | {
      kind: "refund";
      paymentId: string;
      reason: ToolArguments["refund_payment"]["reason"];
      status: string;
      amount: string;
    }
  | {
      kind: "cancellation";
      subscriptionId: string;
      timing: ToolArguments["cancel_subscription"]["timing"];
      status: string;
      effective: string;
    }
  | {
      kind: "ticket";
      ticketId: string;
      customerId: string;
      category: ToolArguments["create_ticket"]["category"];
      status: string;
      queue: string;
    }
  | {
      kind: "escalation";
      customerId: string;
      priority: ToolArguments["escalate_to_human"]["priority"];
      status: string;
      queue: string;
      waitMinutes: number;
    };

/** A registry tool without a prepared renderer must fail the build, not run. */
function assertNever(value: never): never {
  throw new Error(`Unhandled tool: ${JSON.stringify(value)}`);
}

/** Resolves after the delay, or rejects with the abort reason without leaving a timer. */
export function abortableDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Fixed in-memory fixtures. These tools never contact an external system,
// mutate data, or depend on wall-clock time, so the same call always renders
// the same result for every lane.
function buildFixtureResult<Name extends ToolName>(
  tool: Name,
  args: ToolArguments[Name],
): ToolResult {
  switch (tool) {
    case "lookup_order": {
      const { order_id } = args as ToolArguments["lookup_order"];
      return {
        kind: "order",
        orderId: order_id,
        status: "Delivered",
        items: 2,
        total: "$84.00",
      };
    }
    case "track_shipment": {
      const { order_id } = args as ToolArguments["track_shipment"];
      return {
        kind: "shipment",
        orderId: order_id,
        carrier: "Northwind Freight",
        status: "Out for delivery",
        eta: "Today, 6:00 PM",
      };
    }
    case "refund_payment": {
      const { payment_id, reason } = args as ToolArguments["refund_payment"];
      return {
        kind: "refund",
        paymentId: payment_id,
        reason,
        status: "Refund queued",
        amount: "$42.00",
      };
    }
    case "cancel_subscription": {
      const { subscription_id, timing } =
        args as ToolArguments["cancel_subscription"];
      return {
        kind: "cancellation",
        subscriptionId: subscription_id,
        timing,
        status: "Cancellation scheduled",
        effective: timing === "now" ? "Immediately" : "End of paid period",
      };
    }
    case "create_ticket": {
      const { customer_id, category } = args as ToolArguments["create_ticket"];
      return {
        kind: "ticket",
        ticketId: `TCK-${customer_id}`,
        customerId: customer_id,
        category,
        status: "Ticket opened",
        queue: `${category} support`,
      };
    }
    case "escalate_to_human": {
      const { customer_id, priority } =
        args as ToolArguments["escalate_to_human"];
      return {
        kind: "escalation",
        customerId: customer_id,
        priority,
        status: "Routed to a human",
        queue: priority === "urgent" ? "Priority queue" : "Standard queue",
        waitMinutes: priority === "urgent" ? 2 : 11,
      };
    }
    default:
      return assertNever(tool);
  }
}

export async function executeToolCall(
  call: ToolCall,
  signal: AbortSignal,
  delayMs = 180,
): Promise<ToolExecution> {
  const definition = getToolDefinition(call.tool);
  if (!definition) throw new Error(`Unknown tool: ${call.tool}`);
  const parsed = definition.safeParse(call.arguments);
  if (!parsed.success) throw new Error(`Invalid arguments for ${call.tool}.`);
  await abortableDelay(delayMs, signal);
  const tool = call.tool as ToolName;
  return {
    tool,
    arguments: parsed.data,
    result: buildFixtureResult(tool, parsed.data as ToolArguments[ToolName]),
  };
}
