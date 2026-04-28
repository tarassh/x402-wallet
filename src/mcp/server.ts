#!/usr/bin/env bun
import * as path from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./build.ts";
import { buildRuntimeFromConfig } from "./runtime.ts";
import { FileConfigStore, defaultConfigPath } from "../config/store.ts";
import { KeyringSecretStore } from "../signers/secret-store.ts";

async function main(): Promise<void> {
  const configPath = process.env.X402_WALLET_CONFIG ?? defaultConfigPath();
  const configStore = new FileConfigStore(configPath);
  const config = await configStore.load();

  const dbPath =
    config.dbPath ??
    process.env.X402_WALLET_DB ??
    path.join(process.env.HOME ?? "", ".x402-wallet", "payments.db");

  const { runtime, signers } = buildRuntimeFromConfig({
    config,
    secretStore: new KeyringSecretStore(),
    auditDbPath: dbPath,
  });

  if (signers.length === 0) {
    process.stderr.write(
      `x402-wallet: no signers configured at ${configPath}.\n` +
        `Run \`bunx x402-wallet init --label keychain:main\` to create one,\n` +
        `or \`bunx x402-wallet import-key --label <name>\` to import an existing key.\n`,
    );
  }

  const server = buildMcpServer(runtime);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("x402-wallet server failed to start:", err);
  process.exit(1);
});
