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

import OpenAIService from './index.ts';
import { MOCK_CONFIG } from '../../test-utils/mock.ts';
import type { AttachmentForPrompt } from '../../types.ts';

const responsesCreateMock = vi.fn();
const imagesGenerateMock = vi.fn();

vi.mock('openai', () => {
  class OpenAIMock {
    responses = { create: responsesCreateMock };
    images = { generate: imagesGenerateMock };
    static OpenAIError = class extends Error {};
  }
  return { default: OpenAIMock };
});

import OpenAI from 'openai';

let service: OpenAIService;
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
  responsesCreateMock.mockReset();
  imagesGenerateMock.mockReset();
  vi.stubGlobal('process', {
    env: {
      OPENAI_API_KEY: 'key',
      OPENAI_MODEL: 'model',
      OPENAI_IMAGE_MODEL: 'image',
    },
  });
  service = new OpenAIService(MOCK_CONFIG);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OpenAIService', () => {
  describe('createResponse', () => {
    it('returns output text on success', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'test response',
        output: [],
      });
      const result = await service.createResponse('test user', 'hi');
      expect(result).toEqual({
        type: 'text',
        content: 'test response',
        base64Images: [],
      });
    });

    it('strips web_search citation markers from output', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text:
          'Dungeons 3 runs on Windows, Mac, and Linux. 【cite_turn0search0】 Genres: Simulation. 【cite_turn0search1】',
        output: [],
      });
      const result = await service.createResponse('test user', 'hi');
      expect(result.content).toBe(
        'Dungeons 3 runs on Windows, Mac, and Linux. Genres: Simulation.',
      );
    });

    it('includes attachments in the request payload', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'test response',
        output: [],
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

      expect(responsesCreateMock).toHaveBeenCalledTimes(1);
      const callArgs = responsesCreateMock.mock.calls[0]![0];
      const userEntry = callArgs.input.find(
        (entry: any) => entry.role === 'user',
      );

      expect(userEntry).toBeDefined();
      expect(userEntry.content).toEqual([
        { type: 'input_text', text: 'hi' },
        {
          type: 'input_image',
          image_url: 'https://example.com/image.png',
          detail: 'auto',
        },
        {
          type: 'input_text',
          text: 'Attachment (name=data.txt, type=text/plain): https://example.com/data.txt',
        },
      ]);
    });

    it('throws OpenAI error message', async () => {
      responsesCreateMock.mockRejectedValueOnce(
        new (OpenAI as any).OpenAIError('bad'),
      );
      await expect(service.createResponse('test user', 'hi')).rejects.toThrow(
        'bad',
      );
      expect(errorSpy).toHaveBeenCalled();
    });

    it('throws generic error', async () => {
      responsesCreateMock.mockRejectedValueOnce(new Error('fail'));
      await expect(service.createResponse('test user', 'hi')).rejects.toThrow(
        'Error creating chat completion',
      );
    });

    it('replaces date placeholder when building instructions', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-02T00:00:00Z'));
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
      });

      try {
        await service.createResponse('test user', 'hi');

        const callArgs = responsesCreateMock.mock.calls[0]![0];
        expect(callArgs.instructions).toContain('2025-01-02');
      } finally {
        vi.useRealTimers();
      }
    });

    it('passes history as structured input messages', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
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

      const callArgs = responsesCreateMock.mock.calls[0]![0];
      // History should NOT be in instructions
      expect(callArgs.instructions).not.toContain('hello');
      // History should be in input as structured messages
      const input = callArgs.input;
      expect(input[0]).toEqual({
        role: 'user',
        content: '[TestUser]: hello',
      });
      expect(input[1]).toEqual({
        role: 'assistant',
        content: 'hi back',
      });
    });

    it('truncates history to last 40 messages', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
      });

      const history = Array.from({ length: 50 }, (_, i) => ({
        author: `User${i}`,
        content: `message ${i}`,
        attachmentUrls: [] as string[],
      }));

      await service.createResponse('test user', 'hi', history);

      const callArgs = responsesCreateMock.mock.calls[0]![0];
      // 40 history messages + 1 system message + 1 user message = 42
      const input = callArgs.input;
      const historyMessages = input.filter(
        (m: any) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[User'),
      );
      expect(historyMessages).toHaveLength(40);
      // Should keep the last 40, so message 10-49
      expect(historyMessages[0].content).toContain('message 10');
      expect(historyMessages[39].content).toContain('message 49');
    });
  });

  describe('preferences injection', () => {
    it('appends preferences block to instructions when provided', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
      });

      await service.createResponse('test user', 'hi', null, null, undefined, [
        {
          id: 1,
          discord_user_id: 'u',
          content: 'call me Francois',
          kind: 'preference',
          created_at: 0,
        },
      ]);

      const callArgs = responsesCreateMock.mock.calls[0]![0];
      expect(callArgs.instructions).toContain('[Speaker preferences');
      expect(callArgs.instructions).toContain('[id:1] call me Francois');
    });

    it('does not append preferences block when preferences is null', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
      });

      await service.createResponse(
        'test user',
        'hi',
        null,
        null,
        undefined,
        null,
      );

      const callArgs = responsesCreateMock.mock.calls[0]![0];
      expect(callArgs.instructions).not.toContain('[Speaker preferences]');
    });

    it('does not append preferences block when preferences is empty', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'ok',
        output: [],
      });

      await service.createResponse(
        'test user',
        'hi',
        null,
        null,
        undefined,
        [],
      );

      const callArgs = responsesCreateMock.mock.calls[0]![0];
      expect(callArgs.instructions).not.toContain('[Speaker preferences]');
    });
  });

  describe('createImage', () => {
    it('returns base64 image on success', async () => {
      imagesGenerateMock.mockResolvedValueOnce({ data: [{ b64_json: 'img' }] });
      await expect(service.createImage('cat')).resolves.toBe('img');
    });

    it('throws OpenAI error message', async () => {
      imagesGenerateMock.mockRejectedValueOnce(
        new (OpenAI as any).OpenAIError('img fail'),
      );
      await expect(service.createImage('cat')).rejects.toThrow('img fail');
    });

    it('throws generic error', async () => {
      imagesGenerateMock.mockRejectedValueOnce(new Error('fail'));
      await expect(service.createImage('cat')).rejects.toThrow(
        'Error creating image',
      );
    });
  });

  describe('generateThreadName', () => {
    it('returns thread name on success', async () => {
      responsesCreateMock.mockResolvedValueOnce({
        output_text: 'Test Topic',
        output: [],
      });
      const result = await service.generateThreadName('prompt');
      expect(result).toBe('Test Topic');
    });

    it('throws OpenAI error message', async () => {
      responsesCreateMock.mockRejectedValueOnce(
        new (OpenAI as any).OpenAIError('bad'),
      );
      await expect(service.generateThreadName('prompt')).rejects.toThrow('bad');
    });

    it('throws generic error', async () => {
      responsesCreateMock.mockRejectedValueOnce(new Error('fail'));
      await expect(service.generateThreadName('prompt')).rejects.toThrow(
        'Error creating thread name',
      );
    });
  });
});
