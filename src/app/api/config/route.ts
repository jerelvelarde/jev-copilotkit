import { getArenaLanes } from "@/lib/tool-bench/lanes";
import { BENCH_CASES } from "@/lib/tool-bench/cases";

export const dynamic = "force-dynamic";

/**
 * Lane availability without any key value, plus the arena's selectable requests.
 * Expected tool labels stay on the server so the client cannot preview them.
 */
export function GET() {
  return Response.json({
    lanes: getArenaLanes().map((lane) => ({
      ...lane,
      agentId: `tool_bench_${lane.id}`,
    })),
    cases: BENCH_CASES.map(({ id, prompt }) => ({ id, prompt })),
  });
}
