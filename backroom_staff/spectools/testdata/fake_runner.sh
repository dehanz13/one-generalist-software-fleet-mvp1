#!/bin/sh
echo "$*" >> "$FAKE_LOG"
file="$5"
if grep -q '^crash' "$file"; then echo "Error: runner crashed" >&2; exit 1; fi
if grep -q '^empty' "$file"; then echo 'noise {"testResults":[]}'; exit 0; fi
target=$(cat src/thing.ts)
printf 'some log line\n{"testResults":[{"assertionResults":['
grep '^test ' "$file" | {
  sep=""
  while read -r _ name _ needle; do
    case "$target" in *"$needle"*) status=passed ;; *) status=failed ;; esac
    printf '%s{"title":"%s","status":"%s"}' "$sep" "$name" "$status"
    sep=","
  done
}
printf ']}]}\n'
