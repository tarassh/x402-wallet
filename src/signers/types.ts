import type { Address, Hex, TypedDataDefinition } from "viem";

export interface Signer {
  readonly address: Address;
  readonly chains: readonly number[];
  readonly label: string;

  signTypedData(payload: TypedDataDefinition): Promise<Hex>;
}

export interface SignerRegistry {
  list(): readonly Signer[];
  findByAddress(address: Address): Signer | undefined;
  findForChain(chainId: number): readonly Signer[];
}

export class InMemorySignerRegistry implements SignerRegistry {
  private readonly signers: Signer[];

  constructor(signers: readonly Signer[]) {
    this.signers = [...signers];
    const labels = new Set<string>();
    for (const s of this.signers) {
      if (labels.has(s.label)) {
        throw new Error(`Duplicate signer label: ${s.label}`);
      }
      labels.add(s.label);
    }
  }

  list(): readonly Signer[] {
    return this.signers;
  }

  findByAddress(address: Address): Signer | undefined {
    const needle = address.toLowerCase();
    return this.signers.find((s) => s.address.toLowerCase() === needle);
  }

  findForChain(chainId: number): readonly Signer[] {
    return this.signers.filter((s) => s.chains.includes(chainId));
  }
}
