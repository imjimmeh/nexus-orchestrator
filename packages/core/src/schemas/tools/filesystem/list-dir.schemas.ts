import { z } from "zod";

const BooleanishSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return value;
}, z.boolean());

export const ListDirInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Directory path to list, absolute or relative to cwd"),
  all: z
    .union([z.boolean(), BooleanishSchema])
    .optional()
    .default(false)
    .describe("Include hidden files (starting with '.')"),
  long: z
    .union([z.boolean(), BooleanishSchema])
    .optional()
    .default(false)
    .describe(
      "Show detailed listing with permissions, size, and modification time",
    ),
  missing_ok: z
    .union([z.boolean(), BooleanishSchema])
    .optional()
    .default(false)
    .describe(
      "Return an empty successful listing when the path does not exist",
    ),
});
