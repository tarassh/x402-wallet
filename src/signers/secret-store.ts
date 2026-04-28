export interface SecretStore {
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

export class InMemorySecretStore implements SecretStore {
  private readonly store = new Map<string, string>();

  private key(service: string, account: string): string {
    return `${service}\x1f${account}`;
  }

  async get(service: string, account: string): Promise<string | undefined> {
    return this.store.get(this.key(service, account));
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    this.store.set(this.key(service, account), secret);
  }

  async delete(service: string, account: string): Promise<void> {
    this.store.delete(this.key(service, account));
  }
}

export class KeyringSecretStore implements SecretStore {
  // Lazy-loaded because the native module is platform-specific and we
  // don't want to require it at import time (so unit tests on stores that
  // don't use Keychain never touch native code).
  private entryCtor?: new (service: string, account: string) => KeyringEntry;

  private async entry(service: string, account: string): Promise<KeyringEntry> {
    if (!this.entryCtor) {
      const mod = (await import("@napi-rs/keyring")) as { Entry: new (s: string, a: string) => KeyringEntry };
      this.entryCtor = mod.Entry;
    }
    return new this.entryCtor(service, account);
  }

  async get(service: string, account: string): Promise<string | undefined> {
    const e = await this.entry(service, account);
    try {
      return e.getPassword() ?? undefined;
    } catch (err) {
      if (isNotFoundError(err)) return undefined;
      throw err;
    }
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    const e = await this.entry(service, account);
    e.setPassword(secret);
  }

  async delete(service: string, account: string): Promise<void> {
    const e = await this.entry(service, account);
    try {
      e.deletePassword();
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(secret: string): void;
  deletePassword(): boolean;
}

function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /not\s*found|no such|no entry/i.test(msg);
}
