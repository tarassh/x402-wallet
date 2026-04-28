import { promises as fs } from "fs";
import * as path from "path";
import { ConfigError, CONFIG_VERSION, DEFAULT_CONFIG } from "./types.ts";
import type { WalletConfig } from "./types.ts";
import { parseConfig } from "./parse.ts";

export interface ConfigStore {
  load(): Promise<WalletConfig>;
  save(config: WalletConfig): Promise<void>;
  path(): string;
}

export class InMemoryConfigStore implements ConfigStore {
  private current: WalletConfig;
  private readonly location: string;

  constructor(initial: WalletConfig = DEFAULT_CONFIG, location = "<memory>") {
    this.current = initial;
    this.location = location;
  }

  async load(): Promise<WalletConfig> {
    return this.current;
  }

  async save(config: WalletConfig): Promise<void> {
    this.current = config;
  }

  path(): string {
    return this.location;
  }
}

export class FileConfigStore implements ConfigStore {
  constructor(readonly filePath: string) {
    if (!filePath) throw new ConfigError("FileConfigStore requires a file path");
  }

  path(): string {
    return this.filePath;
  }

  async load(): Promise<WalletConfig> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if (isNoEntError(err)) {
        return { ...DEFAULT_CONFIG };
      }
      throw new ConfigError(`Failed to read config at ${this.filePath}: ${messageOf(err)}`, err);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ConfigError(`Config at ${this.filePath} is not valid JSON: ${messageOf(err)}`, err);
    }
    return parseConfig(parsed);
  }

  async save(config: WalletConfig): Promise<void> {
    if (config.version !== CONFIG_VERSION) {
      throw new ConfigError(`Refusing to save config with version ${config.version}`);
    }
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = JSON.stringify(config, null, 2);
    await fs.writeFile(tmp, serialized, { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

export function defaultConfigPath(homeDir: string = process.env.HOME ?? ""): string {
  if (!homeDir) throw new ConfigError("Cannot resolve default config path: $HOME is not set");
  return path.join(homeDir, ".config", "x402-wallet", "config.json");
}

function isNoEntError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
