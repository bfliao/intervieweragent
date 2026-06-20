# Question Arena

Question Arena is an internal testing portal for building ambiguity-based candidate assessments. The current MVP lets the team process a raw teammate storyline into a structured scenario config, edit the interview answer prompt, run a 5-question Q&A with a simulated HR/team/manager source, and inspect what hidden context the candidate earned.

## Tech Stack

- Next.js 14 (App Router)
- React 18 + TypeScript
- TailwindCSS

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the dev server:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000).

The app can run in two answer modes:

- `Model endpoint`: calls an OpenAI-compatible endpoint through `/api/question-arena/answer`.
- `Deterministic mock`: runs the local gatekeeper/persona fallback only.

For the current hackathon endpoint, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Current expected values:

```bash
OPENAI_API_KEY=dummy
OPENAI_BASE_URL=https://c5b6-136-24-140-216.ngrok-free.app/v1
OPENAI_MODEL=qwen2.5-32b
```

The current hackathon model endpoint is an OpenAI-compatible chat-completions endpoint. It does not fetch online by itself. If a scenario needs web context, add that context to the raw storyline first or build a server-side retrieval step that appends fetched evidence before calling the scenario processor.

The storyline processor is a prep-time alignment layer. It can be slow. For the final demo, use a reviewed, saved ScenarioConfig rather than depending on live generation.

## Project Structure

```txt
app/
  page.tsx                         # Testing portal page
components/
  QuestionArenaPortal.tsx          # Scenario editor + Q&A runner
data/
  scenarios/                       # Scenario configs teammates can edit
  manager-personas/                # Reusable manager archetypes
prompts/
  scenario-processor.md            # Raw storyline -> ScenarioConfig prompt
  interview-answerer.md            # Manager/persona response prompt
  gatekeeper.md                    # Hidden-fact unlock prompt draft
  evaluator.md                     # Final validator/report prompt
lib/
  questionArena/
    answerer.ts                    # Deterministic mock gatekeeper/persona
    scenarios.ts                   # Scenario registry
    types.ts                       # Scenario and scoring types
testing-portal/
  index.html                       # Static fallback prototype
assets/
  *.md                             # Product specs, decision logs, research notes
```

## How It Works

The current app uses a deterministic mock answerer:

1. Teammate writes a raw storyline in any reasonable format.
2. `/api/question-arena/process-scenario` converts it into `ScenarioConfig` JSON using the scenario processor prompt and local persona archetypes.
3. Candidate asks a question.
4. The gatekeeper in `lib/questionArena/answerer.ts` decides what facts were earned.
5. The manager persona answers using approved facts only.
6. The report computes weighted information gain from unlocked hidden facts.

When `Model endpoint` is selected, the same deterministic gatekeeper still decides what facts were earned. The model only writes the manager response using approved facts, so scoring stays stable while the answer sounds more natural.

The final report uses `/api/question-arena/evaluate`. It keeps weighted information gain deterministic, then asks the model-backed validator to explain the candidate signal with strengths, concerns, evidence, and next interview focus.

## Team Workflow

- Scenario owners edit or add JSON files in `data/scenarios/`.
- Storyline owners can paste raw notes into the Storyline Processor, then review the generated ScenarioConfig before applying it. The raw input can be bullets, transcript notes, JSON, product tickets, bug reports, HR notes, or another rough draft format.
- Prompt owners edit files in `prompts/`.
- UI/runtime owners work in `components/QuestionArenaPortal.tsx` and `lib/questionArena/`.
- Keep scenario config, answerer prompt, and scoring logic separate so teammates do not overwrite each other.

## Current Scope

- Editable scenario JSON
- Raw storyline processor for manager persona + hidden-fact config generation
- Editable interview answer prompt
- 5-question Q&A runner
- Debug panel for unlocked facts and gatekeeper decisions
- Weighted information-gain report

The original mock interviewer chat files are still in the repository, but the default home page now opens Question Arena.
