/**
 * How assigned skills are surfaced to an agent.
 * - `native`: list assigned skills directly in the system prompt; the agent
 *   sees only its assigned set (the `search_skills` tool is suppressed).
 * - `search`: skills are not listed; the agent uses the `search_skills` tool
 *   to discover any active skill (legacy behavior).
 */
export type SkillDiscoveryMode = "native" | "search";
