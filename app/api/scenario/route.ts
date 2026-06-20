import { NextResponse } from "next/server";
import { generateScenario } from "@/scenario_generation/scenario";
import { getIncident, randomIncident } from "@/scenario_generation/incidents";
import type {
  DesiredCoworker,
  Incident,
  PipelineInput,
} from "@/scenario_generation/types";

export const runtime = "nodejs";

function normalizeInput(body: unknown): PipelineInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const jd = typeof b.jd === "string" ? b.jd : "";

  const skillset = Array.isArray(b.skillset)
    ? (b.skillset as unknown[]).map(String).filter((s) => s.trim().length > 0)
    : [];

  const teamInput: DesiredCoworker[] = Array.isArray(b.teamInput)
    ? (b.teamInput as unknown[])
        .map((m, i) => {
          const mm = (m ?? {}) as Record<string, unknown>;
          return {
            memberId:
              typeof mm.memberId === "string" ? mm.memberId : `member_${i + 1}`,
            memberName:
              typeof mm.memberName === "string" ? mm.memberName : undefined,
            description:
              typeof mm.description === "string" ? mm.description : "",
          } satisfies DesiredCoworker;
        })
        .filter((m) => m.description.trim().length > 0)
    : [];

  return { jd, skillset, teamInput };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = normalizeInput(body);
  if (!input.jd.trim()) {
    return NextResponse.json(
      { error: "`jd` is required." },
      { status: 400 }
    );
  }

  // Ground on a real incident. Priority:
  //   1. a full `incident` object (e.g. from the live JD crawl)
  //   2. an `incidentId` from the local corpus
  //   3. a random local incident
  const b = body as { incident?: unknown; incidentId?: unknown };
  const provided = b.incident as Incident | undefined;
  const incident =
    provided && typeof provided.title === "string"
      ? provided
      : typeof b.incidentId === "string"
        ? await getIncident(b.incidentId)
        : await randomIncident();

  if (!incident) {
    return NextResponse.json(
      {
        error:
          "No incident to ground on. Provide an `incident` (from /api/crawl) or an `incidentId`.",
      },
      { status: 400 }
    );
  }

  try {
    const scenario = await generateScenario(input, incident);
    return NextResponse.json({ scenario });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
