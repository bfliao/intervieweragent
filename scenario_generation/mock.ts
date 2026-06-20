import type { CritiqueOutput, PipelineInput, Scenario } from "./types";

/** Sample input used to prefill the form. */
export const MOCK_INPUT: PipelineInput = {
  jd: "Senior Backend Engineer to own our caching and data-access layer. You will debug production performance incidents, design resilient systems, and work closely with platform and product teams.",
  skillset: [
    "distributed systems",
    "debugging under ambiguity",
    "incident response",
    "Redis / caching",
  ],
  teamInput: [
    {
      memberId: "m1",
      memberName: "Ana (Tech Lead)",
      description:
        "Someone who asks sharp clarifying questions before jumping to a fix, and reasons from evidence rather than hunches.",
    },
    {
      memberId: "m2",
      memberName: "Bjorn (SRE)",
      description:
        "Calm under incidents, prioritizes the highest-signal hypotheses first, communicates status clearly.",
    },
  ],
};

export const MOCK_SCENARIO: Scenario = {
  id: "scn_mock_demo",
  difficulty: "mid",
  brief:
    "It's 2pm on a Tuesday. Alerts fire: p99 latency on the product API has tripled in the last 20 minutes, and customers are complaining the site feels slow. CPU and disk on the app servers look normal. Cache hit rate dropped from 95% to 12% around the same time. A deploy went out this morning. You're on call. Walk us through how you'd diagnose and respond.",
  todos: [
    "Walk us through your diagnostic process step by step — what do you check first and why?",
    "Identify the most likely root cause and explain the reasoning behind your hypothesis.",
    "Describe the immediate mitigation you'd apply and how quickly you'd expect it to work.",
    "Outline what you'd communicate to stakeholders and at what points during the incident.",
  ],
  scope: {
    focus: ["diagnostic reasoning", "signal prioritization", "stakeholder communication"],
    skip: ["writing actual code", "post-incident review", "capacity planning"],
  },
  focusAreas: [
    "incident triage",
    "hypothesis prioritization",
    "root-cause reasoning",
    "communication",
  ],
  derivedFrom: MOCK_INPUT,
  createdAt: "2026-06-19T00:00:00.000Z",
};

export const MOCK_CRITIQUE: CritiqueOutput = {
  scenarioId: MOCK_SCENARIO.id,
  criteria: [
    {
      id: "c1",
      evidence:
        "Triages quickly: confirms blast radius and ranks hypotheses by signal before touching anything.",
      tags: ["triage", "prioritization"],
      score: 0.4,
      followups: [
        {
          id: "c1a",
          evidence:
            "Notices the cache hit rate collapse (95%→12%) is the strongest signal and anchors on it.",
          tags: ["cache", "signal"],
          score: 0.6,
          followups: [],
        },
        {
          id: "c1b",
          evidence:
            "Explicitly de-prioritizes CPU/disk because they read normal (avoids red herrings).",
          tags: ["cpu", "red-herring"],
          score: 0.4,
          followups: [],
        },
      ],
    },
    {
      id: "c2",
      evidence:
        "Reasons toward root cause by correlating the cache drop with the morning deploy.",
      tags: ["root-cause", "deployment"],
      score: 0.4,
      followups: [
        {
          id: "c2a",
          evidence:
            "Asks what changed in the deploy and connects it to a Redis client upgrade.",
          tags: ["redis", "change"],
          score: 1,
          followups: [],
        },
      ],
    },
    {
      id: "c3",
      evidence:
        "Communicates status and a rollback/mitigation plan clearly to stakeholders.",
      tags: ["communication", "mitigation"],
      score: 0.2,
      followups: [],
    },
  ],
};
