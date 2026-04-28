#!/usr/bin/env bun
import { run } from "./run.ts";
import { realIo } from "./io.ts";
import { FileConfigStore, defaultConfigPath } from "../config/store.ts";
import { KeyringSecretStore } from "../signers/secret-store.ts";

async function main(): Promise<void> {
  const configPath = process.env.X402_WALLET_CONFIG ?? defaultConfigPath();
  const configStore = new FileConfigStore(configPath);
  const secretStore = new KeyringSecretStore();

  const exitCode = await run(process.argv.slice(2), {
    io: realIo,
    configPath,
    onboarding: { config: configStore, store: secretStore },
  });
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
