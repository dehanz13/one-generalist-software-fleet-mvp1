# Install and set up

This page takes you from nothing to a working fleet in your own repository:
install, put the fleet into a repository, connect your model keys, and
watch the demo. Allow about fifteen minutes. Nothing here spends a token
until the very last step, and that step is optional.

## What you need

| Tool | Why | Check |
|---|---|---|
| **Go 1.26 or newer** | builds `ogsf` (the module pins Go 1.26.9, which `go` downloads by itself) | `go version` |
| **git** | the fleet commits, diffs and checks branches | `git --version` |
| **Node 22.19 or newer** | pi runs on it; also builds Matchday Live if you change the page | `node --version` |
| **pi**, and a key for a model provider | the club that runs your players' models | `pi --version` |

Optional, later: a [Vercel](https://vercel.com) account and a
[Supabase](https://supabase.com) project (free plans are enough) to watch
from anywhere, and `gh` (the GitHub CLI) so the kickoff checklist can tell
when a quest has already merged.

### Install pi

pi is a separate program; the fleet starts it for each player and never
calls a model itself.

```sh
npm install -g @earendil-works/pi-coding-agent
pi --version
```

You need a key for each provider your roster uses: `ANTHROPIC_API_KEY` for
`anthropic/…` models, `OPENAI_API_KEY` for `openai/…` models. Point every
player at one provider and you need only that one key. You will put the key
in a `.env` file in a moment.

## 1 · Build `ogsf`

Clone the fleet's repository and build the binary. Matchday Live is already
built into it, so this needs Go only:

```sh
git clone https://github.com/<owner>/<repo>.git ogsf-fleet
cd ogsf-fleet/modernized
make build                # ./bin/ogsf
./bin/ogsf --version
```

Put it on your `PATH` so every repository can use it:

```sh
mkdir -p ~/.local/bin && cp bin/ogsf ~/.local/bin/
# then make sure ~/.local/bin is on your PATH, for example in ~/.zshrc:
#   export PATH="$HOME/.local/bin:$PATH"
```

`make` on its own runs every test first (Go, then the page's type-check and
tests, which needs `npm ci` in `matchday_live/` once).

## 2 · Put the fleet into a repository

Go to the repository you want the fleet to work on (not the fleet's own
checkout) and incorporate it:

```sh
cd ~/code/my-project
ogsf incorporate
```

That stamps:

| Path | What it is |
|---|---|
| `set_pieces/boardroom/club.config.yaml` | the roster, the qa checks, the rules: yours to edit |
| `set_pieces/clubhouse/team_talks/<player>/` | what each player is told |
| `set_pieces/clubhouse/enchantments/` | pi extensions, such as the subagent tools |
| `set_pieces/clubhouse/spec_tools/` | helpers for the spec tools |
| `set_pieces/playbooks/README.md` | how to write your own chains |
| `set_pieces/upcoming/README.md` | the ticket format for Upcoming Matches |
| `.env.sample` | every variable the fleet reads, explained |
| `.gitignore` | adds `.env` and the runtime files (the match log, each match's folder) |

It never overwrites a file that exists; `--force` does. Commit what it
stamped: the config and team talks are part of your repository now.

## 3 · Your keys, in `.env`

```sh
cp .env.sample .env
```

Open `.env` and fill in the key(s) your roster needs:

```sh
ANTHROPIC_API_KEY=sk-ant-…
# OPENAI_API_KEY=…            # only if a player uses an openai/ model
```

`.env` is never committed (incorporate added it to `.gitignore`), and the
fleet never reads the keys itself: it passes your environment to pi. A
missing key shows up when that player first runs, not at startup.

## 4 · Configure the fleet for this repository

Open `set_pieces/boardroom/club.config.yaml`. Every key is commented; these
are the ones to look at first.

**The models.** Each player's `model` is `provider/model-id`. The default
is `anthropic/claude-sonnet-5-5` at `medium` thinking, with the ranger on
`anthropic/claude-haiku-4-5` and the bard on `openai/gpt-5-mini`. If you
only have an Anthropic key, change the bard's model:

```yaml
  - name: bard
    model: anthropic/claude-haiku-4-5
```

**The qa checks.** These are the commands that judge the code. The defaults
are `npm run lint`, `typecheck`, `test` and `build`. Change them to whatever
your project uses. For a Go project, for example:

```yaml
qa:
  checks:
    - name: vet
      area: backend
      operation: lint
      argv: [go, vet, ./...]
      timeout_seconds: 300
    - name: test
      area: backend
      operation: test
      argv: [go, test, ./...]
      timeout_seconds: 1800
```

`operation` matters: test objectives run the `test` checks, and a `build`
waits for every `typecheck` to pass. Add `diagnostics: eslint` or
`diagnostics: tsc` to a check whose output the
[progressive gate](../safety.md#qa-and-the-progressive-gate) should read.

**The club rules.** `project.club_rules` are claims about your repository
that every player is told, such as how your tests clean up. Edit `notes` to
add one imperative sentence for anything a player could not work out alone:

```yaml
project:
  name: my-project
  club_rules:
    notes:
      - Use pnpm, never npm, in this repository.
```

**What players may change.** `writes:` per player and `restricted_area` in
`defaults` are the fence. The shipped roster is sensible; read
[safety and checks](../safety.md#the-restricted-area) before loosening it.

## 5 · See every set piece, for free

```sh
ogsf demo --serve
```

The demo builds a throwaway repository in a temporary folder, plays every
set piece and command on the scripted club (no tokens, nothing changed
where you are), and then opens Matchday Live on the result at
`http://127.0.0.1:4600`. Click into a match and watch the lanes, the
reports and the reviews. Stop it with Ctrl-C.

## Next

You are ready for [your first real match](first-match.md).
