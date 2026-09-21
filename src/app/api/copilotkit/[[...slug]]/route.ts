import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { WikiRaceAgent } from "@/lib/race/agent";
import { getLaneDefinitions } from "@/lib/race/providers";
import { ToolArenaAgent } from "@/lib/tool-bench/agent";

export const runtime = "nodejs";
export const maxDuration = 120;
const toolAgents = Object.fromEntries(
  getLaneDefinitions().map((lane) => [
    `tool_bench_${lane.id}`,
    new ToolArenaAgent(lane),
  ]),
);
const copilotRuntime = new CopilotRuntime({
  agents: { wiki_race: new WikiRaceAgent(), ...toolAgents },
  runner: new InMemoryAgentRunner(),
});
const app = createCopilotEndpoint({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});
export const GET = handle(app);
export const POST = handle(app);
