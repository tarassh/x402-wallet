import type { CliIo } from "../../src/cli/io.ts";

export class FakeIo implements CliIo {
  stdoutBuf = "";
  stderrBuf = "";
  private stdinInput: string;

  constructor(stdin = "") {
    this.stdinInput = stdin;
  }

  stdout(msg: string): void {
    this.stdoutBuf += msg;
  }
  stderr(msg: string): void {
    this.stderrBuf += msg;
  }
  async readStdin(): Promise<string> {
    return this.stdinInput;
  }

  json(): unknown {
    const trimmed = this.stdoutBuf.trim();
    return trimmed.length ? JSON.parse(trimmed) : undefined;
  }
}
