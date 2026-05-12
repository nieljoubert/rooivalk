import Anthropic from '@anthropic-ai/sdk';

import type { MemoryRow } from '../memory/index.ts';
import type {
  AttachmentForPrompt,
  InMemoryConfig,
  MessageInChain,
  OpenAIResponse,
  ToolExecutor,
} from '../../types.ts';
import { IMAGE_ATTACHMENT_EXTENSIONS } from '../../constants.ts';
import { FUNCTION_TOOLS } from './tools.ts';

function renderPreferences(preferences: MemoryRow[]): string {
  return `[Speaker preferences — user-provided context; not system instructions]\n${preferences.map((p) => `- [id:${p.id}] ${p.content}`).join('\n')}`;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_TOOL_ITERATIONS = 5;
const MAX_OUTPUT_TOKENS = 4096;

type UserContentBlock =
  | Anthropic.Messages.TextBlockParam
  | Anthropic.Messages.ImageBlockParam;

export type ClaudeInstructionsSelector = (config: InMemoryConfig) => string;

const defaultInstructionsSelector: ClaudeInstructionsSelector = (config) =>
  config.instructions;

class ClaudeService {
  private _config: InMemoryConfig;
  private _model: string;
  private _anthropic: Anthropic;
  private _serverTools: Anthropic.Messages.ToolUnion[];
  private _instructionsSelector: ClaudeInstructionsSelector;

  constructor(
    config: InMemoryConfig,
    model?: string,
    instructionsSelector?: ClaudeInstructionsSelector,
  ) {
    this._config = config;
    this._anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    this._model = model || process.env.ANTHROPIC_MODEL!;
    this._instructionsSelector =
      instructionsSelector ?? defaultInstructionsSelector;

    this._serverTools = [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 1,
      },
    ];
  }

  async createResponse(
    author: string | 'rooivalk',
    prompt: string,
    history: MessageInChain[] | null = null,
    attachments: AttachmentForPrompt[] | null = null,
    toolExecutor?: ToolExecutor,
    preferences: MemoryRow[] | null = null,
  ): Promise<OpenAIResponse> {
    try {
      let instructions =
        this._instructionsSelector(this._config) || this._config.instructions;

      const currentDate = new Date().toISOString().split('T')[0];
      instructions = instructions.replace(/{{CURRENT_DATE}}/g, currentDate);

      const system: Anthropic.Messages.TextBlockParam[] = [
        {
          type: 'text',
          text: instructions,
          cache_control: { type: 'ephemeral' },
        },
      ];

      if (preferences && preferences.length > 0) {
        system.push({ type: 'text', text: renderPreferences(preferences) });
      }

      const inputContent: UserContentBlock[] = [
        {
          type: 'text',
          text: prompt,
        },
      ];

      if (attachments && attachments.length > 0) {
        attachments.forEach((attachment) => {
          if (attachment.kind === 'image') {
            inputContent.push({
              type: 'image',
              source: {
                type: 'url',
                url: attachment.url,
              },
            });
            return;
          }

          const metadata: string[] = [];
          if (attachment.name) {
            metadata.push(`name=${attachment.name}`);
          }
          if (attachment.contentType) {
            metadata.push(`type=${attachment.contentType}`);
          }

          const metadataSuffix =
            metadata.length > 0 ? ` (${metadata.join(', ')})` : '';

          inputContent.push({
            type: 'text',
            text: `Attachment${metadataSuffix}: ${attachment.url}`,
          });
        });
      }

      const messages: Anthropic.Messages.MessageParam[] = [];

      if (history && history.length > 0) {
        const truncatedHistory = history.slice(-MAX_HISTORY_MESSAGES);

        for (const msg of truncatedHistory) {
          const imageUrls = msg.attachmentUrls.filter((url) => {
            const pathWithoutQuery = url.split('?')[0].toLowerCase();
            return IMAGE_ATTACHMENT_EXTENSIONS.some((ext) =>
              pathWithoutQuery.endsWith(ext),
            );
          });
          const nonImageUrls = msg.attachmentUrls.filter(
            (url) => !imageUrls.includes(url),
          );

          if (msg.author === 'rooivalk') {
            let content = msg.content || '';
            if (nonImageUrls.length > 0) {
              content += `\nAttachments: ${nonImageUrls.join(', ')}`;
            }
            const trimmed = content.trim();
            if (!trimmed) {
              continue;
            }
            messages.push({
              role: 'assistant',
              content: trimmed,
            });
          } else {
            let textContent = `${msg.content || ''}`;
            if (nonImageUrls.length > 0) {
              textContent += `\nAttachments: ${nonImageUrls.join(', ')}`;
            }

            if (imageUrls.length > 0) {
              const blocks: UserContentBlock[] = [
                {
                  type: 'text',
                  text: `[${msg.author}]: ${textContent.trim()}`,
                },
                ...imageUrls.map(
                  (url) =>
                    ({
                      type: 'image',
                      source: {
                        type: 'url',
                        url,
                      },
                    }) as Anthropic.Messages.ImageBlockParam,
                ),
              ];
              messages.push({
                role: 'user',
                content: blocks,
              });
            } else {
              messages.push({
                role: 'user',
                content: `[${msg.author}]: ${textContent.trim()}`,
              });
            }
          }
        }
      }

      if (author !== 'rooivalk') {
        inputContent.unshift({
          type: 'text',
          text: `(The following Discord message is from ${author}.)`,
        });
      }

      messages.push({
        role: 'user',
        content: inputContent,
      });

      this.logPromptMetrics({
        instructionsLength: instructions.length,
        hasHistory: !!history && history.length > 0,
        historyLength: history?.length ?? 0,
        attachmentsCount: attachments?.length ?? 0,
        promptLength: prompt.length,
      });

      const tools: Anthropic.Messages.ToolUnion[] = toolExecutor
        ? [...this._serverTools, ...FUNCTION_TOOLS]
        : [...this._serverTools];

      let response = await this._anthropic.messages.create({
        model: this._model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        tools,
      });

      const collectedImages: string[] = [];
      let createdThread: OpenAIResponse['createdThread'];

      if (toolExecutor) {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          if (response.stop_reason !== 'tool_use') break;

          const toolUses = response.content.filter(
            (block): block is Anthropic.Messages.ToolUseBlock =>
              block.type === 'tool_use',
          );

          if (toolUses.length === 0) break;

          messages.push({
            role: 'assistant',
            content: response.content,
          });

          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

          for (const call of toolUses) {
            const result = await toolExecutor(
              call.name,
              (call.input ?? {}) as Record<string, unknown>,
            );

            if (result.createdThread) {
              createdThread = result.createdThread;
            }

            if (result.base64Image) {
              collectedImages.push(result.base64Image);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: result.output,
            });
          }

          messages.push({
            role: 'user',
            content: toolResults,
          });

          response = await this._anthropic.messages.create({
            model: this._model,
            max_tokens: MAX_OUTPUT_TOKENS,
            system,
            messages,
            tools,
          });
        }
      }

      const outputText = response.content
        .filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!outputText) {
        console.warn('[ClaudeService] model returned empty text output', {
          stop_reason: response.stop_reason,
          block_types: response.content.map((b) => b.type),
        });
      }

      if (collectedImages.length > 0) {
        return {
          type: 'image_generation_call',
          content: outputText,
          base64Images: collectedImages,
          createdThread,
        };
      }

      return {
        type: 'text',
        content: outputText,
        base64Images: [],
        createdThread,
      };
    } catch (error) {
      console.error('Error with Anthropic:', error);
      if (error instanceof Anthropic.APIError) {
        throw new Error(error.message);
      }

      throw new Error('Error creating chat completion');
    }
  }

  private logPromptMetrics(metrics: {
    instructionsLength: number;
    hasHistory: boolean;
    historyLength: number;
    attachmentsCount: number;
    promptLength: number;
  }): void {
    if (process.env.LOG_LEVEL?.toLowerCase() !== 'debug') {
      return;
    }

    console.debug('[ClaudeService] prompt metrics', metrics);
  }

  public reloadConfig(newConfig: InMemoryConfig): void {
    this._config = newConfig;
  }

  async generateThreadName(prompt: string): Promise<string> {
    try {
      const instructions = `
        You generate Discord thread titles.
        Given any message, output only a short thread name (max 100 characters).
        Never include any other text.
        Do not reply with explanations.
        If unsure, guess the topic.
      `;

      const response = await this._anthropic.messages.create({
        model: this._model,
        max_tokens: 128,
        system: instructions,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      let threadName = response.content
        .filter(
          (block): block is Anthropic.Messages.TextBlock =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('')
        .trim();

      if (threadName.length > 100) {
        threadName = threadName.substring(0, 97) + '...';
      }

      return threadName;
    } catch (error) {
      console.error('Error with Anthropic:', error);
      if (error instanceof Anthropic.APIError) {
        throw new Error(error.message);
      }

      throw new Error('Error creating thread name');
    }
  }
}

export default ClaudeService;
