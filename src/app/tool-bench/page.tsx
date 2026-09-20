import type { Metadata } from "next";
import { ToolBench } from "@/components/tool-bench";

export const metadata: Metadata = {
  title: "Tool-call arena · CopilotKit × Jev",
  description:
    "Watch Jev and comparison models select tools and arguments for the same support requests.",
};

export default function ToolBenchPage() {
  return <ToolBench />;
}
