#!/usr/bin/env bash
# Run test files with the right runtime:
# - Node test files that import .ts/.tsx → node + tsx
# - bun:test files → bun test
# - node:test without TS deps → node --test

errors=0
for f in src/*.test.mjs; do
  [ -f "$f" ] || continue
  echo "▶ $f"
  if grep -qE "from ['\" ][\./]*\.(ts|tsx)['\" ]" "$f"; then
    # Node's test with tsx transformer for TypeScript imports
    node --import tsx --test "$f" || { errors=$((errors + 1)); echo "  ✗ FAIL"; }
  elif grep -q "from ['\" ]bun:test['\" ]" "$f"; then
    bun test "$f" || { errors=$((errors + 1)); echo "  ✗ FAIL"; }
  else
    node --test "$f" || { errors=$((errors + 1)); echo "  ✗ FAIL"; }
  fi
done

exit $errors
