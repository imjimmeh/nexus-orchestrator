import { ChatContextProviderAdapter } from './chat-context-provider.adapter';
import type { IChatContextProvider } from './chat-context.provider.interface';
import type { ChatPromptAssemblyContext } from './chat-context.types';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';

const session = { id: 'sess-1' } as ChatSession;
const chatCtx: ChatPromptAssemblyContext = {
  runType: 'chat',
  chatSessionId: 'sess-1',
  baseLayers: [],
  session,
};

function makeProvider(
  over: Partial<IChatContextProvider> = {},
): IChatContextProvider {
  return {
    name: 'p',
    priority: 200,
    canProvide: () => Promise.resolve(true),
    getContext: () =>
      Promise.resolve({ title: 'P', content: 'body', priority: 200 }),
    ...over,
  };
}

describe('ChatContextProviderAdapter', () => {
  it('mirrors name and priority from the wrapped provider', () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    expect(adapter.name).toBe('p');
    expect(adapter.priority).toBe(200);
  });

  it('returns null for non-chat contexts', async () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    const block = await adapter.contribute({
      runType: 'workflow',
      baseLayers: [],
    });
    expect(block).toBeNull();
  });

  it('returns null when canProvide is false', async () => {
    const adapter = new ChatContextProviderAdapter(
      makeProvider({ canProvide: () => Promise.resolve(false) }),
    );
    expect(await adapter.contribute(chatCtx)).toBeNull();
  });

  it('delegates getContext for an applicable chat session', async () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    const block = await adapter.contribute(chatCtx);
    expect(block).toEqual({ title: 'P', content: 'body', priority: 200 });
  });
});
