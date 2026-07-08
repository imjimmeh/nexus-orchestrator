import type { EventEmitter2 } from '@nestjs/event-emitter';
import { broadcastUserQuestionsPosed } from '../telemetry-event-broadcaster.helpers';
import type { QuestionIdleTrackerService } from '../../workflow/workflow-run-operations/question-idle-tracker.service';
import type { AuthenticatedSocket } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

const USER_QUESTIONS_POSED_EVENT = 'workflow.user_questions.posed';

/**
 * Per-event compat handler for `user_questions_posed` frames. Emits the
 * broadcast, registers the question in the idle tracker so the run doesn't
 * look stalled while waiting on the user, and re-emits the same payload on
 * the NestJS event bus for downstream listeners (e.g. notifications).
 */
export async function handleUserQuestionsPosedGatewayCompat(params: {
  client: AuthenticatedSocket;
  payload: { questions: Array<Record<string, unknown>> };
  processAndBroadcastEvent: BroadcastEvent;
  questionIdleTracker?: Pick<QuestionIdleTrackerService, 'trackQuestionsPosed'>;
  eventEmitter?: Pick<EventEmitter2, 'emit'>;
}): Promise<void> {
  const {
    client,
    payload,
    processAndBroadcastEvent,
    questionIdleTracker,
    eventEmitter,
  } = params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }

  await broadcastUserQuestionsPosed({
    client,
    payload,
    processAndBroadcastEvent,
  });

  if (questionIdleTracker && client.containerId) {
    await questionIdleTracker.trackQuestionsPosed(
      (client.isSubagent && client.subagentExecutionId) || client.workflowRunId,
      client.containerId,
    );
  }

  eventEmitter?.emit(USER_QUESTIONS_POSED_EVENT, {
    workflowRunId: client.workflowRunId,
    stepId: client.stepId,
    questions: payload.questions,
  });
}
