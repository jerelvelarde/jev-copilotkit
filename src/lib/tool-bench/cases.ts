import type { BenchCase, BenchCaseInput } from "./types";

// The authored support-v1 fixture deliberately uses explicit requests with
// competing entity candidates. Labels are consumed only by scoring and samples.
const entities = {
  order_id: ["ORD-1042", "ORD-1089"],
  payment_id: ["PAY-501", "PAY-502"],
  subscription_id: ["SUB-310", "SUB-720"],
  customer_id: ["CUS-18", "CUS-63"],
};
export const BENCH_CASES: BenchCase[] = [
  {
    id: "order-details",
    prompt:
      "I need to check the item list and total for order ORD-1042. ORD-1089 belongs to my previous purchase; please leave that one alone.",
    entities,
    expected: { tool: "lookup_order", arguments: { order_id: "ORD-1042" } },
  },
  {
    id: "shipment-location",
    prompt:
      "Where is the package for ORD-1089? Please check its carrier progress and arrival estimate. ORD-1042 has already arrived.",
    entities,
    expected: { tool: "track_shipment", arguments: { order_id: "ORD-1089" } },
  },
  {
    id: "duplicate-payment",
    prompt:
      "I was charged twice for one purchase. PAY-501 is the original payment and PAY-502 is the extra charge. Please refund only the extra payment.",
    entities,
    expected: {
      tool: "refund_payment",
      arguments: { payment_id: "PAY-502", reason: "duplicate" },
    },
  },
  {
    id: "cancel-at-renewal",
    prompt:
      "Please stop the renewal of SUB-310, but keep my access until my current paid period ends. Keep SUB-720 active.",
    entities,
    expected: {
      tool: "cancel_subscription",
      arguments: { subscription_id: "SUB-310", timing: "period_end" },
    },
  },
  {
    id: "technical-ticket",
    prompt:
      "I am CUS-63. The app crashes every time I open Settings. Please open a technical support ticket for me. CUS-18 is my colleague's account, not mine.",
    entities,
    expected: {
      tool: "create_ticket",
      arguments: { customer_id: "CUS-63", category: "technical" },
    },
  },
  {
    id: "urgent-human",
    prompt:
      "This is CUS-18, not CUS-63. Our production checkout is completely down and every sale is blocked. I need a human support supervisor immediately; please escalate this as urgent.",
    entities,
    expected: {
      tool: "escalate_to_human",
      arguments: { customer_id: "CUS-18", priority: "urgent" },
    },
  },
  {
    id: "damaged-refund",
    prompt:
      "The item purchased with PAY-501 arrived shattered. Please refund that payment for the damage. The item paid with PAY-502 is fine.",
    entities,
    expected: {
      tool: "refund_payment",
      arguments: { payment_id: "PAY-501", reason: "damaged" },
    },
  },
  {
    id: "missing-refund",
    prompt:
      "The package paid for with PAY-502 never arrived and I no longer want a replacement or a tracking check. Please refund that payment for nonreceipt. My PAY-501 purchase arrived safely.",
    entities,
    expected: {
      tool: "refund_payment",
      arguments: { payment_id: "PAY-502", reason: "not_received" },
    },
  },
  {
    id: "cancel-immediately",
    prompt:
      "Cancel SUB-720 immediately, even though that ends access today. Do not wait until the billing period ends. Leave SUB-310 running.",
    entities,
    expected: {
      tool: "cancel_subscription",
      arguments: { subscription_id: "SUB-720", timing: "now" },
    },
  },
  {
    id: "billing-ticket",
    prompt:
      "I am CUS-18. Please open a ticket about the wrong company name on my invoice. I am not requesting a refund or a human escalation. CUS-63 is a different customer.",
    entities,
    expected: {
      tool: "create_ticket",
      arguments: { customer_id: "CUS-18", category: "billing" },
    },
  },
  {
    id: "delivery-ticket",
    prompt:
      "For customer CUS-63, open a delivery support ticket about repeated failed delivery attempts. We already checked tracking and do not need another tracking check or a refund. CUS-18 is unrelated.",
    entities,
    expected: {
      tool: "create_ticket",
      arguments: { customer_id: "CUS-63", category: "delivery" },
    },
  },
  {
    id: "routine-human",
    prompt:
      "I am CUS-63, not CUS-18. Please pass me to a human to discuss my account options. This is a routine question with no urgency, so the normal queue is fine.",
    entities,
    expected: {
      tool: "escalate_to_human",
      arguments: { customer_id: "CUS-63", priority: "normal" },
    },
  },
];

/** Build a new allowlisted object; a structurally compatible BenchCase may carry labels. */
export function toCaseInput(input: BenchCaseInput): BenchCaseInput {
  return structuredClone({
    id: input.id,
    prompt: input.prompt,
    entities: input.entities,
  });
}
