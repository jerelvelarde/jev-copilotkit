import { getLaneDefinitions } from "@/lib/race/providers";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ lanes: getLaneDefinitions() });
}
