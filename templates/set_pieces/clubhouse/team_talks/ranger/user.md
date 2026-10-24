# Scouting Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Find what `prompt` asks about. Write findings into `torch_pass_dir`, then emit your match report JSON.

## Match report

Respond with ONLY valid JSON matching `AnalystReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "summary": "<one sentence on what you found>",
  "findings": [
    { "file": "src/server.ts", "note": "<why this file matters>" }
  ],
  "artifacts": ["<torch_pass_dir>/ranger_findings.md"]
}
```
