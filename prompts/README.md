# Prompt Development

This folder is for prompt work so teammates can iterate without touching the UI.

Current files:

- `scenario-processor.md`: converts raw teammate storylines into ScenarioConfig JSON
- `interview-answerer.md`: manager/persona response prompt
- `gatekeeper.md`: hidden-fact unlock/classification prompt
- `evaluator.md`: validator prompt for generating the final evidence-backed assessment

Development rule:

Keep scoring and answer generation conceptually separate.

- Scenario processor turns rough notes into HR/team/manager source persona, ambient facts, hidden facts, traps, and ideal recommendation.
- Gatekeeper decides what the candidate earned.
- Manager persona speaks only from approved facts.
- Validator explains the candidate signal but does not change deterministic information gain.

The scenario processor is a prep-time collaboration tool. It can be slow because the final demo should use a reviewed, saved config. The current model endpoint is OpenAI-compatible chat only. It does not browse or fetch online context automatically. For this MVP, paste relevant external context into the raw storyline before processing; a future retrieval step can append web evidence before `scenario-processor.md` runs.
