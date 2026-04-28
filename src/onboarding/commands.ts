import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { DEFAULT_SERVICE } from "../signers/keychain.ts";
import type { SecretStore } from "../signers/secret-store.ts";
import type { ConfigStore } from "../config/store.ts";
import type { WalletConfig, WalletSignerEntry } from "../config/types.ts";

export interface OnboardingDeps {
  store: SecretStore;
  config: ConfigStore;
  clock?: () => number;
  random?: () => Hex;
  keychainService?: string;
}

export interface InitWalletInput {
  label: string;
  chains: readonly number[];
}

export interface ImportKeyInput {
  label: string;
  chains: readonly number[];
  privateKey: Hex;
}

export interface InitWalletResult {
  label: string;
  address: Address;
  chains: readonly number[];
}

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

const HEX_PK = /^0x[0-9a-fA-F]{64}$/;
const LABEL_MAX = 64;
const LABEL_REGEX = /^[A-Za-z0-9:_.-]+$/;

export function validateLabel(label: string): void {
  if (label.length === 0) throw new OnboardingError("label must be non-empty");
  if (label.length > LABEL_MAX) throw new OnboardingError(`label must be ≤ ${LABEL_MAX} chars`);
  if (!LABEL_REGEX.test(label)) {
    throw new OnboardingError(`label may only contain letters, digits, and :_.- (got "${label}")`);
  }
}

export function slugifyLabel(label: string): string {
  return label.replace(/[:_.]/g, "-");
}

export function validateChains(chains: readonly number[]): void {
  if (chains.length === 0) throw new OnboardingError("chains must contain at least one chainId");
  for (const c of chains) {
    if (!Number.isInteger(c) || c <= 0) {
      throw new OnboardingError(`invalid chainId: ${c}`);
    }
  }
}

export async function initWallet(
  deps: OnboardingDeps,
  input: InitWalletInput,
): Promise<InitWalletResult> {
  const privateKey = (deps.random ?? generatePrivateKey)();
  return importKey(deps, { ...input, privateKey });
}

export async function importKey(
  deps: OnboardingDeps,
  input: ImportKeyInput,
): Promise<InitWalletResult> {
  validateLabel(input.label);
  validateChains(input.chains);
  if (!HEX_PK.test(input.privateKey)) {
    throw new OnboardingError("privateKey must be a 0x-prefixed 32-byte hex string");
  }

  const config = await deps.config.load();
  if (config.signers.some((s) => s.label === input.label)) {
    throw new OnboardingError(`Signer label "${input.label}" already exists`);
  }

  const service = deps.keychainService ?? DEFAULT_SERVICE;
  const account = slugifyLabel(input.label);
  if (await deps.store.get(service, account)) {
    throw new OnboardingError(
      `Secret already exists for service="${service}" account="${account}". Remove it first with "remove".`,
    );
  }

  const address = privateKeyToAccount(input.privateKey).address;
  await deps.store.set(service, account, input.privateKey);

  const entry: WalletSignerEntry = {
    label: input.label,
    address,
    chains: [...input.chains],
    keychainService: service,
    keychainAccount: account,
    createdAt: (deps.clock ?? defaultClock)(),
  };
  const updated: WalletConfig = {
    ...config,
    signers: [...config.signers, entry],
  };
  await deps.config.save(updated);

  return { label: input.label, address, chains: entry.chains };
}

export interface SignerSummary {
  label: string;
  address: Address;
  chains: readonly number[];
  keychainService: string;
  keychainAccount: string;
  createdAt: number;
}

export async function listSigners(deps: OnboardingDeps): Promise<SignerSummary[]> {
  const config = await deps.config.load();
  return config.signers.map((s) => ({ ...s }));
}

export async function showAddress(deps: OnboardingDeps, label: string): Promise<Address> {
  const config = await deps.config.load();
  const entry = config.signers.find((s) => s.label === label);
  if (!entry) throw new OnboardingError(`No signer with label "${label}"`);
  return entry.address;
}

export async function removeSigner(deps: OnboardingDeps, label: string): Promise<void> {
  const config = await deps.config.load();
  const entry = config.signers.find((s) => s.label === label);
  if (!entry) throw new OnboardingError(`No signer with label "${label}"`);
  await deps.store.delete(entry.keychainService, entry.keychainAccount);
  await deps.config.save({ ...config, signers: config.signers.filter((s) => s !== entry) });
}

function defaultClock(): number {
  return Math.floor(Date.now() / 1000);
}
