import type { WorkflowRunExecutionStatusV1 } from '@nexus/core';
import { extractAssistantResponseFromRunDetails } from './telegram-outbound-relay.extractor';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';

const MISSING_COMPLETED_RESPONSE_TEXT =
  'I completed your request, but I could not find a text response to return.';

interface BuildTelegramTerminalOutboundTextParams {
  status: WorkflowRunExecutionStatusV1;
  runDetails?: Record<string, unknown> | null;
  settings: TelegramChannelRuntimeSettings;
}

function sanitizeTelegramTerminalResponse(response: string): string {
  const withoutThinkingTags = response.replaceAll(
    /<thinking>[\s\S]*?<\/thinking>/giu,
    '',
  );
  const withoutReasoningBlocks = withoutThinkingTags.replaceAll(
    /```(?:thinking|reasoning|analysis|scratchpad)[\s\S]*?```/giu,
    '',
  );

  return withoutReasoningBlocks.replaceAll(/\n{3,}/gu, '\n\n').trim();
}

export function buildTelegramTerminalOutboundText(
  params: BuildTelegramTerminalOutboundTextParams,
): string | null {
  if (params.status === 'COMPLETED') {
    const runDetails = params.runDetails ?? {};
    const extractedResponse =
      extractAssistantResponseFromRunDetails(runDetails);
    if (!extractedResponse) {
      return MISSING_COMPLETED_RESPONSE_TEXT;
    }

    if (!params.settings.uxHideThinking) {
      return extractedResponse;
    }

    const sanitized = sanitizeTelegramTerminalResponse(extractedResponse);
    if (sanitized.length > 0) {
      return sanitized;
    }

    return extractedResponse.trim() || MISSING_COMPLETED_RESPONSE_TEXT;
  }

  if (params.status === 'FAILED') {
    return 'Sorry, I could not complete that request. Please try again.';
  }

  if (params.status === 'CANCELLED') {
    return 'That request was cancelled before completion.';
  }

  return null;
}
