#!/usr/bin/env bash
set -euo pipefail

# x402-wallet setup — interactive installer.
#
# Defaults (no flags): asks before each step.
# Non-interactive: pass --yes (accept all defaults) plus per-step overrides.
#
# Steps:
#   1. Verify Bun + Claude Code are installed.
#   2. bun install
#   3. Install /x402-wallet slash command (user|project|none)
#   4. Register MCP server with Claude Code (user scope)
#   5. Create a wallet key (label + chains)
#   6. Build Touch ID approver (optional)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

usage() {
  cat <<EOF
x402-wallet setup

Usage: ./setup.sh [flags]

Flags:
  -y, --yes              Accept defaults for every step (non-interactive).
  --skip-deps            Don't run \`bun install\`.
  --skip-mcp             Don't register the MCP server.
  --skip-key             Don't create a new wallet key.
  --skip-touchid         Don't offer to build the Touch ID approver.
  --slash <user|project|none>
                         Slash command scope (default: user).
  --label <name>         Signer label for the new key (default: keychain:main).
  --chains <ids>         Comma-separated chain IDs (default: 8453).
  --touchid              Build the Touch ID approver without asking.
  -h, --help             Show this help.

Examples:
  ./setup.sh                                      # full interactive walk-through
  ./setup.sh --yes                                # accept all defaults
  ./setup.sh --yes --label keychain:work --chains 8453,1
  ./setup.sh --skip-key --slash project           # CI-friendly, skip key creation
EOF
}

# --- defaults ---
yes_to_all=false
do_install=ask
do_slash=ask          # user|project|none|ask
do_mcp=ask
do_key=ask
key_label="keychain:main"
key_chains="8453"
do_touchid=ask

# --- parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) yes_to_all=true ;;
    --skip-deps) do_install=no ;;
    --skip-mcp) do_mcp=no ;;
    --skip-key) do_key=no ;;
    --skip-touchid) do_touchid=no ;;
    --slash)
      shift
      case "${1:-}" in
        user|project|none) do_slash=$1 ;;
        *) echo "error: --slash needs one of: user, project, none" >&2; exit 64 ;;
      esac ;;
    --label) shift; key_label=${1:?--label requires a value} ;;
    --chains) shift; key_chains=${1:?--chains requires a value} ;;
    --touchid) do_touchid=yes ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown flag: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

# --- prompt helpers ---
prompt_yn() {
  local msg=$1 default=$2 ans hint
  if $yes_to_all; then [ "$default" = "y" ] && echo y || echo n; return; fi
  hint=$([ "$default" = "y" ] && echo "Y/n" || echo "y/N")
  while true; do
    read -r -p "$msg [$hint] " ans
    ans="${ans:-$default}"
    case "$ans" in
      [Yy]|[Yy]es) echo y; return ;;
      [Nn]|[Nn]o)  echo n; return ;;
      *) echo "Please answer y or n." ;;
    esac
  done
}

prompt_val() {
  local msg=$1 default=$2 ans
  if $yes_to_all; then echo "$default"; return; fi
  read -r -p "$msg [$default] " ans
  echo "${ans:-$default}"
}

prompt_choice() {
  # $1=msg, $2=default, $3..=options
  local msg=$1 default=$2 ans
  shift 2
  if $yes_to_all; then echo "$default"; return; fi
  while true; do
    read -r -p "$msg [$default] " ans
    ans="${ans:-$default}"
    for opt in "$@"; do
      if [ "$opt" = "$ans" ]; then echo "$ans"; return; fi
    done
    echo "Please answer one of: $*"
  done
}

# --- step 1: prereqs ---
# Find a binary on PATH or in well-known install locations (handles the case
# where the user just ran `curl bun.sh/install | bash` and hasn't reloaded their
# shell rc yet). Prepends the dir to PATH on success.
find_or_die() {
  local name=$1 install_hint=$2
  shift 2
  if command -v "$name" >/dev/null 2>&1; then return 0; fi
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      echo "  (found $name at $candidate; prepended its dir to PATH for this run)"
      return 0
    fi
  done
  echo "  $name ... missing" >&2
  echo "    $install_hint" >&2
  return 1
}

echo "==> Checking prerequisites"
miss=0
find_or_die bun \
  "Install: curl -fsSL https://bun.sh/install | bash    (then: exec \$SHELL)" \
  "$HOME/.bun/bin/bun" \
  "/opt/homebrew/bin/bun" \
  "/usr/local/bin/bun" \
  || miss=1
[ $miss -eq 0 ] && echo "  bun ... ok ($(bun --version))"

find_or_die claude \
  "Install Claude Code: https://docs.claude.com/en/docs/claude-code" \
  "$HOME/.local/bin/claude" \
  "/opt/homebrew/bin/claude" \
  "/usr/local/bin/claude" \
  || miss=1
[ "$(command -v claude)" ] && echo "  claude ... ok"

[ $miss -eq 0 ] || exit 1

# Capture the absolute bun path so we can bake it into the user-scope slash
# command. Claude Code's Bash tool spawns non-login shells without the user's
# shell rc, so bare `bun` won't be found there even when it works in setup.sh.
BUN_BIN="$(command -v bun)"

# --- step 2: bun install ---
if [ "$do_install" = "ask" ]; then
  [ "$(prompt_yn 'Run `bun install`?' y)" = "y" ] && do_install=yes || do_install=no
fi
if [ "$do_install" = "yes" ]; then
  echo "==> bun install"
  bun install
fi

# --- step 3: slash command ---
if [ "$do_slash" = "ask" ]; then
  if $yes_to_all; then
    do_slash=user
  else
    echo
    echo "Install /x402-wallet slash command?"
    echo "  user    — works from any directory (recommended)"
    echo "  project — only when claude runs from this repo"
    echo "  none    — skip"
    do_slash=$(prompt_choice "Choice" "user" user project none)
  fi
fi
case "$do_slash" in
  user)
    mkdir -p "$HOME/.claude/commands"
    src="$REPO_DIR/.claude/commands/x402-wallet.md"
    dest="$HOME/.claude/commands/x402-wallet.md"
    if [ ! -f "$src" ]; then
      echo "error: missing $src — re-clone the repo." >&2
      exit 1
    fi
    {
      echo "<!-- Generated by x402-wallet setup.sh; source: $src -->"
      awk -v repo="$REPO_DIR" -v bun="$BUN_BIN" '
        /^The user invoked / && !injected {
          print "**Working directory:** `" repo "` — use this as cwd for every Bash invocation."
          print ""
          print "**Bun binary:** `" bun "` — use this exact absolute path. Do NOT call bare `bun`; Claude Codes Bash tool spawns a non-login shell where bun is not on PATH."
          print ""
          injected = 1
        }
        { print }
      ' "$src"
    } > "$dest"
    echo "==> Slash command installed (user scope) -> $dest"
    ;;
  project)
    echo "==> Using project-scoped slash command in $REPO_DIR/.claude/commands/"
    ;;
  none)
    echo "==> Skipping slash command install"
    ;;
esac

# --- step 4: MCP server ---
if [ "$do_mcp" = "ask" ]; then
  [ "$(prompt_yn 'Register the MCP server with Claude Code (user scope)?' y)" = "y" ] && do_mcp=yes || do_mcp=no
fi
if [ "$do_mcp" = "yes" ]; then
  echo "==> Registering MCP server"
  bash "$REPO_DIR/scripts/install-mcp.sh"
fi

# --- step 5: create key ---
if [ "$do_key" = "ask" ]; then
  [ "$(prompt_yn 'Create a new wallet key now?' y)" = "y" ] && do_key=yes || do_key=no
fi
if [ "$do_key" = "yes" ]; then
  if ! $yes_to_all; then
    key_label=$(prompt_val "Label" "$key_label")
    key_chains=$(prompt_val "Chain IDs (comma-separated)" "$key_chains")
  fi
  echo "==> Creating signer \"$key_label\" on chains $key_chains"
  bun run cli -- init --label "$key_label" --chains "$key_chains"
fi

# --- step 6: Touch ID approver ---
if [ "$do_touchid" = "ask" ]; then
  [ "$(prompt_yn 'Build the Touch ID approver helper?' n)" = "y" ] && do_touchid=yes || do_touchid=no
fi
if [ "$do_touchid" = "yes" ]; then
  echo "==> Building Touch ID approver"
  bash "$REPO_DIR/scripts/build-touchid-approver.sh"
  echo "  Built. To enable, run \`bun run cli -- config wizard\` and pick approver: touchid."
fi

echo
echo "All done. Next steps:"
echo "  - Restart Claude Code so it picks up the new MCP server."
echo "  - Inspect settings:    bun run cli -- config show    (or  /x402-wallet show)"
echo "  - Tune limits:         bun run cli -- config wizard  (or  /x402-wallet wizard)"
[ "$do_key" = "yes" ] && echo "  - Fund the address printed above with USDC."
