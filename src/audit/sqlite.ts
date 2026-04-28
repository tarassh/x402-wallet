import { Database } from "bun:sqlite";
import type { AuditLog, PaymentRecord } from "../orchestrator/types.ts";
import type { SpendHistory } from "../policy/types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  origin TEXT NOT NULL,
  url TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  amount TEXT NOT NULL,
  signer_label TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_origin_ts ON payments(origin, timestamp);
CREATE INDEX IF NOT EXISTS idx_payments_timestamp ON payments(timestamp);
`;

export class SqliteAuditLog implements AuditLog, SpendHistory {
  private readonly db: Database;

  constructor(path: string | ":memory:" = ":memory:") {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async record(entry: PaymentRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO payments (timestamp, origin, url, asset, network, chain_id, amount, signer_label, tx_hash, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.timestamp,
        entry.origin,
        entry.url,
        entry.asset,
        entry.network,
        entry.chainId,
        entry.amount.toString(),
        entry.signerLabel,
        entry.txHash ?? null,
        entry.status,
        entry.errorMessage ?? null,
      );
  }

  list(limit = 100): PaymentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM payments ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToRecord);
  }

  totalSince(sinceEpochSec: number): bigint {
    const row = this.db
      .prepare(`SELECT amount FROM payments WHERE timestamp >= ? AND status = 'succeeded'`)
      .all(sinceEpochSec) as Array<{ amount: string }>;
    return row.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  }

  totalForOriginSince(origin: string, sinceEpochSec: number): bigint {
    const row = this.db
      .prepare(
        `SELECT amount FROM payments WHERE origin = ? AND timestamp >= ? AND status = 'succeeded'`,
      )
      .all(origin, sinceEpochSec) as Array<{ amount: string }>;
    return row.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  }
}

function rowToRecord(row: Record<string, unknown>): PaymentRecord {
  return {
    timestamp: row.timestamp as number,
    origin: row.origin as string,
    url: row.url as string,
    asset: row.asset as string,
    network: row.network as string,
    chainId: row.chain_id as number,
    amount: BigInt(row.amount as string),
    signerLabel: row.signer_label as string,
    status: row.status as PaymentRecord["status"],
    ...(row.tx_hash ? { txHash: row.tx_hash as string } : {}),
    ...(row.error_message ? { errorMessage: row.error_message as string } : {}),
  };
}
