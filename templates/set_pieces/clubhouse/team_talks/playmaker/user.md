# Spec Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Plan the work described in `prompt`.

1. Write the full plan to `<torch_pass_dir>/plan.md` — this is the copy the builder reads.
2. Copy that file into the repo under `specs/`:
   - **List `specs/` before you pick the name.** A match that plans more than once reuses its `<match_id>`, so the obvious name may already be taken.
   - Base name: `specs/<match_id>_<slug>.md`, where `<match_id>` is the match directory name inside `torch_pass_dir` (`.../matches/<match_id>/torch_pass`) and `<slug>` is two to four kebab-case words naming the work.
   - If a file with that name already exists, use `specs/<match_id>_<slug>_v2.md`, then `_v3`, and so on until the name is free. **Never overwrite an existing spec** — the earlier plan is the record of what was asked for then.
   - **Copy it, do not retype it.** One bash call does the whole step:
     `mkdir -p specs && cp "<torch_pass_dir>/plan.md" "specs/<match_id>_<slug>.md"`
     Writing the plan a second time through `write` re-emits every line you already wrote, which costs the whole document again in output tokens and lets the two copies drift.
3. Decide the `ruling` from your recon, before you emit the report:
   - `implement` — there is code left to write. The normal case.
   - `noop` — the tree already satisfies the request (e.g. the quest already merged). Say where you saw it in `ruling_reason`. Do not write a "verify only" plan for the builder: the match ends at the spec.
   - `blocked` — the request cannot be done as written (an unmet dependency, an acceptance target the allowed method cannot reach, scope rules that contradict each other). Name the contradiction in `ruling_reason`.
   Still write and copy `plan.md` for every ruling — it is the record of what you found.
4. Emit your match report JSON, declaring BOTH paths in `artifacts`.

## Match report

Respond with ONLY valid JSON matching `TalkReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["<torch_pass_dir>/plan.md", "specs/<match_id>_<slug>.md"],
  "ruling": "implement",
  "ruling_reason": "<empty for implement; for noop/blocked, the evidence — file, commit, or command plus exit status>",
  "commit_message": "<imperative one-line git subject for committing THIS PLAN DOCUMENT, not the work it describes — e.g. 'Add spec for the /health endpoint'>",
  "notes_for_next_player": "<what the builder must know>"
}
```

`status` is `touchdown` when you finished the plan and `turnover` only when you could not. Both `artifacts` entries are the paths you ACTUALLY wrote, `_v2` suffix and all. Official reviews open these files — a name you meant to use fails them.
