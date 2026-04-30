---
description: x402-wallet — manage signers, spend limits, approver, balance, topup
argument-hint: [show | wizard | edit | list | balance [label] | topup [label] | help]
---

The user invoked `/x402-wallet` with arguments: `$ARGUMENTS`

## How to run wallet commands

Use this single command for every wallet invocation in this slash command:

```bash
bash scripts/wallet-cli.sh <subcommand> [args...]
```

That wrapper resolves an absolute path to `bun` (PATH → `~/.bun/bin/bun` →
`/opt/homebrew/bin/bun` → `/usr/local/bin/bun`) and execs the CLI. Don't
inline a bun-finding recipe in the agent's Bash — it trips the permission
prompt's brace/quote heuristic and asks the user to confirm every time.

The current working directory is assumed to be this repo (so
`scripts/wallet-cli.sh` resolves). If `pwd` reports something else, `cd` to
the repo first.

## Dispatch by first argument

### `show` (or no arguments and the user asks for a summary)

Run `bash scripts/wallet-cli.sh config show` via Bash. Pretty-print the JSON.

### `list`

Run `bash scripts/wallet-cli.sh list`. Show registered signer labels and addresses.

### `balance [label] [--chain N]`

If a label was provided, run `bash scripts/wallet-cli.sh balance <label>` (append
`--chain N` if a chain was given).

If no label was provided, first run `bash scripts/wallet-cli.sh list`. If exactly
one signer is registered, use it. Otherwise list the labels and ask the user
which one.

### `topup [label]`

Run `bash scripts/wallet-cli.sh topup <label>`. The CLI prints the wallet address,
an ANSI QR code of the address, and the USDC contract for each configured
chain. Forward the output verbatim to the user — the QR is meant for them to
scan with a phone wallet. If no label was given the CLI auto-uses the only
signer when there's exactly one; otherwise it errors and you should ask the
user which label.

### `wizard` (or no first argument other than the empty string)

The wizard is an interactive arrow-key TUI and the agent's Bash has no real
TTY. Tell the user verbatim:

> To launch the interactive settings wizard, type this at your prompt (the
> `!` prefix runs it in your real terminal so the TUI works):
>
> `!bun run cli -- config wizard`

Do **not** try to run the wizard via the Bash tool — it will hang.

### `edit`

Same TTY limitation. Tell the user:

> To open the config in `$EDITOR`, type this at your prompt:
>
> `!bun run cli -- config edit`

Do not attempt the Bash tool route.

### `help` (or any unrecognized subcommand)

Print:

```
/x402-wallet — manage your local x402 wallet

  /x402-wallet show              Print current settings (limits, approver, allowlist)
  /x402-wallet list              List registered signer labels + addresses
  /x402-wallet balance [label]   On-chain USDC balance for a signer
  /x402-wallet topup [label]     Show address + scannable QR + USDC contract per chain
  /x402-wallet wizard            Interactive arrow-key settings TUI (uses ! prefix)
  /x402-wallet edit              Open config in $EDITOR (uses ! prefix)
  /x402-wallet help              This message

Interactive subcommands (wizard, edit) need a real terminal — invoke them with
the leading "!" so they run in your shell, not in the agent's sandboxed Bash.
```

## Notes

- Never modify `~/.config/x402-wallet/config.json` yourself. Mutations belong
  to the wizard or the editor flow, both of which the user runs explicitly.
- If `bun` cannot be found at any of the locations above, do not guess —
  surface the error and tell the user to install Bun (`curl -fsSL
  https://bun.sh/install | bash`) and reload their shell.
