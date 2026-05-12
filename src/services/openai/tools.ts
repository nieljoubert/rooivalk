import type OpenAI from 'openai';

import { YR_COORDINATES } from '../../constants.ts';
import { TOOL_NAMES } from '../chat/tool-names.ts';

export { TOOL_NAMES };

export const FUNCTION_TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    name: TOOL_NAMES.GET_WEATHER,
    description:
      'Get the current weather forecast for a specific city. Available cities are limited to a predefined set.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          enum: Object.keys(YR_COORDINATES),
          description: 'The city to get the weather for',
        },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.GET_ALL_WEATHER,
    description: 'Get weather forecasts for all available cities at once.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.CREATE_THREAD,
    description:
      'Create a new Discord thread on the current message. Only use when explicitly asked to create a thread.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: ['string', 'null'],
          description:
            'Optional thread name (max 100 chars). If null, one will be auto-generated.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.SEND_SMS,
    description:
      'Send an SMS to a Discord user who has registered their phone number. Pass the recipient as their Discord user ID (the snowflake inside <@...> mentions). Refuses if the user has not registered a number.',
    strict: true,
    parameters: {
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
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.REMEMBER,
    description:
      'Store a memory about the user who is currently talking to you. Use sparingly — only for durably useful facts (preferences, context, things they explicitly asked you to remember). Do NOT store conversational fluff.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact or note to remember. One short sentence.',
        },
        kind: {
          type: ['string', 'null'],
          description:
            '`memory` (default, or null) for facts, events, one-off context fetched via `recall`. `preference` for stable traits that shape every reply (name, tone, hard nos). Use `preference` sparingly — injected on every turn. Cap: 5.',
        },
      },
      required: ['content', 'kind'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.RECALL,
    description:
      "Look up recent memories about the user currently talking to you. Always scoped to the speaker — you cannot recall another user's memories. Returns up to `limit` rows ordered most recent first. Only returns `memory` kind — preferences are already in context.",
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: ['number', 'null'],
          description: 'Max rows to return (1-100). Null = default of 10.',
        },
      },
      required: ['limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.FORGET_MEMORY,
    description:
      'Delete a specific memory by id. Works for both `memory` and `preference` kind. Only the user the memory is about can delete it. Use when the speaker explicitly asks you to forget something — call `recall` first to find the id for memories; preferences are visible in context.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'number',
          description: 'The id of the memory row to delete.',
        },
      },
      required: ['memory_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.REGISTER_PHONE_NUMBER,
    description:
      "Register the speaker's own phone number so they can receive SMS. Always registers for the user currently talking to you — they cannot register a number for someone else. Use only when the user explicitly asks.",
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description:
            'Phone number in international format. Digits only is best, but leading + and whitespace are tolerated.',
        },
      },
      required: ['phone_number'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.FORGET_PHONE_NUMBER,
    description:
      "Delete the speaker's registered phone number. Use when the user explicitly asks to be removed from SMS.",
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.GET_GUILD_EVENTS,
    description:
      'Get scheduled Discord server events, optionally filtered by date range.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        start_date: {
          type: ['string', 'null'],
          description:
            'Start date in ISO 8601 format (YYYY-MM-DD). Defaults to today if null.',
        },
        end_date: {
          type: ['string', 'null'],
          description:
            'End date in ISO 8601 format (YYYY-MM-DD). Defaults to 7 days from start if null.',
        },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.RUN_BASH,
    description:
      'Run a read-only shell command on the server. Use to inspect source files, grep the codebase, or read PM2 logs when diagnosing issues. Sandboxed to the project directory — relative paths only for file commands.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The command to run. Allowed prefixes: ls, cat, grep, find, head, tail, wc (relative paths only), pm2 logs rooivalk, pm2 status, pm2 show rooivalk.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.GET_EMOJIS,
    description:
      'List all custom emojis available in this Discord server. Call this before using a custom emoji to get the correct <:name:id> tokens.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.GET_GAME_LISTING,
    description:
      "Look up a game on a digital store and return its full listing: price, description, genres, release date, and platform availability. Use when the user asks about a game's price, store page, or availability.",
    strict: true,
    parameters: {
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
      additionalProperties: false,
    },
  },
];
