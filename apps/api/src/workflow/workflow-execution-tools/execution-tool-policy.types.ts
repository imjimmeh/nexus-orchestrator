export interface CompanionToolRule {
  /** The primary tool; when it is granted, the companion is automatically added. */
  primaryTool: string;
  /** The tool that is implicitly granted alongside the primary. */
  companionTool: string;
}
