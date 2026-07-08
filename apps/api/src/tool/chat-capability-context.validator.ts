import type {
  CapabilityManifestEntry,
  CapabilityPolicyTag,
} from '../capability-infra/capability-manifest.types';

/**
 * Validator for chat session capability context.
 * Handles project ID normalization and project-scoped tool classification.
 */
export class ChatCapabilityContextValidator {
  private static readonly PROJECT_SCOPED_TOOLS: string[] = [];

  /**
   * Normalize a project ID from chat context.
   * Returns null if the value is missing or not a valid UUID.
   */
  normalizeScopeId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (
      !trimmed ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        trimmed,
      )
    ) {
      return null;
    }

    return trimmed;
  }

  /**
   * Check if a tool requires project context.
   * Tools with mutatingAction or project-specific context tags require project context.
   */
  isToolProjectScoped(
    manifestEntry: CapabilityManifestEntry | undefined,
  ): boolean {
    if (!manifestEntry) {
      return false;
    }

    // Tools with mutatingAction are orchestration-scoped and require project context
    if (manifestEntry.mutatingAction) {
      return true;
    }

    // Tools tagged as context or diagnostic that access project-specific data
    const projectScopedTags: CapabilityPolicyTag[] = ['context', 'diagnostic'];
    const hasProjectTag = projectScopedTags.some((tag) =>
      manifestEntry.policyTags?.includes(tag),
    );

    if (hasProjectTag) {
      return ChatCapabilityContextValidator.PROJECT_SCOPED_TOOLS.includes(
        manifestEntry.name,
      );
    }

    return false;
  }
}
