import { AskUserQuestionsSchema } from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class WorkflowUserInteractionCapabilityProvider {
  @Capability({
    name: 'ask_user_questions',
    tierRestriction: 1,
    transport: 'runner_local',
    runtimeOwner: 'runner',
    policyTags: ['context'],
    description:
      'Pose one or more questions to the human user and block until they respond. ' +
      'Each question may include up to 8 predefined answer options. ' +
      'The user can always provide a free-text answer regardless of options. ' +
      'This tool blocks until the user submits their answers.',
    inputSchema: AskUserQuestionsSchema,
  })
  askUserQuestions() {
    return { ok: true };
  }
}
