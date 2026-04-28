import * as path from "path";
import { ExecApprover } from "./exec.ts";
import type { SpawnLike } from "./exec.ts";

export const TOUCHID_EXIT_CODES = {
  CANCELLED: 10,
  BIOMETRY_UNAVAILABLE: 11,
} as const;

export const TOUCHID_CODE_REASONS: Readonly<Record<number, string>> = {
  [TOUCHID_EXIT_CODES.CANCELLED]: "User cancelled the Touch ID prompt",
  [TOUCHID_EXIT_CODES.BIOMETRY_UNAVAILABLE]:
    "Biometry unavailable on this machine (see stderr for details)",
};

export function defaultTouchIdBinary(homeDir: string = process.env.HOME ?? ""): string {
  return path.join(homeDir, ".x402-wallet", "bin", "touchid-approver");
}

export interface TouchIdApproverOptions {
  binary?: string;
  timeoutMs?: number;
}

export function createTouchIdApprover(
  opts: TouchIdApproverOptions = {},
  spawner?: SpawnLike,
): ExecApprover {
  return new ExecApprover(
    {
      binary: opts.binary ?? defaultTouchIdBinary(),
      passRequestOnStdin: true,
      codeToReason: TOUCHID_CODE_REASONS,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    },
    spawner,
  );
}
