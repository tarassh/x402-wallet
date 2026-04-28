export interface ParsedArgs {
  command: string;
  positional: string[];
  options: Record<string, string | true>;
}

export function parseArgv(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", positional: [], options: {} };
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const options: Record<string, string | true> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const eqIdx = key.indexOf("=");
      if (eqIdx >= 0) {
        options[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          options[key] = next;
          i++;
        } else {
          options[key] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { command: command!, positional, options };
}

export function requireOption(opts: Record<string, string | true>, name: string): string {
  const v = opts[name];
  if (v === undefined) throw new Error(`missing required option --${name}`);
  if (v === true) throw new Error(`option --${name} requires a value`);
  return v;
}

export function optionalOption(opts: Record<string, string | true>, name: string): string | undefined {
  const v = opts[name];
  if (v === undefined) return undefined;
  if (v === true) throw new Error(`option --${name} requires a value`);
  return v;
}

export function parseChains(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (!/^[0-9]+$/.test(s)) throw new Error(`invalid chain id: ${s}`);
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid chain id: ${s}`);
      return n;
    });
}
