# Scenario Package Integration

Date: 2026-06-20

## Current Integration Plan

The scenario-generation team may produce a rich markdown package from JD, team background, crawled tickets, open-source issues, evidence, tags, and critique.

Question Arena should treat that package as prep-time source material.

The package is not directly shown to the candidate and should not be passed raw to the answerer at runtime.

Instead, our processor compiles it into:

- candidate-facing initial observation
- answerer persona
- ambient facts
- hidden decision-critical facts
- trap assumptions
- ideal next immediate step

## Why Not Give The Answerer Raw Markdown?

If the answerer has unrestricted access to the full markdown during Q&A, it may leak answer-key context in response to vague questions.

The core mechanic depends on gated context:

- candidate sees the initial observation
- candidate asks a question
- gatekeeper decides what context was earned
- answerer responds only from approved context
- evaluator reads transcript and next immediate step

So the raw markdown belongs before the gatekeeper, not behind it.

## Mapping

| Scenario package field | Question Arena use |
| --- | --- |
| Initial observation / problem statement | `candidatePrompt` |
| Team background / JD | persona expertise and role expectations |
| Evidence | hidden facts or ambient facts |
| Tags / knowledge points | fact categories, unlock triggers, evaluator language |
| Relevance score | hidden fact weight |
| Critique agent output | scenario review guidance |
| Public ticket / issue examples | realism texture and plausible traps |

## Immediate MVP Path

For the 1:00-1:30 sync, do this:

1. Take one generated markdown package from the scenario team.
2. Paste the full package into `Raw Scenario / Markdown Input`.
3. Run `Process`.
4. Manually review the generated JSON.
5. Keep the candidate prompt short.
6. Make sure hidden facts are not trivia; each one should change the next immediate step.
7. Run one strong candidate transcript and one weak candidate transcript.
8. Use the evaluator's signal breakdown to show the difference.

## Open Question For Tomorrow

Decide whether scenario generation should output our `ScenarioConfig` schema directly, or whether markdown package -> processor -> reviewed config remains the collaboration boundary.

For now, the second option is safer because the scenario team can keep iterating independently.
