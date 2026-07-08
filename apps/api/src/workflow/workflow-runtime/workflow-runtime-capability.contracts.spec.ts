import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { recordLearningBodySchema } from '@nexus/core';
import {
  RECORD_LEARNING_RUNTIME_CAPABILITY,
  RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
  READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
  WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS,
} from './workflow-runtime-capability.contracts';
import { WorkflowRuntimeLifecycleController } from './workflow-runtime-lifecycle.controller';

/**
 * Collect every `@Post(...)` route path a controller registers, normalized to
 * the global-prefixed `/api/<controllerPrefix>/<methodPath>` form the agent
 * harness POSTs to. Used to prove that a declared `api_callback` capability is
 * actually reachable — a capability with a `pathTemplate` but no matching route
 * 404s on every call (the EPIC-212 `remember` regression).
 */
function postRoutePaths(
  controller: new (...args: never[]) => unknown,
): Set<string> {
  const prefix =
    (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ??
    '';
  const prototype = controller.prototype as Record<string, unknown>;
  const routes = new Set<string>();
  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;
    const handler = prototype[key];
    if (typeof handler !== 'function') continue;
    const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
      | string
      | undefined;
    const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
      | RequestMethod
      | undefined;
    if (methodPath === undefined || httpMethod !== RequestMethod.POST) continue;
    routes.add(`/api/${prefix}/${methodPath}`.replace(/\/{2,}/g, '/'));
  }
  return routes;
}

// Capabilities whose `api_callback` routes are served by the lifecycle
// controller. Each MUST have a matching POST route or every agent call 404s.
const LIFECYCLE_OWNED_CAPABILITIES = [
  'query_memory',
  'record_learning',
  'remember',
  'record_strategic_intent',
  'read_strategic_intent',
  'get_todo_list',
  'manage_todo_list',
] as const;

describe('workflow runtime capability contracts', () => {
  it('registers record_learning as an API-owned mutating context capability', () => {
    expect(
      WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS.some(
        (capability) => capability.name === 'record_learning',
      ),
    ).toBe(true);

    expect(RECORD_LEARNING_RUNTIME_CAPABILITY).toMatchObject({
      name: 'record_learning',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      description:
        'Submit governed learning input through the internal tool runtime.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/record-learning',
      },
    });
    expect(RECORD_LEARNING_RUNTIME_CAPABILITY.apiCallback?.bodyMapping).toEqual(
      {
        scope_type: 'scope_type',
        scope_id: 'scope_id',
        lesson: 'lesson',
        evidence: 'evidence',
        confidence: 'confidence',
        tags: 'tags',
      },
    );
    expect(RECORD_LEARNING_RUNTIME_CAPABILITY.inputSchema).toBe(
      recordLearningBodySchema,
    );
  });

  it('registers record_strategic_intent as an API-owned mutating context capability', () => {
    expect(
      WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS.some(
        (capability) => capability.name === 'record_strategic_intent',
      ),
    ).toBe(true);

    expect(RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY).toMatchObject({
      name: 'record_strategic_intent',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/record-strategic-intent',
      },
    });
    expect(
      RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY.apiCallback?.bodyMapping,
    ).toEqual({
      entity_type: 'entity_type',
      entity_id: 'entity_id',
      intent: 'intent',
    });
  });

  it('registers read_strategic_intent as an API-owned read-only context capability', () => {
    expect(
      WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS.some(
        (capability) => capability.name === 'read_strategic_intent',
      ),
    ).toBe(true);

    expect(READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY).toMatchObject({
      name: 'read_strategic_intent',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/read-strategic-intent',
      },
    });
    expect(
      READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY.apiCallback?.bodyMapping,
    ).toEqual({
      entity_type: 'entity_type',
      entity_id: 'entity_id',
    });
  });

  it('registers remember as an API-owned mutating context capability', () => {
    const remember = WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS.find(
      (capability) => capability.name === 'remember',
    );
    expect(remember).toBeDefined();
    expect(remember).toMatchObject({
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/remember',
      },
    });
  });

  it('serves every lifecycle-owned api_callback capability with a matching POST route', () => {
    const routes = postRoutePaths(WorkflowRuntimeLifecycleController);
    for (const name of LIFECYCLE_OWNED_CAPABILITIES) {
      const capability = WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS.find(
        (candidate) => candidate.name === name,
      );
      expect(
        capability,
        `capability '${name}' is not registered`,
      ).toBeDefined();
      const pathTemplate = capability?.apiCallback?.pathTemplate;
      expect(
        pathTemplate,
        `capability '${name}' is not an api_callback with a pathTemplate`,
      ).toBeDefined();
      expect(
        routes.has(pathTemplate as string),
        `capability '${name}' declares ${pathTemplate} but no matching POST route exists — every agent call would 404`,
      ).toBe(true);
    }
  });
});
