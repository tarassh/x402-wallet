#!/usr/bin/env bash
set -euo pipefail

# Registers x402-wallet as a stdio MCP server in Claude Code (user scope),
# wired to this repo's checkout. Idempotent: re-running re-registers.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_PATH="$REPO_DIR/src/mcp/server.ts"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found." >&2
  echo "  Install Claude Code first: https://docs.claude.com/en/docs/claude-code" >&2
  exit 1
fi

# Resolve an absolute path to bun. Claude Code spawns MCP servers without
# sourcing the user's shell rc, so registering with bare `bun` fails when
# `~/.bun/bin` isn't on the system PATH (e.g. Claude Code launched from
# Spotlight). Use an absolute path instead.
BUN_BIN=""
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
else
  for c in "$HOME/.bun/bin/bun" "/opt/homebrew/bin/bun" "/usr/local/bin/bun"; do
    if [ -x "$c" ]; then BUN_BIN="$c"; break; fi
  done
fi
if [ -z "$BUN_BIN" ]; then
  echo "error: 'bun' not found on PATH or in ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin." >&2
  echo "  Install Bun: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if [ ! -f "$SERVER_PATH" ]; then
  echo "error: expected MCP entrypoint at $SERVER_PATH" >&2
  exit 1
fi

# Remove any prior registration so this is idempotent.
claude mcp remove x402-wallet -s user >/dev/null 2>&1 || true

# Register with the absolute bun path so Claude Code can spawn the server
# even when launched without the user's shell PATH.
claude mcp add -s user x402-wallet -- "$BUN_BIN" run "$SERVER_PATH"

echo
echo "Registered x402-wallet (user scope)"
echo "  bun:    $BUN_BIN"
echo "  server: $SERVER_PATH"
echo "Verify with:  claude mcp list"
echo "Restart Claude Code to pick up the new server."
