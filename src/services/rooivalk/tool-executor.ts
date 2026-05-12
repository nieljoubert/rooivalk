import type { Message, ThreadChannel } from 'discord.js';

import { runBash } from '../bash/index.ts';
import { TOOL_NAMES } from '../chat/tool-names.ts';
import type ClickatellService from '../clickatell/index.ts';
import type DiscordService from '../discord/index.ts';
import type MemoryService from '../memory/index.ts';
import type { MemoryKind } from '../memory/index.ts';
import type OpenAIService from '../openai/index.ts';
import type SteamService from '../steam/index.ts';
import type YrService from '../yr/index.ts';
import type { ToolExecutionResult } from '../../types.ts';

export type ToolExecutorContext = {
  message: Message<boolean>;
  yr: YrService;
  discord: DiscordService;
  openai: OpenAIService;
  clickatell: ClickatellService;
  memory: MemoryService;
  steam: SteamService;
  createThread: (
    message: Message<boolean>,
    name?: string,
  ) => Promise<ThreadChannel | null>;
};

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolExecutionResult>;

function errorOutput(err: unknown): ToolExecutionResult {
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  return { output: JSON.stringify({ error: errorMessage }) };
}

export function buildToolExecutor(ctx: ToolExecutorContext): ToolExecutor {
  const {
    message,
    yr,
    discord,
    openai,
    clickatell,
    memory,
    steam,
    createThread,
  } = ctx;

  return async (name, args) => {
    switch (name) {
      case TOOL_NAMES.GET_WEATHER: {
        const city = args.city as string;
        const forecast = await yr.getForecastByLocation(city);
        return { output: JSON.stringify(forecast) };
      }
      case TOOL_NAMES.GET_ALL_WEATHER: {
        const forecasts = await yr.getAllForecasts();
        return { output: JSON.stringify(forecasts) };
      }
      case TOOL_NAMES.CREATE_THREAD: {
        if (message.channel.isThread()) {
          return {
            output: JSON.stringify({
              error: 'Cannot create a thread inside an existing thread',
            }),
          };
        }

        try {
          const threadName = (args.name as string | null) ?? undefined;
          const thread = await createThread(message, threadName);
          if (thread) {
            return {
              output: JSON.stringify({
                threadId: thread.id,
                name: thread.name,
              }),
              createdThread: thread,
            };
          }
          return {
            output: JSON.stringify({ error: 'Failed to create thread' }),
          };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.GENERATE_IMAGE: {
        try {
          const imagePrompt = args.prompt as string;
          const base64Image = await openai.createImage(imagePrompt);
          if (base64Image) {
            return {
              output: JSON.stringify({
                status: 'ok',
                note: 'Image generated and attached to the reply.',
              }),
              base64Image,
            };
          }
          return {
            output: JSON.stringify({
              error: 'Image generation returned no data',
            }),
          };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.SEND_SMS: {
        if (!clickatell.isConfigured) {
          return {
            output: JSON.stringify({
              error:
                'SMS sending is not configured (CLICKATELL_API_KEY missing)',
            }),
          };
        }

        try {
          const recipientId = args.discord_user_id as string;
          const content = args.content as string;
          const phoneNumber = memory.getPhoneNumberFor(recipientId);
          if (!phoneNumber) {
            return {
              output: JSON.stringify({
                error: `User ${recipientId} has not registered a phone number.`,
              }),
            };
          }
          const result = await clickatell.sendSms(phoneNumber, content);
          return {
            output: JSON.stringify({
              status: 'ok',
              httpStatus: result.status,
              response: result.body,
            }),
          };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.REMEMBER: {
        try {
          const content = args.content as string;
          const kind: MemoryKind =
            args.kind === 'preference' ? 'preference' : 'memory';
          const { id } = memory.remember(message.author.id, content, kind);
          return {
            output: JSON.stringify({ status: 'ok', memory_id: id }),
          };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.RECALL: {
        try {
          const limit = typeof args.limit === 'number' ? args.limit : undefined;
          const rows = memory.recall(message.author.id, limit);
          return { output: JSON.stringify({ memories: rows }) };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.FORGET_MEMORY: {
        try {
          const memoryId = Number(args.memory_id);
          const result = memory.forgetMemory(memoryId, message.author.id);
          return { output: JSON.stringify(result) };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.REGISTER_PHONE_NUMBER: {
        try {
          const phoneNumber = args.phone_number as string;
          const result = memory.registerPhoneNumber(
            message.author.id,
            phoneNumber,
          );
          return {
            output: JSON.stringify({
              status: 'ok',
              phone_number: result.phoneNumber,
            }),
          };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.FORGET_PHONE_NUMBER: {
        try {
          const result = memory.forgetPhoneNumber(message.author.id);
          return { output: JSON.stringify(result) };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.GET_GUILD_EVENTS: {
        const startDate = args.start_date
          ? new Date(args.start_date as string)
          : new Date();
        startDate.setHours(0, 0, 0, 0);

        const endDate = args.end_date
          ? new Date(args.end_date as string)
          : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        endDate.setHours(23, 59, 59, 999);

        const events = await discord.getGuildEventsBetween(startDate, endDate);
        return { output: JSON.stringify(events) };
      }
      case TOOL_NAMES.RUN_BASH: {
        const result = await runBash(args.command as string);
        if (!result.ok) {
          return { output: JSON.stringify({ error: result.error }) };
        }
        return { output: result.output };
      }
      case TOOL_NAMES.GET_GAME_LISTING: {
        const store = args.store as string;
        if (store !== 'steam') {
          return {
            output: JSON.stringify({
              error: `Store not yet supported: ${store}`,
            }),
          };
        }

        try {
          const query = args.query as string;
          const match = steam.findGame(query);
          if (!match) {
            return {
              output: JSON.stringify({
                error:
                  'Game not found — try a more specific name, or the app list may still be syncing.',
              }),
            };
          }

          const details = await steam.getGameDetails(match.appid);
          if (!details) {
            return {
              output: JSON.stringify({
                error: 'Could not retrieve game details from Steam.',
              }),
            };
          }

          return { output: JSON.stringify(details) };
        } catch (err) {
          return errorOutput(err);
        }
      }
      case TOOL_NAMES.GET_EMOJIS: {
        const emojis = discord.allowedEmojis;
        return {
          output:
            emojis.length > 0
              ? emojis.join('\n')
              : JSON.stringify({ note: 'No custom emojis available.' }),
        };
      }
      default:
        return {
          output: JSON.stringify({ error: `Unknown tool: ${name}` }),
        };
    }
  };
}
