import { describe, expect, it } from "vitest";
import { BENCH_CASES, toCaseInput } from "./cases";
import { scoreCall } from "./scoring";
import { createToolSchemas, TOOL_REGISTRY } from "./tools";
import type { ToolCall } from "./types";

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
