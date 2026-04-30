import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import type { ConfigStore } from "../config/store.ts";
import { parseConfig } from "../config/parse.ts";
import type { CliIo } from "../cli/io.ts";

export type EditorRunner = (filePath: string) => Promise<void>;

export interface ConfigEditDeps {
  config: ConfigStore;
  io: CliIo;
  runEditor: EditorRunner;
  tmpFile?: () => string;
}

export async function configEdit(deps: ConfigEditDeps): Promise<number> {
  const current = await deps.config.load();
  const tmpPath =
    deps.tmpFile?.() ??
    path.join(os.tmpdir(), `x402-wallet-config-${process.pid}-${Date.now()}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });

  try {
    await deps.runEditor(tmpPath);
    const text = await fs.readFile(tmpPath, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      deps.io.stderr(
        `Config not saved: invalid JSON (${err instanceof Error ? err.message : String(err)}).\n` +
          `Re-run \`bun run cli -- config edit\` to try again.\n`,
      );
      return 1;
    }
    let next;
    try {
      next = parseConfig(raw);
    } catch (err) {
      deps.io.stderr(
        `Config not saved: ${err instanceof Error ? err.message : String(err)}.\n` +
          `Re-run \`bun run cli -- config edit\` to try again.\n`,
      );
      return 1;
    }
    await deps.config.save(next);
    deps.io.stderr(
      `Saved config to ${deps.config.path()}.\n` +
        `Note: the MCP server reads this config at startup. Fully quit and\n` +
        `reopen Claude Code for limit / approver changes to take effect there.\n`,
    );
    return 0;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export const realEditorRunner: EditorRunner = async (filePath) => {
  const cmd = process.env.VISUAL || process.env.EDITOR || "vi";
  const parts = cmd.split(/\s+/).filter(Boolean);
  const proc = Bun.spawn([...parts, filePath], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Editor "${cmd}" exited with code ${code}`);
  }
};
