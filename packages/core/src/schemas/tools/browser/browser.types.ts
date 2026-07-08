import { z } from "zod";
import {
  BrowserOpenPageSchema,
  BrowserNavigateSchema,
  BrowserClickSchema,
  BrowserFillSchema,
  BrowserWaitSchema,
  BrowserScreenshotSchema,
  BrowserCloseSchema,
  BrowserArtifactsListSchema,
  BrowserArtifactsGetSchema,
  browserActionSchema,
} from "./browser.schemas";

export type BrowserOpenPageInput = z.infer<typeof BrowserOpenPageSchema>;
export type BrowserNavigateInput = z.infer<typeof BrowserNavigateSchema>;
export type BrowserClickInput = z.infer<typeof BrowserClickSchema>;
export type BrowserFillInput = z.infer<typeof BrowserFillSchema>;
export type BrowserWaitInput = z.infer<typeof BrowserWaitSchema>;
export type BrowserScreenshotInput = z.infer<typeof BrowserScreenshotSchema>;
export type BrowserCloseInput = z.infer<typeof BrowserCloseSchema>;
export type BrowserArtifactsListInput = z.infer<
  typeof BrowserArtifactsListSchema
>;
export type BrowserArtifactsGetInput = z.infer<
  typeof BrowserArtifactsGetSchema
>;
export type BrowserActionBody = z.infer<typeof browserActionSchema>;

// Backward-compatible aliases retained for API/controller type imports.
export type BrowserArtifactListBody = BrowserArtifactsListInput;
export type BrowserArtifactGetBody = BrowserArtifactsGetInput;
export type BrowserRuntimeActionBody = BrowserActionBody;
export type BrowserClosePageBody = BrowserActionBody;
