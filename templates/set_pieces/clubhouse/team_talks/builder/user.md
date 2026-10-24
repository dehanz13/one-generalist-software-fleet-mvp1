# Build Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Implement the work described in `prompt`, guided by `previous_report` if present, then emit your match report JSON.

## Match report

Respond with ONLY valid JSON matching `AttackReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "summary": "<one sentence describing what you built>",
  "changed_files": ["src/server.ts"],
  "artifacts": [],
  "commit_message": "<the WHOLE commit message for the code you changed — an imperative one-line subject; then, when the spec asks for a body (a quest spec's 'The commit message' section does), \\n\\n and the prose body it asks for. Write it in full in EVERY match report, including one written after a fix: the message is not rebuilt from earlier reports>",
  "notes_for_next_player": "<how to verify this work>"
}
```
