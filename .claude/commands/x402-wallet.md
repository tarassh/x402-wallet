---
description: x402-wallet — manage signers, spend limits, approver, balance
argument-hint: [show | wizard | edit | list | balance [label] | help]
---

The user invoked `/x402-wallet` with arguments: `$ARGUMENTS`

Dispatch by the first argument:

## `show` (or no arguments and the user wants a quick summary)

Run `bun run cli -- config show` via Bash. Pretty-print the JSON in your reply.

## `list`

Run `bun run cli -- list` via Bash. Show the registered signer labels and addresses.

## `balance [label] [--chain N]`

If a label was provided, run `bun run cli -- balance <label>` (append `--chain N` if a chain was given).
If no label was provided, first run `bun run cli -- list` to see the registered labels, then ask the user which one — or, if exactly one signer is registered, just use it.

## `wizard` (or no arguments at all)

The wizard is an interactive arrow-key TUI. The Bash tool used by the agent does **not** have a real TTY, so the wizard cannot run from the agent. Tell the user verbatim:

> To launch the interactive settings wizard, type this at your prompt (the `!` prefix runs it in your real terminal so the TUI works):
>
> `!bun run cli -- config wizard`

Do **not** try to run `bun run cli -- config wizard` via the Bash tool — it will hang waiting for input.

## `edit`

Same TTY limitation. Tell the user:

> To open the config in `$EDITOR`, type this at your prompt:
>
> `!bun run cli -- config edit`

Do not attempt the Bash tool route.

## `help` (or any unrecognized subcommand)

Print:

```
/x402-wallet — manage your local x402 wallet

  /x402-wallet show              Print current settings (limits, approver, allowlist)
  /x402-wallet list              List registered signer labels + addresses
  /x402-wallet balance [label]   On-chain USDC balance for a signer
  /x402-wallet wizard            Interactive arrow-key settings TUI (uses ! prefix)
  /x402-wallet edit              Open config in $EDITOR (uses ! prefix)
  /x402-wallet help              This message

Interactive subcommands (wizard, edit) need a real terminal — invoke them with
the leading "!" so they run in your shell, not in the agent's sandboxed Bash.
```

## Notes

- All `bun run cli` invocations assume the current working directory is this repo (so `package.json` and `src/cli/main.ts` resolve correctly). If Bash reports `bun: command not found` or the script fails because it's running outside the repo, tell the user and stop — don't `cd` to a guessed path.
- Never modify `~/.config/x402-wallet/config.json` yourself. Mutations belong to the wizard or the editor flow, both of which the user runs explicitly.
