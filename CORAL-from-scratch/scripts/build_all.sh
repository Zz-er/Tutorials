#!/bin/bash
# 一键构建所有 notebook
# 用法: bash scripts/build_all.sh

set -e
cd "$(dirname "$0")"

for f in _build_nb*.js; do
  echo "Building $f..."
  node "$f"
done

echo ""
echo "Validating all notebooks..."
cd ../notebooks
for nb in *.ipynb; do
  node -e "JSON.parse(require('fs').readFileSync('$nb','utf8')); console.log('  OK: $nb')"
done

echo ""
echo "All notebooks built and validated."
