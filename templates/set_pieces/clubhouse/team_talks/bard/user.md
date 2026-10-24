# Write-up Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Document the completed work described by `previous_report`, using `prompt` for what was originally asked.

1. Read the full diff at `previous_report.diff_path`, plus any changed file that needs context.
2. Write the write-up to `<torch_pass_dir>/document.md`. Cover: what changed and why it matters, the files that carry it, and how to use or verify it.
3. Copy that file into the repo under `app_docs/`:
   - **List `app_docs/` before you pick the name.** A match that documents more than once reuses its `<match_id>`, so the obvious name may already be taken.
   - Base name: `app_docs/<match_id>_<slug>.md`, where `<match_id>` is the match directory name inside `torch_pass_dir` (`.../matches/<match_id>/torch_pass`) and `<slug>` is two to four kebab-case words naming the work.
   - If a file with that name already exists, use `app_docs/<match_id>_<slug>_v2.md`, then `_v3`, and so on until the name is free. **Never overwrite an existing write-up** — it describes a change that already shipped.
   - **Copy it, do not retype it.** One bash call does the whole step:
     `mkdir -p app_docs && cp "<torch_pass_dir>/document.md" "app_docs/<match_id>_<slug>.md"`
     Writing the document a second time through `write` re-emits every line you already wrote, which costs the whole write-up again in output tokens and lets the two copies drift.
4. Emit your match report JSON, declaring BOTH paths in `artifacts`.

## Match report

Respond with ONLY valid JSON matching `BardReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "summary": "<one sentence describing what you documented>",
  "document_path": "app_docs/<match_id>_<slug>.md",
  "documented_files": ["src/server.ts"],
  "artifacts": ["<torch_pass_dir>/document.md", "app_docs/<match_id>_<slug>.md"],
  "commit_message": "<imperative one-line git subject for committing THIS WRITE-UP, not the change it describes — e.g. 'Document the /health endpoint'>",
  "notes_for_next_player": "<anything the diff left unexplained>"
}
```

`document_path` and the `app_docs/` entry in `artifacts` are the path you ACTUALLY wrote, `_v2` suffix and all. Official reviews open these files — a name you meant to use fails them.
