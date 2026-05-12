import {
  Client as DiscordClient,
  GatewayIntentBits,
  AttachmentBuilder,
  userMention,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';
import type { Message, TextChannel, ClientEvents } from 'discord.js';

import {
  DISCORD_MESSAGE_LIMIT,
  DISCORD_COMMAND_DEFINITIONS,
} from '../../constants.ts';
import type {
  InMemoryConfig,
  ResponseType,
  MessageInChain,
  OpenAIResponse,
} from '../../types.ts';

import { parseMessageInChain, formatEmojiEntry } from './helpers.ts';

class DiscordService {
  private _discordClient: DiscordClient;
  private _mentionRegex: RegExp | null = null;
  private _startupChannelId: string | undefined;
  private _motdChannelId: string | undefined;
  private _allowedEmojis: string[];
  private _config: InMemoryConfig;

  constructor(config: InMemoryConfig, discordClient?: DiscordClient) {
    this._config = config;
    this._discordClient =
      discordClient ??
      new DiscordClient({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMessageReactions,
          GatewayIntentBits.MessageContent,
        ],
      });
    this._startupChannelId = process.env.DISCORD_STARTUP_CHANNEL_ID;
    this._motdChannelId = process.env.DISCORD_MOTD_CHANNEL_ID;
    this._allowedEmojis = [];
  }

  public reloadConfig(newConfig: InMemoryConfig): void {
    this._config = newConfig;
  }

  public get client(): DiscordClient {
    return this._discordClient;
  }

  public get mentionRegex(): RegExp | null {
    return this._mentionRegex;
  }

  public set mentionRegex(regex: RegExp | null) {
    this._mentionRegex = regex;
  }

  public get startupChannelId(): string | undefined {
    return this._startupChannelId;
  }

  public get motdChannelId(): string | undefined {
    return this._motdChannelId;
  }

  public get allowedEmojis(): string[] {
    return this._allowedEmojis;
  }

  public getRooivalkResponse(type: ResponseType): string {
    let arrayToUse: string[] = [];
    switch (type) {
      case 'error':
        arrayToUse = this._config.errorMessages;
        break;
      case 'greeting':
        arrayToUse = this._config.greetingMessages;
        break;
      case 'discordLimit':
        arrayToUse = this._config.discordLimitMessages;
        break;
      default:
        throw new Error('Invalid response type');
    }
    const index = Math.floor(Math.random() * arrayToUse.length);
    return arrayToUse[index]!;
  }

  public async sendReadyMessage(): Promise<void> {
    if (this._startupChannelId) {
      try {
        const channel = await this._discordClient.channels.fetch(
          this._startupChannelId,
        );
        if (channel && channel.isTextBased()) {
          await (channel as TextChannel).send(
            this.getRooivalkResponse('greeting'),
          );
        }
      } catch (err) {
        console.error('Error sending ready message:', err);
      }
    }
  }

  public buildMessageReply(
    response: OpenAIResponse,
    allowedMentions: string[] = [],
  ) {
    const exceedsDiscordLimit = response.content.length > DISCORD_MESSAGE_LIMIT;

    if (response.type === 'text' && exceedsDiscordLimit) {
      // create a markdown file attachment and send that instead
      const attachment = new AttachmentBuilder(
        Buffer.from(response.content, 'utf-8'),
        {
          name: 'rooivalk.md',
        },
      );

      return {
        content: this.getRooivalkResponse('discordLimit'),
        files: [attachment],
        allowedMentions: {
          users: allowedMentions,
        },
      };
    } else if (response.type === 'text' && !exceedsDiscordLimit) {
      if (!response.content.trim()) {
        console.warn(
          '[DiscordService] buildMessageReply: empty text content, substituting fallback',
        );
        return {
          content: '[no response generated]',
          allowedMentions: {
            users: allowedMentions,
          },
        };
      }
      return {
        content: response.content,
        allowedMentions: {
          users: allowedMentions,
        },
      };
    } else if (
      response.type === 'image_generation_call' &&
      response.base64Images.length > 0
    ) {
      // there are images to return from this response
      return {
        content: response.content,
        allowedMentions: {
          users: allowedMentions,
        },
        files: response.base64Images.map(
          (base64Image, index) =>
            new AttachmentBuilder(Buffer.from(base64Image, 'base64'), {
              name: `rooivalk_${index}.jpeg`,
            }),
        ),
        embeds: response.base64Images.map(
          (_, index) =>
            new EmbedBuilder({
              image: {
                url: `attachment://rooivalk_${index}.jpeg`,
              },
            }),
        ),
      };
    }

    return {
      content: this.getRooivalkResponse('error'),
    };
  }

  public buildImageReply(prompt: string, base64Image: string) {
    return {
      files: [
        new AttachmentBuilder(Buffer.from(base64Image, 'base64'), {
          name: 'rooivalk.jpeg',
        }),
      ],
      embeds: [
        new EmbedBuilder({
          title: 'Image by @rooivalk',
          description: prompt,
          image: {
            url: 'attachment://rooivalk.jpeg',
          },
        }),
      ],
    };
  }

  public async getGuildEventsBetween(
    start: Date,
    end: Date,
  ): Promise<{ name: string; date: Date }[]> {
    try {
      const guild = await this._discordClient.guilds.fetch(
        process.env.DISCORD_GUILD_ID!,
      );
      const events = await guild.scheduledEvents.fetch();
      return Array.from(events.values())
        .filter((event) => {
          const date = event.scheduledStartAt;
          return date && date >= start && date < end;
        })
        .map((event) => ({ name: event.name, date: event.scheduledStartAt! }));
    } catch (error) {
      console.error('Error fetching scheduled events:', error);
      return [];
    }
  }

  public async cacheGuildEmojis() {
    try {
      const guild = await this._discordClient.guilds.fetch(
        process.env.DISCORD_GUILD_ID!,
      );
      const emojis = await guild.emojis.fetch();
      this._allowedEmojis = emojis
        .filter((emoji) => emoji.name !== null)
        .map((emoji) => formatEmojiEntry(emoji.name!, emoji.toString()));
    } catch (error) {
      console.error('Error caching guild emojis:', error);
    }
  }

  public async getMessageChain(
    currentMessage: Message<boolean>,
  ): Promise<MessageInChain[]> {
    const messageChain: MessageInChain[] = [];

    try {
      // if the current message is a reply
      if (currentMessage.reference && currentMessage.reference.messageId) {
        // fetch the referenced message
        let referencedMessage = await currentMessage.channel.messages.fetch(
          currentMessage.reference.messageId,
        );
        const tempChain: MessageInChain[] = [];

        // while there are replies in the chain with content / attachments
        while (referencedMessage) {
          const parsedMessage = parseMessageInChain(
            referencedMessage,
            this._discordClient.user?.id,
          );
          if (parsedMessage) {
            tempChain.push(parsedMessage);
          }

          // if the current referenced message has a reference
          if (
            referencedMessage.reference &&
            referencedMessage.reference.messageId
          ) {
            try {
              // fetch the next referenced message
              referencedMessage =
                await referencedMessage.channel.messages.fetch(
                  referencedMessage.reference.messageId,
                );
            } catch (error) {
              console.error('Error fetching message chain:', error);
              break;
            }
          } else {
            // no more references, end of chain.
            break;
          }
        }

        // reverse the temp chain in chronological order and add it to the message chain
        messageChain.push(...tempChain.reverse());
      }
    } catch (error) {
      console.error('Error fetching message chain:', error);
    }

    // deliberately omit the current message from the chain
    return messageChain;
  }

  public async registerSlashCommands(): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(
      process.env.DISCORD_TOKEN!,
    );

    try {
      const commands = Object.keys(DISCORD_COMMAND_DEFINITIONS)
        .map((key) => {
          const def = DISCORD_COMMAND_DEFINITIONS[key];
          if (!def) {
            return false;
          }

          const builder = new SlashCommandBuilder();
          builder.setName(key);
          builder.setDescription(def.description);

          def.parameters.forEach((param) => {
            builder.addStringOption((option) => {
              const commandOption = option
                .setName(param.name)
                .setDescription(param.description)
                .setRequired(param.required);

              if (param.choices) {
                commandOption.addChoices(param.choices);
              }

              return commandOption;
            });
          });

          return builder.toJSON();
        })
        .filter(Boolean);

      await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_APP_ID!,
          process.env.DISCORD_GUILD_ID!,
        ),
        { body: commands },
      );
      console.log('Successfully registered slash commands.');
    } catch (error) {
      console.error('Error registering slash command:', error);
    }
  }

  public async buildMessageChainFromMessage(
    currentMessage: Message<boolean>,
  ): Promise<MessageInChain[] | null> {
    // get the message chain for the current message
    const messageChain = await this.getMessageChain(currentMessage);

    if (messageChain.length === 0) {
      return null;
    }

    return messageChain;
  }

  public async buildMessageChainFromThreadMessage(
    message: Message<boolean>,
  ): Promise<MessageInChain[] | null> {
    if (message.channel.isThread()) {
      const thread = message.channel;

      try {
        // Get the thread starter message
        const starterMessage = await thread.fetchStarterMessage();
        if (!starterMessage) {
          return null;
        }

        // Build the message chain from the starter message (gets context before thread)
        const preThreadContext =
          await this.buildMessageChainFromMessage(starterMessage);

        // Parse the starter message itself
        const starterParsed = parseMessageInChain(
          starterMessage,
          this._discordClient.user?.id,
        );

        // Fetch all thread messages
        const threadMessages = await thread.messages.fetch();
        const messages = Array.from(threadMessages.values());

        // Process thread messages in chronological order
        const threadParsed: MessageInChain[] = [];
        messages.reverse().forEach((msg) => {
          const msgInChain = parseMessageInChain(
            msg,
            this._discordClient.user?.id,
          );
          if (msgInChain) {
            threadParsed.push(msgInChain);
          }
        });

        // Combine all parts: pre-thread context + starter message + thread messages
        const result: MessageInChain[] = [
          ...(preThreadContext ?? []),
          ...(starterParsed ? [starterParsed] : []),
          ...threadParsed,
        ];

        return result.length > 0 ? result : null;
      } catch (error) {
        console.error('Error building thread message chain:', error);
        return null;
      }
    }

    return null;
  }

  public setupMentionRegex(): void {
    if (this._discordClient.user?.id) {
      this._mentionRegex = new RegExp(
        userMention(this._discordClient.user.id),
        'g',
      );
    }
  }

  public on<K extends keyof ClientEvents>(
    event: K,
    listener: (...args: ClientEvents[K]) => void,
  ): void {
    this._discordClient.on(event, listener);
  }

  public once<K extends keyof ClientEvents>(
    event: K,
    listener: (...args: ClientEvents[K]) => void,
  ): void {
    this._discordClient.once(event, listener);
  }

  public async login(): Promise<void> {
    await this._discordClient.login(process.env.DISCORD_TOKEN);
  }
}

export default DiscordService;
