import { z } from "zod";

export const EffectiveMemberSourceSchema = z.enum(["direct", "inherited"]);

export const EffectiveMemberSchema = z.object({
  userId: z.uuid(),
  userEmail: z.string(),
  roleId: z.uuid(),
  roleName: z.string(),
  source: EffectiveMemberSourceSchema,
  sourceScopeNodeId: z.uuid(),
  sourceScopeName: z.string(),
});

export type EffectiveMemberSource = z.infer<typeof EffectiveMemberSourceSchema>;
export type EffectiveMember = z.infer<typeof EffectiveMemberSchema>;
