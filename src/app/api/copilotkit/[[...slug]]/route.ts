import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { WikiRaceAgent } from "@/lib/race/agent";

export const runtime = "nodejs";
export const maxDuration = 120;
const copilotRuntime = new CopilotRuntime({
  agents: { wiki_race: new WikiRaceAgent() },
  runner: new InMemoryAgentRunner(),
});
const app = createCopilotEndpoint({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});
export const GET = handle(app);
export const POST = handle(app);
