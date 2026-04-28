export interface CliIo {
  stdout(msg: string): void;
  stderr(msg: string): void;
  readStdin(): Promise<string>;
}

export const realIo: CliIo = {
  stdout: (m) => process.stdout.write(m),
  stderr: (m) => process.stderr.write(m),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
};
