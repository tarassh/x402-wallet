# x402-wallet

Personal agentic wallet that speaks the x402 / EIP-3009 payment protocol, exposed to agents via an MCP server. Designed for self-custody: keys live in the macOS Keychain (Ledger planned), payments are gated by a policy engine, and — optionally — every payment requires user approval via Touch ID, a native dialog, or a custom binary.

## Stack

- Runtime + package manager: **Bun**
- Test runner: **`bun test`** (colocated in `tests/`)
- Language: TypeScript, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- Crypto / EIP-712: **viem**
- MCP: **`@modelcontextprotocol/sdk`**
- Audit log + spend history: **`bun:sqlite`**
- Keyring: **`@napi-rs/keyring`** (macOS Keychain on this machine)

## Architecture

```
┌──── MCP client (Claude Code / Cursor / …) ────┐
│                                               │
│  calls x402_fetch / x402_check / list_accounts│
│                                               │
└───────────────── stdio MCP ───────────────────┘
                      ▼
┌───────── src/mcp ─────────┐
│  build.ts  server.ts      │  (tools: x402_fetch, x402_check,
│  tools.ts  transport.ts   │   list_accounts, get_budget_status)
│  runtime.ts               │  (reads WalletConfig → builds signers,
│                           │   policy, approver, orchestrator)
└────────────┬──────────────┘
             ▼
┌────── src/orchestrator ───────┐
│  orchestrator.ts              │
│    request → 402 → parse      │
│      → selectAccept+signer    │
│      → policy.evaluate        │
│      → approver.approve       │
│      → signer.signTypedData   │
│      → retry with X-PAYMENT   │
│      → audit.record           │
└──────┬──────────┬─────┬───────┘
       ▼          ▼     ▼
   src/policy  src/    src/signers
               approvers       │
                               ├── mock.ts          (tests)
                               ├── keychain.ts      (Keychain-backed)
                               └── secret-store.ts  (InMemory | Keyring)
                    │
                    ├── simple.ts       (Always / Deny / Mock)
                    ├── exec.ts         (spawn any binary)
                    ├── osascript.ts    (native macOS dialog)
                    └── format.ts       (human summary)
       │
       └── src/audit/sqlite.ts  (AuditLog + SpendHistory, same table)

       src/x402/
         parse.ts          (decode PAYMENT-REQUIRED header)
         authorization.ts  (EIP-3009 TypedData + X-PAYMENT encoder)
         types.ts

       src/config/  (persisted wallet state)
         types.ts          (WalletConfig, WalletSignerEntry, ApproverConfig)
         parse.ts          (strict validator for loaded configs)
         store.ts          (ConfigStore interface, FileConfigStore JSON)

       src/onboarding/commands.ts  (init / import / list / show / remove)
       src/cli/                    (argv parser + run() dispatcher + main entry)
```

## Onboarding

The wallet ships a CLI for creating signers and a separate MCP server binary.
Keys live in the macOS Keychain under service `x402-agent-wallet` (override via
config). The config file lives at `~/.config/x402-wallet/config.json` (override
with `X402_WALLET_CONFIG`).

```bash
# one-time: generate a key locally + register it
bunx x402-wallet init --label keychain:main --chains 8453

# or: import an existing key (from stdin; don't use --private-key on the CLI)
echo "0x…" | bunx x402-wallet import-key --label backup --chains 8453,1

bunx x402-wallet list
bunx x402-wallet show-address keychain:main
bunx x402-wallet balance keychain:main --chain 8453
bunx x402-wallet remove keychain:main
```

Config file (v1, JSON):

```json
{
  "version": 1,
  "signers": [
    {
      "label": "keychain:main",
      "address": "0x…",
      "chains": [8453],
      "keychainService": "x402-agent-wallet",
      "keychainAccount": "keychain-main",
      "createdAt": 1700000000
    }
  ],
  "policy": {
    "maxAmountPerRequest": "10000",
    "perDayCap": "500000",
    "perOriginBudgets": { "https://transit402.dev": "50000" },
    "originAllowlist": ["https://transit402.dev"]
  },
  "approver": { "kind": "none" }
}
```

Approver kinds:

- `{ "kind": "none" }` — policy-only (default)
- `{ "kind": "osascript", "title": "...", "timeoutMs": 60000 }` — native macOS dialog
- `{ "kind": "exec", "binary": "~/.x402-wallet/bin/touchid-approver", "timeoutMs": 30000 }` — Touch ID / password via the Swift helper, or any custom binary

The MCP server (`x402-wallet-mcp`, wired as `bun run start`) loads this config on startup. If no signers are configured it prints an onboarding hint to stderr but still connects (so tooling can detect it).

## Request flow

1. Agent calls MCP tool `x402_fetch` with a URL.
2. Orchestrator issues the HTTP request via the injected `HttpTransport`.
3. If response isn't `402`, returned as `no_payment_required`.
4. `tryExtractChallenge` decodes the `PAYMENT-REQUIRED` base64 JSON (x402 v2).
5. `selectAccept` picks the first `accepts[]` entry with a registered signer for its `chainId`.
6. `PolicyEngine.evaluate` checks `maxAmountPerRequest`, per-origin + global daily caps, asset / network / origin / payTo allowlists. Audit `failed` + return `rejected_by_policy` on denial.
7. If an `Approver` is configured, call `.approve({ origin, amount, payTo, signerLabel, … })`. Audit + return `rejected_by_user` on denial.
8. Build EIP-3009 `TransferWithAuthorization` typed data (`validAfter = now - 60`, `validBefore = now + maxTimeoutSeconds`, fresh 32-byte nonce).
9. `signer.signTypedData` → signature. Keychain signer reads the private key from the OS keyring, signs with `viem.privateKeyToAccount`, and verifies the recovered address matches.
10. Encode `X-PAYMENT` header and retry the original request.
11. On 2xx → `paid`. On non-2xx → `payment_failed`. Audit the outcome either way.

## Key design decisions (non-obvious)

- **Approver runs *after* policy, *before* signing.** Means a user rejection never exposes key material, and a policy-rejected request never prompts the user. Ordering is load-bearing; don't swap.
- **Approver is orchestrator-level, not signer-level.** Lets us swap Keychain ↔ Ledger later without changing the approval UX, and the same signer can front different approval policies per origin.
- **`SecretStore` is abstract.** `KeychainSigner` depends on a `SecretStore` (`InMemorySecretStore` for tests, `KeyringSecretStore` for real Keychain). Unit tests never touch the OS; only the `keychain.integration.test.ts` (gated by `RUN_KEYCHAIN_IT=1`) does.
- **`HttpTransport` is injectable.** The orchestrator never calls `fetch` directly. Real HTTP lives in `src/mcp/transport.ts`, tests use a recording stub.
- **SQLite doubles as `SpendHistory`.** `SqliteAuditLog` implements both `AuditLog` and `SpendHistory`, so the policy engine's per-day budgets read the same table the orchestrator writes.
- **`now` and `nonce` are injected** on the orchestrator. Lets tests assert deterministic `X-PAYMENT` payloads and lets production swap in `crypto.getRandomValues` + `Date.now()` without overriding signing logic.
- **osascript dialog defaults to Deny.** Both "default button" and "cancel button" are "Deny" — pressing Enter or Esc rejects, reducing risk of accidental approval.
- **EIP-3009 timing envelope** is `[now - 60, now + maxTimeoutSeconds]`. The 60s backwards slack handles clock skew between wallet and facilitator.
- **Single-asset hardcoded to USDC (6 decimals) in amount formatting.** We only support the `exact` scheme today; adding `upto` or other stablecoins means plumbing decimals from the accept's `extra` metadata, not re-fetching contract state.

## Layout

```
src/
  approvers/       Approver interface + Mock/Always/Deny/Exec/Osascript + formatters
  audit/           SqliteAuditLog (implements AuditLog + SpendHistory)
  chain/           USDC contract addresses (usdc.ts) + on-chain ERC-20 balance reads via viem (balance.ts)
  mcp/             build.ts, server.ts entrypoint, tools.ts, transport.ts
  orchestrator/    payment state machine
  policy/          PolicyEngine + InMemorySpendHistory
  signers/         Signer interface, MockSigner, KeychainSigner, SecretStore
  x402/            challenge parser + EIP-3009 payload builder
  onboarding/      CLI commands.ts (init/import/list/show/remove) + balance.ts (label → address → on-chain USDC)
                   + config-actions.ts (pure policy mutations + USDC↔atomic) + config-edit.ts ($EDITOR flow)
                   + config-wizard.ts (@clack/prompts arrow-key wizard)
setup.sh                       Top-level interactive installer (deps, MCP, slash, key, Touch ID)
scripts/
  touchid-approver.swift       Touch ID / password helper (LocalAuthentication)
  build-touchid-approver.sh    Compiles the Swift helper
  install-mcp.sh               Registers the wallet as a stdio MCP server in Claude Code (user scope)
.claude/commands/x402-wallet.md  Project-scoped slash command (setup.sh can mirror to ~/.claude/commands/)
tests/             Mirrors src/ tree, plus tests/e2e/
```

## Commands

```bash
bun test                            # full unit suite (fast, hermetic)
bun test --coverage                 # with per-file coverage
bun run typecheck                   # tsc --noEmit, strict
RUN_KEYCHAIN_IT=1 bun test          # also run macOS Keychain integration test
RUN_E2E=1 bun test tests/e2e        # hit real transit402.dev 402 (no payment)
bun run start                       # stdio MCP server (src/mcp/server.ts)
bun run cli -- list                 # run the CLI in-repo
bunx x402-wallet init --label …     # once installed globally
scripts/install-mcp.sh              # register the MCP server with Claude Code (user scope, idempotent)
scripts/build-touchid-approver.sh   # compile Swift helper → ~/.x402-wallet/bin
```

## Testing conventions

- Every source module has a colocated `*.test.ts` that mirrors its path.
- Tests are hermetic by default: no network, no filesystem (SQLite uses `:memory:`), no OS keychain.
- External adapters (real HTTP, real keyring, Ledger USB later) live behind interfaces and get **gated integration tests** via env flags (`RUN_E2E`, `RUN_KEYCHAIN_IT`).
- Orchestrator tests inject `() => 1_700_000_000` for `now` and a fixed 32-byte nonce so `X-PAYMENT` payloads are byte-stable.
- Coverage target: logic modules at ≥95% lines. Thin OS adapters (`transport.ts`, `KeyringSecretStore`) are exempt because their integration paths are tested separately.

## What's not built yet

- Ledger signer. The `Signer` interface is ready (only needs `signTypedData`); plan is `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-eth`.
- Funding helper — `balance` CLI reads on-chain USDC, but no faucet deep-link or guided deposit flow.
- ~~CLI commands for managing origins, budgets, approvers after initial setup~~ — `bun run cli -- config wizard|edit|show` cover this. (Mnemonic export, BIP-39 recovery still TODO.)
- Out-of-band approval queue (agent gets `pending_approval` synchronously; a separate UI approves out of band).
- Multi-asset / `upto` scheme support. USDC + `exact` only today.
- BIP-39 mnemonic export / recovery flow.
- Biometric ACL on the Keychain item itself (today biometry comes from the approver layer via the Swift helper — the `@napi-rs/keyring` API doesn't expose per-item ACLs).

## Don't

- Don't call `fetch` directly in the orchestrator — it breaks test hermeticity. Use `deps.transport`.
- Don't store key material outside `SecretStore`. The `KeychainSigner` address check (`viemAccount.address === registeredAddress`) is the canary for a tampered store.
- Don't make the approver call mandatory in tests — keep it optional so existing orchestrator tests stay terse.
- Don't skip hooks / bypass types. `tsconfig.json` is `strict` + `exactOptionalPropertyTypes`; spread `...(x !== undefined ? { x } : {})` is the idiom.
- Don't write to `src/mcp/server.ts` or `src/cli/main.ts` for business logic — they're thin entrypoints. Logic belongs in `runtime.ts`, `commands.ts`, `run.ts`.
- Don't use `--private-key` on the CLI in docs or examples — it leaks into shell history. Always pipe via stdin.
- Don't put bigints in the JSON config; stringify them. `config/parse.ts` accepts either string or number but always normalizes to string.
- Don't add `Co-Authored-By` trailers (or any AI-attribution) to commits. Commits in this repo stay authored by the human.
