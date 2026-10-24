```ogsf
lane: sdlc-strict
precondition: |
  n=$(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx' | tr '\n' '\0' \
        | xargs -0 npx eslint --no-warn-ignored --format json | jq '[.[].errorCount] | add')
  echo "examined $(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx' | wc -l | tr -d ' ') test files in scope: $n lint errors"
  test "$n" -gt 0
writes:
  - components/auth/*.test.ts
  - components/auth/*.test.tsx
  - components/home/*.test.ts
  - components/home/*.test.tsx
  - changelog/unreleased/testing-library-clean-auth-contact-games-home.md
checks:
  - name: every test file in scope is lint-clean
    run: |
      git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx' | tr '\n' '\0' | xargs -0 npx eslint --no-warn-ignored
  - name: no assertion, test case or cleanup was removed
    run: |
      status=0; n=0
      for f in $(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx'); do
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
      for f in $(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx'); do
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
      for f in $(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx'); do
        n=$((n+1))
        new=$(comm -13 <(git show "HEAD:$f" | bare) <(bare < "$f"))
        [ -z "$new" ] || { echo "$f: bare text in toHaveTextContent, which matches a substring. Whole text: ...exactText(text). Part of it: a regular expression. Found: $new"; status=1; }
      done
      echo "examined $n files"; exit $status
  - name: every lint suppression added carries its reason
    run: |
      added=$(git diff HEAD -- 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx' | grep -E '^\+.*eslint-disable' || true)
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
      for f in $(git ls-files 'components/auth/*.test.ts' 'components/auth/*.test.tsx' 'components/home/*.test.ts' 'components/home/*.test.tsx'); do
        n=$((n+1))
        new=$(comm -13 <(git show "HEAD:$f" | disguised) <(disguised < "$f"))
        [ -z "$new" ] || { echo "$f: a search of the markup, a selector or a function passed to a text query, or a style assertion that cannot fail (an empty value for a camel-case property), where an element should be found. Find the element; if no query reaches it, keep the access with a reasoned suppression. Found: $new"; status=1; }
      done
      echo "examined $n files"; exit $status
```