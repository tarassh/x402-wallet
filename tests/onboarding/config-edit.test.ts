import { afterEach, describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { configEdit } from "../../src/onboarding/config-edit.ts";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { DEFAULT_CONFIG } from "../../src/config/types.ts";
import { FakeIo } from "../cli/fake-io.ts";

const tmpFiles: string[] = [];
afterEach(async () => {
  while (tmpFiles.length) {
    await fs.unlink(tmpFiles.pop()!).catch(() => undefined);
  }
});

function uniqueTmp(): string {
  const p = path.join(
    os.tmpdir(),
    `x402-wallet-edit-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
  tmpFiles.push(p);
  return p;
}

describe("configEdit", () => {
  test("writes the current config to the temp file before invoking the editor", async () => {
    const store = new InMemoryConfigStore();
    const io = new FakeIo();
    const tmp = uniqueTmp();

    let observed = "";
    const code = await configEdit({
      config: store,
      io,
      tmpFile: () => tmp,
      runEditor: async (filePath) => {
        observed = await fs.readFile(filePath, "utf8");
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(observed)).toEqual(DEFAULT_CONFIG);
  });

  test("persists valid edits via configStore.save", async () => {
    const store = new InMemoryConfigStore();
    const io = new FakeIo();
    const tmp = uniqueTmp();

    const code = await configEdit({
      config: store,
      io,
      tmpFile: () => tmp,
      runEditor: async (filePath) => {
        const next = {
          ...DEFAULT_CONFIG,
          policy: { maxAmountPerRequest: "200000", perDayCap: "1000000" },
        };
        await fs.writeFile(filePath, JSON.stringify(next, null, 2));
      },
    });

    expect(code).toBe(0);
    const saved = await store.load();
    expect(saved.policy.maxAmountPerRequest).toBe("200000");
    expect(saved.policy.perDayCap).toBe("1000000");
  });

  test("rejects invalid JSON without saving", async () => {
    const store = new InMemoryConfigStore();
    const io = new FakeIo();
    const tmp = uniqueTmp();

    const code = await configEdit({
      config: store,
      io,
      tmpFile: () => tmp,
      runEditor: async (filePath) => {
        await fs.writeFile(filePath, "{ this is not json }");
      },
    });

    expect(code).toBe(1);
    expect(io.stderrBuf).toContain("invalid JSON");
    expect(await store.load()).toEqual(DEFAULT_CONFIG);
  });

  test("rejects schema-invalid config without saving", async () => {
    const store = new InMemoryConfigStore();
    const io = new FakeIo();
    const tmp = uniqueTmp();

    const code = await configEdit({
      config: store,
      io,
      tmpFile: () => tmp,
      runEditor: async (filePath) => {
        await fs.writeFile(
          filePath,
          JSON.stringify({ version: 1, signers: [], policy: {} }),
        );
      },
    });

    expect(code).toBe(1);
    expect(io.stderrBuf).toContain("Config not saved");
    expect(await store.load()).toEqual(DEFAULT_CONFIG);
  });

  test("cleans up the temp file even when the editor throws", async () => {
    const store = new InMemoryConfigStore();
    const io = new FakeIo();
    const tmp = uniqueTmp();

    await expect(
      configEdit({
        config: store,
        io,
        tmpFile: () => tmp,
        runEditor: async () => {
          throw new Error("editor exploded");
        },
      }),
    ).rejects.toThrow("editor exploded");

    expect(await fs.access(tmp).then(() => true, () => false)).toBe(false);
  });
});
