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

export interface CliDeps {
  onboarding: OnboardingDeps;
  io: CliIo;
  configPath: string;
}

const USAGE = `x402-wallet — agentic wallet for x402-gated APIs

USAGE
  x402-wallet <command> [options]

COMMANDS
  init           Generate a new private key and register it in the wallet.
  import-key     Import an existing private key (from stdin by default).
  list           List all registered signers.
  show-address   Print the address for a given signer label.
  remove         Delete a signer (from config and keychain).
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
      case "remove":
        return await cmdRemove(parsed.options, parsed.positional, deps);
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
