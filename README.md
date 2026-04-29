# x402-wallet

A personal, self-custodial wallet that speaks the [x402](https://x402.org) /
EIP-3009 payment protocol over [MCP](https://modelcontextprotocol.io). Plug it
into Claude Code (or any MCP client) and your agent can pay 402-gated
endpoints — under spend caps you control, optionally with a Touch ID prompt
per payment.

- Keys live in the macOS Keychain (Ledger planned).
- Every payment is checked against a policy engine (per-request cap, per-day
  cap, per-origin budgets, allowlists).
- Optional approval step: silent, native macOS dialog, or Touch ID via a
  signed Swift helper.
- All payments are logged to a local SQLite audit trail.

> macOS only today (Keychain + Touch ID).

## Requirements

- macOS
- [Bun](https://bun.sh) — install with `curl -fsSL https://bun.sh/install | bash`
- [Claude Code](https://docs.claude.com/en/docs/claude-code) (or another MCP client)

## Install

```bash
git clone <this-repo-url> x402-wallet
cd x402-wallet
bun install

# Generate a fresh key in the macOS Keychain (or use import-key to bring your own).
bun run cli -- init --label keychain:main --chains 8453

# Wire the MCP server into Claude Code at user scope.
./scripts/install-mcp.sh
```

Restart Claude Code. You should see four new tools available:

- `x402_fetch` — make an HTTP request, auto-paying any x402 challenge
- `x402_check` — inspect what a 402 endpoint would charge, without paying
- `list_accounts` — list registered signer accounts
- `get_budget_status` — total spend in a rolling window

Verify the registration any time with `claude mcp list`.

## Bring your own key

```bash
echo "0xYOUR_PRIVATE_KEY" | bun run cli -- import-key --label main --chains 8453
```

Pipe via stdin — never pass `--private-key` on the command line (it leaks into
your shell history).

## Configure spend limits

The wallet creates `~/.config/x402-wallet/config.json` on first run. Edit it
to set policy. Amounts are atomic units (USDC has 6 decimals, so `10000` =
`0.01 USDC`).

```jsonc
{
  "version": 1,
  "signers": [ /* … managed by the CLI … */ ],
  "policy": {
    "maxAmountPerRequest": "100000",            // 0.10 USDC per call
    "perDayCap":           "1000000",           // 1.00 USDC / day total
    "perOriginBudgets":    { "https://transit402.dev": "500000" },
    "originAllowlist":     ["https://transit402.dev"]
  },
  "approver": { "kind": "none" }
}
```

## Optional: require approval per payment

Three approver modes — pick one and put it under `"approver"`:

```jsonc
{ "kind": "none" }                                // default: pay silently within policy
{ "kind": "osascript", "title": "x402 payment" }  // native macOS dialog (no extra setup)
{ "kind": "exec",                                  // Touch ID / password
  "binary": "~/.x402-wallet/bin/touchid-approver",
  "timeoutMs": 30000 }
```

For Touch ID, build the helper once:

```bash
./scripts/build-touchid-approver.sh
```

The `osascript` dialog defaults to **Deny** — pressing Enter or Esc rejects.

## Day-to-day commands

```bash
bun run cli -- list                                # registered signers
bun run cli -- show-address keychain:main          # public address
bun run cli -- balance keychain:main --chain 8453  # on-chain USDC balance
bun run cli -- remove keychain:main                # delete signer + Keychain item
```

## Updating

```bash
git pull
bun install
./scripts/install-mcp.sh   # idempotent; safe to re-run
```

## Uninstall

```bash
claude mcp remove x402-wallet -s user
bun run cli -- remove keychain:main         # wipes the Keychain item too
rm -rf ~/.config/x402-wallet ~/.x402-wallet
```

## Troubleshooting

- **`claude mcp list` doesn't show the server** — re-run `./scripts/install-mcp.sh`
  from inside the repo, then fully restart Claude Code.
- **`bun: command not found` after install** — open a new terminal, or
  `source ~/.bashrc` / `~/.zshrc` so Bun's `PATH` entry takes effect.
- **Touch ID prompt cancelled / "user-facing reasons"** — the wallet treats
  Touch ID cancel and "biometry unavailable" as clean rejections. Re-run the
  request, or fall back to `"approver": { "kind": "osascript" }`.
- **No signers configured** — the MCP server still starts, but every payment
  request returns `no_signer`. Run `bun run cli -- init …` first.

## Architecture / development

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture (request flow, design
decisions, testing conventions, what's not built yet).

```bash
bun test                            # full unit suite
bun run typecheck                   # tsc --noEmit, strict
RUN_KEYCHAIN_IT=1 bun test          # also runs Keychain integration test
RUN_E2E=1 bun test tests/e2e        # hits real transit402.dev (no payment)
```
