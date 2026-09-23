import { describe, expect, it } from "vitest";
import { DEFAULT_LANES } from "../race/types";
import { BENCH_CASES, toCaseInput } from "./cases";
import { scoreCall } from "./scoring";
import { createToolSchemas, TOOL_REGISTRY } from "./tools";
import { arenaConfigSchema, initialLaneState, type ToolCall } from "./types";

const expected: ToolCall = {
  tool: "refund_payment",
  arguments: { payment_id: "PAY-2", reason: "duplicate" },
};
describe("exact tool-call scoring and authored support suite", () => {
  it.each([
    [expected, true, true, true],
    [{ tool: "invented", arguments: expected.arguments }, false, true, false],
    [{ ...expected, arguments: { payment_id: "PAY-2" } }, true, false, false],
    [
      { ...expected, arguments: { ...expected.arguments, extra: "x" } },
      true,
      false,
      false,
    ],
    [
      { ...expected, arguments: { payment_id: "PAY-1", reason: "duplicate" } },
      true,
      false,
      false,
    ],
    [
      {
        ...expected,
        arguments: { payment_id: "PAY-2", reason: ["duplicate"] },
      },
      true,
      false,
      false,
    ],
    [null, false, false, false],
  ])(
    "scores selection and arguments independently",
    (actual, toolCorrect, argumentsCorrect, correct) => {
      expect(scoreCall(expected, actual)).toEqual({
        toolCorrect,
        argumentsCorrect,
        correct,
      });
    },
  );
  it("has twelve unique answerable cases covering every registered tool", () => {
    expect(BENCH_CASES).toHaveLength(12);
    expect(new Set(BENCH_CASES.map((c) => c.id)).size).toBe(12);
    expect(new Set(BENCH_CASES.map((c) => c.expected.tool))).toEqual(
      new Set(TOOL_REGISTRY.map((t) => t.name)),
    );
    for (const item of BENCH_CASES) {
      const schema = createToolSchemas(toCaseInput(item)).find(
        (t) => t.function.name === item.expected.tool,
      )!.function.parameters;
      expect(Object.keys(item.expected.arguments).sort()).toEqual(
        [...schema.required].sort(),
      );
      for (const [field, value] of Object.entries(item.expected.arguments))
        expect(schema.properties[field].enum).toContain(value);
      expect(toCaseInput(item)).not.toHaveProperty("expected");
    }
  });
});

describe("single-case arena contract", () => {
  it("uses one selected case per synchronized race", () => {
    expect(
      arenaConfigSchema.parse({ mode: "live", caseId: "earth-article" }),
    ).toEqual({ mode: "live", caseId: "earth-article" });
    expect(() =>
      arenaConfigSchema.parse({ mode: "live", caseCount: 6 }),
    ).toThrow();
    expect(() =>
      arenaConfigSchema.parse({ mode: "batch", caseId: "order-details" }),
    ).toThrow();
  });

  it("creates an idle lane with an empty normalized timeline", () => {
    const lane = initialLaneState({ ...DEFAULT_LANES[0], available: true });
    expect(lane).toMatchObject({
      ...DEFAULT_LANES[0],
      available: true,
      status: "idle",
      runId: "",
      caseId: null,
      prompt: "",
      expected: null,
      decision: null,
      execution: null,
      score: null,
      timings: { decisionMs: 0, toolMs: 0, renderMs: 0, totalMs: 0 },
      events: [],
      error: null,
    });
  });

  it("starts an unconfigured lane as unavailable", () => {
    expect(initialLaneState(DEFAULT_LANES[0]).status).toBe("unavailable");
  });
});
