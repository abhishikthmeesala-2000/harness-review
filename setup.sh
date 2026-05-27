#!/bin/sh
# One-time setup: build harness and install CLI globally
set -e

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$HARNESS_DIR/packages/cli/dist/bin/engagement-harness.js"
LINK="$HOME/Library/pnpm/engagement-harness"

cd "$HARNESS_DIR"
pnpm build

# Write wrapper script directly — no pnpm link, no global store
printf '#!/bin/sh\nexec node "%s" "$@"\n' "$BIN" > "$LINK"
chmod +x "$LINK"

echo "Done. engagement-harness -> $BIN"
engagement-harness --version
