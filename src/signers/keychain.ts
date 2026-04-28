import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Signer } from "./types.ts";
import type { SecretStore } from "./secret-store.ts";

export const DEFAULT_SERVICE = "x402-agent-wallet";

export interface KeychainSignerOptions {
  label: string;
  chains: readonly number[];
  account: string;
  store: SecretStore;
  service?: string;
  address: Address;
}

export class KeychainSigner implements Signer {
  readonly address: Address;
  readonly chains: readonly number[];
  readonly label: string;
  readonly service: string;
  readonly account: string;
  private readonly store: SecretStore;

  constructor(opts: KeychainSignerOptions) {
    this.label = opts.label;
    this.chains = [...opts.chains];
    this.service = opts.service ?? DEFAULT_SERVICE;
    this.account = opts.account;
    this.store = opts.store;
    this.address = opts.address;
  }

  async signTypedData(payload: TypedDataDefinition): Promise<Hex> {
    const secret = await this.store.get(this.service, this.account);
    if (!secret) {
      throw new Error(
        `No private key found in secret store for service="${this.service}" account="${this.account}"`,
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) {
      throw new Error(
        `Secret for service="${this.service}" account="${this.account}" is not a 32-byte hex private key`,
      );
    }
    const viemAccount = privateKeyToAccount(secret as Hex);
    if (viemAccount.address.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(
        `Secret private key does not match registered address (${viemAccount.address} vs ${this.address})`,
      );
    }
    return viemAccount.signTypedData(payload);
  }
}

export interface RegisterKeychainSignerInput {
  store: SecretStore;
  service?: string;
  account: string;
  privateKey: Hex;
}

export async function registerKeychainSigner(
  input: RegisterKeychainSignerInput,
): Promise<Address> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.privateKey)) {
    throw new Error("privateKey must be 0x-prefixed 32-byte hex");
  }
  const service = input.service ?? DEFAULT_SERVICE;
  const viemAccount = privateKeyToAccount(input.privateKey);
  await input.store.set(service, input.account, input.privateKey);
  return viemAccount.address;
}
