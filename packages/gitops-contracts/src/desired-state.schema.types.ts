// packages/gitops-contracts/src/desired-state.schema.types.ts

import { z } from "zod";
import { DesiredStateSchema } from "./desired-state.schema";

export type DesiredState = z.infer<typeof DesiredStateSchema>;
