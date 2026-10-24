# Review Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Confirm that the work reported in `previous_report` is what was asked for.

1. Establish the spec: read `<torch_pass_dir>/plan.md` if it exists, else use `prompt`.
2. Read the code that was actually written, starting from `previous_report.changed_files`.
3. Rule on every requirement in the spec — one `findings` entry each, with evidence.
4. Write the review to `<torch_pass_dir>/review.md`, then emit your match report JSON.

## Match report

Respond with ONLY valid JSON matching `VarReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "approved": false,
  "summary": "<one sentence: N of M requirements met>",
  "findings": [
    { "requirement": "<the ask, in the requester's words>", "met": true, "evidence": "src/server.ts:42 — handler registered" }
  ],
  "blocking": ["<what must change before this can be approved>"],
  "artifacts": ["<torch_pass_dir>/review.md"],
  "notes_for_next_player": "<what the builder must fix, or how to verify if approved>"
}
```

`status` is `touchdown` when the review itself completed — it is not the verdict. The verdict is `approved`, and it is true only when `findings` has no unmet entry and `blocking` is empty.
