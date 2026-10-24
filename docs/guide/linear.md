# Linear (coming later)

Upcoming Matches is built to read tickets from more than one place. Today
the only source is Markdown in your repository. Linear is designed for and
arrives later.

## What is ready today

- The config already has a place for it. A source of `kind: linear` is
  accepted and reported as "the Linear source arrives later; use markdown
  for now", so nothing breaks if you add it early:

  ```yaml
  upcoming:
    sources:
      - kind: markdown
        path: set_pieces/upcoming/*.md
      # - kind: linear              # designed for; arrives later
  ```

- The `upcoming_matches` table records each ticket's `source` and its
  `source_ref` (the Markdown file today; the Linear issue's URL later): the
  record is already shaped for a second source.

## Until then

Keep your sprint in `set_pieces/upcoming/*.md` ([plan a sprint](plan-a-sprint.md)).
If your team plans in Linear, copy the week's issues into a Markdown file
with their Linear ids as ticket ids (`## ENG-142 · …`), so a match on
Matchday Live names the same issue your team knows.
