import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';

interface SplitServiceTarget {
  service: 'chat' | 'domain';
  baseUrlEnv: string;
}
interface SplitServiceInspection {
  service: string;
  configured: boolean;
  base_url: string | null;
  health_url: string | null;
  status: DoctorCheckStatus;
  healthy: boolean;
  http_status: number | null;
  error: string | null;
}

const SPLIT_SERVICE_TARGETS: SplitServiceTarget[] = [
  {
    service: 'chat',
    baseUrlEnv: 'CHAT_SERVICE_BASE_URL',
  },
  {
    service: 'domain',
    baseUrlEnv: 'DOMAIN_SERVICE_BASE_URL',
  },
];

const DEFAULT_TIMEOUT_MS = 3000;

@Injectable()
export class SplitServiceHealthCheckService implements DoctorCheck {
  readonly checkId = 'split_service_connectivity_check';

  async run(): Promise<DoctorCheckResult> {
    const inspections = await Promise.all(
      SPLIT_SERVICE_TARGETS.map((target) => this.inspectTarget(target)),
    );
    const configuredInspections = inspections.filter(
      (inspection) => inspection.configured,
    );

    if (configuredInspections.length === 0) {
      return {
        check_id: this.checkId,
        status: 'warn',
        evidence: {
          summary:
            'No split-service targets are configured. Set CHAT_SERVICE_BASE_URL to enable connectivity diagnostics.',
          details: {
            services: inspections,
          },
        },
      };
    }

    const status = this.resolveStatus(configuredInspections);

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary: this.buildSummary(configuredInspections, status),
        details: {
          configured_target_count: configuredInspections.length,
          timeout_ms: this.resolveTimeoutMs(),
          services: inspections,
        },
      },
    };
  }

  private resolveStatus(
    inspections: SplitServiceInspection[],
  ): DoctorCheckStatus {
    if (inspections.some((inspection) => inspection.status === 'fail')) {
      return 'fail';
    }

    if (inspections.some((inspection) => inspection.status === 'warn')) {
      return 'warn';
    }

    return 'ok';
  }

  private buildSummary(
    inspections: SplitServiceInspection[],
    status: DoctorCheckStatus,
  ): string {
    if (status === 'ok') {
      return `Split-service health checks passed for ${inspections.length.toString()} configured target(s).`;
    }

    const failCount = inspections.filter(
      (inspection) => inspection.status === 'fail',
    ).length;
    const warnCount = inspections.filter(
      (inspection) => inspection.status === 'warn',
    ).length;

    if (status === 'fail') {
      return `Split-service health failed for ${failCount.toString()} target(s) with ${warnCount.toString()} connectivity warning(s).`;
    }

    return `Split-service health produced ${warnCount.toString()} connectivity warning(s).`;
  }

  private async inspectTarget(
    target: SplitServiceTarget,
  ): Promise<SplitServiceInspection> {
    const baseUrl = this.readOptionalEnv(target.baseUrlEnv);
    if (!baseUrl) {
      return {
        service: target.service,
        configured: false,
        base_url: null,
        health_url: null,
        status: 'warn',
        healthy: false,
        http_status: null,
        error: `${target.baseUrlEnv} is not configured`,
      };
    }

    const healthUrl = this.resolveHealthUrl(baseUrl);
    const timeoutMs = this.resolveTimeoutMs();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.getFetch()(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      const payload = await this.safeReadJson(response);
      const healthStatus = this.readHealthStatus(payload);

      if (!response.ok) {
        return {
          service: target.service,
          configured: true,
          base_url: baseUrl,
          health_url: healthUrl,
          status: 'fail',
          healthy: false,
          http_status: response.status,
          error: `Health response failed with status ${response.status.toString()}`,
        };
      }

      if (healthStatus !== null && healthStatus !== 'ok') {
        return {
          service: target.service,
          configured: true,
          base_url: baseUrl,
          health_url: healthUrl,
          status: 'fail',
          healthy: false,
          http_status: response.status,
          error: `Health response status is ${healthStatus}`,
        };
      }

      return {
        service: target.service,
        configured: true,
        base_url: baseUrl,
        health_url: healthUrl,
        status: 'ok',
        healthy: true,
        http_status: response.status,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        service: target.service,
        configured: true,
        base_url: baseUrl,
        health_url: healthUrl,
        status: 'warn',
        healthy: false,
        http_status: null,
        error: message,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  protected getFetch(): typeof fetch {
    return fetch;
  }

  private readHealthStatus(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as Record<string, unknown>).status;
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private async safeReadJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private resolveHealthUrl(baseUrl: string): string {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL(normalizedBase);
    const pathWithoutTrailingSlash = url.pathname.endsWith('/')
      ? url.pathname.slice(0, -1)
      : url.pathname;
    const healthPath = pathWithoutTrailingSlash.endsWith('/api')
      ? `${pathWithoutTrailingSlash}/health`
      : `${pathWithoutTrailingSlash}/api/health`;

    url.pathname = healthPath;
    url.search = '';
    url.hash = '';

    return url.toString();
  }

  private resolveTimeoutMs(): number {
    const configured = this.readOptionalEnv('DOCTOR_SPLIT_SERVICE_TIMEOUT_MS');
    if (!configured) {
      return DEFAULT_TIMEOUT_MS;
    }

    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_TIMEOUT_MS;
    }

    return Math.floor(parsed);
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
