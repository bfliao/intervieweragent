import type {
  AmbientFact,
  EvaluationReport,
  GatekeeperDecision,
  HiddenFact,
  QuestionClassification,
  ScenarioConfig,
} from "./types";

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function countMatches(question: string, triggers: string[] = []) {
  const q = normalize(question);
  return triggers.filter((trigger) => q.includes(normalize(trigger))).length;
}

function hasSpecificIntent(question: string) {
  const q = normalize(question);
  return [
    "who",
    "why",
    "what",
    "which",
    "when",
    "how many",
    "use",
    "purpose",
    "constraint",
    "risk",
    "deadline",
    "scope",
    "reproduce",
    "affected",
    "segment",
  ].some((word) => q.includes(word));
}

function matchHiddenFacts(
  question: string,
  scenario: ScenarioConfig
): Array<{ fact: HiddenFact; matches: number }> {
  return scenario.hiddenFacts
    .map((fact) => ({ fact, matches: countMatches(question, fact.unlockTriggers) }))
    .filter((item) => item.matches > 0);
}

function matchAmbientFacts(
  question: string,
  scenario: ScenarioConfig
): Array<{ fact: AmbientFact; matches: number }> {
  return scenario.ambientFacts
    .map((fact) => ({ fact, matches: countMatches(question, fact.whenToReveal) }))
    .filter((item) => item.matches > 0);
}

export function gatekeepQuestion(
  question: string,
  scenario: ScenarioConfig,
  unlockedFactIds: string[]
): GatekeeperDecision {
  const matchedHidden = matchHiddenFacts(question, scenario);
  const matchedNewHidden = matchedHidden.filter(
    (item) => !unlockedFactIds.includes(item.fact.id)
  );
  const matchedAmbient = matchAmbientFacts(question, scenario);
  const specific = hasSpecificIntent(question);
  const isScattershot =
    matchedNewHidden.length >= 3 || question.split("?").length > 2;

  let classification: QuestionClassification = "irrelevant";
  let nextUnlockedFactIds: string[] = [];
  const ambientFactIds = matchedAmbient.slice(0, 2).map((item) => item.fact.id);

  if (isScattershot) {
    classification = "scattershot";
  } else if (matchedHidden.length > 0 && specific) {
    classification = matchedHidden.length === 1 ? "targeted" : "sharp";
    nextUnlockedFactIds = matchedNewHidden
      .slice(0, 2)
      .map((item) => item.fact.id);
  } else if (
    matchedHidden.length > 0 ||
    matchedAmbient.length > 0 ||
    question.trim().length > 15
  ) {
    classification = "broad";
  }

  return {
    classification,
    unlockedFactIds: nextUnlockedFactIds,
    ambientFactIds,
    rationale:
      classification === "scattershot"
        ? "Question touched too many new hidden areas at once; treating as broad rather than unlocking many facts."
        : nextUnlockedFactIds.length > 0
          ? "Question targeted decision-critical context with enough specificity."
          : "Question did not earn hidden context.",
  };
}

export function generateManagerAnswer(
  scenario: ScenarioConfig,
  decision: GatekeeperDecision
) {
  const approvedHidden = decision.unlockedFactIds
    .map((id) => scenario.hiddenFacts.find((fact) => fact.id === id))
    .filter(Boolean) as HiddenFact[];
  const approvedAmbient = decision.ambientFactIds
    .map((id) => scenario.ambientFacts.find((fact) => fact.id === id))
    .filter(Boolean) as AmbientFact[];

  if (decision.classification === "scattershot") {
    return "There are a few threads in there. I would narrow it down first. What specific part are you trying to decide?";
  }

  if (approvedHidden.length > 0) {
    return approvedHidden
      .map((fact) => fact.sampleResponse || fact.fact)
      .join(" ");
  }

  if (approvedAmbient.length > 0) {
    return approvedAmbient.map((fact) => fact.fact).join(" ");
  }

  if (decision.classification === "broad") {
    return "Broadly, yes, there is context here, but I would need a more specific question to give you something useful.";
  }

  return "I do not have much useful context from that angle.";
}

export function scoreInformationGain(
  scenario: ScenarioConfig,
  unlockedFactIds: string[]
): EvaluationReport {
  const totalWeight = scenario.hiddenFacts.reduce(
    (sum, fact) => sum + Number(fact.weight || 1),
    0
  );
  const unlockedWeight = scenario.hiddenFacts
    .filter((fact) => unlockedFactIds.includes(fact.id))
    .reduce((sum, fact) => sum + Number(fact.weight || 1), 0);
  const percent =
    totalWeight === 0 ? 0 : Math.round((unlockedWeight / totalWeight) * 100);
  const label =
    percent >= 75
      ? "Strong ambiguity reducer"
      : percent >= 45
        ? "Developing ambiguity reducer"
        : "Weak ambiguity reducer";
  const missedFacts = scenario.hiddenFacts.filter(
    (fact) => !unlockedFactIds.includes(fact.id)
  );

  return {
    percent,
    label,
    unlockedWeight,
    totalWeight,
    missedFacts,
  };
}
