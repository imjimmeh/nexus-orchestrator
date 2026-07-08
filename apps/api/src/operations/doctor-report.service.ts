import { Injectable } from '@nestjs/common';
import { DoctorCheckRegistryService } from './doctor-check-registry.service';
import type {
  DoctorCheckResult,
  DoctorCheckStatus,
  DoctorReport,
  DoctorReportEnvelope,
} from './doctor.types';

@Injectable()
export class DoctorReportService {
  constructor(private readonly checkRegistry: DoctorCheckRegistryService) {}

  async generateReport(): Promise<DoctorReport> {
    const checks = await this.checkRegistry.runAll();
    const summary = this.summarize(checks);

    return {
      generated_at: new Date().toISOString(),
      overall_status: this.resolveOverallStatus(summary),
      summary: {
        ...summary,
        total: checks.length,
      },
      checks: this.sortChecks(checks),
    };
  }

  async generateReportEnvelope(): Promise<DoctorReportEnvelope> {
    const report = await this.generateReport();
    return {
      report,
      summary_markdown: this.toMarkdown(report),
    };
  }

  private sortChecks(checks: DoctorCheckResult[]): DoctorCheckResult[] {
    const order: Record<DoctorCheckStatus, number> = {
      fail: 0,
      warn: 1,
      ok: 2,
    };

    return [...checks].sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) {
        return byStatus;
      }

      return a.check_id.localeCompare(b.check_id);
    });
  }

  private summarize(checks: DoctorCheckResult[]): {
    ok: number;
    warn: number;
    fail: number;
  } {
    const counts = {
      ok: 0,
      warn: 0,
      fail: 0,
    };

    for (const check of checks) {
      counts[check.status] += 1;
    }

    return counts;
  }

  private resolveOverallStatus(summary: {
    ok: number;
    warn: number;
    fail: number;
  }): DoctorCheckStatus {
    if (summary.fail > 0) {
      return 'fail';
    }

    if (summary.warn > 0) {
      return 'warn';
    }

    return 'ok';
  }

  private toMarkdown(report: DoctorReport): string {
    const lines: string[] = [];
    lines.push('# Doctor Report');
    lines.push('');
    lines.push(`Generated: ${report.generated_at}`);
    lines.push(`Overall: ${report.overall_status.toUpperCase()}`);
    lines.push(
      `Summary: ${report.summary.fail.toString()} fail, ${report.summary.warn.toString()} warn, ${report.summary.ok.toString()} ok`,
    );
    lines.push('');

    for (const check of report.checks) {
      lines.push(
        `- [${check.status.toUpperCase()}] ${check.check_id}: ${check.evidence.summary}`,
      );
      if (check.repair_action_id) {
        lines.push(`  - repair_action_id: ${check.repair_action_id}`);
      }
    }

    return lines.join('\n');
  }
}
