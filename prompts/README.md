# Prompt Development

This folder is for prompt work so teammates can iterate without touching the UI.

Current files:

- `interview-answerer.md`: manager/persona response prompt
- `gatekeeper.md`: hidden-fact unlock/classification prompt
- `evaluator.md`: validator prompt for generating the final evidence-backed assessment

Development rule:

Keep scoring and answer generation conceptually separate.

- Gatekeeper decides what the candidate earned.
- Manager persona speaks only from approved facts.
- Validator explains the candidate signal but does not change deterministic information gain.

The current app uses deterministic mock logic, but these prompts define the intended model-backed behavior.
