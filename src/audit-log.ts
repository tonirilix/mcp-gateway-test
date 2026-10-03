import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type CallOutcome = "success" | "tool_error" | "invalid_arguments" | "timeout" | "unavailable" | "denied" | "protocol_failure";

export type CallRecord = {
  correlationId: string;
  at: string;
  userId: string;
  integrationId: string;
  exposedTool: string;
  downstreamTool: string;
  durationMs: number;
  outcome: CallOutcome;
};

export class AuditLog {
  private readonly calls: CallRecord[] = [];
  private pendingWrite = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async open(file: string) {
    const log = new AuditLog(file);
    try {
      const content = await readFile(file, "utf8");
      for (const line of content.split("\n")) {
        if (line) log.calls.push(JSON.parse(line) as CallRecord);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return log;
  }

  async record(call: CallRecord) {
    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, `${JSON.stringify(call)}\n`, { mode: 0o600 });
      this.calls.push(call);
    });
    await this.pendingWrite;
  }

  list(userId: string) {
    return this.calls.filter((call) => userId === "admin" || call.userId === userId).slice(-100);
  }
}
