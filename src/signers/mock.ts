import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Signer } from "./types.ts";

export interface MockSignerOptions {
  label: string;
  chains: readonly number[];
  privateKey?: Hex;
}

export class MockSigner implements Signer {
  readonly address: Address;
  readonly chains: readonly number[];
  readonly label: string;
  readonly privateKey: Hex;
  signCallCount = 0;

  private readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(opts: MockSignerOptions) {
    this.privateKey = opts.privateKey ?? generatePrivateKey();
    this.account = privateKeyToAccount(this.privateKey);
    this.address = this.account.address;
    this.chains = [...opts.chains];
    this.label = opts.label;
  }

  async signTypedData(payload: TypedDataDefinition): Promise<Hex> {
    this.signCallCount++;
    return this.account.signTypedData(payload);
  }
}
