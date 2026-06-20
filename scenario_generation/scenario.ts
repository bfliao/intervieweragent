import { chatJSON } from "./openai";
import type { Incident, PipelineInput, Scenario } from "./types";

const SYSTEM_PROMPT = `You are an expert hiring scenario designer for ENTRY-LEVEL candidates.

You are given a REAL production incident (from a public postmortem) plus the job
context (JD, target skillset, and each team member's desired coworker). Turn the
real incident into ONE concrete, tightly-scoped evaluation scenario.

Hard requirements:
- GROUND every detail in the real incident's facts. Do NOT invent unrelated
  systems. Use the incident's actual symptoms, components, and timeline.
- SCOPE IT DOWN for an entry-level candidate: a single failing system, a short
  diagnostic path, and 3-6 concrete observable signals (include 1-2 normal/
  red-herring signals). Strip away large-scale, multi-team, org-specific
  complexity from the original incident.
- Present it as a CONCRETE on-call situation with specific numbers, error
  messages, and signals the candidate can react to. Avoid vague phrasing like
  "something seems off" - be specific.
- DO NOT reveal the root cause in the brief. The candidate must diagnose it.
- Keep the brief to 1-2 short paragraphs followed by a short bullet list of the
  observable signals.

Return STRICT JSON only, matching this shape:
{
  "brief": string,            // concrete on-call situation + observable signals
  "focusAreas": string[]      // 3-6 short labels of what this scenario probes
}`;

function buildUserPrompt(input: PipelineInput, incident: Incident): string {
  const team = input.teamInput
    .map(
      (m, i) =>
        `- ${m.memberName || `Member ${i + 1}`}: ${m.description.trim()}`
    )
    .join("\n");

  return `REAL INCIDENT (ground the scenario in this):
Title: ${incident.title}
Company/Product: ${incident.company} ${incident.product}
Keywords: ${incident.keywords.join(", ")}
Summary: ${incident.summary}
Details: ${incident.description}

JOB DESCRIPTION:
${input.jd.trim()}

TARGET SKILLSET:
${input.skillset.map((s) => `- ${s}`).join("\n")}

TEAM MEMBERS' DESIRED COWORKER:
${team || "- (none provided)"}

Now produce a concrete, entry-level-scoped scenario grounded in the real incident.`;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

interface ScenarioDraft {
  brief: string;
  focusAreas: string[];
}

/**
 * Stage 1: generate a concrete, entry-level-scoped evaluation scenario,
 * grounded in a REAL incident from the crawled corpus.
 */
export async function generateScenario(
  input: PipelineInput,
  incident: Incident
): Promise<Scenario> {
  const draft = await chatJSON<ScenarioDraft>(
    SYSTEM_PROMPT,
    buildUserPrompt(input, incident)
  );

  const brief = (draft.brief || "").trim();
  if (!brief) {
    throw new Error("Scenario generation returned an empty brief.");
  }

  return {
    id: makeId("scn"),
    brief,
    focusAreas: Array.isArray(draft.focusAreas) ? draft.focusAreas : [],
    derivedFrom: input,
    groundedOn: {
      incidentId: incident.id,
      title: incident.title,
      source: incident.source,
    },
    createdAt: new Date().toISOString(),
  };
}
