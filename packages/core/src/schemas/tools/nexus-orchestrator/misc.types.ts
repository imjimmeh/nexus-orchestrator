import { z } from "zod";
import { StepCompleteSchema } from "./misc.schemas";

export type StepCompleteInput = z.infer<typeof StepCompleteSchema>;
