import {
  BrowserOpenPageSchema,
  BrowserNavigateSchema,
  BrowserClickSchema,
  BrowserFillSchema,
  BrowserWaitSchema,
  browserActionSchema,
  BrowserScreenshotSchema,
  BrowserCloseSchema as browserCloseSchema,
  BrowserArtifactsListSchema as browserArtifactListSchema,
  BrowserArtifactsGetSchema as browserArtifactGetSchema,
  getTodoListBodySchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class WorkflowRuntimeBrowserCapabilityProvider {
  // --- Browser ---

  @Capability({
    name: 'browser_open_page',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Create or reset a browser session and optionally open the provided url.',
    inputSchema: BrowserOpenPageSchema,
  })
  browserOpenPage() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_navigate',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description: 'Navigate an existing browser session to a target url.',
    inputSchema: BrowserNavigateSchema,
  })
  browserNavigate() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_click',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Click a target element using selector fallback strategy and retry policy.',
    inputSchema: BrowserClickSchema,
  })
  browserClick() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_type',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Fill text into an element selected through explicit, alias, or heuristic selectors.',
    inputSchema: BrowserFillSchema,
  })
  browserType() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_wait_for',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Wait for load state, duration, or selector condition in an existing browser session.',
    inputSchema: BrowserWaitSchema,
  })
  browserWaitFor() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_read_page',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['read_only', 'context'],
    description: 'Return title and HTML content for the current page.',
    inputSchema: browserActionSchema,
  })
  browserReadPage() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_screenshot',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description: 'Capture a PNG screenshot for the current page context.',
    inputSchema: BrowserScreenshotSchema,
  })
  browserScreenshot() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_close_page',
    tierRestriction: 2,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Explicitly close browser session resources for the workflow run context.',
    inputSchema: browserCloseSchema,
  })
  browserClosePage() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_list_failure_artifacts',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'diagnostic', 'context'],
    description:
      'List persisted browser failure artifacts for the workflow run context.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/browser/failure-artifacts/list',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
        limit: 'limit',
        offset: 'offset',
      },
    },
    inputSchema: browserArtifactListSchema,
  })
  browserListFailureArtifacts() {
    return { ok: true };
  }

  @Capability({
    name: 'browser_get_failure_artifact',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'diagnostic', 'context'],
    description: 'Get detailed browser failure artifact diagnostics.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/browser/failure-artifacts/get',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
        artifact_id: 'artifact_id',
      },
    },
    inputSchema: browserArtifactGetSchema,
  })
  browserGetFailureArtifact() {
    return { ok: true };
  }

  @Capability({
    name: 'get_todo_list',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description: 'Get workflow run todo list state.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/get-todo-list',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
      },
    },
    inputSchema: getTodoListBodySchema,
  })
  getTodoList() {
    return { ok: true };
  }
}
