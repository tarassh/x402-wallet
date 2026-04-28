import { EventEmitter } from "events";
import type { SpawnLike, SpawnResult } from "../../src/approvers/exec.ts";

export interface FakeInvocation {
  command: string;
  args: readonly string[];
  stdin: string;
}

export interface FakeSpawnBehavior {
  exitCode?: number | null;
  delayMs?: number;
  error?: Error;
  stdoutBytes?: string;
  stderrBytes?: string;
}

export class FakeSpawn {
  invocations: FakeInvocation[] = [];
  private responses: FakeSpawnBehavior[] = [];

  queue(behavior: FakeSpawnBehavior): this {
    this.responses.push(behavior);
    return this;
  }

  readonly spawner: SpawnLike = (command, args, _options) => {
    const behavior = this.responses.shift() ?? { exitCode: 0 };
    const emitter = new EventEmitter() as unknown as SpawnResult & EventEmitter;
    let stdinBuf = "";

    const stdin = {
      write: (chunk: string | Buffer) => {
        stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        return true;
      },
      end: (chunk?: string | Buffer) => {
        if (chunk) stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.invocations.push({ command, args, stdin: stdinBuf });
      },
    } as unknown as NodeJS.WritableStream;

    (emitter as unknown as { stdin: unknown }).stdin = stdin;
    (emitter as unknown as { stdout: unknown }).stdout = null;
    (emitter as unknown as { stderr: unknown }).stderr = null;
    (emitter as unknown as { kill: (sig?: string) => void }).kill = () => {
      emitter.emit("close", 143);
    };

    queueMicrotask(() => {
      const fire = () => {
        if (behavior.error) emitter.emit("error", behavior.error);
        else emitter.emit("close", behavior.exitCode ?? 0);
      };
      if (behavior.delayMs && behavior.delayMs > 0) setTimeout(fire, behavior.delayMs);
      else fire();
    });

    return emitter as unknown as SpawnResult;
  };
}
