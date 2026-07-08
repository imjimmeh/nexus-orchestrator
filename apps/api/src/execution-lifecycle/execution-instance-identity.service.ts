import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Injectable()
export class ExecutionInstanceIdentityService {
  readonly id = process.env.NEXUS_API_INSTANCE_ID ?? randomUUID();
}
