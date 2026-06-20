import { NextResponse } from "next/server";
import { listIncidentSummaries } from "@/scenario_generation/incidents";

export const runtime = "nodejs";

export async function GET() {
  const incidents = await listIncidentSummaries();
  return NextResponse.json({ incidents });
}
