# Scenario To Persona Handoff

Date: 2026-06-20

## Current Decision

The scenario processor is a prep-time alignment layer. It is not part of the live candidate experience.

Its job is to convert whatever the scenario team produces into a candidate-facing initial observation, a realistic answerer persona, and a structured `ScenarioConfig` that the Q&A agent can use.

This lets the team collaborate even while the scenario team's final output format is still unknown.

The assessment should not be framed as a hidden puzzle where the candidate must collect every fact. The stronger signal is how the candidate asks, what perspective their question reveals, and whether they use each answer to form a sharper next question or next immediate step.

## Why This Layer Exists

Question Arena needs the answerer to feel like a real workplace source, not a generic chatbot.

The answerer may be:

- HR
- recruiter
- hiring manager
- engineering manager
- team lead
- product manager
- another realistic source in the scenario

The selected persona should help the evaluator understand whether the candidate is good for the role. For example, HR may be best for job-fit and process questions, while a team lead may be best for scoping, debugging, and execution tradeoffs.

## Fixed Behavior

The source persona is always:

- kind
- concise
- busy
- not adversarial
- not handholding
- truthful within their knowledge boundary
- limited to what they would realistically know

Weak candidates should fail because their questions are vague or misdirected, not because the persona has attitude.

## Dynamic Behavior

The processor generates these scenario-specific fields:

- identity and role
- expertise
- direct knowledge
- hedged or secondhand knowledge
- blind spots
- ambient facts that make the world feel real but do not score
- hidden decision-critical facts that determine information gain
- trap assumptions that a rushed candidate might make
- ideal next step / recommendation

The deterministic info-gain score is only the baseline. The evaluator should also look for question quality, adaptive follow-up, and experience signal.

## Scenario Team Can Provide Any Format

Acceptable inputs include:

- bullet points
- transcript notes
- rough storylines
- markdown scenario packages
- initial observations / problem statements
- crawler output
- evidence tables
- tag or knowledge-point tables
- critique notes from another agent
- incident reports
- product tickets
- bug reports
- job descriptions
- HR/hiring manager notes
- JSON drafts
- incomplete scenario drafts

The processor should be able to turn rough input into a first-pass config. The result still needs human review.

## Mapping From Scenario Package To Our Runtime

When the scenario team provides a richer markdown package, map it this way:

- Initial observation / problem statement -> `candidatePrompt`
- Evidence -> `hiddenFacts` or `ambientFacts`
- Tags / knowledge points -> `category`, `unlockTriggers`, and evaluator language
- Relevance or quality score -> hidden-fact `weight`
- Critique notes -> review guidance for improving unfair, overly narrow, or unrealistic scenarios
- Team/JD/background context -> persona expertise, direct knowledge, hedged knowledge, and blind spots

The candidate should not see the raw evidence table. The answerer should not freely dump the whole markdown. The markdown is compiled into the scenario config, and the gatekeeper still decides what context the candidate earned.

## Review Checklist

Before using a processed scenario in the demo, check:

- Does the chosen persona naturally know the facts they reveal?
- Are any facts better marked as hedged instead of direct?
- Does every hidden fact change the next immediate step or recommendation?
- Are ambient facts truly non-scoring?
- Is the candidate prompt vague but fair?
- Is the trap plausible but not unfair?
- Can a strong candidate reasonably earn the key facts in 5 questions?
- Is the next immediate step obvious only after earning context?
- Do the questions create room for candidates to show prior experience, stakeholder awareness, risk awareness, or a useful hypothesis?
- Can the manager's answers become useful input for a sharper follow-up question?

## Demo Workflow

1. Scenario team provides raw storyline in any format.
2. Paste it into `Raw Scenario / Markdown Input`.
3. Set the target role.
4. Run `Process`.
5. Review and edit the generated `ScenarioConfig JSON`.
6. Apply the config.
7. Run Q&A against the answerer.
8. Save the good generated config for the final demo.

Speed is not important for this layer. It can run slowly because the final demo should use a reviewed, pre-recorded, or pre-generated scenario config.

## Current Caveat

The current model endpoint is OpenAI-compatible chat only. It does not fetch online context by itself.

If external research matters, paste that context into the raw storyline or add a future server-side retrieval step before the processor.
