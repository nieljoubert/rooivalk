# RooivalkService Agent Guidelines

## Overview

The RooivalkService contains the core business logic for the bot. It processes messages, prepares prompts, integrates weather/events, shapes responses, and manages conversational context.

## Key Responsibilities

- Core business logic and message processing
- Prompt preparation and context management
- Weather and event data integration
- Response shaping and formatting
- Thread handling and automatic responses
- Message filtering and routing decisions

## Core Functionality

### Message Processing

- Determines when to process messages based on mentions, replies to bot, or thread ownership
- Processes message content and prepares appropriate responses
- Integrates contextual information (weather, events, etc.)

### Thread Handling

- Automatically responds to ALL messages in bot-created threads (no mentions needed)
- Manages thread context and conversation continuity
- Handles thread-specific logic and state management

### Context Integration

- Integrates weather data from YrService for MOTD and enhanced responses
- Manages conversation context and history
- Handles system prompts and instructions

### MOTD Image Generation

The daily MOTD uses a three-tier image fallback strategy:

1. **AI-generated image** (primary): Calls `OpenAIService.createImage()` with a randomly composed prompt combining a style and city aspect for the selected city
2. **Wikimedia** (fallback): Fetches a geo-located photo via `WikimediaService.getCityImage()`
3. **Peapix** (last resort): Fetches Bing's image of the day via `PeapixService.getImage()`

Image prompt composition uses two module-level arrays:

- `MOTD_IMAGE_STYLES` — 15 art styles (watercolour, pixel art, retro travel poster, etc.)
- `MOTD_CITY_ASPECTS` — 12 subject topics (landmarks, cuisine, wildlife, etc.)

A random style + aspect + city name are combined into the prompt each day for variety.

## Bot Behavior Logic

### Message Processing Rules

1. **Direct mentions**: Bot responds when mentioned anywhere (`@rooivalk message`)
2. **Replies to bot**: When users reply to bot messages, creates a thread automatically
3. **Thread conversations**: Bot responds to ALL messages in threads it created (no mentions needed)
4. **Other threads**: Bot ignores messages unless directly mentioned

## Architecture Notes

- Uses class-based TypeScript with private `_underscore` properties
- Integrates with DiscordService for Discord operations
- Integrates with OpenAIService for AI responses
- Integrates with YrService for weather data
- Coordinates overall bot behavior and decision-making

## Common Tasks

| Task                     | Action                                 | Notes                                            |
| ------------------------ | -------------------------------------- | ------------------------------------------------ |
| Enhance business logic   | Extend message/state handling          | Update core processing logic in index.ts         |
| Modify thread behavior   | Update thread detection/creation logic | Consider automatic response rules                |
| Add context integration  | Extend weather/event integration       | Coordinate with YrService and other data sources |
| Update message filtering | Modify when bot should respond         | Update mention/reply/thread logic                |

## Testing

- Unit tests in `index.test.ts`
- Use mock threads with `createMockMessage` for thread testing
- Use `test-utils/mock.ts` for common environment and config mocks
- Test message filtering and routing logic
- Validate context integration and response formatting

## Integration Points

- **DiscordService**: For Discord API operations and message handling
- **ChatService**: For AI-generated text responses (MOTD, conversations)
- **OpenAIService**: For image generation (`createImage`)
- **YrService**: For weather data integration
- **WikimediaService**: For geo-located city photos (MOTD image fallback)
- **PeapixService**: For Bing image of the day (MOTD last-resort fallback)
- **CronService**: For scheduled tasks and operations
- **Config system**: For hot-swappable configuration

## Helper Functions

- `isRooivalkThread` (in `helpers.ts`) - Determines if a Discord thread was created by the bot
- `isReplyToRooivalk` (in `helpers.ts`) - Checks if a message is a direct reply to the bot

## Dependencies

- All other services via dependency injection
- Shared types and constants
- Config system for dynamic behavior
- Environment configuration
