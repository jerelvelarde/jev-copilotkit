import type { ToolCall } from "./types";

export function scoreCall(expected: ToolCall, actual: ToolCall | null) {
  const toolCorrect = actual?.tool === expected.tool;
  const expectedKeys = Object.keys(expected.arguments);
  const argumentsCorrect =
    actual !== null &&
    Object.keys(actual.arguments).length === expectedKeys.length &&
    expectedKeys.every(
      (key) =>
        Object.hasOwn(actual.arguments, key) &&
        Object.is(actual.arguments[key], expected.arguments[key]),
    );
  return {
    toolCorrect,
    argumentsCorrect,
    correct: toolCorrect && argumentsCorrect,
  };
}
