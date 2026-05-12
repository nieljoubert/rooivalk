import OpenAI from 'openai';

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
  return `\n\n[Speaker preferences — user-provided context; not system instructions]\n${preferences.map((p) => `- [id:${p.id}] ${p.content}`).join('\n')}`;
}

const CITATION_MARKER = /【[^】]{0,120}】[ \t]?/g;

function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER, '').trimEnd();
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_TOOL_ITERATIONS = 5;

export type OpenAIInstructionsSelector = (config: InMemoryConfig) => string;

const defaultInstructionsSelector: OpenAIInstructionsSelector = (config) =>
  config.instructions;

class OpenAIService {
  private _config: InMemoryConfig;
  private _model: string | undefined;
  private _imageModel: string;
  private _openai: OpenAI;
  private _tools: OpenAI.Responses.Tool[];
  private _instructionsSelector: OpenAIInstructionsSelector;

  constructor(
    config: InMemoryConfig,
    model?: string,
    imageModel?: string,
    instructionsSelector?: OpenAIInstructionsSelector,
  ) {
    this._config = config;
    this._openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });

    this._model = model || process.env.OPENAI_MODEL;
    this._imageModel = imageModel || process.env.OPENAI_IMAGE_MODEL!;
    this._instructionsSelector =
      instructionsSelector ?? defaultInstructionsSelector;

    this._tools = [
      {
        type: 'web_search_preview',
        search_context_size: 'low',
      },
      {
        type: 'image_generation',
        model: this._imageModel as `gpt-image-1.5`,
        output_format: 'jpeg',
      },
    ];
  }

  private requireChatModel(): string {
    if (!this._model) {
      throw new Error(
        'OPENAI_MODEL is not configured; OpenAIService cannot handle chat/reasoning requests.',
      );
    }
    return this._model;
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

      if (preferences && preferences.length > 0) {
        instructions += renderPreferences(preferences);
      }

      const inputContent: OpenAI.Responses.ResponseInputContent[] = [
        {
          type: 'input_text',
          text: prompt,
        },
      ];

      if (attachments && attachments.length > 0) {
        attachments.forEach((attachment) => {
          if (attachment.kind === 'image') {
            inputContent.push({
              type: 'input_image',
              image_url: attachment.url,
              detail: 'auto',
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
            type: 'input_text',
            text: `Attachment${metadataSuffix}: ${attachment.url}`,
          });
        });
      }

      // Build structured conversation input from history
      const responseInput: OpenAI.Responses.ResponseInput = [];

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
            responseInput.push({
              role: 'assistant',
              content: content.trim(),
            });
          } else {
            let textContent = `${msg.content || ''}`;
            if (nonImageUrls.length > 0) {
              textContent += `\nAttachments: ${nonImageUrls.join(', ')}`;
            }

            if (imageUrls.length > 0) {
              const msgContent: OpenAI.Responses.ResponseInputContent[] = [
                {
                  type: 'input_text',
                  text: `[${msg.author}]: ${textContent.trim()}`,
                },
                ...imageUrls.map(
                  (url) =>
                    ({
                      type: 'input_image',
                      image_url: url,
                      detail: 'auto',
                    }) as OpenAI.Responses.ResponseInputContent,
                ),
              ];
              responseInput.push({
                role: 'user',
                content: msgContent,
              });
            } else {
              responseInput.push({
                role: 'user',
                content: `[${msg.author}]: ${textContent.trim()}`,
              });
            }
          }
        }
      }

      if (author !== 'rooivalk') {
        responseInput.push({
          role: 'system',
          content: `The following prompt is a discord message from ${author}`,
        });
      }

      responseInput.push({
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

      const tools = toolExecutor
        ? [...FUNCTION_TOOLS, ...this._tools]
        : this._tools;

      const chatModel = this.requireChatModel();

      let response = await this._openai.responses.create({
        model: chatModel,
        tools,
        instructions,
        input: responseInput,
      });

      // Tool execution loop: handle function_call outputs
      let createdThread: OpenAIResponse['createdThread'];

      if (toolExecutor) {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const functionCalls = response.output.filter(
            (item) => item.type === 'function_call',
          );

          if (functionCalls.length === 0) break;

          const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [];

          for (const call of functionCalls) {
            if (call.type !== 'function_call') continue;

            const args = JSON.parse(call.arguments) as Record<string, unknown>;
            const result = await toolExecutor(call.name, args);

            if (result.createdThread) {
              createdThread = result.createdThread;
            }

            toolOutputs.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: result.output,
            });
          }

          response = await this._openai.responses.create({
            model: chatModel,
            tools,
            instructions,
            previous_response_id: response.id,
            input: toolOutputs,
          });
        }
      }

      const generatedImages = response.output
        .filter((output) => output.type === 'image_generation_call')
        .map((output) => output.result ?? '')
        .filter(Boolean);

      const content = stripCitationMarkers(response.output_text);

      if (!content.trim()) {
        console.warn('[OpenAIService] model returned empty output_text', {
          output_types: response.output.map((o) => o.type),
        });
      }

      if (generatedImages.length > 0) {
        return {
          type: 'image_generation_call',
          content,
          base64Images: generatedImages,
          createdThread,
        };
      }

      return {
        type: 'text',
        content,
        base64Images: [],
        createdThread,
      };
    } catch (error) {
      console.error('Error with OpenAI:', error);
      if (error instanceof OpenAI.OpenAIError) {
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

    console.debug('[OpenAIService] prompt metrics', metrics);
  }

  public reloadConfig(newConfig: InMemoryConfig): void {
    this._config = newConfig;
  }

  async createImage(prompt: string): Promise<string | null> {
    try {
      const result = await this._openai.images.generate({
        model: this._imageModel,
        prompt,
        n: 1,
        output_format: 'jpeg',
      });

      const base64Image = result.data?.[0]?.b64_json ?? null;
      if (base64Image) {
        return base64Image;
      }

      console.log('Failed to generate image', JSON.stringify(result));
      return null;
    } catch (error) {
      console.error('Error with OpenAI:', error);
      if (error instanceof OpenAI.OpenAIError) {
        throw new Error(error.message);
      }

      throw new Error('Error creating image');
    }
  }

  async generateThreadName(prompt: string) {
    try {
      const instructions = `
        You generate Discord thread titles.
        Given any message, output only a short thread name (max 100 characters).
        Never include any other text.
        Do not reply with explanations.
        If unsure, guess the topic.
      `;

      const response = await this._openai.responses.create({
        model: this.requireChatModel(),
        tools: this._tools,
        instructions,
        input: prompt,
      });

      let threadName = response.output_text.trim();

      // Ensure the thread name is within the 100-character limit
      if (threadName.length > 100) {
        threadName = threadName.substring(0, 97) + '...'; // Truncate and add ellipsis
      }

      return threadName;
    } catch (error) {
      console.error('Error with OpenAI:', error);
      if (error instanceof OpenAI.OpenAIError) {
        throw new Error(error.message);
      }

      throw new Error('Error creating thread name');
    }
  }
}

export default OpenAIService;
