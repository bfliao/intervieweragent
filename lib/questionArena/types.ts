export type QuestionClassification =
  | "irrelevant"
  | "broad"
  | "targeted"
  | "sharp"
  | "scattershot";

export interface PersonaConfig {
  name: string;
  role: string;
  tone: string;
  answerStyle: string;
  expertise?: string[];
  directKnowledge?: string[];
  hedgedKnowledge?: string[];
  blindSpots?: string[];
  communicationRules?: string[];
}

export interface AmbientFact {
  id: string;
  fact: string;
  whenToReveal: string[];
}

export interface HiddenFact {
  id: string;
  title: string;
  fact: string;
  category: string;
  weight: number;
  knowledgeLevel: "direct" | "hedged";
  unlockTriggers: string[];
  requiresSpecificity: boolean;
  sampleResponse: string;
  whyItMatters: string;
}

export interface TrapAssumption {
  id: string;
  assumption: string;
  whyTempting: string;
  howToDisprove: string;
}

export interface ScenarioConfig {
  id: string;
  title: string;
  role: string;
  candidatePrompt: string;
  persona: PersonaConfig;
  maxQuestions: number;
  ambientFacts: AmbientFact[];
  hiddenFacts: HiddenFact[];
  trapAssumptions: TrapAssumption[];
  idealRecommendation: string;
}

export interface GatekeeperDecision {
  classification: QuestionClassification;
  unlockedFactIds: string[];
  ambientFactIds: string[];
  rationale: string;
}

export interface Message {
  role: "candidate" | "manager";
  content: string;
}

export interface EvaluationReport {
  percent: number;
  label: string;
  unlockedWeight: number;
  totalWeight: number;
  missedFacts: HiddenFact[];
}

export interface ValidatorAssessment {
  label: string;
  summary: string;
  signalBreakdown?: {
    questionQuality: SignalDimension;
    adaptiveFollowUp: SignalDimension;
    ownershipPosture: SignalDimension;
    groundedNextStep: SignalDimension;
  };
  strengths: string[];
  concerns: string[];
  evidence: string[];
  finalRecommendationAssessment: string;
  nextInterviewFocus: string[];
}

export interface SignalDimension {
  label: string;
  assessment: string;
  evidence: string;
}

export interface ValidatorReport {
  deterministic: EvaluationReport;
  assessment: ValidatorAssessment;
  modelUsed: string;
  source: "model" | "fallback";
  warning?: string;
  rawModelOutput?: string;
}
