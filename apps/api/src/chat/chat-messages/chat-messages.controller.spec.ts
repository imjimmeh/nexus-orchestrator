import { describe, expect, it, vi } from 'vitest';
import { ChatMessagesController } from './chat-messages.controller';

describe('ChatMessagesController', () => {
  it('delegates sendChatMessage payload to service', async () => {
    const service = {
      sendChatMessage: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const controller = new ChatMessagesController(service as never);

    const result = await controller.sendChatMessage('chat-1', {
      message: 'hello',
    });

    expect(service.sendChatMessage).toHaveBeenCalledWith('chat-1', 'hello', {
      attachmentIds: undefined,
    });
    expect(result).toEqual({ success: true, data: { acknowledged: true } });
  });

  it('delegates submitQuestionAnswers payload to service', async () => {
    const service = {
      submitQuestionAnswers: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const controller = new ChatMessagesController(service as never);

    const result = await controller.submitQuestionAnswers('chat-1', {
      answers: [
        {
          questionIndex: 0,
          selectedOption: 'yes',
          freeTextAnswer: null,
        },
      ],
    });

    expect(service.submitQuestionAnswers).toHaveBeenCalledWith('chat-1', [
      {
        questionIndex: 0,
        selectedOption: 'yes',
        freeTextAnswer: null,
      },
    ]);
    expect(result).toEqual({ success: true, data: { acknowledged: true } });
  });
});
