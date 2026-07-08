import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from '../users/database/repositories/user.repository';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly nodeEnv: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });

    this.nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  }

  private isAgentPayload(payload: { role?: string; roles: string[] }): boolean {
    return (
      payload.role === 'agent' &&
      Array.isArray(payload.roles) &&
      payload.roles.length > 0
    );
  }

  private normalizeRoles(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private canUseNonProductionFallback(payload: { roles: string[] }): boolean {
    const isNonProduction = this.nodeEnv !== 'production';
    const hasRoles = Array.isArray(payload.roles) && payload.roles.length > 0;
    return isNonProduction && hasRoles;
  }

  async validate(payload: {
    sub: string;
    email: string;
    roles: string[];
    role?: string;
    agentProfileName?: string;
    workflowRunId?: string;
    stepId?: string;
    jobId?: string;
    scopeId?: string;
    isSubagent?: boolean;
    subagentExecutionId?: string;
    parent_job_id?: string;
    allowedTools?: unknown;
  }) {
    // Agent tokens (from workflow containers) have role='agent' and a non-user sub.
    // Allow them through with their declared roles.
    if (this.isAgentPayload(payload)) {
      const roles = this.normalizeRoles(payload.roles);
      return {
        userId: payload.sub,
        email: payload.email,
        roles,
        agentProfileName:
          typeof payload.agentProfileName === 'string'
            ? payload.agentProfileName
            : undefined,
        workflowRunId:
          typeof payload.workflowRunId === 'string'
            ? payload.workflowRunId
            : undefined,
        stepId: typeof payload.stepId === 'string' ? payload.stepId : undefined,
        jobId: typeof payload.jobId === 'string' ? payload.jobId : undefined,
        scopeId:
          typeof payload.scopeId === 'string' ? payload.scopeId : undefined,
        isSubagent: payload.isSubagent === true,
        subagentExecutionId:
          typeof payload.subagentExecutionId === 'string'
            ? payload.subagentExecutionId
            : undefined,
        parentJobId:
          typeof payload.parent_job_id === 'string'
            ? payload.parent_job_id
            : undefined,
        allowedTools: Array.isArray(payload.allowedTools)
          ? payload.allowedTools
              .filter(
                (toolName): toolName is string => typeof toolName === 'string',
              )
              .map((toolName) => toolName.trim())
              .filter((toolName) => toolName.length > 0)
          : undefined,
      };
    }

    const isUuid = UUID_PATTERN.test(payload.sub);

    const user = isUuid
      ? await this.userRepository.findById(payload.sub)
      : await this.userRepository.findByUsername(payload.sub);

    if (!user) {
      if (this.canUseNonProductionFallback(payload)) {
        const roles = this.normalizeRoles(payload.roles);
        return {
          userId: payload.sub,
          email: payload.email,
          roles,
        };
      }

      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    return {
      userId: user.id,
      email: user.email,
      roles: this.normalizeRoles(payload.roles),
    };
  }
}
