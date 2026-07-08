import { Injectable } from '@nestjs/common';
import { BaseRequestContextService } from '@nexus/core';

export type { RequestContext } from './request-context.service.types';

@Injectable()
export class RequestContextService extends BaseRequestContextService {}
