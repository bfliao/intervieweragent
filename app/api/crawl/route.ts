import { NextResponse } from "next/server";
import { crawlIncidentsForJD } from "@/scenario_generation/crawl-live";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const jd = (body as { jd?: unknown })?.jd;
  if (typeof jd !== "string" || !jd.trim()) {
    return NextResponse.json({ error: "`jd` is required." }, { status: 400 });
  }
  const skillsRaw = (body as { skills?: unknown })?.skills;
  const skills = typeof skillsRaw === "string" ? skillsRaw : "";
  const excludeRaw = (body as { exclude?: unknown })?.exclude;
  const exclude = typeof excludeRaw === "string" ? excludeRaw : "";
  const difficultyRaw = (body as { difficulty?: unknown })?.difficulty;
  const difficulty =
    difficultyRaw === "junior" || difficultyRaw === "senior" ? difficultyRaw : "mid";

  try {
    const result = await crawlIncidentsForJD(jd, { skills, exclude, difficulty });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
