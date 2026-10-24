# Slice: test files lint-clean in `components/x` (beta.18 group 3)

> **Factory slice (ADW).** Dispatched with
> `just sdlc-strict specs/beta-18-slices/testing-library-clean-x.md`
> from the branch `feature/testing-library-clean-x`.
>
> **Pre-flight reading (REQUIRED):** `docs/agent-brief.md` (§3 and §7),
> `specs/beta-18-slices/testing-library-clean-onboarding.md` (the pilot, and
> the four rules its last section records), `lib/testing/exact-text.ts`,
> `lib/testing/data-hp-is-the-test-id.ts`.

```ogsf
lane: sdlc-strict
precondition: |
  n=$(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx' | tr '\n' '\0' \
        | xargs -0 npx eslint --no-warn-ignored --format json | jq '[.[].errorCount] | add')
  echo "examined $(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx' | wc -l | tr -d ' ') test files in scope: $n lint errors"
  test "$n" -gt 0
writes:
  - components/x/*.test.ts
  - components/x/*.test.tsx
  - changelog/unreleased/testing-library-clean-x.md
checks:
  - name: every test file in scope is lint-clean
    run: |
      git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx' | tr '\n' '\0' | xargs -0 npx eslint --no-warn-ignored
  - name: no assertion, test case or cleanup was removed
    run: |
      status=0; n=0
      for f in $(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx'); do
        n=$((n+1))
        for what in 'expect\(' '(^|[[:space:];{}])(it|test)(\.each)?\(' 'cleanup'; do
          b=$(git show "HEAD:$f" | grep -oE "$what" | wc -l | tr -d '[:space:]'); a=$(grep -oE "$what" "$f" | wc -l | tr -d '[:space:]')
          [ "$a" -ge "$b" ] || { echo "$f: occurrences of $what went $b -> $a"; status=1; }
        done
      done
      echo "examined $n files"; exit $status
  - name: no new selection by position
    run: |
      sel() { perl -0ne 'while (/((?:get|query|find)AllBy\w+\((?:[^()]|\([^()]*\))*\)\s*(?:\[\d+\]|\.at\([^)]*\)))/g) { (my $m = $1) =~ s/\s+//g; $m =~ s/,([\)\]\}])/$1/g; print "$m\n" }' | sort; }
      # A position can also be taken from a stored result: `const rows =
      # getAllBy…(…)`, then `rows[0]`. `held` names what a file stores that
      # way; `indexed` lists every place those names are indexed.
      held() { perl -0ne 'my %h; while (/(?:const|let)\s+(\w+)\s*=[^;]*?(?:get|query|find)AllBy/g) { $h{$1} = 1 } print join("|", sort keys %h)'; }
      indexed() { NAMES="$1" perl -0ne 'for my $name (grep { length } split /\|/, $ENV{NAMES}) { while (/\b(\Q$name\E\s*(?:\[[^\]]+\]|\.at\([^)]*\)))/g) { (my $m = $1) =~ s/\s+//g; print "$m\n" } }' | sort -u; }
      # Each pattern is tried on a line it must find first.
      for must in 'screen.getAllByRole("row")[0]' 'within(x).queryAllByText(/a/).at(-1)'; do
        printf '%s\n' "$must" | sel | grep -q . || { echo "this check's own pattern does not find: $must"; exit 2; }
      done
      for must in 'const rows = screen.getAllByRole("row"); expect(rows[1]).toBeVisible()' 'const figures = screen.getAllByRole("figure"); names.forEach((n, i) => expect(figures[i]).toBeVisible())'; do
        printf '%s\n' "$must" | indexed "$(printf '%s\n' "$must" | held)" | grep -q . || { echo "this check's own pattern does not find: $must"; exit 2; }
      done
      status=0; n=0
      for f in $(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx'); do
        n=$((n+1))
        new=$(comm -13 <(git show "HEAD:$f" | sel) <(sel < "$f"))
        [ -z "$new" ] || { echo "$f: new selection by position (select by role, text or the data-hp test id): $new"; status=1; }
        names=$(held < "$f")
        new=$(comm -13 <(git show "HEAD:$f" | indexed "$names") <(indexed "$names" < "$f"))
        [ -z "$new" ] || { echo "$f: new selection by position, taken from a stored query result (compare the whole list, or select by role, text or the data-hp test id): $new"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: no bare-string toHaveTextContent was added
    run: |
      bare() { perl -0ne 'while (/(toHaveTextContent\(\s*(?:["\x27\x60](?:[^"\x27\x60\\]|\\.)*["\x27\x60]|(?!expect\.|new\s|exactText)[A-Za-z_\$][\w.\$]*))/g) { (my $m = $1) =~ s/\s+//g; $m =~ s/,([\)\]\}])/$1/g; print "$m\n" }' | sort; }
      status=0; n=0
      for f in $(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx'); do
        n=$((n+1))
        new=$(comm -13 <(git show "HEAD:$f" | bare) <(bare < "$f"))
        [ -z "$new" ] || { echo "$f: bare text in toHaveTextContent, which matches a substring. Whole text: ...exactText(text). Part of it: a regular expression. Found: $new"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: every lint suppression added carries its reason
    run: |
      added=$(git diff HEAD -- 'components/x/*.test.ts' 'components/x/*.test.tsx' | grep -E '^\+.*eslint-disable' || true)
      n=$(printf '%s' "$added" | grep -c 'eslint-disable' || true)
      bare=$(printf '%s' "$added" | grep -vcE 'eslint-disable.* -- .{20,}' || true)
      [ "$n" -eq 0 ] && bare=0
      echo "examined the diff in scope: $n suppression(s) added, $bare without a reason"
      test "$bare" -eq 0
  - name: no element lookup became a search of the markup
    run: |
      disguised() { perl -0pe 's/(By(?:Text|LabelText|Title|AltText)\(|toHaveStyle\(\{)\s*\n\s*/$1/g' | grep -vE '^[[:space:]]*(//|/?[*])' | grep -E '\.(innerHTML|outerHTML)\b|toContainHTML\(|selector:[[:space:]]*["'"'"'`]|By(Text|LabelText|Title|AltText)\([[:space:]]*\(|toHaveStyle\(\{[^}]*[a-z][A-Z][A-Za-z]*:[[:space:]]*""|toHaveStyle\(\{[^}]*:[[:space:]]*expect\.' | sed -E 's/[[:space:]]+//g; s/,([])}])/\1/g' | sort; }
      # The pattern is tried on a line it must find first: a pattern grep
      # rejects would otherwise find nothing in every file and pass.
      for must in 'expect(row.innerHTML).toMatch(/x/)' 'getAllByText(/.+/, { selector: "[aria-live]" })' 'screen.getByText(DATE, { selector: "time" })' 'within(x).getByText((_text, el) => el?.tagName === "FIGCAPTION")' 'expect(panel).toHaveStyle({ clipPath: "" })'; do
        printf '%s\n' "$must" | disguised | grep -q . || { echo "this check's own pattern does not find: $must"; exit 2; }
      done
      # A matcher handed to toHaveStyle as a value is usually on the next line too.
      printf 'expect(panel()).toHaveStyle({\n  clipPath: expect.stringMatching(/^polygon/),\n});\n' | disguised | grep -q . || { echo "this check's own pattern does not find a matcher passed to toHaveStyle as a value"; exit 2; }
      # A function matcher is usually wrapped onto the next line by Prettier.
      printf 'within(x).getByText(\n  (_text, el) => el?.tagName === "P",\n);\n' | disguised | grep -q . || { echo "this check's own pattern does not find a function matcher on the line after the query"; exit 2; }
      status=0; n=0
      for f in $(git ls-files 'components/x/*.test.ts' 'components/x/*.test.tsx'); do
        n=$((n+1))
        new=$(comm -13 <(git show "HEAD:$f" | disguised) <(disguised < "$f"))
        [ -z "$new" ] || { echo "$f: a search of the markup, a selector or a function passed to a text query, or a style assertion that cannot fail (an empty value for a camel-case property), where an element should be found. Find the element; if no query reaches it, keep the access with a reasoned suppression. Found: $new"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: the Jest-run files in scope pass
    run: |
      npx jest -c jest.config.mjs --runTestsByPath 'components/x/A.a11y.test.tsx' 'components/x/B.a11y.test.tsx'
```

## Why this slice exists

The pre-commit hook runs ESLint on staged files and refuses a commit while
any error remains (`.lintstagedrc.json`), so a test file that is only partly
cleaned cannot be committed at all. The cleanup therefore goes group by
group, and each slice leaves every test file in its group with **no lint
error**. The pilot did this for `components/onboarding`; this slice does it
for `components/x`.

## The files, measured on this branch

3 test files, 3 of them with findings, 4 lint errors:
`testing-library/no-node-access` 2, `jest-dom/prefer-focus` 1, `testing-library/prefer-screen-queries` 1.

| File | Runs in | Errors | After `eslint --fix` | `expect(` lines / test cases |
| --- | --- | --- | --- | --- |
| `components/x/A.a11y.test.tsx` | Jest | 1 | **does not parse** (Parsing error: Unexpected token) | 1 / 1 |
| `components/x/B.a11y.test.tsx` | Jest | 2 | **does not parse** (Parsing error: ',' expected.) | 2 / 1 |
| `components/x/c.test.ts` | node | 1 | 1 left: prefer-screen-queries 1 | 5 / 3 |

Before the slice: Vitest COULD NOT READ THE VITEST SUMMARY; Jest 6 passed, 6 total. They all pass after it.

**The fixer breaks these files:** `components/x/A.a11y.test.tsx`, `components/x/B.a11y.test.tsx`. Do not keep its output there. Restore the file (`git checkout -- <file>`) and convert the same assertions by hand, to the matchers in the table under step 3.

**`components/x/A.a11y.test.tsx`, `components/x/B.a11y.test.tsx` run under Jest, not Vitest.** Run `npx jest -c jest.config.mjs --runTestsByPath <file>` for them. `expect` comes from `@jest/globals` there and is typed `any`, so `tsc` will not catch a misspelt matcher: run the file. Jest unmounts between tests by itself, so do not add `cleanup` to a Jest-run file.

### The findings no fixer closes

- `components/x/B.a11y.test.tsx:3` (no-node-access): `x.closest('a')`
- `components/x/B.a11y.test.tsx:4` (no-node-access): `y.closest('li')`

## Method, in this order

1. **Fix one file at a time**: `npx eslint --fix --no-warn-ignored <file>`.
   Never run `--fix` on a directory or on the repository.
2. **After each file, read the output for `Parsing error`.** The jest-dom
   fixer writes broken code for some shapes (a property read through an `as`
   cast loses a parenthesis). ESLint says so and exits 1, but 1 is also what
   it returns for any file with an error left, so read the output.
3. **A file the fixer breaks is restored and converted by hand**, to the
   matchers the fixer would have written:

   | Finding | Write |
   | --- | --- |
   | `jest-dom/prefer-in-document` | `toBeInTheDocument()` / `.not.toBeInTheDocument()` |
   | `jest-dom/prefer-to-have-text-content` | `toHaveTextContent(...)`, and see step 4 |
   | `jest-dom/prefer-to-have-attribute` | `toHaveAttribute(name, value)` / `.not.toHaveAttribute(name)` |
   | `jest-dom/prefer-enabled-disabled` | `toBeDisabled()` / `toBeEnabled()`, and drop the `as` cast |
   | `jest-dom/prefer-focus` | `toHaveFocus()` |
   | `jest-dom/prefer-to-have-class` | `toHaveClass(...)` / `.not.toHaveClass(...)` |
   | `jest-dom/prefer-to-have-style` | `toHaveStyle(...)`; it reads computed style, so run the test |

4. **Check every text assertion the fixer touched.** It rewrites
   `expect(x.textContent).toBe(text)`, which is exact, into
   `toHaveTextContent(text)`, which matches a substring. Wherever the original
   used `toBe`, `toEqual` or `toStrictEqual`, write
   `expect(x).toHaveTextContent(...exactText(text))` with
   `import { exactText } from "@/lib/testing/exact-text";`. Never a bare
   string and never an anchored regular expression in its place. A `toContain`
   original was a substring and stays one, written as a regular expression:
   `toHaveTextContent(/Room soon/)`. The fixer writes that as a bare string
   too; change it. The contract refuses every new bare string or bare
   constant in `toHaveTextContent`, because the bare form does not say which
   of the two was meant.
5. **Then the findings no fixer closes** (listed above). Select the element
   by what it is, trying in this order:
   1. its role with its accessible name;
   2. `within(...)` a role-bearing region that narrows it;
   3. the text a player reads;
   4. last, `screen.getByTestId("…")` on the `data-hp` hook the component
      already carries, with `import "@/lib/testing/data-hp-is-the-test-id";`
      and a comment beside the call saying why nothing above applies (no
      role at all, or several share a role and none has a name).

   **Add a query beside the original lookup; do not put one in its
   place.** The order above is for a read that needs a new handle: a bare
   class, a tag, a position nobody meant. Where the original found its
   element by something the element carries, that lookup is the subject
   and stays, in a helper where lint objects, whatever role the element
   also has:
   - its `data-hp` hook (`[data-hp="home-round"]` is
     `getByTestId("home-round")`; the browser journeys select by it);
   - a key in a data attribute (`[data-achievement="first-win"]`);
   - an ARIA attribute (`[aria-roledescription="slide"]:not([aria-hidden])`,
     `[role="option"][aria-hidden]` counted by the attribute, not by what a
     reader can reach);
   - its id (`getElementById("squad-name-help")`).
   The role query you would have written goes beside it as an assertion:
   `expect(card).toBe(screen.getByRole("region", { name }))`, or
   `toHaveAccessibleDescription(...)` on the field after the help line has
   been read by its id. Both then fail for their own reasons. The
   thirteenth and fourteenth groups (sessions 8cd78a4c, 8e39a399) replaced
   such lookups with roles; a renamed hook passed eight tests and a slide
   no longer described as a slide passed another eight.

   **A marker on a node the test hands in stays on it.** A test that
   passes `<p data-testid="ways-in">…</p>` into a slot and then finds it
   is identifying THAT node. Once `data-hp` is the file's test id,
   `getByTestId("ways-in")` no longer sees `data-testid`; do not drop the
   attribute and look for the node's words, because a component that
   ignores its slot and prints the same words then passes. Keep the
   attribute and assert it on what is found:
   `expect(within(card).getByText("Host or join")).toHaveAttribute("data-testid", "ways-in")`.
   And **a selector with alternatives keeps all of them**:
   `querySelector('[role="progressbar"], progress')` is not
   `queryByRole("progressbar")`, which does not see a `<progress>` given
   another role. Keep the list in a helper. (Both from the thirteenth
   group, found by the vendor reviewer after a review by breaks had
   passed them.)

   **Never by position** (`getAllByRole(...)[1]`): the pilot did, and a
   reorder no player would notice failed three tests and let a fourth pass
   against the wrong element. Never add a role or a name to a component so a
   test can find it. `document.activeElement` becomes `toHaveFocus()`; a help
   line read by id keeps that read and gains `toHaveAccessibleDescription(...)`
   on the field it describes.

   `render-result-naming-convention` is about what a Testing Library
   `render(...)` or `renderHook(...)` returns when a test holds on to it.
   Prefer not holding it: query through `screen`, and destructure only what
   the test uses (`const { rerender, unmount } = render(...)`, renamed when
   a test has two renders: `const { unmount: unmountFirst } = render(...)`;
   for a hook, `const { result } = renderHook(...)`). Where the whole
   render result is needed, name it `view`. Never name a hook's result
   `view`: destructure it. The same applies to a helper in the same file
   that returns one of the two.

   If the rule fires on a function that is NOT a Testing Library render
   (`renderToStaticMarkup`, `renderMarkdown`, a WebGL renderer, a helper that
   returns an element or props), do not rename the value to `view`: that
   name would be false. `eslint.config.mjs` sets
   `testing-library/custom-renders` to `["renderHook"]` so that such calls
   are not reported at all. If one is reported anyway, that setting is missing from
   this branch: stop and say so, because the fix is one line of
   configuration and not a rename in every test.

   **Before you decide no query can reach an element, read the component and
   the primitive that draws it** (`git grep -n 'data-hp' <the component file>`,
   and the same for what it renders). `ContentCardSurface` puts
   `data-hp="card"` on every card. The first group suppressed a rule on the
   grounds that a card had no hook, and it had one.

   If no query can select the element as it is rendered, keep the access and
   suppress that one line with what you tried:
   `// eslint-disable-next-line testing-library/no-node-access -- <what was tried and why no query reaches it>`.
   The contract refuses one without a reason. It does not cap them.

   **A reasoned suppression is better than a rewrite that asserts less.**
   The second group ran under a cap of three and came back with four tests
   weakened to stay under it. Do not do any of these to make a finding go
   away; the contract refuses the first three and a reviewer will find the
   rest by breaking the component:
   - a search of the markup (`innerHTML`, `outerHTML`, `toContainHTML`)
     where an element used to be found;
   - a text query with a selector, of any kind (`getAllByText(/.+/, { selector:
     "[aria-live]" })`, `getByText(DATE, { selector: "time" })`), or with
     a function that looks at the element and not the text (`getByText((_t,
     el) => el?.tagName === "FIGCAPTION")`): each is a lookup by tag or
     attribute wearing a query's name, it does not see an empty element, and
     finding an element by the text it is then asserted to have proves
     nothing about the text;
   - emptying a container (`document.head.innerHTML = ""`) where one node
     used to be removed;
   - asserting on a nearby element that has a hook (a stub's marker) in
     place of the element the test was about (a wrapper's class).

   **Change the matcher, keep the subject.** The third group ran with every
   check above in place and came back with five tests reading a different
   thing than before (session eac9e0eb). Each kept its `expect(`, so nothing
   counted the loss; a reviewer found all five by breaking the component.
   What an assertion reads, and the area a search covers, stay exactly what
   they were:
   - **the same element.** Not its parent or the whole component where one
     line was read (a tag's text is the same string whichever child
     "(you)" sits in), and not "whatever holds this text" where a named cell
     was read (`getByText("NightOwls")` finds the name wherever in the row
     it is printed, the Squad column or not);
   - **the same direction.** `x.closest(sel)` looks up from `x`. A search
     inside a container looks down and does not see the container itself;
   - **the same area.** A lookup asked of `document` or `container` is still
     asked of all of it, not `within()` one part of it;
   - **the same property.** An id, a class or an attribute that was asserted
     is still asserted, or the thing it exists for is (an id that a label
     points at: ask for the region by its name);
   - **everything the original could see.** A role query leaves out what is
     hidden from assistive technology (`aria-hidden`, `inert`, `hidden`).
     `querySelectorAll('[role="option"][aria-selected="true"]')` counts
     every option; `queryAllByRole("option", { selected: true })` counts
     the ones on show. The fifth group counted one card of a deck that
     hides eleven of its twelve (session b36fabde). Where the original
     counted or searched regardless of what is hidden, pass `hidden: true`.

   **The new matcher is at least as strict as the comparison it replaces.**
   The fifth group kept its subjects and loosened two matchers:
   - `className` equal to `"a b"` becomes `toHaveClass("a b", { exact: true })`.
     Without `exact` it passes with any class added;
   - an anchored pattern keeps its anchors: `toMatch(/^One word\./)` on a
     line's text does not become `/One word\./` on the field's accessible
     description;
   - `toBe(text)` stays exact (`...exactText(text)`, or a plain string for
     `toHaveAccessibleDescription`, which compares the whole description);
   - a list compared with `toEqual([...])` stays a whole-list comparison.

   **A comparison of two lookups asserts that the first one exists.**
   `expect(a?.closest(sel)).toBe(b)` fails when both are missing only by
   accident: one side is `undefined` and the other `null`. Tidy the left
   side into a helper that ends `?? null` and the accident is gone: both
   sides are `null` and the test passes with nothing on the page (session
   84e783fb). Before comparing two lookups, ask for one of them and assert
   it is there (`expect(floater).not.toBeNull()`), then compare.

   **`fireEvent` already runs inside `act`.** When a native `.click()`
   inside `act(() => …)` becomes `fireEvent.click(…)`, drop the wrapper;
   do not keep it and suppress `no-unnecessary-act`. Keep an `await act(async
   () => …)` that awaits work the test needs done, with its reason.
   When lint objects to how the subject is found, move that lookup
   **unchanged** into a helper (`nameLineIn(row)`, `chipAround(note)`) whose
   doc comment says why no query reaches it. And "stricter" is a claim: if
   you call a rewrite stricter, say in the commit message which change to
   the component the old assertion missed and the new one catches. If you
   cannot name one, keep the subject.

   Put a lookup that two tests share in one helper with a doc comment that
   says why no query reaches the element, and **write the helper as a
   `function` declaration**. `testing-library/no-node-access` reports a
   member access under a variable declarator or an expression statement,
   so it reports one inside `const rowsOf = (root) => root.querySelectorAll(…)`
   and does not report one inside `function rowsOf(root) { return … }`.
   A helper written as a declaration needs no disable comment; leave none
   there, because the pre-commit hook removes an unused one. The doc comment
   carries the reason.

   **A suppression sits on the line the rule reports, after formatting.**
   The contract rehearses the pre-commit hook before it checks lint, and the
   hook runs Prettier. A call written on one line under its
   `eslint-disable-next-line` and then wrapped by Prettier has moved off the
   suppressed line: the comment is reported as unused and the error is back.
   The sixth group's run ended "fail" on exactly this, three attempts in a
   row (session 249f6c5b). So: run `npx prettier --write <file>` BEFORE you
   read the lint result, never after; and where a suppression is needed on a
   call that wraps, put the comment inside the wrapped expression, directly
   above the reported line, or use a `function` declaration, which needs
   none.

   **Three conversions that look like matcher swaps and are not.**
   - `toHaveStyle({ someCamelCase: "" })` cannot fail. With an empty
     expected value jest-dom falls back to `getPropertyValue("someCamelCase")`,
     which is empty for any camel-case name, so the assertion passes with the
     style set. `expect(el.style.clipPath).toBe("")` stays as it is, with a
     reasoned suppression of `jest-dom/prefer-to-have-style`. (One-word
     properties, `width`, `transform`, `overflow`, do work.) The contract
     refuses the camel-case form. A matcher as the value is the same trap:
     `toHaveStyle({ clipPath: expect.stringMatching(/^polygon/) })` passes
     with no clip-path at all, because a matcher is not a style and is
     normalised to the empty string (session 526ebf58). A pattern on a
     style stays `expect(el.style.clipPath).toMatch(/^polygon/)`, which
     lint does not report. The contract refuses a matcher there too.
   - `expect(child.parentElement).toBe(host)` is not
     `expect(host).toContainElement(child)`: the first says "directly
     inside", the second "anywhere inside".
   - A read by tag is not a query by role. `querySelectorAll("a")` sees an
     anchor with no `href`; `getAllByRole("link")` does not, and that entry
     is what an inventory of a nav is for. `x.closest("a")` is the same.
     Keep both by tag, in a helper (`anchorsIn(nav)`, `anchorAround(x)`).

   **Four more, from the eleventh group** (session 732e9e1c; thirteen tests
   in four files read something else afterwards, and every check passed).
   - **A position the original took is part of the subject.** "Never by
     position" above is about a position the original did NOT take. Where
     the original read `document.querySelectorAll("tbody tr")[0]` or
     `list.firstElementChild`, the first row is what it asserted about, and
     in a standing or an ordered list the order is the claim. Finding "the
     row named Priya" instead passes with the rows in reverse. Move the
     positional read, unchanged, into a `function` helper (`bodyRows()`,
     `firstChipOf(list)`) and index what it returns.
   - **A scoped selector keeps its scope and its tag.**
     `'.hp-daily-place [data-hp="gamer-tag"]'` is not
     `getAllByTestId("gamer-tag")`, and `'time[data-hp="countdown"]'` is not
     `getByTestId("countdown")`: the first lost where the tags must be, the
     second lost that the element is a `<time>`, in a test titled "is a time
     element". Keep the selector in a helper, or find by the hook and then
     assert the part the hook does not say (`expect(el.tagName).toBe("TIME")`).
   - **`toHaveValue(0)` cannot fail for a missing value** on a progress bar,
     meter, slider or spinbutton. There the matcher reads `aria-valuenow`
     through `Number()`, and `Number(null)` is 0 (so is `Number("")`).
     `expect(bar.getAttribute("aria-valuenow")).toBe("0")` becomes
     `expect(bar).toHaveAttribute("aria-valuenow", "0")` with a reasoned
     suppression of `jest-dom/prefer-to-have-value`. Any other number is
     safe as `toHaveValue(n)`.
   - **`.not.toBeChecked()` cannot fail for a missing state.** For a radio,
     checkbox or switch drawn with a role, `toBeChecked` answers "not
     checked" when `aria-checked` is absent or is not `"true"` or `"false"`
     (it returns a failed match, it does not throw), and `.not` turns that
     into a pass. `expect(x.getAttribute("aria-checked")).toBe("false")`
     becomes `expect(x).toHaveAttribute("aria-checked", "false")` with a
     reasoned suppression of `jest-dom/prefer-checked` (session 435f786b:
     the builder read the matcher's source, concluded the opposite, and
     wrote the conclusion in a comment). `toBeChecked()` without `.not` is
     safe. The same reading applies to any matcher that reports a state it
     cannot determine as a failed match: under `.not`, try it on an element
     that has no state at all.
   - **An assertion added to keep the count has to be able to fail.** The
     contract counts `expect(` per file, and merging two assertions into one
     list comparison lowers the count. Do not make it up with
     `expect(x).toHaveAttribute("data-you")` on rows just filtered by that
     attribute. Keep the original's separate assertions, or add one that a
     change to the component could fail, and say which change.
6. **Run the tests** for the files you changed, in the runner that owns them.
7. **Write the changelog fragment**
   `changelog/unreleased/testing-library-clean-x.md`: one `### Changed`
   bullet in the voice of `CHANGELOG.md`, ending with "nothing players see
   changes." (`changelog/unreleased/README.md`).

## Rules

1. **Never weaken or delete a test to make it pass** (`docs/agent-brief.md`
   §7). Every `expect(` that exists now exists afterwards, asserting the same
   fact **about the same element** or a stricter one.
2. **Keep every `cleanup` reference in a Vitest-run file.** This project's
   cleanup is manual; your instructions say why.
3. **Test files only.** No component, helper, fixture, config or setup file
   changes. `lib/testing/exact-text.ts` and
   `lib/testing/data-hp-is-the-test-id.ts` already exist: import them, do not
   edit them.
4. **No new `any`, no `as unknown as`.** Removing an `as` cast that a matcher
   makes unnecessary is expected.
5. **Stay in scope.** A test file outside `components/x` is another slice's.
6. **A helper function you add or change keeps or gains a one-line doc
   comment** saying what it returns, written as `/** … */` directly above
   it. A `//` line comment does not count, on a `function` or on a
   `const f = () => …` alike (session fb2db224 explained a changed helper
   in two `//` lines, and a reviewer sent it back). The merge-gate reviewer
   measures this on the functions a diff touches.

## The commit message

`commit_message` in your Report is the whole message, and **every Report you
emit carries it in full**, including one written after a fix: the last Report
is the one that gets committed.

- Subject, Conventional Commits, lowercase, no full stop, for example
  `test(x): make the x test files lint-clean`.
- A blank line, then a prose body that says: the lint error count before and
  after; which files were converted by hand and the construct the fixer
  broke in each; for **each** finding no fixer closes, what replaced it (the
  query, or the suppression and its reason); every `getByTestId` you added
  and why no role applied; every assertion you rewrote into a different KIND
  of check, even one you believe equivalent (an `innerHTML` comparison into
  `toBeEmptyDOMElement()`, a text read into a text query); every assertion
  that now reads a different element, or searches a different area, than it
  did, with the reason the original subject could not be kept; and anything
  this spec did not predict.

## Done when

- [ ] Every test file in scope reports no lint error and no `Parsing error`.
- [ ] The tests that passed before pass after, in both runners.
- [ ] No `expect(`, test case or `cleanup` reference was removed.
- [ ] No selection by position was added, and no bare string or bare
      constant was added to `toHaveTextContent`.
- [ ] `changelog/unreleased/testing-library-clean-x.md` exists.
- [ ] Nothing outside `writes` changed.
- [ ] One commit, with the body described above.
