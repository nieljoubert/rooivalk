import ClaudeService from '../claude/index.ts';
import OpenAIService from '../openai/index.ts';
import type { MemoryRow } from '../memory/index.ts';
import type {
  AttachmentForPrompt,
  InMemoryConfig,
  MessageInChain,
  OpenAIResponse,
  ToolExecutor,
} from '../../types.ts';

export interface ChatService {
  createResponse(
    author: string | 'rooivalk',
    prompt: string,
    history?: MessageInChain[] | null,
    attachments?: AttachmentForPrompt[] | null,
    toolExecutor?: ToolExecutor,
    preferences?: MemoryRow[] | null,
  ): Promise<OpenAIResponse>;
  generateThreadName(prompt: string): Promise<string>;
  reloadConfig(newConfig: InMemoryConfig): void;
}

export type ChatProvider = 'anthropic' | 'openai';

export function resolveChatProvider(
  env: NodeJS.ProcessEnv = process.env,
): ChatProvider {
  if (env.ANTHROPIC_MODEL) {
    return 'anthropic';
  }

  if (env.OPENAI_MODEL) {
    return 'openai';
  }

  throw new Error(
    'No chat model configured. Set ANTHROPIC_MODEL or OPENAI_MODEL.',
  );
}

export function createChatService(
  config: InMemoryConfig,
  openaiService?: OpenAIService,
): ChatService {
  const provider = resolveChatProvider();
  console.log(`[chat] Using ${provider} for chat/reasoning`);

  if (provider === 'anthropic') {
    return new ClaudeService(config);
  }

  // Reuse the existing OpenAI instance if one was provided, so the
  // image-generation service and chat service share a single client.
  return openaiService ?? new OpenAIService(config);
}

export function createFieldHospitalChatService(
  config: InMemoryConfig,
  env: NodeJS.ProcessEnv = process.env,
): ChatService | undefined {
  // Field hospital mode is pinned to OpenAI regardless of the base chat
  // provider — Claude's read on the target use case has been less
  // reliable in side-by-side comparison.
  const model = env.OPENAI_MODEL_FIELD_HOSPITAL;
  const roleId = env.DISCORD_FIELD_HOSPITAL_ROLE_ID;
  const channelId = env.DISCORD_FIELD_HOSPITAL_CHANNEL_ID;

  if (!model || !roleId || !channelId) {
    return undefined;
  }

  if (!config.fieldHospitalInstructions) {
    return undefined;
  }

  console.log('[chat] Field hospital chat provider active (OpenAI)');
  return new OpenAIService(
    config,
    model,
    undefined,
    (c) => c.fieldHospitalInstructions ?? c.instructions,
  );
}
