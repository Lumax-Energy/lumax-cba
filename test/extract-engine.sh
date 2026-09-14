#!/bin/bash
# Pulls the analysis engine out of index.html into a CommonJS module the tests can require.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/../index.html"
START=$(grep -n '^"use strict";' "$SRC" | head -1 | cut -d: -f1)
END=$(grep -n '^const STORAGE_KEY = ' "$SRC" | head -1 | cut -d: -f1)
sed -n "${START},$((END-1))p" "$SRC" > "$DIR/engine.js"
cat >> "$DIR/engine.js" <<'JS'

module.exports = { analyze, simpleThreeSpan, excelExample, emptyLoads, DEFAULT_COMBINATIONS, SECTION_LIBRARY, LOAD_CASES };
JS
echo "wrote $DIR/engine.js"
