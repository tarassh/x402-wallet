#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around `bun src/cli/main.ts`. Resolves an absolute path to
# bun (PATH first, then well-known install locations) and execs the CLI
# with all args forwarded.
#
# Why: Claude Code's Bash tool spawns a non-login shell, so `bun` is often
# not on PATH there even when it works in interactive shells. The slash
# command (.claude/commands/x402-wallet.md) calls this wrapper so its
# recipe stays a single short command — no inline brace/quote heuristics
# triggering the permission prompt every time.
#
# Usage:  bash scripts/wallet-cli.sh <subcommand> [args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$REPO_DIR/src/cli/main.ts"

if command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
elif [ -x /opt/homebrew/bin/bun ]; then
  BUN=/opt/homebrew/bin/bun
elif [ -x /usr/local/bin/bun ]; then
  BUN=/usr/local/bin/bun
else
  echo "error: bun not found on PATH or in known install locations." >&2
  echo "  Install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if [ ! -f "$ENTRY" ]; then
  echo "error: missing $ENTRY (re-clone the repo?)" >&2
  exit 1
fi

exec "$BUN" "$ENTRY" "$@"
