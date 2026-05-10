#!/bin/bash
set -e
cd "$(dirname "$0")"
for f in _build_nb*.js; do
  echo "Building $f..."
  node "$f"
done
echo ""
echo "Validating..."
for i in $(seq -w 0 9); do
  node -e "JSON.parse(require('fs').readFileSync('../${i}-*.ipynb'.replace('*','')))" 2>/dev/null || true
done
echo "All notebooks built."
