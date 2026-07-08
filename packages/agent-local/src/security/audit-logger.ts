import fs from "node:fs/promises";
import path from "node:path";
import { getLogsDirPath } from "../config/defaults.js";

type AuditLogEntry = {
  timestamp: string;
  operation: string;
  success: boolean;
  details: Record<string, unknown>;
};

export class AuditLogger {
  constructor(private readonly logToStdout: boolean) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const line = JSON.stringify(entry);
    if (this.logToStdout) {
      console.log(line);
    }

    const logsDir = getLogsDirPath();
    await fs.mkdir(logsDir, { recursive: true });

    const fileName = `audit-${entry.timestamp.slice(0, 10)}.log`;
    const filePath = path.resolve(logsDir, fileName);
    await fs.appendFile(filePath, line + "\n", "utf8");
  }

  async logSuccess(
    operation: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      operation,
      success: true,
      details,
    });
  }

  async logFailure(
    operation: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      operation,
      success: false,
      details,
    });
  }
}
