import { CONTAINER_AGENT_DIR } from '@nexus/core';

/**
 * Default container mount target for the assigned-skill bundle and the path the
 * skill catalog / runtime diagnostics report. The actual per-harness mount uses
 * `HarnessCapabilities.skillsContainerPath`; this is the fallback default and
 * MUST equal the directory the default (pi) harness natively scans
 * (`${agentDir}/skills`, agentDir = CONTAINER_AGENT_DIR) so the mount is
 * discoverable and diagnostics resolve the mount correctly.
 */
export const CONTAINER_SKILLS_ROOT = `${CONTAINER_AGENT_DIR}/skills`;
export const SKILL_CATALOG_FILE_NAME = 'skill-catalog.json';
