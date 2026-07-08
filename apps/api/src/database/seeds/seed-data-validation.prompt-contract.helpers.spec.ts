import { describe, expect, it } from 'vitest';
import { extractPromptContractMentions } from './seed-data-validation.prompt-contract.helpers';

describe('seed prompt contract helpers', () => {
  it('extracts tool names, output keys, and event names from prompt content', () => {
    const mentions = extractPromptContractMentions(
      [
        'Call `external.lookup` with the resource id.',
        'Set tool_name: "external.write" before invoking the tool.',
        'Use the external.audit tool for a final audit.',
        'Call set_job_output("decision", value) when complete.',
        'Also set_job_output for summary.',
        'Emit GenericCompletedEvent and generic.completed.v1 when finished.',
      ].join('\n'),
    );

    expect(mentions.toolNames).toEqual([
      'external.audit',
      'external.lookup',
      'external.write',
      'set_job_output',
    ]);
    expect(mentions.setJobOutputKeys).toEqual(['decision', 'summary']);
    expect(mentions.eventNames).toEqual([
      'generic.completed.v1',
      'GenericCompletedEvent',
    ]);
  });
});
