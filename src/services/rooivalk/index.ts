import {
  AttachmentBuilder,
  EmbedBuilder,
  Events as DiscordEvents,
} from 'discord.js';
import type {
  Attachment,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  ThreadChannel,
  Message,
  MessageReaction,
  PartialMessageReaction,
  SendableChannels,
} from 'discord.js';

import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  DISCORD_COMMANDS,
  IMAGE_ATTACHMENT_EXTENSIONS,
  YR_COORDINATES,
} from '../../constants.ts';
import {
  createChatService,
  createFieldHospitalChatService,
} from '../chat/index.ts';
import type { ChatService } from '../chat/index.ts';
import ClickatellService from '../clickatell/index.ts';
import DiscordService from '../discord/index.ts';
import MemoryService from '../memory/index.ts';
import OpenAIService from '../openai/index.ts';
import PeapixService from '../peapix/index.ts';
import SteamService from '../steam/index.ts';
import WikimediaService from '../wikimedia/index.ts';
import YrService from '../yr/index.ts';
import type {
  AttachmentForPrompt,
  InMemoryConfig,
  MessageInChain,
} from '../../types.ts';

import { formatMessageInChain } from '../discord/helpers.ts';
import {
  isReplyToRooivalk,
  isRooivalkThread,
  buildPromptAuthor,
  shouldUseFieldHospitalModel,
} from './helpers.ts';
import { buildToolExecutor } from './tool-executor.ts';
import type { ToolExecutor } from './tool-executor.ts';

function shuffleArray<T>(items: T[]): T[] {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

const MOTD_IMAGE_ATTACHMENT_NAME = 'rooivalk_motd.jpg';

const MOTD_IMAGE_STYLES = [
  'watercolour painting',
  'oil painting',
  'digital concept art',
  'pencil sketch',
  'pop art',
  'art nouveau illustration',
  'impressionist painting',
  'ukiyo-e woodblock print',
  'pixel art',
  'retro travel poster',
  'isometric illustration',
  'stained glass window design',
  'vintage postcard',
  'charcoal drawing',
  'comic book panel',
];

const MOTD_CITY_ASPECTS = [
  'a famous landmark or monument',
  'the local cuisine and street food',
  'a hidden gem only locals know about',
  'the skyline at golden hour',
  'a bustling local market scene',
  'the surrounding natural landscape',
  'a cultural festival or tradition',
  'the distinctive architecture',
  'everyday street life',
  'wildlife native to the region',
  'the coastline or waterfront',
  'a historical scene from the past',
];

class Rooivalk {
  protected _config: InMemoryConfig;
  protected _discord: DiscordService;
  protected _chat: ChatService;
  protected _chatFieldHospital?: ChatService;
  protected _openai: OpenAIService;
  protected _yr: YrService;
  protected _peapix: PeapixService;
  protected _wikimedia: WikimediaService;
  protected _clickatell: ClickatellService;
  protected _memory: MemoryService;
  protected _steam: SteamService;
  private _allowedAppIds: string[];

  constructor(
    config: InMemoryConfig,
    discordService?: DiscordService,
    chatService?: ChatService,
    openaiService?: OpenAIService,
    yrService?: YrService,
    peapixService?: PeapixService,
    wikimediaService?: WikimediaService,
    fieldHospitalChatService?: ChatService,
    clickatellService?: ClickatellService,
    memoryService?: MemoryService,
    steamService?: SteamService,
  ) {
    this._config = config;
    this._discord = discordService ?? new DiscordService(this._config);
    this._openai = openaiService ?? new OpenAIService(this._config);
    this._chat = chatService ?? createChatService(this._config, this._openai);
    this._chatFieldHospital =
      fieldHospitalChatService ?? createFieldHospitalChatService(this._config);
    this._yr = yrService ?? new YrService();
    this._peapix = peapixService ?? new PeapixService();
    this._wikimedia = wikimediaService ?? new WikimediaService();
    this._clickatell =
      clickatellService ??
      new ClickatellService(process.env.CLICKATELL_API_KEY);
    this._memory =
      memoryService ??
      new MemoryService(process.env.ROOIVALK_DB_PATH ?? './data/rooivalk.db');
    this._steam =
      steamService ??
      new SteamService(
        process.env.ROOIVALK_DB_PATH ?? './data/rooivalk.db',
        process.env.STEAM_API_KEY,
      );

    // Parse DISCORD_ALLOWED_APPS once and store
    const allowedAppsEnv = process.env.DISCORD_ALLOWED_APPS;
    this._allowedAppIds = allowedAppsEnv
      ? allowedAppsEnv
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
  }

  /**
   * Determines if a message should be processed based on allowlist and guild.
   * @param message The Discord message.
   * @param guildId The guild/server ID to match.
   */
  private shouldProcessMessage(
    message: Message<boolean>,
    guildId: string,
  ): boolean {
    if (
      (message.author.bot &&
        !this._allowedAppIds.includes(message.author.id)) ||
      message.guild?.id !== guildId
    ) {
      return false;
    }
    return true;
  }

  private isAttachmentAllowed(attachment: Attachment): boolean {
    const normalizedContentType = this.normalizeContentType(
      attachment.contentType,
    );

    if (
      normalizedContentType &&
      ALLOWED_ATTACHMENT_CONTENT_TYPES.includes(normalizedContentType)
    ) {
      return true;
    }

    if (attachment.name) {
      const lowerCaseName = attachment.name.toLowerCase();
      return ALLOWED_ATTACHMENT_EXTENSIONS.some((extension) =>
        lowerCaseName.endsWith(extension),
      );
    }

    return false;
  }

  private getAttachmentKind(
    attachment: Attachment,
  ): AttachmentForPrompt['kind'] {
    const normalizedContentType = this.normalizeContentType(
      attachment.contentType,
    );

    if (normalizedContentType?.startsWith('image/')) {
      return 'image';
    }

    if (attachment.name) {
      const lowerCaseName = attachment.name.toLowerCase();
      if (
        IMAGE_ATTACHMENT_EXTENSIONS.some((extension) =>
          lowerCaseName.endsWith(extension),
        )
      ) {
        return 'image';
      }
    }

    return 'file';
  }

  private buildAttachmentForPrompt(
    attachment: Attachment,
  ): AttachmentForPrompt {
    const normalizedContentType = this.normalizeContentType(
      attachment.contentType,
    );

    return {
      url: attachment.url,
      name: attachment.name ?? null,
      contentType: normalizedContentType,
      kind: this.getAttachmentKind(attachment),
    };
  }

  private normalizeContentType(contentType?: string | null): string | null {
    if (!contentType) {
      return null;
    }

    const [parsedContentType] = contentType.split(';');
    return parsedContentType ? parsedContentType.trim().toLowerCase() : null;
  }

  /**
   * Reloads the config for Rooivalk and propagates to child services.
   */
  reloadConfig(newConfig: InMemoryConfig) {
    this._config = newConfig;
    this._discord.reloadConfig(newConfig);
    this._chat.reloadConfig(newConfig);
    this._chatFieldHospital?.reloadConfig(newConfig);
    this._openai.reloadConfig(newConfig);
  }

  private selectChatService(message: Message<boolean>): ChatService {
    if (!this._chatFieldHospital) {
      return this._chat;
    }

    const useFieldHospital = shouldUseFieldHospitalModel(
      message,
      process.env.DISCORD_FIELD_HOSPITAL_ROLE_ID,
      process.env.DISCORD_FIELD_HOSPITAL_CHANNEL_ID,
    );

    return useFieldHospital ? this._chatFieldHospital : this._chat;
  }

  private createToolExecutor(message: Message<boolean>): ToolExecutor {
    return buildToolExecutor({
      message,
      yr: this._yr,
      discord: this._discord,
      openai: this._openai,
      clickatell: this._clickatell,
      memory: this._memory,
      steam: this._steam,
      createThread: (msg, name) => this.createRooivalkThread(msg, name),
    });
  }

  public async syncSteamAppList(): Promise<void> {
    await this._steam.syncAppList();
  }

  public async processMessage(message: Message<boolean>) {
    try {
      let prompt = message.content
        .replace(this._discord.mentionRegex!, '')
        .trim();

      let conversationHistory: MessageInChain[] | null = null;

      if (message.channel.isThread()) {
        conversationHistory =
          await this._discord.buildMessageChainFromThreadMessage(message);
      } else {
        conversationHistory =
          await this._discord.buildMessageChainFromMessage(message);
      }

      const usersToMention = message.mentions.users.filter(
        (user) => user.id !== this._discord.client.user?.id,
      );

      // filter attachments to only those with allowed content types
      const attachments = Array.from(message.attachments.values())
        .filter((attachment) => this.isAttachmentAllowed(attachment))
        .map((attachment) => this.buildAttachmentForPrompt(attachment));

      const toolExecutor = this.createToolExecutor(message);
      const chat = this.selectChatService(message);
      const preferences = this._memory.getPreferences(message.author.id);

      const response = await chat.createResponse(
        buildPromptAuthor(message.author),
        prompt,
        conversationHistory,
        attachments.length > 0 ? attachments : null,
        toolExecutor,
        preferences,
      );

      if (response) {
        const reply = this._discord.buildMessageReply(
          response,
          usersToMention.map((user) => user.id),
        );

        if (response.createdThread) {
          await response.createdThread.send(reply);
        } else if (message.channel.isThread()) {
          await message.channel.send(reply);
        } else {
          await message.reply(reply);
        }
      } else {
        await message.reply(this._discord.getRooivalkResponse('error'));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      const errorMessage = this._discord.getRooivalkResponse('error');

      const reply =
        error instanceof Error
          ? `${errorMessage}\n\`\`\`${error.message}\`\`\``
          : errorMessage;

      if (message.channel.isThread()) {
        await message.channel.send(reply);
      } else {
        await message.reply(reply);
      }
      return;
    }
  }

  public async sendMotdToMotdChannel() {
    if (!this._config.motd) {
      console.log('No MOTD configured');
      return;
    }

    // set a date range of today
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    let motd = this._config.motd;
    const forecasts = await this._yr.getAllForecasts();
    const events = await this._discord.getGuildEventsBetween(start, end);

    // replace placeholders with JSON for the prompt
    motd = motd.replace(
      /{{WEATHER_FORECASTS_JSON}}/,
      JSON.stringify(forecasts || []),
    );
    motd = motd.replace(/{{EVENTS_JSON}}/, JSON.stringify(events || []));

    try {
      const response = await this._chat.createResponse('rooivalk', motd);

      const rawMotdContent = response.content?.trim();
      if (!rawMotdContent) {
        console.error('MOTD response was empty');
        return;
      }

      let motdImage: {
        heading: string;
        attribution: string;
        buffer: Buffer;
      } | null = null;

      const locations = Object.values(YR_COORDINATES);
      const shuffled = shuffleArray(locations);
      const selectedCity = shuffled[0];

      const style =
        MOTD_IMAGE_STYLES[Math.floor(Math.random() * MOTD_IMAGE_STYLES.length)];
      const aspect =
        MOTD_CITY_ASPECTS[Math.floor(Math.random() * MOTD_CITY_ASPECTS.length)];
      const imagePrompt = `${style} depicting ${aspect} of ${selectedCity.name}. Vivid, detailed, atmospheric.`;

      try {
        const base64Image = await this._openai.createImage(imagePrompt);
        if (base64Image) {
          motdImage = {
            heading: selectedCity.name,
            attribution: imagePrompt,
            buffer: Buffer.from(base64Image, 'base64'),
          };
        }
      } catch (err) {
        console.error(
          `AI image generation failed for ${selectedCity.name}:`,
          err,
        );
      }

      if (!motdImage) {
        for (const location of shuffled) {
          try {
            const cityImage = await this._wikimedia.getCityImage(location);
            if (cityImage) {
              motdImage = {
                heading: cityImage.cityName,
                attribution: cityImage.title,
                buffer: cityImage.buffer,
              };
              break;
            }
          } catch (err) {
            console.error(
              `Wikimedia image fetch failed for ${location.name}:`,
              err,
            );
          }
        }

        if (!motdImage) {
          console.warn(
            `AI generation and Wikimedia both failed. Falling back to Peapix.`,
          );
          try {
            const peapixImage = await this._peapix.getImage();
            if (peapixImage) {
              motdImage = {
                heading: peapixImage.title ?? 'Image of the day',
                attribution: peapixImage.copyright,
                buffer: peapixImage.buffer,
              };
            } else {
              console.warn('Peapix fallback returned no image.');
            }
          } catch (peapixErr) {
            console.error(
              'Peapix fallback image fetch threw an error:',
              peapixErr,
            );
          }
        }
      }

      if (!motdImage) {
        console.error(
          'MOTD image sources exhausted: both Wikimedia and Peapix failed to provide an image. ' +
            'The MOTD will be sent without an image.',
        );
      }

      if (!this._discord.motdChannelId) {
        console.error('Channel ID not set');
        return;
      }

      const channel = await this._discord.client.channels.fetch(
        this._discord.motdChannelId,
      );
      if (!channel || !channel.isTextBased()) {
        console.error(
          `Cannot send MOTD: Channel ${this._discord.motdChannelId} is not text-based`,
        );
        return;
      }

      const messageOptions = this._discord.buildMessageReply({
        type: 'text',
        content: rawMotdContent,
        base64Images: [],
      });

      const files = [...(messageOptions.files ?? [])];
      const embeds = [...(messageOptions.embeds ?? [])];

      if (motdImage) {
        files.push(
          new AttachmentBuilder(motdImage.buffer, {
            name: MOTD_IMAGE_ATTACHMENT_NAME,
          }),
        );

        embeds.push(
          new EmbedBuilder({
            description: motdImage.heading,
            footer: {
              text: motdImage.attribution,
            },
            image: {
              url: `attachment://${MOTD_IMAGE_ATTACHMENT_NAME}`,
            },
          }),
        );
      }

      if (!('send' in channel)) {
        console.error(
          `Cannot send MOTD: Channel ${this._discord.motdChannelId} is not sendable`,
        );
        return;
      }

      await (channel as SendableChannels).send({
        ...messageOptions,
        files: files.length > 0 ? files : undefined,
        embeds: embeds.length > 0 ? embeds : undefined,
      });
    } catch (err) {
      console.error(`Error sending MOTD to channel:`, err);
    }
  }

  public async sendMessageToChannel(
    channelId: string | undefined,
    prompt: string,
  ) {
    if (!channelId) {
      console.error(`Channel ID not set`);
      return null;
    }

    try {
      const response = await this._chat.createResponse('rooivalk', prompt);

      const channel = await this._discord.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const messageOptions = this._discord.buildMessageReply(response);
        await (channel as any).send(messageOptions);
        return response;
      } else {
        console.error(`Channel: ${channelId} is not text-based`);
        return null;
      }
    } catch (err) {
      console.error(`Error sending message to channel:`, err);
      return null;
    }
  }

  private async handleSyncSteamCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!process.env.STEAM_API_KEY) {
      await interaction.reply({
        content: '`STEAM_API_KEY` is not configured — sync is unavailable.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      await this._steam.syncAppList();
      await interaction.editReply({ content: 'Steam app list sync complete.' });
    } catch (error) {
      console.error('Error syncing Steam app list:', error);
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        content: `Steam sync failed.\n\n\`\`\`${message}\`\`\``,
      });
    }
  }

  private async handleImageCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const prompt = interaction.options.getString('prompt', true);
    await interaction.deferReply();

    try {
      const base64Image = await this._openai.createImage(prompt);

      if (base64Image) {
        const message = this._discord.buildImageReply(prompt, base64Image);

        await interaction.editReply({
          embeds: message.embeds,
          files: message.files,
        });
      } else {
        await interaction.editReply({
          content: this._discord.getRooivalkResponse('error'),
        });
      }
    } catch (error) {
      console.error('Error handling image command:', error);

      const errorMessage = this._discord.getRooivalkResponse('error');
      if (error instanceof Error) {
        await interaction.editReply({
          content: `${errorMessage}\n\n\`\`\`${error.message}\`\`\``,
        });
        return;
      } else {
        await interaction.editReply({
          content: errorMessage,
        });
        return;
      }
    }
  }

  public async handleWeatherCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const city = interaction.options.getString('city', true);
    await interaction.deferReply();

    try {
      const weather = await this._yr.getForecastByLocation(city);
      if (!weather) {
        await interaction.editReply({
          content: this._discord.getRooivalkResponse('error'),
        });
        return;
      }

      const prompt = `
        You will be provided with a daily weather forecast in JSON format.

        ## Weather formatting
        - Include the friendlyName along with the country flag emoji.
        - Add a short description of the weather, including:
          - Average wind speed (m/s) and direction
          - Average humidity (%)
          - Total precipitation (mm) -- exclude this if it's 0
        - Add 1–2 relevant weather emojis.
        - Keep the style readable but punchy.
        - Do **not** mention the \`location\` value — it's for internal use only.
        - Mention the data is provided by yr.no under the CC BY 4.0 license. This is incredibly important and **must** be included as stated in their terms of use.

        ### Forecast Data
        \`\`\`json
        ${JSON.stringify(weather)}
        \`\`\`
      `;

      const response = await this._chat.createResponse(
        interaction.user.displayName,
        prompt,
      );
      await interaction.editReply({
        content: response.content,
      });
    } catch (error) {
      console.error('Error handling weather command:', error);
      const errorMessage = this._discord.getRooivalkResponse('error');
      const reply =
        error instanceof Error
          ? `${errorMessage}\n\n\`\`\`${error.message}\`\`\``
          : errorMessage;
      await interaction.editReply({ content: reply });
    }
  }

  public async createRooivalkThread(
    message: Message<boolean>,
    name?: string,
  ): Promise<ThreadChannel | null> {
    let threadName: string;

    const trimmedName = name?.trim();

    if (trimmedName && trimmedName.length > 0) {
      threadName = trimmedName.substring(0, 100);
    } else {
      const history = await this._discord.buildMessageChainFromMessage(message);
      const historyText = history
        ? history.map(formatMessageInChain).join('\n')
        : null;
      const chat = this.selectChatService(message);
      threadName = await chat.generateThreadName(
        historyText ?? message.content.trim(),
      );
    }

    const thread = await message.startThread({
      name: threadName,
      autoArchiveDuration: 60,
    });
    await thread.members.add(message.author.id);

    return thread;
  }

  public async processMessageReaction(
    reaction: MessageReaction | PartialMessageReaction,
  ) {
    // Ignore reactions from:
    // 1. Other bots
    // 2. Messages not from the specified guild (server)
    if (reaction.message.guild?.id !== process.env.DISCORD_GUILD_ID) {
      return;
    }
  }

  public async init(): Promise<void> {
    const ready = new Promise<Client<boolean>>((res) =>
      this._discord.once(DiscordEvents.ClientReady, (client) => res(client)),
    );

    await this._discord.registerSlashCommands();

    this._discord.on(DiscordEvents.MessageCreate, async (message) => {
      if (!this.shouldProcessMessage(message, process.env.DISCORD_GUILD_ID!)) {
        return;
      }

      const isMentioned = this._discord.mentionRegex
        ? this._discord.mentionRegex.test(message.content)
        : false;
      const isInRooivalkThread = isRooivalkThread(
        message,
        this._discord.client.user?.id,
      );
      const isReply = await isReplyToRooivalk(
        message,
        this._discord.client.user?.id,
      );

      if (!isMentioned && !isInRooivalkThread && !isReply) {
        return;
      }

      await this.processMessage(message);
    });

    this._discord.on(DiscordEvents.MessageReactionAdd, async (reaction) =>
      this.processMessageReaction(reaction),
    );

    this._discord.on(
      DiscordEvents.InteractionCreate,
      async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        switch (interaction.commandName) {
          case DISCORD_COMMANDS.IMAGE:
            await this.handleImageCommand(interaction);
            break;
          case DISCORD_COMMANDS.WEATHER:
            await this.handleWeatherCommand(interaction);
            break;
          case DISCORD_COMMANDS.SYNC_STEAM:
            await this.handleSyncSteamCommand(interaction);
            break;
          default:
            console.error(
              `Invalid command received: ${interaction.commandName}`,
            );
            await interaction.reply({
              content: `❌ Invalid command: \`${interaction.commandName}\`. Please use a valid command.`,
              ephemeral: true,
            });
            return;
        }
      },
    );

    // finally log in after all event handlers have been set up
    await this._discord.login();

    await ready;

    console.log(`🤖 Logged in as ${this._discord.client.user?.tag}`);

    this._discord.setupMentionRegex();
    this._discord.cacheGuildEmojis();

    await this._discord.sendReadyMessage();
  }
}

export default Rooivalk;
