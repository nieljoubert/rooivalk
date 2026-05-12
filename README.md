![github](https://github.com/user-attachments/assets/cfcc082b-5809-4d82-a537-5d1c44c36d1d)
> Artwork by [Pieter Jordaan](https://www.thisisender.com/)

# Rooivalk
Rooivalk is a Discord bot powered by Anthropic Claude or OpenAI. It responds to mentions and replies, manages threaded conversations, and exposes a set of tools the model can invoke directly.

## Features
- **AI-powered responses**: Supports Anthropic Claude and OpenAI as interchangeable chat providers; image generation always uses OpenAI gpt-image-1
- **Smart conversation handling**: Responds to mentions, replies to bot messages, and automatically creates threads
- **Thread management**: Automatic thread creation when users reply to bot messages, with full conversation continuity and initial context preservation
- **Persistent memory**: Per-user memory and preference storage backed by SQLite; the model can remember, recall, and forget facts across conversations
- **Weather integration**: Fetches weather data from Yr.no for enhanced contextual responses and daily MOTD
- **Steam store lookups**: The model can look up any game's price, description, genres, and platform availability via the `get_game_listing` tool; the full app catalogue is synced nightly into SQLite
- **SMS**: Sends SMS to registered users via Clickatell
- **Shell inspection**: The model can read server logs and inspect its own source files via a sandboxed `run_bash` tool
- **Scheduled tasks**: MOTD (Message of the Day) and Steam app list sync via cron jobs
- **Hot-reloadable configuration**: Runtime configuration updates via `config/*.md` files
- **Robust testing**: Comprehensive test suite with dedicated utilities for mocking Discord interactions and service dependencies

### Rooivalk in action

https://github.com/user-attachments/assets/f2ba3afe-4aca-4ac9-bb5b-852aa8277518

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v22 or newer)
- [pnpm](https://pnpm.io/) (v10.x)
- A Discord bot token ([guide](https://discord.com/developers/applications))
- An OpenAI API key ([guide](https://platform.openai.com/account/api-keys))
- An Anthropic API key ([guide](https://console.anthropic.com/)) — optional if using OpenAI as the chat provider

### Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/fjlaubscher/rooivalk.git
   cd rooivalk
   ```
2. Install dependencies:
   ```sh
   pnpm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```sh
   cp .env.example .env
   ```
   Key variables:
   | Variable | Description |
   |---|---|
   | `DISCORD_TOKEN` | Discord bot token |
   | `DISCORD_GUILD_ID` | Discord server ID |
   | `DISCORD_APP_ID` | Discord application ID |
   | `DISCORD_STARTUP_CHANNEL_ID` | Channel the bot announces startup in |
   | `DISCORD_MOTD_CHANNEL_ID` | Channel for daily MOTD posts |
   | `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` | Use Claude as the chat provider (takes priority if both are set) |
   | `OPENAI_API_KEY` + `OPENAI_MODEL` | Use OpenAI as the chat provider |
   | `OPENAI_IMAGE_MODEL` | Model used for image generation (always OpenAI) |
   | `ROOIVALK_MOTD_CRON` | Cron expression for the MOTD job (e.g. `"0 8 * * *"`) |
   | `ROOIVALK_DB_PATH` | Path to the SQLite database (default: `./data/rooivalk.db`) |
   | `CLICKATELL_API_KEY` | Clickatell API key for SMS (optional) |
   | `STEAM_API_KEY` | Steam Web API key for nightly app list sync. Required to populate the local app catalogue; `get_game_listing` lookups depend on a previously-synced catalogue and will return "not found" until the first successful sync. |

4. Start the bot (uses native TypeScript execution — no build step):
   ```sh
   pnpm start
   ```

### Project structure

For a full breakdown of the architecture and coding conventions, see [AGENTS.md](./AGENTS.md).

### Services

Each service has its own `AGENTS.md` with specific guidance:

- **ClaudeService** (`src/services/claude/`): Anthropic Claude chat provider
- **OpenAIService** (`src/services/openai/`): OpenAI chat provider and image generation
- **RooivalkService** (`src/services/rooivalk/`): Core business logic, message processing, and tool dispatch
- **DiscordService** (`src/services/discord/`): Discord API integration and thread management
- **MemoryService** (`src/services/memory/`): SQLite-backed per-user memory and phone number registry
- **BashService** (`src/services/bash/`): Sandboxed shell execution for log inspection and source reading
- **YrService** (`src/services/yr/`): Weather data from Yr.no
- **SteamService** (`src/services/steam/`): Steam store lookups and nightly app catalogue sync
- **ClickatellService** (`src/services/clickatell/`): SMS via Clickatell HTTP API
- **CronService** (`src/services/cron/`): Scheduled background jobs
- **Config system** (`src/config/`): Hot-reloadable markdown configuration

### Prompt & Persona Tuning

- Edit `config/instructions.md` to adjust Rooivalk's lore, tone, and response rules. The file is hot-reloaded, so changes take effect without redeploying.
- Available placeholders:
  - `{{CURRENT_DATE}}` – replaced with the current ISO date before sending prompts.
  - `{{EMOJIS}}` – populated with the server's allowed custom emojis (one per line).
  - `{{CONVERSATION_HISTORY}}` – replaced with the most recent conversation history (or a fallback line when no history exists). History is automatically truncated to keep prompts lean.
- Set `LOG_LEVEL=debug` to emit prompt-metric debug logs (instructions length, presence of history, attachment count) ahead of each request.

### Continuous Integration

GitHub Actions workflows live in `.github/workflows/`:
- `test.yml`: Runs on every push and pull request to `main` — Prettier check + full test suite.
- `deploy.yml`: Deploys automatically after tests pass on `main` — rsyncs source to the server and restarts the PM2 process.

---

## Notes

- TypeScript strict mode with native execution via Node.js 22+ — no build step required.
- All tests use [Vitest](https://vitest.dev/), with shared utilities in `src/test-utils/` for mocking Discord interactions, environment variables, and service dependencies.

## License
MIT

![rooivalk](https://github.com/user-attachments/assets/e579da64-fe84-4483-9686-32c65dd23acb)
> This image was generated by @rooivalk.
