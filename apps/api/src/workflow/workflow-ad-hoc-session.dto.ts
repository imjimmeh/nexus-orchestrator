import {
  createAdHocSessionSchema,
  type CreateAdHocSessionRequest,
} from '@nexus/core';

export class CreateAdHocSessionDto {
  static readonly schema = createAdHocSessionSchema;

  agentProfileName!: CreateAdHocSessionRequest['agentProfileName'];

  scopeId?: CreateAdHocSessionRequest['scopeId'];

  initialMessage!: CreateAdHocSessionRequest['initialMessage'];
}
