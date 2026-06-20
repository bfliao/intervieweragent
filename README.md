# Question Arena

Question Arena is an internal testing portal for building ambiguity-based candidate assessments. The current MVP lets the team edit a scenario config, edit the interview answer prompt, run a 5-question Q&A with a simulated manager, and inspect what hidden context the candidate earned.

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

## Project Structure

```txt
app/
  page.tsx                         # Testing portal page
components/
  QuestionArenaPortal.tsx          # Scenario editor + Q&A runner
data/
  scenarios/                       # Scenario configs teammates can edit
prompts/
  interview-answerer.md            # Manager/persona response prompt
  gatekeeper.md                    # Hidden-fact unlock prompt draft
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

1. Candidate asks a question.
2. The gatekeeper in `lib/questionArena/answerer.ts` decides what facts were earned.
3. The manager persona answers using approved facts only.
4. The report computes weighted information gain from unlocked hidden facts.

When `Model endpoint` is selected, the same deterministic gatekeeper still decides what facts were earned. The model only writes the manager response using approved facts, so scoring stays stable while the answer sounds more natural.

## Team Workflow

- Scenario owners edit or add JSON files in `data/scenarios/`.
- Prompt owners edit files in `prompts/`.
- UI/runtime owners work in `components/QuestionArenaPortal.tsx` and `lib/questionArena/`.
- Keep scenario config, answerer prompt, and scoring logic separate so teammates do not overwrite each other.

## Current Scope

- Editable scenario JSON
- Editable interview answer prompt
- 5-question Q&A runner
- Debug panel for unlocked facts and gatekeeper decisions
- Weighted information-gain report

The original mock interviewer chat files are still in the repository, but the default home page now opens Question Arena.
