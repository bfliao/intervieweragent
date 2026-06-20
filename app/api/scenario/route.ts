import { NextResponse } from "next/server";
import { generateScenario } from "@/scenario_generation/scenario";
import { getIncident, randomIncident } from "@/scenario_generation/incidents";
import type {
  Difficulty,
  DesiredCoworker,
  Incident,
  PipelineInput,
} from "@/scenario_generation/types";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  const difficultyRaw = b.difficulty;
  const difficulty: Difficulty =
    difficultyRaw === "junior" || difficultyRaw === "senior"
      ? difficultyRaw
      : "mid";

  return { jd, skillset, teamInput, difficulty };
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
    return NextResponse.json({ error: "`jd` is required." }, { status: 400 });
  }

  const b = body as {
    incident?: unknown;
    incidentId?: unknown;
    incidents?: unknown;
    count?: unknown;
  };

  const difficulty = input.difficulty ?? "mid";

  // Resolve the incident(s) to generate from.
  // Priority: incidents[] array > single incident object > incidentId > random
  let incidentList: Incident[] = [];

  if (Array.isArray(b.incidents) && b.incidents.length > 0) {
    incidentList = (b.incidents as unknown[]).filter(
      (i): i is Incident => !!i && typeof (i as Incident).title === "string"
    );
  }

  if (incidentList.length === 0) {
    const provided = b.incident as Incident | undefined;
    const single =
      provided && typeof provided.title === "string"
        ? provided
        : typeof b.incidentId === "string"
          ? await getIncident(b.incidentId)
          : await randomIncident();
    if (single) incidentList = [single];
  }

  if (incidentList.length === 0) {
    return NextResponse.json(
      {
        error:
          "No incident to ground on. Provide `incidents` (from /api/crawl), `incident`, or `incidentId`.",
      },
      { status: 400 }
    );
  }

  // Honour `count` but cap at the number of available incidents (max 3)
  const rawCount = typeof b.count === "number" ? b.count : 1;
  const count = Math.min(Math.max(1, rawCount), 3, incidentList.length);
  const targets = incidentList.slice(0, count);

  try {
    const scenarios = await Promise.all(
      targets.map((incident) => generateScenario(input, incident, { difficulty }))
    );
    return NextResponse.json({ scenarios });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
