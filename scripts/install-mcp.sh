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

if ! command -v bun >/dev/null 2>&1; then
  echo "error: 'bun' not found." >&2
  echo "  Install Bun: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if [ ! -f "$SERVER_PATH" ]; then
  echo "error: expected MCP entrypoint at $SERVER_PATH" >&2
  exit 1
fi

# Remove any prior registration so this is idempotent.
claude mcp remove x402-wallet -s user >/dev/null 2>&1 || true

claude mcp add -s user x402-wallet -- bun run "$SERVER_PATH"

echo
echo "Registered x402-wallet (user scope) -> $SERVER_PATH"
echo "Verify with:  claude mcp list"
echo "Restart Claude Code to pick up the new server."
