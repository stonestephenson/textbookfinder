#!/bin/bash
# Done-gate for istheseawolfbundleworthit.com — fast, no dependencies.
# Green here means: all JS parses, all tests pass.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in assets/*.js api/*.js tests/*.js; do
  [ -e "$f" ] || continue
  node --check "$f"
done

node --test 'tests/*.test.js'
