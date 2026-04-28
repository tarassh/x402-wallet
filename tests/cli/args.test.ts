import { describe, expect, it } from "bun:test";
import {
  optionalOption,
  parseArgv,
  parseChains,
  requireOption,
} from "../../src/cli/args.ts";

describe("parseArgv", () => {
  it("returns help when argv is empty", () => {
    expect(parseArgv([])).toEqual({ command: "help", positional: [], options: {} });
  });

  it("parses a command + positional args", () => {
    expect(parseArgv(["remove", "keychain:main"])).toEqual({
      command: "remove",
      positional: ["keychain:main"],
      options: {},
    });
  });

  it("parses --key value pairs", () => {
    expect(parseArgv(["init", "--label", "k1", "--chains", "8453,1"])).toEqual({
      command: "init",
      positional: [],
      options: { label: "k1", chains: "8453,1" },
    });
  });

  it("parses --key=value form", () => {
    expect(parseArgv(["init", "--label=k1"])).toEqual({
      command: "init",
      positional: [],
      options: { label: "k1" },
    });
  });

  it("treats a bare --flag as true when followed by another flag", () => {
    expect(parseArgv(["init", "--yes", "--label", "a"])).toEqual({
      command: "init",
      positional: [],
      options: { yes: true, label: "a" },
    });
  });

  it("treats the final bare flag as true", () => {
    expect(parseArgv(["init", "--yes"])).toEqual({
      command: "init",
      positional: [],
      options: { yes: true },
    });
  });
});

describe("requireOption / optionalOption", () => {
  it("requireOption returns the value", () => {
    expect(requireOption({ a: "1" }, "a")).toBe("1");
  });
  it("requireOption throws when missing", () => {
    expect(() => requireOption({}, "a")).toThrow(/--a/);
  });
  it("requireOption throws when option is a bare flag", () => {
    expect(() => requireOption({ a: true }, "a")).toThrow(/requires a value/);
  });
  it("optionalOption returns undefined when missing", () => {
    expect(optionalOption({}, "a")).toBeUndefined();
  });
  it("optionalOption throws when option is a bare flag", () => {
    expect(() => optionalOption({ a: true }, "a")).toThrow(/requires a value/);
  });
});

describe("parseChains", () => {
  it("parses a single chain", () => {
    expect(parseChains("8453")).toEqual([8453]);
  });
  it("parses multiple comma-separated chains", () => {
    expect(parseChains("8453,1,137")).toEqual([8453, 1, 137]);
  });
  it("tolerates whitespace", () => {
    expect(parseChains(" 8453 , 1 ")).toEqual([8453, 1]);
  });
  it("rejects non-integer entries", () => {
    expect(() => parseChains("8453,abc")).toThrow();
    expect(() => parseChains("-1")).toThrow();
    expect(() => parseChains("1.5")).toThrow();
  });
});
