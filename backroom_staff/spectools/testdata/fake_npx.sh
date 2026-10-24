#!/bin/sh
# A stand-in for `npx` in the spec tool tests. It answers eslint, vitest and
# jest with fixed output for the files in testdata/area_repo, so the legacy
# Python tool and the Go port can be run over the same tree and compared.
tool="$1"; shift
root="$(pwd -P)"
case "$tool" in
eslint)
  dry=0
  files=""
  for a in "$@"; do
    case "$a" in
      --fix-dry-run) dry=1 ;;
      --*|json) ;;
      *) files="$files $a" ;;
    esac
  done
  printf '['
  sep=""
  for f in $files; do
    case "$f:$dry" in
      components/home/Feed.test.tsx:0)
        m='{"ruleId":"testing-library/no-node-access","severity":2,"line":3,"message":"Avoid direct Node access.","fatal":false},{"ruleId":"jest-dom/prefer-to-have-text-content","severity":2,"line":4,"message":"Use toHaveTextContent","fatal":false},{"ruleId":"testing-library/no-node-access","severity":2,"line":5,"message":"Avoid direct Node access.","fatal":false},{"ruleId":"no-console","severity":1,"line":2,"message":"warning only","fatal":false}' ;;
      components/home/Feed.test.tsx:1)
        m='{"ruleId":"testing-library/no-node-access","severity":2,"line":3,"message":"Avoid direct Node access.","fatal":false},{"ruleId":"testing-library/no-node-access","severity":2,"line":5,"message":"Avoid direct Node access.","fatal":false}' ;;
      components/a11y/Dialog.a11y.test.tsx:0)
        m='{"ruleId":"testing-library/no-container","severity":2,"line":2,"message":"Avoid container","fatal":false},{"ruleId":"jest-dom/prefer-focus","severity":2,"line":3,"message":"Use toHaveFocus","fatal":false}' ;;
      components/a11y/Dialog.a11y.test.tsx:1)
        m='{"ruleId":null,"severity":2,"line":3,"message":"Parsing error: '"')'"' expected.","fatal":true}' ;;
      *) m='' ;;
    esac
    printf '%s{"filePath":"%s/%s","messages":[%s]}' "$sep" "$root" "$f" "$m"
    sep=","
  done
  printf ']\n'
  ;;
vitest)
  printf '\033[2m Test Files \033[22m 2 passed (2)\n\033[2m      Tests \033[22m 5 passed (5)\n'
  ;;
jest)
  printf 'PASS components/a11y/Dialog.a11y.test.tsx\nTests:       2 passed, 2 total\n' >&2
  ;;
*)
  echo "fake npx: no answer for $tool" >&2
  exit 1
  ;;
esac
