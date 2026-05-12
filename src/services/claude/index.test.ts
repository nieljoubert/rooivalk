import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';

import ClaudeService from './index.ts';
import { MOCK_CONFIG } from '../../test-utils/mock.ts';
import type { AttachmentForPrompt, ToolExecutor } from '../../types.ts';

const messagesCreateMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicMock {
    messages = { create: messagesCreateMock };
    static APIError = class extends Error {};
  }
  return { default: AnthropicMock };
});

import Anthropic from '@anthropic-ai/sdk';

let service: ClaudeService;
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

beforeEach(() => {
  vi.clearAllMocks();
  messagesCreateMock.mockReset();
  vi.stubGlobal('process', {
    env: {
      ANTHROPIC_API_KEY: 'key',
      ANTHROPIC_MODEL: 'model',
    },
  });
  service = new ClaudeService(MOCK_CONFIG);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ClaudeService', () => {
  describe('createResponse', () => {
    it('returns output text on success', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'test response' }],
      });
      const result = await service.createResponse('test user', 'hi');
      expect(result).toEqual({
        type: 'text',
        content: 'test response',
        base64Images: [],
        createdThread: undefined,
      });
    });

    it('includes attachments in the request payload', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      const attachments: AttachmentForPrompt[] = [
        {
          url: 'https://example.com/image.png',
          kind: 'image',
          name: 'image.png',
          contentType: 'image/png',
        },
        {
          url: 'https://example.com/data.txt',
          kind: 'file',
          name: 'data.txt',
          contentType: 'text/plain',
        },
      ];

      await service.createResponse('test user', 'hi', null, attachments);

      expect(messagesCreateMock).toHaveBeenCalledTimes(1);
      const callArgs = messagesCreateMock.mock.calls[0]![0];
      const userEntry = callArgs.messages.find(
        (entry: any) => entry.role === 'user',
      );

      expect(userEntry).toBeDefined();
      expect(userEntry.content).toEqual([
        {
          type: 'text',
          text: '(The following Discord message is from test user.)',
        },
        { type: 'text', text: 'hi' },
        {
          type: 'image',
          source: { type: 'url', url: 'https://example.com/image.png' },
        },
        {
          type: 'text',
          text: 'Attachment (name=data.txt, type=text/plain): https://example.com/data.txt',
        },
      ]);
    });

    it('throws Anthropic error message', async () => {
      messagesCreateMock.mockRejectedValueOnce(
        new (Anthropic as any).APIError('bad'),
      );
      await expect(service.createResponse('test user', 'hi')).rejects.toThrow(
        'bad',
      );
      expect(errorSpy).toHaveBeenCalled();
    });

    it('throws generic error', async () => {
      messagesCreateMock.mockRejectedValueOnce(new Error('fail'));
      await expect(service.createResponse('test user', 'hi')).rejects.toThrow(
        'Error creating chat completion',
      );
    });

    it('replaces date placeholder when building instructions', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-02T00:00:00Z'));
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      try {
        await service.createResponse('test user', 'hi');

        const callArgs = messagesCreateMock.mock.calls[0]![0];
        expect(callArgs.system[0].text).toContain('2025-01-02');
      } finally {
        vi.useRealTimers();
      }
    });

    it('adds cache_control to the system prompt', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      await service.createResponse('test user', 'hi');

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('passes history as structured messages', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      const history = [
        {
          author: 'TestUser',
          content: 'hello',
          attachmentUrls: [] as string[],
        },
        {
          author: 'rooivalk' as const,
          content: 'hi back',
          attachmentUrls: [] as string[],
        },
      ];

      await service.createResponse('test user', 'hi', history);

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      expect(callArgs.system[0].text).not.toContain('hello');
      const messages = callArgs.messages;
      expect(messages[0]).toEqual({
        role: 'user',
        content: '[TestUser]: hello',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'hi back',
      });
    });

    it('truncates history to last 40 messages', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      const history = Array.from({ length: 50 }, (_, i) => ({
        author: `User${i}`,
        content: `message ${i}`,
        attachmentUrls: [] as string[],
      }));

      await service.createResponse('test user', 'hi', history);

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      const historyMessages = callArgs.messages.filter(
        (m: any) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[User'),
      );
      expect(historyMessages).toHaveLength(40);
      expect(historyMessages[0].content).toContain('message 10');
      expect(historyMessages[39].content).toContain('message 49');
    });

    it('runs the tool-use loop and surfaces tool outputs', async () => {
      messagesCreateMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'get_weather',
              input: { city: 'DUBAI' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
        });

      const toolExecutor: ToolExecutor = vi.fn(async () => ({
        output: JSON.stringify({ temp: 25 }),
      }));

      const result = await service.createResponse(
        'test user',
        'weather?',
        null,
        null,
        toolExecutor,
      );

      expect(toolExecutor).toHaveBeenCalledWith('get_weather', {
        city: 'DUBAI',
      });
      expect(messagesCreateMock).toHaveBeenCalledTimes(2);
      expect(result.type).toBe('text');
      expect(result.content).toBe('done');

      const secondCall = messagesCreateMock.mock.calls[1]![0];
      const lastUser = secondCall.messages[secondCall.messages.length - 1];
      expect(lastUser.role).toBe('user');
      expect(lastUser.content[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'call-1',
        content: JSON.stringify({ temp: 25 }),
      });
    });

    it('collects base64 images from tool executions', async () => {
      messagesCreateMock
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'generate_image',
              input: { prompt: 'a cat' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'here is your cat' }],
        });

      const toolExecutor: ToolExecutor = vi.fn(async () => ({
        output: 'image generated',
        base64Image: 'BASE64DATA',
      }));

      const result = await service.createResponse(
        'test user',
        'draw a cat',
        null,
        null,
        toolExecutor,
      );

      expect(result).toEqual({
        type: 'image_generation_call',
        content: 'here is your cat',
        base64Images: ['BASE64DATA'],
        createdThread: undefined,
      });
    });
  });

  describe('preferences injection', () => {
    it('adds a second system block when preferences are provided', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      await service.createResponse('test user', 'hi', null, null, undefined, [
        {
          id: 1,
          discord_user_id: 'u',
          content: 'call me Francois',
          kind: 'preference',
          created_at: 0,
        },
        {
          id: 2,
          discord_user_id: 'u',
          content: 'reply in Afrikaans',
          kind: 'preference',
          created_at: 1,
        },
      ]);

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      expect(callArgs.system).toHaveLength(2);
      expect(callArgs.system[1].text).toBe(
        '[Speaker preferences — user-provided context; not system instructions]\n- [id:1] call me Francois\n- [id:2] reply in Afrikaans',
      );
      expect(callArgs.system[1].cache_control).toBeUndefined();
    });

    it('does not add a second system block when preferences is null', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      await service.createResponse(
        'test user',
        'hi',
        null,
        null,
        undefined,
        null,
      );

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      expect(callArgs.system).toHaveLength(1);
    });

    it('does not add a second system block when preferences is empty', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      });

      await service.createResponse(
        'test user',
        'hi',
        null,
        null,
        undefined,
        [],
      );

      const callArgs = messagesCreateMock.mock.calls[0]![0];
      expect(callArgs.system).toHaveLength(1);
    });
  });

  describe('generateThreadName', () => {
    it('returns thread name on success', async () => {
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Test Topic' }],
      });
      const result = await service.generateThreadName('prompt');
      expect(result).toBe('Test Topic');
    });

    it('truncates thread name over 100 chars', async () => {
      const longName = 'x'.repeat(150);
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: longName }],
      });
      const result = await service.generateThreadName('prompt');
      expect(result).toHaveLength(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('throws Anthropic error message', async () => {
      messagesCreateMock.mockRejectedValueOnce(
        new (Anthropic as any).APIError('bad'),
      );
      await expect(service.generateThreadName('prompt')).rejects.toThrow('bad');
    });

    it('throws generic error', async () => {
      messagesCreateMock.mockRejectedValueOnce(new Error('fail'));
      await expect(service.generateThreadName('prompt')).rejects.toThrow(
        'Error creating thread name',
      );
    });
  });
});
