import { z } from "zod";
import { ListDirInputSchema } from "./list-dir.schemas.js";

export type ListDirInput = z.infer<typeof ListDirInputSchema>;
