# Question Arena Demo Pipeline

**Qssessment: assessment by questions, not just answers.**

Qssessment turns job requirements into interactive AI interview simulations that
evaluate how candidates ask questions, uncover context, and reason through
ambiguity before making a recommendation.

Most technical interviews reward candidates for arriving at the right answer.
Real workplace engineering often starts earlier than that: a vague request, a
missing constraint, an unclear stakeholder, or a production signal that needs
interpretation. Qssessment is built around that moment. It helps hiring teams
test whether a candidate can reduce ambiguity before they commit to a solution.

## What It Does

Qssessment combines a scenario-generation dashboard with the TeamB Question
Arena candidate flow.

A hiring manager starts with a role, job description, required skills, excluded
topics, difficulty level, and scenario count. The system can crawl real
engineering incidents from GitHub Issues and Stack Overflow, filter out
excluded topics, and turn relevant incidents into structured workplace
simulations.

Each assessment package can include:

- a candidate-facing brief
- an AI manager persona
- ambient facts that are safe to reveal
- hidden decision-critical facts
- unlock triggers for candidate questions
- an ideal recommendation
- a weighted evaluation rubric

The hiring manager reviews the generated package, then sends the candidate a
shareable `/assessment?assessment=<uuid>` link.

## Candidate Experience

The candidate does not simply answer a static prompt. They receive an ambiguous
manager request and get up to 5 questions before making a recommendation.

Behind the scenes, a gatekeeper decides what each question earns. Sharp,
specific questions can unlock decision-critical context. Broad, generic, or
scattershot questions may receive only limited information. The manager persona
answers from approved context only, so it cannot casually reveal facts the
candidate did not earn.

The result is closer to a work simulation than a quiz: candidates are evaluated
on how they gather information, test assumptions, and decide what to do next.

## Evaluation

Qssessment keeps scoring explicit. The final information-gain score is computed
deterministically:

```txt
unlocked hidden-fact weight / total hidden-fact weight
```

That score maps to an ambiguity-reduction label. The evaluator model can add a
narrative breakdown covering question quality, adaptive follow-up, ownership
posture, and grounded next step, but it cannot change the score that was already
computed in TypeScript.

## Demo Path

1. Generate or save a scenario from the dashboard.
2. Add or select a candidate.
3. Click `Generate assessment link`.
4. The app stores the assessment package in the demo assessment store and shows
   a candidate URL.
5. Open the candidate URL: `/assessment?assessment=<uuid>`.
6. The candidate view parses the UUID from the link, loads the matching
   assessment package, compiles it into a Question Arena config, and starts the
   Q&A flow with dev mode off.

This is intentionally backed by an in-memory server store plus local JSON
persistence for the hackathon demo. In production, the UUID would resolve from a
database.

## Tech Stack

- Next.js 14 App Router
- React 18
- TypeScript
- Node.js API routes
- Tailwind CSS
- OpenAI-compatible Chat Completions API
- Qwen2.5-32B-compatible model configuration through `OPENAI_BASE_URL`
- GitHub Issues API
- Stack Overflow / Stack Exchange API
- Local JSON assessment persistence for the hackathon demo

## Getting Started

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app can run in two answer modes:

- `Model endpoint`: calls an OpenAI-compatible endpoint through
  `/api/question-arena/answer`.
- `Deterministic mock`: runs the local gatekeeper/persona fallback only.

For a model-backed demo, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Expected values:

```bash
OPENAI_API_KEY=dummy
OPENAI_BASE_URL=https://your-openai-compatible-endpoint/v1
OPENAI_MODEL=qwen2.5-32b
VOICE_BASE_URL=http://localhost:8888
```

The model endpoint is an OpenAI-compatible chat-completions endpoint. It does
not fetch online by itself. If a scenario needs web context, add that context to
the raw storyline first or use the server-side incident retrieval flow.

The storyline processor is a prep-time alignment layer and can be slow. For a
live demo, use a reviewed, saved `ScenarioConfig` rather than depending on live
generation.

## How It Works

The current app supports both generated and manually reviewed scenarios:

1. The hiring team creates or selects a scenario package.
2. `/api/question-arena/process-scenario` can convert raw storyline notes into
   `ScenarioConfig` JSON using the scenario processor prompt and local persona
   archetypes.
3. The candidate asks a question.
4. The gatekeeper decides what facts were earned.
5. The manager persona answers using approved facts only.
6. The candidate submits a recommendation.
7. The report computes weighted information gain from unlocked hidden facts.

When `Model endpoint` is selected, the model can make the manager response feel
more natural. Scoring still stays stable because unlocked fact IDs are validated
against the scenario before they affect the result.

The final report uses `/api/question-arena/evaluate`. It keeps weighted
information gain deterministic, then asks the model-backed validator to explain
the candidate signal with question quality, adaptive follow-up, ownership
posture, grounded next step, strengths, concerns, evidence, and next interview
focus.

## Project Structure

```txt
app/
  page.tsx                         # Hiring team dashboard
  assessment/page.tsx              # Candidate assessment entrypoint
  api/                             # Server-side model, crawl, and report routes
components/
  PipelineApp.tsx                  # JD -> incident -> scenario pipeline UI
  QuestionArenaPortal.tsx          # Candidate simulation and report UI
  CandidatesTab.tsx                # Candidate link generation
data/
  scenarios/                       # Saved ScenarioConfig examples
  manager-personas/                # Reusable manager archetypes
prompts/
  scenario-processor.md            # Raw storyline -> ScenarioConfig prompt
  interview-answerer.md            # Manager/persona response prompt
  gatekeeper.md                    # Hidden-fact unlock prompt
  evaluator.md                     # Final validator/report prompt
lib/
  assessmentStore.ts               # Demo assessment persistence
  questionArena/                   # Gatekeeper, answerer, scoring, and types
scenario_generation/
  crawl-live.ts                    # GitHub / Stack Overflow incident search
  scenario.ts                      # Scenario drafting and self-critique
  critique.ts                      # Rubric generation and weight normalization
```

## Current Scope

- Editable scenario JSON
- Job-description-driven incident search
- Raw storyline processor for manager persona and hidden-fact config generation
- Editable interview answer prompt
- 5-question Q&A runner
- Debug panel for unlocked facts and gatekeeper decisions
- Weighted information-gain report

## What's Next

- Calibrate scenarios with simulated strong and weak candidates before sending.
- Improve manager personas for richer follow-up conversations.
- Expand reports for easier side-by-side candidate comparison.
- Replace demo persistence with production database-backed assessment storage.
