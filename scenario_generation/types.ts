// Shared types for the scenario -> critique -> rubric pipeline.

export interface DesiredCoworker {
  memberId: string;
  memberName?: string;
  /** This member's description of their ideal coworker. */
  description: string;
}

export interface PipelineInput {
  jd: string;
  skillset: string[];
  /** Each team member submits their own desired coworker. */
  teamInput: DesiredCoworker[];
}

/** A real public postmortem, crawled into scenario_generation/data/incidents.json. */
export interface Incident {
  id: string;
  title: string;
  source: string;
  company: string;
  product: string;
  categories: string[];
  keywords: string[];
  summary: string;
  description: string;
}

export interface Scenario {
  id: string;
  /** The ambiguous work scenario presented to the candidate. */
  brief: string;
  /** What the scenario is designed to probe (high-level). */
  focusAreas: string[];
  /** Echo of the inputs this scenario was derived from. */
  derivedFrom: PipelineInput;
  /** The real incident this scenario was grounded on, if any. */
  groundedOn?: {
    incidentId: string;
    title: string;
    source: string;
  };
  createdAt: string;
}

/** Max nesting depth for Criterion.followups (decision B). */
export const MAX_FOLLOWUP_DEPTH = 7;

/**
 * A node in the recursive scoring-rubric tree produced by the critique agent.
 * Sibling `score` values sum to 1 at every level (decision C).
 */
export interface Criterion {
  id: string;
  /** Observable evidence describing what "meeting this criterion" looks like. */
  evidence: string;
  /** Hashtags derived from the evidence (decision D). */
  tags: string[];
  /** 0-1; siblings under the same parent sum to 1. */
  score: number;
  /** Nested sub-criteria, max depth MAX_FOLLOWUP_DEPTH. */
  followups: Criterion[];
}

export interface CritiqueOutput {
  scenarioId: string;
  criteria: Criterion[];
}

export interface CandidateApplication {
  jobTitle: string;
  appliedAt: string;
  assessmentsSent: string[]; // UUIDs
}

export interface Candidate {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  applications: CandidateApplication[];
}

export interface SavedJob {
  id: string;
  savedAt: string;
  title: string;
  jd: string;
  skills: string;
  other: string;
}

export interface SavedScenario {
  savedAt: string;
  jobTitle?: string;
  jd: string;
  sourceTitle?: string;
  sourceUrl?: string;
  scenario: Scenario;
  critique: CritiqueOutput | null;
}
