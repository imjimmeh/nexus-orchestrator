import { z } from "zod";

export const GenericDomainEventBodySchema = z
  .object({
    event_type: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    event_name: z.string().min(1).optional(),
    eventName: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    eventId: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()
  .refine(
    (body) =>
      Boolean(
        body.event_type ?? body.eventType ?? body.event_name ?? body.eventName,
      ),
    {
      message: "event type is required",
      path: ["event_type"],
    },
  );

export type GenericDomainEventBody = z.infer<
  typeof GenericDomainEventBodySchema
>;
