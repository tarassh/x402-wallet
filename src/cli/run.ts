import type { Hex } from "viem";
import { optionalOption, parseArgv, parseChains, requireOption } from "./args.ts";
import type { CliIo } from "./io.ts";
import type { OnboardingDeps } from "../onboarding/commands.ts";
import {
  importKey,
  initWallet,
  listSigners,
  removeSigner,
  showAddress,
} from "../onboarding/commands.ts";
import type { HttpTransport } from "../orchestrator/types.ts";
import { getBalances } from "../onboarding/balance.ts";
import { formatTokenAmount } from "../chain/balance.ts";
import { summarize } from "../onboarding/config-actions.ts";
import { configEdit, realEditorRunner } from "../onboarding/config-edit.ts";
import type { EditorRunner } from "../onboarding/config-edit.ts";
import { configWizard } from "../onboarding/config-wizard.ts";
import { buildTopupReport } from "../onboarding/topup.ts";

export interface CliDeps {
  onboarding: OnboardingDeps;
  io: CliIo;
  configPath: string;
  transport: HttpTransport;
  rpcOverrides?: Record<number, string>;
  runEditor?: EditorRunner;
}

const USAGE = `x402-wallet — agentic wallet for x402-gated APIs

USAGE
  x402-wallet <command> [options]

COMMANDS
  init           Generate a new private key and register it in the wallet.
  import-key     Import an existing private key (from stdin by default).
  list           List all registered signers.
  show-address   Print the address for a given signer label.
  balance        Print USDC balance across all configured chains.
  remove         Delete a signer (from config and keychain).
  topup          Show address + QR + USDC contract per chain (for funding).
  config show    Print the current config (limits, approver, allowlist).
  config wizard  Interactive arrow-key editor for limits / approver / origins.
  config edit    Open the config JSON in $EDITOR (validates on save).
  help           Show this message.

COMMON OPTIONS
  --label <name>      Signer label (alphanumeric + : _ . -)
  --chains <ids>      Comma-separated chain IDs (default: 8453)
  --private-key 0x…   Hex private key. WARNING: appears in shell history; prefer stdin.
`;

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgv(argv);

  try {
    switch (parsed.command) {
      case "init":
        return await cmdInit(parsed.options, deps);
      case "import-key":
        return await cmdImport(parsed.options, deps);
      case "list":
        return await cmdList(deps);
      case "show-address":
        return await cmdShow(parsed.options, parsed.positional, deps);
      case "balance":
        return await cmdBalance(parsed.options, parsed.positional, deps);
      case "remove":
        return await cmdRemove(parsed.options, parsed.positional, deps);
      case "config":
        return await cmdConfig(parsed.positional, deps);
      case "topup":
        return await cmdTopup(parsed.options, parsed.positional, deps);
      case "help":
      case "--help":
      case "-h":
        deps.io.stdout(USAGE);
        return 0;
      default:
        deps.io.stderr(`Unknown command: ${parsed.command}\n\n${USAGE}`);
        return 64;
    }
  } catch (err) {
    deps.io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function cmdInit(opts: Record<string, string | true>, deps: CliDeps): Promise<number> {
  const label = requireOption(opts, "label");
  const chains = parseChains(optionalOption(opts, "chains") ?? "8453");
  const result = await initWallet(deps.onboarding, { label, chains });
  deps.io.stdout(
    JSON.stringify(
      {
        action: "init",
        label: result.label,
        address: result.address,
        chains: result.chains,
        configPath: deps.configPath,
      },
      null,
      2,
    ) + "\n",
  );
  deps.io.stderr(
    `✔ Created signer "${result.label}" (${result.address})\n` +
      `  Private key stored in OS keychain. Save the address above — you'll need it for funding.\n`,
  );
  return 0;
}

async function cmdImport(opts: Record<string, string | true>, deps: CliDeps): Promise<number> {
  const label = requireOption(opts, "label");
  const chains = parseChains(optionalOption(opts, "chains") ?? "8453");

  let privateKey = optionalOption(opts, "private-key");
  if (privateKey) {
    deps.io.stderr(
      `WARNING: --private-key on the command line leaks into shell history and \`ps\`.\n` +
        `         Next time, pipe the key via stdin instead:\n` +
        `           echo "0x…" | x402-wallet import-key --label ${label}\n`,
    );
  } else {
    const stdin = (await deps.io.readStdin()).trim();
    if (!stdin) throw new Error("No private key provided on stdin");
    privateKey = stdin;
  }
  const result = await importKey(deps.onboarding, {
    label,
    chains,
    privateKey: privateKey as Hex,
  });
  deps.io.stdout(
    JSON.stringify(
      {
        action: "import-key",
        label: result.label,
        address: result.address,
        chains: result.chains,
        configPath: deps.configPath,
      },
      null,
      2,
    ) + "\n",
  );
  deps.io.stderr(`✔ Imported signer "${result.label}" (${result.address})\n`);
  return 0;
}

async function cmdList(deps: CliDeps): Promise<number> {
  const signers = await listSigners(deps.onboarding);
  deps.io.stdout(JSON.stringify({ configPath: deps.configPath, signers }, null, 2) + "\n");
  return 0;
}

async function cmdShow(
  opts: Record<string, string | true>,
  positional: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const label = positional[0] ?? optionalOption(opts, "label");
  if (!label) throw new Error("show-address requires a signer label");
  const address = await showAddress(deps.onboarding, label);
  deps.io.stdout(`${address}\n`);
  return 0;
}

async function cmdBalance(
  opts: Record<string, string | true>,
  positional: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const label = positional[0] ?? optionalOption(opts, "label");
  if (!label) throw new Error("balance requires a signer label");
  const report = await getBalances(
    {
      config: deps.onboarding.config,
      transport: deps.transport,
      ...(deps.rpcOverrides ? { rpcOverrides: deps.rpcOverrides } : {}),
    },
    label,
  );
  const rows = report.rows.map((r) => ({
    chainId: r.chainId,
    chainName: r.chainName,
    rpcUrl: r.rpcUrl,
    ...(r.raw !== undefined ? { raw: r.raw } : {}),
    ...(r.raw !== undefined && r.decimals !== undefined
      ? { usdc: formatTokenAmount(BigInt(r.raw), r.decimals) }
      : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
  }));
  deps.io.stdout(
    JSON.stringify(
      { label: report.label, address: report.address, balances: rows },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

async function cmdRemove(
  opts: Record<string, string | true>,
  positional: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const label = positional[0] ?? optionalOption(opts, "label");
  if (!label) throw new Error("remove requires a signer label");
  await removeSigner(deps.onboarding, label);
  deps.io.stdout(`Removed signer "${label}"\n`);
  return 0;
}

async function cmdTopup(
  opts: Record<string, string | true>,
  positional: readonly string[],
  deps: CliDeps,
): Promise<number> {
  let label = positional[0] ?? optionalOption(opts, "label");
  if (!label) {
    const config = await deps.onboarding.config.load();
    if (config.signers.length === 1) {
      label = config.signers[0]!.label;
    } else if (config.signers.length === 0) {
      throw new Error("topup: no signers configured. Run `init` or `import-key` first.");
    } else {
      throw new Error(
        `topup: multiple signers configured; pass a label (got ${config.signers
          .map((s) => `"${s.label}"`)
          .join(", ")})`,
      );
    }
  }

  const report = await buildTopupReport({ config: deps.onboarding.config }, label);

  // Render an ANSI QR via qrcode-terminal. Dynamically imported so unrelated
  // CLI commands work even if the optional dep isn't installed.
  // The library reads `this._errorLevel` internally, so we call generate()
  // through the module object (not a detached reference) to preserve binding.
  const qrModule = (await import("qrcode-terminal")) as unknown as {
    default?: QrTerminal;
  } & QrTerminal;
  const qr: QrTerminal = (qrModule.default ?? qrModule) as QrTerminal;
  if (typeof qr?.generate !== "function") {
    throw new Error(
      "qrcode-terminal failed to load. Try `bun install` from the repo root.",
    );
  }

  const qrText = await new Promise<string>((resolve) => {
    qr.generate(report.address, { small: true }, (out: string) => resolve(out));
  });

  const lines: string[] = [];
  lines.push("");
  lines.push(`Top up "${report.label}"`);
  lines.push(`Address: ${report.address}`);
  lines.push("");
  lines.push(qrText);
  lines.push("Send USDC (decimals: 6) on any of these networks:");
  for (const c of report.chains) {
    lines.push(`  • ${c.chainName} (chainId ${c.chainId})`);
    lines.push(`      USDC contract: ${c.usdcContract}`);
    lines.push(`      Explorer:      ${c.explorerAddressUrl}`);
  }
  if (report.unknownChainIds.length > 0) {
    lines.push("");
    lines.push(
      `WARNING: configured chains not in this build's USDC registry: ${report.unknownChainIds.join(", ")}`,
    );
    lines.push("Do not send USDC on those chains until support is added.");
  }
  lines.push("");
  lines.push("WARNING: send USDC ONLY. Sending other tokens may be permanently lost.");
  lines.push("");
  deps.io.stdout(lines.join("\n"));
  return 0;
}

interface QrTerminal {
  generate(
    input: string,
    opts: { small?: boolean },
    cb: (out: string) => void,
  ): void;
}

async function cmdConfig(
  positional: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const sub = positional[0];
  switch (sub) {
    case undefined:
    case "wizard":
      return await configWizard({ config: deps.onboarding.config });
    case "show": {
      const config = await deps.onboarding.config.load();
      deps.io.stdout(
        JSON.stringify(
          { configPath: deps.configPath, ...summarize(config) },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }
    case "edit":
      return await configEdit({
        config: deps.onboarding.config,
        io: deps.io,
        runEditor: deps.runEditor ?? realEditorRunner,
      });
    default:
      deps.io.stderr(
        `Unknown config subcommand: ${sub}. ` +
          `Use one of: show, wizard, edit.\n`,
      );
      return 64;
  }
}
