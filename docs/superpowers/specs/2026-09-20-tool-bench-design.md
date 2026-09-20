# Tool-call arena

Add a second demo at `/tool-bench`, preserving Wiki Race. Reuse its dark four-quadrant visual language and the same actual configured model identities, with Jev highlighted in magenta. CopilotKit runs a new `tool_bench` AG-UI agent and streams every case result to the UI.

The initial dataset is a versioned suite of 12 labeled support requests; the UI offers 6 or 12 requests. Each lane receives identical prompts, entity candidates, tools, and case order, progressing independently. Tasks cover order lookup, shipment tracking, refund selection, cancellation timing, ticket category, and escalation priority. Tools are simulated: the benchmark measures selection and arguments only and performs no external operations.

Jev answers typed Choice questions for tool selection and candidate-bound argument fields in a single request. Baselines use OpenRouter's native function calling with the same tool schemas and candidate argument sets. Expected answers stay out of provider inputs. The harness evaluates exact tool and exact argument correctness independently, including unknown/extra/missing arguments. The differing API formats are disclosed. Each decision reports measured latency and returned token usage only.

Show current request, tool invocation JSON, expected/actual inspection, per-case correctness trail, tool accuracy, exact-call accuracy, p50/p95 request latency, completion, and correct calls per elapsed second. Show Jev speed comparisons only for completed available live lanes with recorded results, qualified by accuracy and this small dataset. Avoid claiming general model superiority. Bottom bars compare measured request latency; all sample numbers are visibly simulated and sample providers use equal delays, with no scripted winner.

Each run is capped at 90 seconds and 12 cases per lane; requests time out. Stop cancels outstanding requests and preserves completed results. Provider/auth failures remain explicit; unconfigured lanes are unavailable. Live never falls back to samples. Keep existing API keys server-side. No new credential is exposed to the UI or tests.

Verify adapter contracts and that expected labels never enter prompts, exact scoring edge cases, cancellation/deadlines/lane isolation, and AG-UI run identity/lifecycle. Verify the real Jev path with a small suite, while reporting baseline comparison as pending until OpenRouter is configured. Check both demo routes in browser, desktop/mobile layouts, lint, types, formatting, tests, and build.
