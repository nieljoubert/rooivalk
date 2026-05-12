import type Anthropic from '@anthropic-ai/sdk';

import { YR_COORDINATES } from '../../constants.ts';
import { TOOL_NAMES } from '../chat/tool-names.ts';

export { TOOL_NAMES };

export const FUNCTION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: TOOL_NAMES.GET_WEATHER,
    description:
      'Get the current weather forecast for a specific city. Available cities are limited to a predefined set.',
    input_schema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          enum: Object.keys(YR_COORDINATES),
          description: 'The city to get the weather for',
        },
      },
      required: ['city'],
    },
  },
  {
    name: TOOL_NAMES.GET_ALL_WEATHER,
    description: 'Get weather forecasts for all available cities at once.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.CREATE_THREAD,
    description:
      'Create a new Discord thread on the current message. Only use when explicitly asked to create a thread.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Optional thread name (max 100 chars). Omit to auto-generate one.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.GET_GUILD_EVENTS,
    description:
      'Get scheduled Discord server events, optionally filtered by date range.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description:
            'Start date in ISO 8601 format (YYYY-MM-DD). Defaults to today if omitted.',
        },
        end_date: {
          type: 'string',
          description:
            'End date in ISO 8601 format (YYYY-MM-DD). Defaults to 7 days from start if omitted.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.GENERATE_IMAGE,
    description:
      'Generate an image from a text prompt. Use when the user explicitly asks you to create, draw, or generate an image.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'A detailed description of the image to generate. Refine the user prompt if it is vague.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: TOOL_NAMES.SEND_SMS,
    description:
      'Send an SMS to a Discord user who has registered their phone number. Pass the recipient as their Discord user ID (the snowflake inside <@...> mentions). Refuses if the user has not registered a number.',
    input_schema: {
      type: 'object',
      properties: {
        discord_user_id: {
          type: 'string',
          description:
            'Discord user ID (snowflake) of the recipient. Extract from <@123...> mentions in the prompt.',
        },
        content: {
          type: 'string',
          description: 'The SMS message body. Keep it concise.',
        },
      },
      required: ['discord_user_id', 'content'],
    },
  },
  {
    name: TOOL_NAMES.REMEMBER,
    description:
      'Store a memory about the user who is currently talking to you. Use sparingly — only for durably useful facts (preferences, context, things they explicitly asked you to remember). Do NOT store conversational fluff.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact or note to remember. One short sentence.',
        },
        kind: {
          type: 'string',
          enum: ['memory', 'preference'],
          description:
            '`memory` (default) for facts, events, one-off context fetched via `recall`. `preference` for stable traits that shape every reply (name, tone, hard nos). Use `preference` sparingly — injected on every turn. Cap: 5.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: TOOL_NAMES.RECALL,
    description:
      "Look up recent memories about the user currently talking to you. Always scoped to the speaker — you cannot recall another user's memories. Returns up to `limit` rows ordered most recent first. Only returns `memory` kind — preferences are already in context.",
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max rows to return (1-100). Defaults to 10.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.FORGET_MEMORY,
    description:
      'Delete a specific memory by id. Works for both `memory` and `preference` kind. Only the user the memory is about can delete it. Use when the speaker explicitly asks you to forget something — call `recall` first to find the id for memories; preferences are visible in context.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'number',
          description: 'The id of the memory row to delete.',
        },
      },
      required: ['memory_id'],
    },
  },
  {
    name: TOOL_NAMES.REGISTER_PHONE_NUMBER,
    description:
      "Register the speaker's own phone number so they can receive SMS. Always registers for the user currently talking to you — they cannot register a number for someone else. Use only when the user explicitly asks.",
    input_schema: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description:
            'Phone number in international format. Digits only is best, but leading + and whitespace are tolerated.',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: TOOL_NAMES.FORGET_PHONE_NUMBER,
    description:
      "Delete the speaker's registered phone number. Use when the user explicitly asks to be removed from SMS.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.RUN_BASH,
    description:
      'Run a read-only shell command on the server. Use to inspect source files, grep the codebase, or read PM2 logs when diagnosing issues. Sandboxed to the project directory — relative paths only for file commands.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The command to run. Allowed prefixes: ls, cat, grep, find, head, tail, wc (relative paths only), pm2 logs rooivalk, pm2 status, pm2 show rooivalk.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: TOOL_NAMES.GET_EMOJIS,
    description:
      'List all custom emojis available in this Discord server. Call this before using a custom emoji to get the correct <:name:id> tokens.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.GET_GAME_LISTING,
    description:
      "Look up a game on a digital store and return its full listing: price, description, genres, release date, and platform availability. Use when the user asks about a game's price, store page, or availability.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The game name to search for. Be as specific as possible to avoid wrong matches.',
        },
        store: {
          type: 'string',
          enum: ['steam'],
          description: 'The store to query.',
        },
      },
      required: ['query', 'store'],
    },
  },
];
