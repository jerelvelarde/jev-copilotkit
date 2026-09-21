import { describe, expect, it } from "vitest";
import { abortableDelay, executeToolCall } from "./executor";
import { TOOL_REGISTRY } from "./tools";
import type { ToolCall } from "./types";

const valid: Record<string, ToolCall> = {
  lookup_order: { tool: "lookup_order", arguments: { order_id: "ORD-1042" } },
  track_shipment: {
    tool: "track_shipment",
    arguments: { order_id: "ORD-1089" },
  },
  refund_payment: {
    tool: "refund_payment",
    arguments: { payment_id: "PAY-502", reason: "duplicate" },
  },
  cancel_subscription: {
    tool: "cancel_subscription",
    arguments: { subscription_id: "SUB-310", timing: "period_end" },
  },
  create_ticket: {
    tool: "create_ticket",
    arguments: { customer_id: "CUS-63", category: "technical" },
  },
  escalate_to_human: {
    tool: "escalate_to_human",
    arguments: { customer_id: "CUS-18", priority: "urgent" },
  },
};

describe("deterministic local tool execution", () => {
  it("executes lookup_order into a typed prepared result", async () => {
    const result = await executeToolCall(
      { tool: "lookup_order", arguments: { order_id: "ORD-1042" } },
      new AbortController().signal,
      0,
    );
    expect(result).toEqual({
      tool: "lookup_order",
      arguments: { order_id: "ORD-1042" },
      result: {
        kind: "order",
        orderId: "ORD-1042",
        status: "Delivered",
        items: 2,
        total: "$84.00",
      },
    });
  });

  it.each([
    [{ tool: "invented", arguments: {} }, "Unknown tool"],
    [
      { tool: "lookup_order", arguments: { order_id: 42 } },
      "Invalid arguments",
    ],
    [{ tool: "lookup_order", arguments: {} }, "Invalid arguments"],
    [
      { tool: "lookup_order", arguments: { order_id: "ORD-1", extra: "x" } },
      "Invalid arguments",
    ],
    [
      {
        tool: "refund_payment",
        arguments: { payment_id: "P", reason: "nope" },
      },
      "Invalid arguments",
    ],
  ])("rejects an unsafe call", async (call, message) => {
    await expect(
      executeToolCall(call, new AbortController().signal, 0),
    ).rejects.toThrow(message);
  });

  it("renders a distinct typed result for every registered tool", async () => {
    for (const tool of TOOL_REGISTRY) {
      const call = valid[tool.name];
      expect(call, `missing fixture call for ${tool.name}`).toBeDefined();
      const execution = await executeToolCall(
        call,
        new AbortController().signal,
        0,
      );
      expect(execution.arguments).toEqual(call.arguments);
      expect(typeof execution.result.kind).toBe("string");
    }
    expect(
      new Set(
        await Promise.all(
          TOOL_REGISTRY.map(
            async (tool) =>
              (
                await executeToolCall(
                  valid[tool.name],
                  new AbortController().signal,
                  0,
                )
              ).result.kind,
          ),
        ),
      ).size,
    ).toBe(TOOL_REGISTRY.length);
  });

  it("stops before producing a result when the parent signal aborts", async () => {
    const controller = new AbortController();
    const pending = executeToolCall(
      valid.lookup_order,
      controller.signal,
      5_000,
    );
    controller.abort(new Error("Stopped by you."));
    await expect(pending).rejects.toThrow("Stopped by you.");
  });

  it("never mutates the caller's argument object", async () => {
    const call: ToolCall = {
      tool: "lookup_order",
      arguments: { order_id: "ORD-1042" },
    };
    const execution = await executeToolCall(
      call,
      new AbortController().signal,
      0,
    );
    execution.arguments.order_id = "tampered";
    expect(call.arguments.order_id).toBe("ORD-1042");
  });
});

describe("abortableDelay", () => {
  it("rejects with the abort reason and leaves no pending timer", async () => {
    const controller = new AbortController();
    const reason = new Error("Stopped by you.");
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Already stopped."));
    await expect(abortableDelay(5, controller.signal)).rejects.toThrow(
      "Already stopped.",
    );
  });

  it("resolves after the delay", async () => {
    await expect(
      abortableDelay(0, new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});
