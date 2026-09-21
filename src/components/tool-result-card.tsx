"use client";

import {
  Boxes,
  Package,
  Receipt,
  ShieldAlert,
  Ticket,
  UserRound,
} from "lucide-react";
import type { ToolResult } from "../lib/tool-bench/executor";
import type { ToolExecution } from "../lib/tool-bench/types";

type Prepared = {
  icon: typeof Boxes;
  title: string;
  rows: { label: string; value: string }[];
};

const timingLabels = { now: "Immediately", period_end: "End of paid period" };
const reasonLabels = {
  duplicate: "Duplicate charge",
  not_received: "Not received",
  damaged: "Damaged on arrival",
};

/**
 * Every label is application code and every value is escaped by React. A
 * provider can influence which tool runs, never what this card renders.
 */
function prepare(result: ToolResult): Prepared {
  switch (result.kind) {
    case "order":
      return {
        icon: Boxes,
        title: "Order details",
        rows: [
          { label: "Order", value: result.orderId },
          { label: "Delivery", value: result.status },
          { label: "Items", value: String(result.items) },
          { label: "Total", value: result.total },
        ],
      };
    case "shipment":
      return {
        icon: Package,
        title: "Shipment status",
        rows: [
          { label: "Order", value: result.orderId },
          { label: "Carrier", value: result.carrier },
          { label: "Status", value: result.status },
          { label: "Arrives", value: result.eta },
        ],
      };
    case "refund":
      return {
        icon: Receipt,
        title: "Refund",
        rows: [
          { label: "Payment", value: result.paymentId },
          { label: "Reason", value: reasonLabels[result.reason] },
          { label: "Status", value: result.status },
          { label: "Amount", value: result.amount },
        ],
      };
    case "cancellation":
      return {
        icon: ShieldAlert,
        title: "Subscription",
        rows: [
          { label: "Subscription", value: result.subscriptionId },
          { label: "Timing", value: timingLabels[result.timing] },
          { label: "Status", value: result.status },
          { label: "Effective", value: result.effective },
        ],
      };
    case "ticket":
      return {
        icon: Ticket,
        title: "Support ticket",
        rows: [
          { label: "Ticket", value: result.ticketId },
          { label: "Customer", value: result.customerId },
          { label: "Category", value: result.category },
          { label: "Status", value: result.status },
          { label: "Queue", value: result.queue },
        ],
      };
    case "escalation":
      return {
        icon: UserRound,
        title: "Human escalation",
        rows: [
          { label: "Customer", value: result.customerId },
          { label: "Priority", value: result.priority },
          { label: "Status", value: result.status },
          { label: "Queue", value: result.queue },
          { label: "Typical wait", value: `${result.waitMinutes} min` },
        ],
      };
  }
}

export function ToolResultCard({ execution }: { execution: ToolExecution }) {
  const result = execution.result as ToolResult;
  // Defensive: an unexpected payload shows nothing rather than a guessed card.
  if (typeof result?.kind !== "string") return null;
  const prepared = prepare(result);
  const Icon = prepared.icon;
  return (
    <div className="tb-result-card">
      <div className="tb-result-title">
        <Icon size={13} aria-hidden="true" />
        <span>{prepared.title}</span>
        <span className="tb-result-source">local tool result</span>
      </div>
      <dl className="tb-result-rows">
        {prepared.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
