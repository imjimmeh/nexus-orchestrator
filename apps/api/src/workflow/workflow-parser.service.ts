import { BadRequestException, Injectable } from '@nestjs/common';
import * as yaml from 'js-yaml';
import {
  IWorkflowDefinition,
  IJob,
  IJobStep,
  IWorkflowStep,
  IConcurrencyPolicy,
  IWorkflowTrigger,
  IWorkflowLaunchMetadata,
  IWorkflowLaunchInput,
  isRecord,
} from '@nexus/core';

@Injectable()
export class WorkflowParserService {
  private static readonly VALID_TRIGGER_TYPES = [
    'event',
    'webhook',
    'manual',
    'lifecycle',
  ];
  private static readonly VALID_LAUNCH_CONTEXTS = [
    'none',
    'scope',
    'context',
    'resource',
  ];
  private static readonly VALID_LAUNCH_INPUT_TYPES = [
    'string',
    'number',
    'boolean',
    'json',
    'string_array',
  ];

  parseWorkflow(yamlString: string): IWorkflowDefinition {
    try {
      const doc = this.parseAndValidateDocument(yamlString);
      this.normalizeJobsShape(doc);
      this.validateSkillsShape(doc);
      return doc;
    } catch (e) {
      const err = e as Error;
      throw new BadRequestException(`Invalid workflow YAML: ${err.message}`);
    }
  }

  private parseAndValidateDocument(yamlString: string): IWorkflowDefinition {
    const doc = yaml.load(yamlString) as IWorkflowDefinition;
    if (!doc || typeof doc !== 'object') {
      throw new Error('YAML must evaluate to an object');
    }

    if (!doc.workflow_id) {
      throw new Error('Missing workflow_id');
    }

    if (!doc.name) {
      throw new Error('Missing name');
    }

    if (doc.concurrency !== undefined) {
      this.validateConcurrencyPolicy(doc.concurrency);
    }

    if (doc.trigger !== undefined) {
      this.validateTrigger(doc.trigger);
    }

    if (doc.skill_discovery_mode !== undefined) {
      this.validateSkillDiscoveryMode(doc.skill_discovery_mode, 'workflow');
    }

    for (const job of doc.jobs ?? []) {
      for (const step of job.steps ?? []) {
        if (step.skill_discovery_mode !== undefined) {
          this.validateSkillDiscoveryMode(
            step.skill_discovery_mode,
            `step ${step.id}`,
          );
        }
      }
    }

    return doc;
  }

  private validateTrigger(
    trigger: unknown,
  ): asserts trigger is IWorkflowTrigger {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
      throw new Error('trigger must be an object');
    }

    const record = trigger as Record<string, unknown>;
    this.assertAllowedStringValue(
      record.type,
      'trigger.type',
      WorkflowParserService.VALID_TRIGGER_TYPES,
    );

    this.assertOptionalStringValue(record.name, 'trigger.name');
    this.assertOptionalStringValue(record.event, 'trigger.event');
    this.assertOptionalStringValue(record.description, 'trigger.description');

    if (record.launch !== undefined) {
      this.validateLaunchMetadata(record.launch);
    }

    if (record.type === 'lifecycle') {
      this.validateLifecycleTriggerFields(record);
    }
  }

  private validateLifecycleTriggerFields(
    record: Record<string, unknown>,
  ): void {
    const phase = record.phase;
    if (typeof phase !== 'string' || phase.trim().length === 0) {
      throw new Error(
        'trigger.phase must be a non-empty string for lifecycle triggers',
      );
    }

    const hook = record.hook;
    if (typeof hook !== 'string' || hook.trim().length === 0) {
      throw new Error(
        'trigger.hook must be a non-empty string for lifecycle triggers',
      );
    }

    if (record.blocking !== undefined && typeof record.blocking !== 'boolean') {
      throw new Error(
        'trigger.blocking must be a boolean for lifecycle triggers',
      );
    }
  }

  private validateLaunchMetadata(
    metadata: unknown,
  ): asserts metadata is IWorkflowLaunchMetadata {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('trigger.launch must be an object');
    }

    const launch = metadata as Record<string, unknown>;
    this.assertOptionalAllowedStringValue(
      launch.context,
      'trigger.launch.context',
      WorkflowParserService.VALID_LAUNCH_CONTEXTS,
    );

    if (
      launch.allow_raw_json !== undefined &&
      typeof launch.allow_raw_json !== 'boolean'
    ) {
      throw new Error('trigger.launch.allow_raw_json must be a boolean');
    }

    if (launch.inputs !== undefined) {
      this.validateLaunchInputs(launch.inputs);
    }
  }

  private validateLaunchInputs(
    inputs: unknown,
  ): asserts inputs is IWorkflowLaunchInput[] {
    if (!Array.isArray(inputs)) {
      throw new Error('trigger.launch.inputs must be an array');
    }

    const seenKeys = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      this.validateLaunchInputEntry(input, index, seenKeys);
    }
  }

  private validateLaunchInputEntry(
    input: unknown,
    index: number,
    seenKeys: Set<string>,
  ): asserts input is IWorkflowLaunchInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(`trigger.launch.inputs[${index}] must be an object`);
    }

    const inputRecord = input as Record<string, unknown>;
    const key = this.extractLaunchInputKey(inputRecord, index);

    if (seenKeys.has(key)) {
      throw new Error(`trigger.launch.inputs contains duplicate key '${key}'`);
    }
    seenKeys.add(key);

    this.assertOptionalStringValue(
      inputRecord.label,
      `trigger.launch.inputs[${index}].label`,
    );
    this.assertOptionalStringValue(
      inputRecord.description,
      `trigger.launch.inputs[${index}].description`,
    );
    this.assertOptionalBooleanValue(
      inputRecord.required,
      `trigger.launch.inputs[${index}].required`,
    );
    this.assertOptionalAllowedStringValue(
      inputRecord.type,
      `trigger.launch.inputs[${index}].type`,
      WorkflowParserService.VALID_LAUNCH_INPUT_TYPES,
    );
  }

  private extractLaunchInputKey(
    inputRecord: Record<string, unknown>,
    index: number,
  ): string {
    const key = inputRecord.key;
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error(
        `trigger.launch.inputs[${index}].key must be a non-empty string`,
      );
    }

    return key;
  }

  private assertOptionalStringValue(value: unknown, fieldPath: string): void {
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`${fieldPath} must be a string`);
    }
  }

  private assertOptionalBooleanValue(value: unknown, fieldPath: string): void {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error(`${fieldPath} must be a boolean`);
    }
  }

  private assertAllowedStringValue(
    value: unknown,
    fieldPath: string,
    allowedValues: readonly string[],
  ): void {
    if (typeof value !== 'string' || !allowedValues.includes(value)) {
      throw new Error(
        `${fieldPath} must be one of: ${allowedValues.join(', ')}`,
      );
    }
  }

  private assertOptionalAllowedStringValue(
    value: unknown,
    fieldPath: string,
    allowedValues: readonly string[],
  ): void {
    if (value === undefined) {
      return;
    }

    this.assertAllowedStringValue(value, fieldPath, allowedValues);
  }

  private validateConcurrencyPolicy(
    policy: unknown,
  ): asserts policy is IConcurrencyPolicy {
    if (!policy || typeof policy !== 'object') {
      throw new Error('concurrency must be an object');
    }

    const p = policy as Record<string, unknown>;

    if (
      typeof p.max_runs !== 'number' ||
      p.max_runs < 1 ||
      !Number.isInteger(p.max_runs)
    ) {
      throw new Error('concurrency.max_runs must be a positive integer');
    }

    if (p.scope !== undefined && typeof p.scope !== 'string') {
      throw new Error('concurrency.scope must be a string');
    }

    const validConflictPolicies = ['skip', 'queue', 'cancel_running'];
    if (
      p.on_conflict !== undefined &&
      !validConflictPolicies.includes(p.on_conflict as string)
    ) {
      throw new Error(
        `concurrency.on_conflict must be one of: ${validConflictPolicies.join(', ')}`,
      );
    }
  }

  private validateSkillDiscoveryMode(mode: unknown, where: string): void {
    const validModes = ['native', 'search'];
    if (typeof mode !== 'string' || !validModes.includes(mode)) {
      throw new Error(
        `skill_discovery_mode (${where}) must be one of: ${validModes.join(', ')}`,
      );
    }
  }

  /**
   * Structural shape check for the YAML `skills:` surface (Epic B Task 5):
   * a workflow-level `skills` block and each job's `inputs.skills` block, if
   * present, must be an array of non-empty strings. Runs after
   * `normalizeJobsShape` so `steps:`-format workflows (which fold into
   * `jobs[].inputs`) are checked the same way as `jobs:`-format ones.
   * Existence of the referenced skill names is a runtime/DB-backed concern
   * handled as a validation *warning* by `WorkflowValidationService`, not
   * here — unknown names may simply not be authored yet.
   */
  private validateSkillsShape(doc: IWorkflowDefinition): void {
    if (doc.skills !== undefined) {
      this.assertSkillNameArray(doc.skills, 'skills');
    }

    for (const job of doc.jobs ?? []) {
      const jobSkills = isRecord(job.inputs) ? job.inputs.skills : undefined;
      if (jobSkills !== undefined) {
        this.assertSkillNameArray(jobSkills, `job '${job.id}' inputs.skills`);
      }
    }
  }

  private assertSkillNameArray(
    value: unknown,
    fieldPath: string,
  ): asserts value is string[] {
    const isValid =
      Array.isArray(value) &&
      value.every(
        (entry) => typeof entry === 'string' && entry.trim().length > 0,
      );
    if (!isValid) {
      throw new Error(`${fieldPath} must be an array of non-empty strings`);
    }
  }

  private normalizeJobsShape(doc: IWorkflowDefinition): void {
    if (doc.jobs && doc.steps) {
      throw new Error(
        'Cannot define both jobs and steps at the workflow level',
      );
    }

    if (doc.jobs) {
      this.ensureJobsArray(doc.jobs);
      return;
    }

    if (doc.steps) {
      this.ensureStepsArray(doc.steps);
      doc.jobs = this.normalizeStepsToJobs(doc.steps);
      delete (doc as { steps?: IWorkflowStep[] }).steps;
      return;
    }

    throw new Error('Workflow must contain either jobs or steps');
  }

  private ensureJobsArray(jobs: unknown): void {
    if (!Array.isArray(jobs)) {
      throw new Error('jobs must be an array');
    }
  }

  private ensureStepsArray(steps: unknown): asserts steps is IWorkflowStep[] {
    if (!Array.isArray(steps)) {
      throw new Error('steps must be an array');
    }
  }

  private normalizeStepsToJobs(steps: IWorkflowStep[]): IJob[] {
    return steps.map(
      (step): IJob => ({
        id: step.id,
        type: step.type,
        tier: step.tier,
        depends_on: step.depends_on,
        inputs: step.inputs,
        workflow_id: step.workflow_id,
        wait_for_completion: step.wait_for_completion,
        continue_on_concurrency_skip: step.continue_on_concurrency_skip,
        permissions: step.permissions,
        tools: step.tools,
        transitions: step.transitions,
        max_retries: step.max_retries,
        retry_prompt: step.retry_prompt,
        output_contract: step.output_contract,
        switch: step.switch,
        default: step.default,
        for_each: step.for_each,
        continue_on_error: step.continue_on_error,
        steps: this.createJobStepsFromStepInputs(step.inputs),
      }),
    );
  }

  private createJobStepsFromStepInputs(
    inputs: Record<string, unknown> | undefined,
  ): IJobStep[] {
    const systemPrompt =
      inputs && typeof inputs.system_prompt === 'string'
        ? inputs.system_prompt
        : '';
    return [{ id: 'default', prompt: systemPrompt }];
  }

  extractTemplateVariables(yamlString: string): string[] {
    const variables = new Set<string>();
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(yamlString)) !== null) {
      if (match[1]) {
        variables.add(match[1].trim());
      }
    }
    return Array.from(variables);
  }
}
