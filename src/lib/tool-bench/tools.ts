import { z } from "zod";
import type { BenchCaseInput } from "./types";

export const ARGUMENT_FIELDS = {
  order_id: {
    description: "The order referenced by the customer.",
    values: null,
  },
  payment_id: {
    description:
      "The payment to refund, not another payment mentioned for context.",
    values: null,
  },
  reason: {
    description: "Why the requested payment should be refunded.",
    values: ["duplicate", "not_received", "damaged"],
  },
  subscription_id: {
    description: "The subscription the customer wants cancelled.",
    values: null,
  },
  timing: {
    description:
      "When to cancel: now for immediate cancellation, period_end to retain the already paid access.",
    values: ["now", "period_end"],
  },
  customer_id: {
    description: "The customer who needs a ticket or a human escalation.",
    values: null,
  },
  category: {
    description:
      "Ticket subject: billing for invoices or charges, technical for software faults, delivery for shipping problems.",
    values: ["billing", "technical", "delivery"],
  },
  priority: {
    description:
      "Human escalation urgency: urgent for a stated immediate critical impact; normal for routine requests.",
    values: ["normal", "urgent"],
  },
} satisfies Record<string, { description: string; values: string[] | null }>;
export type ArgumentField = keyof typeof ARGUMENT_FIELDS;
export const TOOL_REGISTRY: {
  name: ToolName;
  description: string;
  fields: ArgumentField[];
}[] = [
  {
    name: "lookup_order",
    description:
      "Retrieve order details such as items and totals when the customer asks to inspect an order.",
    fields: ["order_id"],
  },
  {
    name: "track_shipment",
    description:
      "Retrieve carrier progress and estimated arrival for a shipped order.",
    fields: ["order_id"],
  },
  {
    name: "refund_payment",
    description:
      "Refund a specific payment when the customer explicitly requests a refund for a duplicate charge, nonreceipt, or damage.",
    fields: ["payment_id", "reason"],
  },
  {
    name: "cancel_subscription",
    description:
      "Cancel a subscription at the timing explicitly requested by the customer.",
    fields: ["subscription_id", "timing"],
  },
  {
    name: "create_ticket",
    description:
      "Open a support ticket in the requested issue category when the customer requests a ticket rather than immediate human escalation.",
    fields: ["customer_id", "category"],
  },
  {
    name: "escalate_to_human",
    description:
      "Route the customer to a human when they explicitly request a human or supervisor, using the stated urgency.",
    fields: ["customer_id", "priority"],
  },
];

/**
 * Local execution contract. Kept strict and independent of the per-case entity
 * candidates so an off-suite but structurally valid call still runs and shows a
 * real result instead of a fabricated one.
 */
const toolDefinitions = {
  lookup_order: z.object({ order_id: z.string().min(1) }).strict(),
  track_shipment: z.object({ order_id: z.string().min(1) }).strict(),
  refund_payment: z
    .object({
      payment_id: z.string().min(1),
      reason: z.enum(["duplicate", "not_received", "damaged"]),
    })
    .strict(),
  cancel_subscription: z
    .object({
      subscription_id: z.string().min(1),
      timing: z.enum(["now", "period_end"]),
    })
    .strict(),
  create_ticket: z
    .object({
      customer_id: z.string().min(1),
      category: z.enum(["billing", "technical", "delivery"]),
    })
    .strict(),
  escalate_to_human: z
    .object({
      customer_id: z.string().min(1),
      priority: z.enum(["normal", "urgent"]),
    })
    .strict(),
} as const;
export type ToolName = keyof typeof toolDefinitions;
export type ToolArguments = {
  [Name in ToolName]: z.infer<(typeof toolDefinitions)[Name]>;
};
export function getToolDefinition(
  name: string,
): (typeof toolDefinitions)[ToolName] | null {
  return Object.hasOwn(toolDefinitions, name)
    ? toolDefinitions[name as ToolName]
    : null;
}

export function argumentCandidates(
  input: BenchCaseInput,
  field: ArgumentField,
): string[] {
  const candidates = ARGUMENT_FIELDS[field].values ?? input.entities[field];
  if (!candidates?.length)
    throw new Error(`No candidates supplied for ${field}.`);
  return [...candidates];
}
export function createToolSchemas(input: BenchCaseInput) {
  return TOOL_REGISTRY.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      strict: true,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          tool.fields.map((field) => [
            field,
            {
              type: "string" as const,
              enum: argumentCandidates(input, field),
              description: ARGUMENT_FIELDS[field].description,
            },
          ]),
        ),
        required: [...tool.fields],
        additionalProperties: false,
      },
    },
  }));
}
