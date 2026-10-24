# Slice: typed records in 2 files (group 2, the pilot)

```ogsf
lane: sdlc-strict
precondition: |
  node scripts/type-safety/index-signature-reads.mjs 'app/r/[code]/route.ts' 'lib/rooms/store.ts' > /dev/null
  test $? -eq 1
writes:
  - app/r/[[]code]/route.ts
  - lib/rooms/store.ts
  - lib/db/rows.ts
  - changelog/unreleased/typed-records-rooms-and-routes.md
checks:
  - name: no read from an index signature is left in the files in scope
    run: |
      node scripts/type-safety/index-signature-reads.mjs 'app/r/[code]/route.ts' 'lib/rooms/store.ts'
  - name: the emitted JavaScript of every file in scope is unchanged
    run: |
      base=$(git log --diff-filter=A --format=%H -1 -- specs/beta-18-slices/typed-records-rooms-and-routes.md)
      node scripts/type-safety/same-emit.mjs "$base" 'app/r/[code]/route.ts' 'lib/rooms/store.ts' 'lib/db/rows.ts'
  - name: no bracket access with a literal key was added
    run: |
      base=$(git log --diff-filter=A --format=%H -1 -- specs/beta-18-slices/typed-records-rooms-and-routes.md)
      count() { perl -0ne 'my $n = () = /\[\s*["\x27][A-Za-z_\$][\w\$]*["\x27]\s*\]/g; print $n' ; }
      status=0; n=0
      for f in 'app/r/[code]/route.ts' 'lib/rooms/store.ts'; do
        n=$((n+1))
        b=$(git show "$base:$f" | count); a=$(count < "$f")
        [ "$a" -le "$b" ] || { echo "$f: bracket reads with a literal key went $b -> $a"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: no any, no suppression and no double cast was added
    run: |
      base=$(git log --diff-filter=A --format=%H -1 -- specs/beta-18-slices/typed-records-rooms-and-routes.md)
      count() { perl -0ne 'my $n = () = /(?::\s*any\b|\bas\s+any\b|<any>|\bany\[\]|\@ts-ignore|\@ts-expect-error|\@ts-nocheck|eslint-disable|as\s+unknown\s+as)/g; print $n' ; }
      status=0; n=0
      for f in 'app/r/[code]/route.ts' 'lib/rooms/store.ts'; do
        n=$((n+1))
        b=$(git show "$base:$f" | count); a=$(count < "$f")
        [ "$a" -le "$b" ] || { echo "$f: any, suppressions and double casts went $b -> $a"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: the helper type is the one this spec gives, and it emits nothing
    run: |
      test -f lib/unchecked-fields.ts || { echo "lib/unchecked-fields.ts is missing"; exit 1; }
      grep -q 'export type UncheckedFields<Field extends string> = {' lib/unchecked-fields.ts
      grep -q 'readonly \[Name in Field\]?: unknown;' lib/unchecked-fields.ts
      test "$(grep -cE '^(export )?(const|let|var|function|class|enum) ' lib/unchecked-fields.ts)" -eq 0
```

> Dispatched with `just sdlc-strict specs/beta-18-slices/typed-records-rooms-and-routes.md` from the branch
> `feature/typed-records-rooms-and-routes`, cut from
> `release/beta-eighteen-type-safety-ci-hardening-and-leaner-tests`.
> Read `docs/agent-brief.md` before planning.

## Why this slice exists

Typecheck is the last gate red on this release, and every error left is
`TS4111`: with `noPropertyAccessFromIndexSignature` on, `r.name` is refused
when `r` is typed as nothing but "some string keys". The founder chose to fix
the types those reads come from, over writing `r["name"]` everywhere (which
checks nothing) or turning the flag off. `docs/beta-18-running-notes/slice-plan.md`
has the measurement: 976 of the errors read from a value typed
`Record<string, unknown>` (or a relative of it), and they hang off 418
declarations, none shared between files. So each needs its own shape
written down. This group is 8 errors in 2 files.

## The rule: say which fields the code reads, and change nothing that runs

**This slice changes types only.** No statement, expression, default, branch
or test assertion changes. The contract proves it: each file's JavaScript,
with types and comments removed, must be identical to what it was. If a
file cannot be made to pass typecheck without changing what runs, leave that
read as it is, say so in the commit message, and let the check fail on it.

There are three cases. Decide which one a declaration is before typing it.

**1. A value that is read and has not been checked yet** (a request body, a
stored row, a parsed file, a mock's recorded arguments). Name the fields
the code reads, with the helper type:

```ts
// before
const r = raw as Record<string, unknown>;
if (!isSoundSlot(r.slot)) continue;
rows.push({ id: String(r.id), version: Number(r.version) });

// after
const r = raw as UncheckedFields<"id" | "slot" | "version">;
```

Each field is optional and `unknown`, so every existing check
(`typeof r.label === "string"`) still type-checks and still has to be there.
Import it with `import type { UncheckedFields } from "@/lib/unchecked-fields";`.
List exactly the fields that are read: the table below has them.

**2. A value the code builds** (it is assigned to: `body.captchaToken = token`,
`delete older.spoken_code`). `UncheckedFields` is read-only and `unknown`,
which is wrong for something being filled in. Spell the shape out, with the
real type of each field the code sets:

```ts
// before
const body: Record<string, unknown> = { email };
if (captchaToken) body.captchaToken = captchaToken;

// after
const body: { email: string; captchaToken?: string } = { email };
```

**3. A value whose real type already exists** (a row type exported by the
module under test, a response type, a props type). Import that type with
`import type` and use it. Do not invent a second description of the same
thing.

Two more things decide where the type goes:

- **Change the type where the value gets it, once.** When a read is of a
  callback parameter (`rows.map((row) => row.player_id)`) or of a field
  (`db.writes.rematch`), the type comes from the declaration of the array or
  the field. Change it there, and every read below it is fixed. Do not cast
  at each read.
- **When the type comes from a helper in another file of this repository**,
  fix it there. The section "Sources in other files" below lists the ones
  the measurement found, and their files are in `writes`. The pilot group
  cast at ten calls where typing one helper was the fix.
- **When the type comes from a package** (a library's own type with an
  index signature), or from a repository file that is not in `writes`, do
  not edit that file. Cast at the
  call here (`(await readJsonObject(req)) as UncheckedFields<…>`) and name
  the helper in the commit message, so that it can be fixed at its own
  source when its file's slice comes.

**Where the value was `any`** (the blog's front matter from `gray-matter`, a
`JSON.parse` result) the code may already use a field as a string or a list
without checking it. Give that field the type the code uses it as, in a
spelled-out shape, and say in the type's doc comment that it is assumed and
not checked. Do not add the check: that changes what runs, and replacing
hand checks with schemas is a separate piece of work the founder has put in
the backlog. List every such field in the commit message.

Never:

- write `value["field"]` to get past the error;
- add `any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error` or an
  `eslint-disable`;
- change `tsconfig.json`, or any file not in `writes`;
- rename a field, reorder a statement, or "tidy" anything: the emit check
  will fail the run for it.

Give every named type you add a `/** … */` comment that says what the value
is and where it comes from. The helper file already exists; do not change it.



## The files, measured on this branch

For each file: the declarations the refused reads hang off, whether the
value is read or written to, what it is typed as today, and the fields
read. Lines are of this branch's tip. `inferred` reads take their type from
somewhere above the line shown: find that place.

### `app/r/[code]/route.ts` (4 errors, 3 declarations)

- line 20, read, 2 errors, typed `{ [key: string]: string \| number \| boolean \| null \| undefined; other: `: `rows = await readRows(sql)`
  fields: `player_id`, `score`
- line 5, read, 1 errors, typed `Record<string, string>`: `x = lib.read()`
  fields: `label`
- line 5, read, 1 errors, typed `Record<string, string>`: `y = other()`
  fields: `mode`

### `lib/rooms/store.ts` (4 errors, 2 declarations)

- line 12, written to, 1 errors, typed `Record<string, unknown> \| { email: string }`: `body: Record<string, unknown> = { email, aVeryLongNameThatKeepsGoing, andAnotherOneThatPus`
  fields: `captchaToken`
- line 41, read, 3 errors, typed `Record<string, unknown>`: `r = raw as Record<string, unknown>`
  fields: `id`, `slot`, `version`

## Sources in other files: fix these where they are

These reads take their type from a helper in another file of this repository. The file is in `writes`. Change the type there, once (a generic parameter that names the fields, a real return type), and the reads below need no cast. The emit check covers the helper's file too.

Other files call these helpers and are not in this slice. They must go on compiling exactly as they do today: no new error anywhere, of any kind (the gate compares error identities). So a call that names no fields has to keep the type it has now. A type parameter with a default, or an overload, does that; changing the return type outright does not.

- `lib/db/rows.ts:8`: 2 errors in 1 files of this group (`app/r/[code]/route.ts`)

## Changelog fragment

`changelog/unreleased/typed-records-rooms-and-routes.md`: `### Changed`, then one bullet in the voice of the existing
fragments, ending "nothing players see changes."

## The commit message

One commit. A Conventional Commit subject under 100 characters, then prose:
how many errors went (the count before and after in these files), which
declarations became case 1, 2 and 3, every field typed as assumed and not
checked, every helper outside the slice that was cast at its call, and
anything left unfixed with the reason.

## Done when

- [ ] No `TS4111` is left in the files in scope, and no new error of any
      kind anywhere.
- [ ] Every file's emitted JavaScript is unchanged.
- [ ] The tests that passed before pass after, in both runners.
- [ ] `changelog/unreleased/typed-records-rooms-and-routes.md` exists.
- [ ] Nothing outside `writes` changed.
