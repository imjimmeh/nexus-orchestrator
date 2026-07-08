import { z } from "zod";

export const GITOPS_API_VERSION = "nexus.gitops/v1" as const;

/** Lowercase, hyphen-friendly slug segment (matches scope_nodes.slug convention). */
export const SlugSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug must be lowercase alphanumeric with single hyphens",
  );

/**
 * A scope node address by slug path. "/" is the platform root; otherwise a
 * leading-slash chain of slugs (e.g. "/acme/emea/platform-team"). UUIDs never
 * appear in paths — the repo is human-addressed.
 */
export const ScopePathSchema = z
  .string()
  .refine((p) => p === "/" || /^(\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(p), {
    message: 'scope path must be "/" or a /slug/slug chain of lowercase slugs',
  });

export type { ScopePath } from "./common.schema.types";
