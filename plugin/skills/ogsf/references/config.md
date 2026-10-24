# Config reference

Every key of `set_pieces/boardroom/club.config.yaml`: type, default, meaning, and how defaults merge.

The default path is `set_pieces/boardroom/club.config.yaml`. `--config <path>` on any command, or `CLUB_CONFIG`, points at another roster. `ogsf incorporate` and `ogsf onboard` write the starter file.

## Loading rules

- **The `project` block is strict.** An unknown key in it fails the load, and so does a value a rule does not accept: a typo must fail, not select a default nobody chose.
- **Everything else ignores unknown keys** and fills what is missing from the defaults below.
- **Defaults merge per player.** A player's missing `club`, `model`, `thinking`, `color`, `tools` and `writes` come from `defaults` when `defaults` sets them; a missing `enchantments` comes from `defaults.enchantments`, else empty. A player states only what differs.
- **The load checks enumerations**: `rtl_cleanup`, `club`, each qa check's `area`, `operation` and `diagnostics`, and that every qa check has an `argv`.
- **Validation runs per set piece**, for the players it needs, before anything spawns: the player exists, its club is implemented, both team-talk files exist, and its club can resolve its model. Every problem is listed at once.

## `project`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `""` | The project's name, shown at the head of every player's Club rules ("this repository" when empty), and recorded on every match. |
| `club_rules.rtl_cleanup` | `manual` \| `global` | `manual` | Who unmounts rendered trees between Testing Library tests: each test file (`manual`) or the test setup file (`global`). Each value tells players something different. |
| `club_rules.test_id_attribute` | string | `data-testid` | The attribute `getByTestId` reads here. Players are told the selection order (role, then a role-bearing region, then text, then this test id) and never to select by position. |
| `club_rules.test_id_import` | string | `""` | The side-effect import a test file needs for that attribute to be the test id; empty when the setup file or the library default already makes it so. |
| `club_rules.notes` | list of strings | `[]` | Anything else a player must know about THIS repository and could not infer: one imperative sentence each. Blank notes are dropped. |

A club rule is a **claim** about the repository, not a switch that changes it. Flip one only in the commit that makes it true. The rendered rules reach every player through `{{club_rules}}` in its `system.md`.

## `defaults`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `club` | `pi` \| `scripted` \| `claude_code` | `pi` | The program that runs the model. `scripted` plays a script (tests, `ogsf demo`); `claude_code` loads but fails validation until its driver exists. |
| `model` | string | `anthropic/claude-sonnet-5-5` | `provider/model-id`, resolved against `pi --list-models`. |
| `thinking` | enum | `medium` | `off \| minimal \| low \| medium \| high \| xhigh \| max`. |
| `color` | hex string | `""` | Lane colour for players that set none; empty lets Matchday Live choose. |
| `enchantments` | list of paths | `[]` | Pi extension files, passed as `pi -e <path>`. |
| `tools` | list of strings | unset (all tools) | Roster-wide tool allowlist, inherited by every player without its own. |
| `restricted_area` | list of patterns | `[set_pieces/boardroom/, set_pieces/playbooks/]` | Paths no player may change unless it names them in its own `writes`: a player must not edit the machinery that decides whether its work passed. |
| `data_dir` | path | `set_pieces/clubhouse` | The runtime home: `{data_dir}/matches/{match_id}/…`. Always writable for every player. |

## `var`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `match_log` | path | `set_pieces/clubhouse/match_log.db` | The SQLite match log the feed writes and `ogsf var` reads. `CLUB_MATCHLOG` overrides it. |
| `flush_ms` | integer | `1000` | How often a running match sends its queued rows to Matchday Live, when a relay is set up. |

## `qa.checks[]`

The deterministic checks, in the order they run (fast first by convention). Default: legacy's four — `npm run lint` (180 s, `eslint`), `npm run typecheck` (300 s, `tsc`), `npm run test` (1800 s), `npm run build` (600 s).

| Key | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Shown in the record; names the check's log folder (`torch_pass/qa/<seq>_<name>/command.log`). |
| `area` | `frontend` \| `backend` | yes | A label for the record. |
| `operation` | `lint` \| `typecheck` \| `build` \| `test` | yes | How the gate uses the check: `test` checks are what test objectives run; a `build` check waits until every `typecheck` check passes; every check runs in a `qa` objective. |
| `argv` | list of strings | yes | The command, run in the repository root with the founder's environment. No shell: write `[sh, -c, "…"]` when you need one. |
| `timeout_seconds` | integer | no (120 when unset) | The limit; the command and all its children are killed at it, with exit 124. |
| `diagnostics` | `eslint` \| `tsc` \| empty | no | The parser the progressive gate uses to give each problem an identity (`file|rule|message`). Without one, the check is judged by its exit code. A failed run the parser cannot read stops the match rather than counting as zero problems. |

## `players[]`

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | The identifier set pieces and playbooks use. **They name players, never models.** |
| `purpose` | yes | One sentence: what this player is for. Matches its `system.md` Purpose. |
| `team_talks.system` | yes | Path to the system prompt: who the player is, plus `{{club_rules}}`. |
| `team_talks.user` | yes | Path to the user prompt: the task with `{{prompt}}`, `{{previous_report}}`, `{{torch_pass_dir}}`, and the `## Match report` JSON. |
| `club`, `model`, `thinking`, `color`, `enchantments` | no | Override the corresponding `defaults` key. |
| `tools` | no | Allowlist. Omitted = inherit `defaults.tools`; neither set = all tools. An empty list is a tool-less player, and it will stall. A capability list, not a boundary. |
| `writes` | no | What this player may modify **in the repository**, enforced after every player call. Omitted = unrestricted except the restricted area. `[]` = read-only. A list = only those patterns. Naming a restricted path here unlocks it for this player. |

Report types are deliberately absent: the config says who a player *is*; the set piece's call site says how it is *used*. One player serves many calls — the same system prompt, a different user prompt and report type per call.

## Thinking levels

Pi's reasoning-effort ladder, lowest to highest: `off | minimal | low | medium | high | xhigh | max`. Honoured when the model is registered as a reasoning model in Pi's catalog; on any other model the setting is inert — no error, no effect. Rough guidance: `high`/`xhigh` for the playmaker and the safety officer, `medium` for the builder, `low` for mechanical read-and-report players.

## Model resolution

**Always write `model` as `provider/model-id`.** The Pi club resolves it against `pi --list-models` (read once per process): an exact `provider/id` first, then exactly one exact id, then exactly one substring match. Several matches are an error that names them all; none is an error that says to register the model or fix the config. Either fails validation before anything spawns rather than silently billing the wrong provider.

- **Ambiguity can appear without anyone touching the config.** Registering a new provider that carries a model you already use turns a bare pattern ambiguous. If a roster stops validating and nobody edited it, that is why.
- Context windows come from Pi's catalog (`~/.pi/agent/models.json` or `models-store.json`, or `PI_MODELS_PATH`), else the list.
- Provider credentials come from the environment (`.env`), never the config: `ANTHROPIC_API_KEY` for `anthropic/…`, `OPENAI_API_KEY` for `openai/…`. Pi reads them; the fleet never does.
- **Changing a player's model starts a fresh club session** on the next joined match (`club_sessions.json` records the model each session was created with).

## Tools

`tools` maps to `pi --tools`. Pi's seven builtins: `read`, `bash`, `edit`, `write` (on by default in Pi) and `grep`, `find`, `ls` (**off** in bare Pi — a player that does not name them shells out through `bash`). The starter `defaults.tools` names all seven.

**Enchantment tools must be named.** `--tools` filters built-in, extension and custom tools alike, so once a player has a `tools` list, a tool its enchantment registers is dropped unless it is named there. Nothing errors. The starter playmaker and ranger name `sub_bring_on`, `sub_instruct`, `sub_bench_list` and `sub_take_off` for `subagents.ts`.

## Write permissions: `writes` and `restricted_area`

Before a player's first prompt the working tree's change-set is fingerprinted (`git diff HEAD --numstat` plus untracked files); after its last send — JSON fixes and review corrections included — it is fingerprinted again. Every path that appeared, vanished or changed is attributed to that player and checked in this order:

1. the match runtime under `data_dir` — always allowed;
2. the player's own `writes` — allowed, even inside the restricted area;
3. `restricted_area` — refused;
4. otherwise allowed only if the player has no `writes` key.

Patterns: a trailing `/` is a directory prefix; `*` and `?` stop at `/`; `**` crosses directories; anything else is an exact path.

Comparing change-sets rather than watching writes is deliberate: a path modified before the player ran and clean afterwards has been **reverted**, and a reversion is a modification — that is what catches `git checkout`.

A breach rolls back every change the player **introduced** (a new file deleted, a tracked file checked out), leaves a path that was **already dirty** alone (the founder's uncommitted work is not the fleet's to discard), records an `error` event named `permission_breach`, and fails the objective naming every path. It is never re-prompted: the write already happened.

Known gap, kept from legacy: `data_dir` holds the team talks and enchantments, and `data_dir` is always writable, so a player can edit its own prompts.

## Environment

| Variable | Meaning |
|---|---|
| `CLUB_CONFIG` | The config path for every command. |
| `CLUB_MATCHLOG` | The match log path, over `var.match_log`. |
| `CLUB_RELAY_URL`, `CLUB_RELAY_TOKEN` | Matchday Live on Vercel and a fleet token: set both and every match is relayed. |
| `CLUB_MACHINE` | How this Mac is labelled on every match (default: the host name). |
| `FOUNDER_NAME` | The founder's lane label (default: `git config user.name`). |
| `PI_PATH`, `PI_MODELS_PATH` | The Pi binary and a custom model catalog. |
| `CLUB_SCRIPT` | A script for the scripted club, when it is used outside `ogsf demo`. |

`ogsf` loads `.env` from the working directory at startup; a variable already set in the environment wins.
