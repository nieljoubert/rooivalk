import {
  vi,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'vitest';
import { Collection, Events as DiscordEvents } from 'discord.js';
import type {
  Attachment,
  Message,
  ChatInputCommandInteraction,
  ThreadChannel,
} from 'discord.js';

import { YR_COORDINATES } from '@/constants';
import { silenceConsole } from '@/test-utils/consoleMocks';
import { createMockMessage } from '@/test-utils/createMockMessage';
import { MOCK_CONFIG, MOCK_ENV } from '@/test-utils/mock';

import { buildPromptAuthor } from './helpers';

const VALID_CITY_NAMES = Object.values(YR_COORDINATES).map((loc) => loc.name);
const CITY_COUNT = Object.keys(YR_COORDINATES).length;

let restoreConsole: () => void;

beforeAll(() => {
  restoreConsole = silenceConsole({
    ignoreErrors: ['OpenAI error!', 'Startup channel ID not set', 'blocked'],
    ignoreLogs: ['🤖 Logged in as', 'Successfully registered slash commands.'],
  });
});

afterAll(() => {
  restoreConsole();
});

import Rooivalk from '.';

// Create mock instances using vi.mocked
const mockDiscordService = vi.mocked({
  mentionRegex: new RegExp(`<@test-bot-id>`, 'g'),
  client: {
    user: { id: 'test-bot-id', tag: 'TestBot#0000' },
    channels: { fetch: vi.fn() },
  },
  allowedEmojis: [],
  startupChannelId: 'test-startup-channel-id',
  getMessageChain: vi.fn(),
  buildMessageReply: vi.fn().mockResolvedValue({}),
  buildImageReply: vi.fn().mockReturnValue({ embeds: [], files: [] }),
  chunkContent: vi.fn(),
  getRooivalkResponse: vi.fn().mockReturnValue('Error!'),
  getGuildEventsBetween: vi.fn(),
  fetchScheduledEventsBetween: vi.fn(),
  buildMessageChainFromMessage: vi.fn(),
  buildMessageChainFromThreadMessage: vi.fn(),
  registerSlashCommands: vi.fn(),
  sendReadyMessage: vi.fn(),
  setupMentionRegex: vi.fn(),
  cacheGuildEmojis: vi.fn(), // Add mock for cacheGuildEmojis
  on: vi.fn(),
  once: vi.fn(),
  login: vi.fn(),
} as any);

const mockOpenAIClient = vi.mocked({
  createResponse: vi.fn(),
  createImage: vi.fn(),
  generateThreadName: vi.fn(),
} as any);

const BOT_ID = 'test-bot-id';
const mockPeapixService = vi.mocked({
  getImage: vi.fn(),
} as any);

const mockWikimediaService = vi.mocked({
  getCityImage: vi.fn(),
} as any);

describe('Rooivalk', () => {
  let rooivalk: Rooivalk;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('process', { env: { ...MOCK_ENV } });

    mockOpenAIClient.createResponse.mockResolvedValue('Mocked AI Response');
    mockOpenAIClient.createImage.mockReset();
    mockOpenAIClient.generateThreadName.mockResolvedValue('Thread Title');
    mockPeapixService.getImage.mockResolvedValue(null);
    mockDiscordService.mentionRegex = new RegExp(`<@${BOT_ID}>`, 'g');

    Object.defineProperty(mockDiscordService, 'client', {
      get: () => ({
        user: { id: BOT_ID, tag: 'TestBot#0000' },
        channels: { fetch: vi.fn() },
      }),
      configurable: true,
    });

    rooivalk = new Rooivalk(MOCK_CONFIG, mockDiscordService, mockOpenAIClient);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('when processing a message', () => {
    describe('and buildMessageChainFromMessage returns history', () => {
      it('should pass history to OpenAI if available', async () => {
        const userMessage = createMockMessage({
          content: `<@${BOT_ID}> Hi!`,
        } as Partial<Message<boolean>>);
        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(
          '- User: Hi!\n- Rooivalk: Hello!',
        );
        await (rooivalk as any).processMessage(userMessage);
        expect(
          mockDiscordService.buildMessageChainFromMessage,
        ).toHaveBeenCalledWith(userMessage);

        const expectedAuthor = buildPromptAuthor(userMessage.author);
        expect(mockOpenAIClient.createResponse).toHaveBeenCalledWith(
          expectedAuthor,
          'Hi!',
          [],
          '- User: Hi!\n- Rooivalk: Hello!',
          null,
        );
      });
    });

    it('should include allowed text attachments when prompting OpenAI', async () => {
      const attachment = {
        url: 'https://cdn.discordapp.com/attachments/file.md',
        contentType: 'text/markdown',
        name: 'file.md',
      } as unknown as Attachment;

      const userMessage = createMockMessage({
        content: `<@${BOT_ID}> Please review the attached notes`,
        attachments: new Collection<string, Attachment>([['1', attachment]]),
      } as Partial<Message<boolean>>);

      mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);

      await (rooivalk as any).processMessage(userMessage);

      const expectedAuthor = buildPromptAuthor(userMessage.author);

      expect(mockOpenAIClient.createResponse).toHaveBeenCalledWith(
        expectedAuthor,
        'Please review the attached notes',
        [],
        null,
        [
          {
            url: attachment.url,
            name: attachment.name,
            contentType: 'text/markdown',
            kind: 'file',
          },
        ],
      );
    });

    describe('Rooivalk private shouldProcessMessage', () => {
      it('returns true for whitelisted bot', () => {
        const allowedBotId = 'allowed-bot-id';
        // Set up environment with allowed bot ID
        vi.stubGlobal('process', {
          env: { ...MOCK_ENV, DISCORD_ALLOWED_APPS: allowedBotId },
        });

        // Create new instance with updated environment
        const testRooivalk = new Rooivalk(
          MOCK_CONFIG,
          mockDiscordService,
          mockOpenAIClient,
        );

        const msg = Object.assign(createMockMessage(), {
          author: { id: allowedBotId, bot: true } as any,
          guild: { id: 'guild-id' } as any,
        });
        // @ts-expect-error: testing private method
        expect(testRooivalk.shouldProcessMessage(msg, 'guild-id')).toBe(true);
      });

      it('returns false for non-whitelisted bot', () => {
        const msg = Object.assign(createMockMessage(), {
          author: { id: 'not-allowed-bot-id', bot: true } as any,
          guild: { id: 'guild-id' } as any,
        });
        // @ts-expect-error: testing private method
        expect(rooivalk.shouldProcessMessage(msg, 'guild-id')).toBe(false);
      });

      it('returns false for wrong guild', () => {
        const allowedBotId = 'allowed-bot-id';
        // Set up environment with allowed bot ID
        vi.stubGlobal('process', {
          env: { ...MOCK_ENV, DISCORD_ALLOWED_APPS: allowedBotId },
        });

        // Create new instance with updated environment
        const testRooivalk = new Rooivalk(
          MOCK_CONFIG,
          mockDiscordService,
          mockOpenAIClient,
        );

        const msg = Object.assign(createMockMessage(), {
          author: { id: allowedBotId, bot: true } as any,
          guild: { id: 'other-guild' } as any,
        });
        // @ts-expect-error: testing private method
        expect(testRooivalk.shouldProcessMessage(msg, 'guild-id')).toBe(false);
      });

      it('returns true for a user (not a bot)', () => {
        const msg = Object.assign(createMockMessage(), {
          author: { id: 'user-id', bot: false } as any,
          guild: { id: 'guild-id' } as any,
        });
        // @ts-expect-error: testing private method
        expect(rooivalk.shouldProcessMessage(msg, 'guild-id')).toBe(true);
      });
    });

    describe('and buildMessageChainFromMessage returns null', () => {
      it('should use message content if no history is available', async () => {
        const userMessage = createMockMessage({
          content: `<@${BOT_ID}> Hello bot!`,
        } as Partial<Message<boolean>>);
        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        await (rooivalk as any).processMessage(userMessage);

        const expectedAuthor = buildPromptAuthor(userMessage.author);
        expect(mockOpenAIClient.createResponse).toHaveBeenCalledWith(
          expectedAuthor,
          'Hello bot!',
          [],
          null,
          null,
        );
      });
    });

    describe('and OpenAI returns null', () => {
      it('should reply with error message if OpenAI response is null', async () => {
        const userMessage = createMockMessage({
          content: `<@${BOT_ID}> Fail!`,
        } as Partial<Message<boolean>>);
        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        mockOpenAIClient.createResponse.mockResolvedValue(null);
        await (rooivalk as any).processMessage(userMessage);
        expect(userMessage.reply).toHaveBeenCalledWith('Error!');
      });
    });

    describe('and OpenAI throws an error', () => {
      it('should reply with error message and error details if OpenAI throws', async () => {
        const userMessage = createMockMessage({
          content: `<@${BOT_ID}> Fail!`,
        } as Partial<Message<boolean>>);
        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        mockOpenAIClient.createResponse.mockRejectedValue(
          new Error('OpenAI error!'),
        );
        await (rooivalk as any).processMessage(userMessage);
        expect(userMessage.reply).toHaveBeenCalledWith(
          expect.stringContaining('OpenAI error!'),
        );
      });
    });
  });

  describe('when sending a message to the startup channel', () => {
    describe('and the channel is available and text-based', () => {
      it('should send OpenAI response to startup channel', async () => {
        mockOpenAIClient.createResponse.mockResolvedValue('Startup response');
        const mockChannel = { isTextBased: () => true, send: vi.fn() };
        // Patch the client getter to return a channels.fetch mock for this test
        Object.defineProperty(mockDiscordService, 'client', {
          get: () => ({
            user: { id: BOT_ID, tag: 'TestBot#0000' },
            channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
          }),
          configurable: true,
        });
        // Ensure buildMessageReply returns a valid message object
        mockDiscordService.buildMessageReply.mockResolvedValue({
          content: 'test',
        });
        await rooivalk.sendMessageToChannel(
          'startup-channel-id',
          'Hello startup!',
        );
        expect(mockChannel.send).toHaveBeenCalled();
      });
    });

    describe('and the startup channel is not set', () => {
      it('should return null and log error if startup channel is not set', async () => {
        Object.defineProperty(mockDiscordService, 'startupChannelId', {
          get: () => undefined,
          configurable: true,
        });
        const result = await rooivalk.sendMessageToChannel(
          'startup-channel-id',
          'Hello startup!',
        );
        expect(result).toBeNull();
      });
    });

    describe('and the channel is not text-based', () => {
      it('should return null and log error if channel is not text-based', async () => {
        mockOpenAIClient.createResponse.mockResolvedValue('Startup response');
        const mockChannel = { isTextBased: () => false, send: vi.fn() };
        Object.defineProperty(mockDiscordService, 'client', {
          get: () => ({
            user: { id: BOT_ID, tag: 'TestBot#0000' },
            channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
          }),
          configurable: true,
        });
        const result = await rooivalk.sendMessageToChannel(
          'startup-channel-id',
          'Hello startup!',
        );
        expect(result).toBeNull();
      });
    });
  });

  describe('when handling an image command', () => {
    it('should send image when OpenAI returns data', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('cat') },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      mockOpenAIClient.createImage.mockResolvedValue('img');
      mockDiscordService.buildImageReply.mockReturnValue({
        embeds: ['e'],
        files: ['f'],
      });

      await (rooivalk as any).handleImageCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: ['e'],
        files: ['f'],
      });
    });

    it('should reply with error details if OpenAI throws', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('dog') },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      mockOpenAIClient.createImage.mockRejectedValue(new Error('blocked'));

      await (rooivalk as any).handleImageCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('blocked'),
        }),
      );
    });

    it('should reply with error message if OpenAI returns null', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('bird') },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      mockOpenAIClient.createImage.mockResolvedValue(null);

      await (rooivalk as any).handleImageCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Error!' });
    });
  });

  describe('when handling a weather command', () => {
    it('should reply with weather data on success', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('Dubai') },
        user: { displayName: 'TestUser' },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      const mockYrService = {
        getAllForecasts: vi.fn(),
        getForecastByLocation: vi
          .fn()
          .mockResolvedValue({ location: 'DUBAI', minTemp: 25 }),
      } as any;

      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: 'Sunny in Dubai!',
        base64Images: [],
      });

      const weatherRooivalk = new Rooivalk(
        MOCK_CONFIG,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await weatherRooivalk.handleWeatherCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Sunny in Dubai!',
      });
    });

    it('should reply with error when Yr returns null', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('Unknown') },
        user: { displayName: 'TestUser' },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      const mockYrService = {
        getAllForecasts: vi.fn(),
        getForecastByLocation: vi.fn().mockResolvedValue(null),
      } as any;

      const weatherRooivalk = new Rooivalk(
        MOCK_CONFIG,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await weatherRooivalk.handleWeatherCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Error!',
      });
    });

    it('should reply with error details when Yr throws', async () => {
      const interaction = {
        options: { getString: vi.fn().mockReturnValue('Dubai') },
        user: { displayName: 'TestUser' },
        deferReply: vi.fn(),
        editReply: vi.fn(),
      } as unknown as ChatInputCommandInteraction;

      const mockYrService = {
        getAllForecasts: vi.fn(),
        getForecastByLocation: vi
          .fn()
          .mockRejectedValue(new Error('Yr API down')),
      } as any;

      const weatherRooivalk = new Rooivalk(
        MOCK_CONFIG,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await weatherRooivalk.handleWeatherCommand(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Yr API down'),
        }),
      );
    });
  });

  describe('when sending a MOTD with weather image', () => {
    it('adds an image attachment when a feed image is available', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = ['Intro line', 'Footer line'].join('\n');
      const forecast = {
        location: 'TABLEVIEW',
        friendlyName: 'Table View, South Africa',
        minTemp: 12,
        maxTemp: 21,
        avgWindSpeed: 4,
        avgWindDirection: 'SE',
        avgHumidity: 72,
        totalPrecipitation: 0,
      };
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockPeapixService.getImage.mockResolvedValue({
        title: 'Dune Patrol',
        copyright: '© Eric Yang/Getty Image',
        pageUrl: 'https://peapix.com/bing/123',
        buffer: Buffer.from([1, 2, 3]),
      });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([forecast]),
      } as any;
      mockWikimediaService.getCityImage.mockResolvedValue({
        title: 'Table View Beach',
        cityName: 'Table View, South Africa',
        mimeType: 'image/jpeg',
        sourceUrl:
          'https://commons.wikimedia.org/wiki/File:Table_View_Beach.jpg',
        buffer: Buffer.from([4, 5, 6]),
      });

      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      expect(mockOpenAIClient.createImage).not.toHaveBeenCalled();
      expect(mockDiscordService.buildMessageReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: motdContent,
        }),
      );

      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toHaveLength(1);
      expect(sendPayload?.embeds).toHaveLength(1);
      expect(sendPayload?.embeds?.[0]?.data?.description).toContain(
        'Table View, South Africa',
      );
      expect(sendPayload?.embeds?.[0]?.data?.footer?.text).toBe(
        'Table View Beach',
      );
      // Should stop after first successful city, not try all
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(1);
      expect(mockPeapixService.getImage).not.toHaveBeenCalled();
    });

    it('succeeds on a later city after earlier cities return null', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });

      // First two cities return null (no image found), third succeeds
      mockWikimediaService.getCityImage
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          title: 'Dubai Skyline',
          cityName: 'Dubai, United Arab Emirates',
          mimeType: 'image/jpeg',
          sourceUrl:
            'https://commons.wikimedia.org/wiki/File:Dubai_Skyline.jpg',
          buffer: Buffer.from([1, 2, 3]),
        });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should stop after the third city succeeds
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(3);
      expect(mockPeapixService.getImage).not.toHaveBeenCalled();

      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toHaveLength(1);
      expect(sendPayload?.embeds).toHaveLength(1);
      expect(sendPayload?.embeds?.[0]?.data?.description).toBe(
        'Dubai, United Arab Emirates',
      );
      expect(sendPayload?.embeds?.[0]?.data?.footer?.text).toBe(
        'Dubai Skyline',
      );
    });

    it('skips image attachment when the feed has no images', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = ['Intro line', 'Footer line'].join('\n');
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockPeapixService.getImage.mockResolvedValue(null);
      mockWikimediaService.getCityImage.mockResolvedValue(null);

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      expect(mockOpenAIClient.createImage).not.toHaveBeenCalled();
      // Should try all cities before giving up
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(
        CITY_COUNT,
      );
      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toBeUndefined();
      expect(sendPayload?.embeds).toBeUndefined();
    });

    it('falls back to Peapix when Wikimedia returns null for all cities', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockWikimediaService.getCityImage.mockResolvedValue(null);
      mockPeapixService.getImage.mockResolvedValue({
        title: 'Dune Patrol',
        copyright: '© Eric Yang/Getty Image',
        pageUrl: 'https://peapix.com/bing/123',
        buffer: Buffer.from([1, 2, 3]),
      });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should try all cities before falling back to Peapix
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(
        CITY_COUNT,
      );
      expect(mockPeapixService.getImage).toHaveBeenCalledTimes(1);

      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toHaveLength(1);
      expect(sendPayload?.embeds).toHaveLength(1);
      // Peapix fallback uses Peapix title as heading, not a city name
      expect(sendPayload?.embeds?.[0]?.data?.description).toBe('Dune Patrol');
      expect(sendPayload?.embeds?.[0]?.data?.footer?.text).toBe(
        '© Eric Yang/Getty Image',
      );
    });

    it('uses "Image of the day" as heading when Peapix title is null', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockWikimediaService.getCityImage.mockResolvedValue(null);
      mockPeapixService.getImage.mockResolvedValue({
        title: null,
        copyright: '© Some Photographer',
        pageUrl: 'https://peapix.com/bing/456',
        buffer: Buffer.from([1, 2, 3]),
      });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should try all cities before falling back
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(
        CITY_COUNT,
      );

      // Heading should be "Image of the day" when Peapix title is null
      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.embeds?.[0]?.data?.description).toBe(
        'Image of the day',
      );
    });

    it('tries all cities then falls back to Peapix when Wikimedia throws for every city', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockWikimediaService.getCityImage.mockRejectedValue(
        new Error('Unexpected Wikimedia crash'),
      );
      mockPeapixService.getImage.mockResolvedValue({
        title: 'Fallback Image',
        copyright: '© Fallback',
        pageUrl: 'https://peapix.com/bing/789',
        buffer: Buffer.from([7, 8, 9]),
      });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should try every city before falling back
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(
        CITY_COUNT,
      );
      expect(mockPeapixService.getImage).toHaveBeenCalledTimes(1);

      // MOTD should still be sent with Peapix fallback image
      expect(mockChannel.send).toHaveBeenCalled();
      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toHaveLength(1);
      expect(sendPayload?.embeds).toHaveLength(1);
      // Peapix fallback uses Peapix title as heading
      expect(sendPayload?.embeds?.[0]?.data?.description).toBe(
        'Fallback Image',
      );
    });

    it('still sends MOTD without image when all cities fail and Peapix throws', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });
      mockWikimediaService.getCityImage.mockResolvedValue(null);
      mockPeapixService.getImage.mockRejectedValue(
        new Error('Peapix network failure'),
      );

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should exhaust all cities then try Peapix
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(
        CITY_COUNT,
      );
      expect(mockPeapixService.getImage).toHaveBeenCalledTimes(1);

      expect(mockChannel.send).toHaveBeenCalled();
      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.content).toBe(motdContent);
      expect(sendPayload?.files).toBeUndefined();
      expect(sendPayload?.embeds).toBeUndefined();
    });

    it('passes valid WeatherLocation objects to getCityImage', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: 'Good morning!',
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: 'Good morning!',
      });
      mockWikimediaService.getCityImage.mockResolvedValue(null);

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Every call should receive a valid WeatherLocation with name and coordinates
      for (const call of mockWikimediaService.getCityImage.mock.calls) {
        const location = call[0];
        expect(location).toHaveProperty('name');
        expect(location).toHaveProperty('latitude');
        expect(location).toHaveProperty('longitude');
        expect(VALID_CITY_NAMES).toContain(location.name);
      }
    });

    it('succeeds on a later city after earlier cities throw', async () => {
      const motdConfig = {
        ...MOCK_CONFIG,
        motd: 'Prompt {{WEATHER_FORECASTS_JSON}} {{EVENTS_JSON}}',
      };
      const motdContent = 'Good morning!';
      const mockChannel = { isTextBased: () => true, send: vi.fn() };

      Object.defineProperty(mockDiscordService, 'motdChannelId', {
        get: () => 'motd-channel-id',
        configurable: true,
      });
      Object.defineProperty(mockDiscordService, 'client', {
        get: () => ({
          user: { id: BOT_ID, tag: 'TestBot#0000' },
          channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
        }),
        configurable: true,
      });

      mockDiscordService.getGuildEventsBetween.mockResolvedValue([]);
      mockOpenAIClient.createResponse.mockResolvedValue({
        type: 'text',
        content: motdContent,
        base64Images: [],
      });
      mockDiscordService.buildMessageReply.mockReturnValue({
        content: motdContent,
      });

      // First city throws, second succeeds
      mockWikimediaService.getCityImage
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          title: 'City Photo',
          cityName: 'Dubai, United Arab Emirates',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:City_Photo.jpg',
          buffer: Buffer.from([1, 2, 3]),
        });

      const mockYrService = {
        getAllForecasts: vi.fn().mockResolvedValue([]),
      } as any;
      const motdRooivalk = new Rooivalk(
        motdConfig,
        mockDiscordService,
        mockOpenAIClient,
        mockYrService,
        mockPeapixService,
        mockWikimediaService,
      );

      await motdRooivalk.sendMotdToMotdChannel();

      // Should recover after the throw and use the successful city
      expect(mockWikimediaService.getCityImage).toHaveBeenCalledTimes(2);
      expect(mockPeapixService.getImage).not.toHaveBeenCalled();

      const sendPayload = mockChannel.send.mock.calls[0]?.[0];
      expect(sendPayload?.files).toHaveLength(1);
      expect(sendPayload?.embeds?.[0]?.data?.description).toBe(
        'Dubai, United Arab Emirates',
      );
    });
  });

  describe('when initialized', () => {
    it('should set up event handlers and call login', async () => {
      // Patch the once method to immediately call the callback for ClientReady
      mockDiscordService.once.mockImplementation(
        (event: string, cb: (client: unknown) => void) => {
          if (event === DiscordEvents.ClientReady) {
            cb(mockDiscordService.client as any);
          }
          return mockDiscordService;
        },
      );

      await rooivalk.init();

      expect(mockDiscordService.once).toHaveBeenCalled();
      expect(mockDiscordService.on).toHaveBeenCalled();
      expect(mockDiscordService.login).toHaveBeenCalled();
      expect(mockDiscordService.registerSlashCommands).toHaveBeenCalled();
      expect(mockDiscordService.sendReadyMessage).toHaveBeenCalled();
      expect(mockDiscordService.setupMentionRegex).toHaveBeenCalled();
    });
  });

  describe('thread handling', () => {
    describe('when message is sent in a thread', () => {
      it('should use thread history when processing messages in threads', async () => {
        const threadMessage = createMockMessage({
          content: 'Hello in thread',
          channel: {
            isThread: vi.fn().mockReturnValue(true),
            send: vi.fn(),
          } as any,
        } as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromThreadMessage.mockResolvedValue(
          'thread conversation history',
        );
        mockDiscordService.buildMessageReply.mockReturnValue({
          content: 'Response',
        });

        await (rooivalk as any).processMessage(threadMessage);

        expect(
          mockDiscordService.buildMessageChainFromThreadMessage,
        ).toHaveBeenCalledWith(threadMessage);
        expect(
          mockDiscordService.buildMessageChainFromMessage,
        ).not.toHaveBeenCalled();

        const expectedAuthor = buildPromptAuthor(threadMessage.author);
        expect(mockOpenAIClient.createResponse).toHaveBeenCalledWith(
          expectedAuthor,
          'Hello in thread',
          [],
          'thread conversation history',
          null,
        );
      });

      it('should send response to thread channel', async () => {
        const threadMessage = createMockMessage({
          content: 'Hello in thread',
          channel: {
            isThread: vi.fn().mockReturnValue(true),
            send: vi.fn(),
          } as any,
        } as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromThreadMessage.mockResolvedValue(
          null,
        );
        mockDiscordService.buildMessageReply.mockReturnValue({
          content: 'Response',
        });

        await rooivalk.processMessage(threadMessage);

        expect((threadMessage.channel as any).send).toHaveBeenCalled();
        expect(threadMessage.reply).not.toHaveBeenCalled();
      });
    });

    describe('when message is not in a thread', () => {
      it('should use message chain history when processing non-thread messages', async () => {
        const regularMessage = createMockMessage({
          content: 'Hello outside thread',
          channel: {
            isThread: vi.fn().mockReturnValue(false),
          } as any,
        } as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(
          'message chain history',
        );
        mockDiscordService.buildMessageReply.mockReturnValue({
          content: 'Response',
        });

        await rooivalk.processMessage(regularMessage);

        expect(
          mockDiscordService.buildMessageChainFromMessage,
        ).toHaveBeenCalledWith(regularMessage);
        expect(
          mockDiscordService.buildMessageChainFromThreadMessage,
        ).not.toHaveBeenCalled();

        const expectedAuthor = buildPromptAuthor(regularMessage.author);
        expect(mockOpenAIClient.createResponse).toHaveBeenCalledWith(
          expectedAuthor,
          'Hello outside thread',
          [],
          'message chain history',
          null,
        );
      });

      it('should send response as reply when not in thread', async () => {
        const regularMessage = createMockMessage({
          content: 'Hello outside thread',
          channel: {
            isThread: vi.fn().mockReturnValue(false),
            send: vi.fn(),
          } as any,
        } as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        mockDiscordService.buildMessageReply.mockReturnValue({
          content: 'Response',
        });

        await (rooivalk as any).processMessage(regularMessage);

        expect(regularMessage.reply).toHaveBeenCalled();
        expect((regularMessage.channel as any).send).not.toHaveBeenCalled();
      });
    });

    describe('when creating a new thread from reply', () => {
      it('should send response to newly created thread instead of original channel', async () => {
        const mockThread = {
          send: vi.fn(),
          isThread: vi.fn().mockReturnValue(true),
        } as any as ThreadChannel;

        const replyMessage = createMockMessage({
          content: 'Reply to bot message',
          channel: {
            isThread: vi.fn().mockReturnValue(false),
            send: vi.fn(),
          } as any,
        } as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(
          'conversation history',
        );
        mockDiscordService.buildMessageReply.mockReturnValue({
          content: 'Thread response',
        });

        // Test the processMessage method with targetChannel parameter
        await (rooivalk as any).processMessage(replyMessage, mockThread);

        // Should send to the thread, not reply to original message
        expect(mockThread.send).toHaveBeenCalledWith({
          content: 'Thread response',
        });
        expect(replyMessage.reply).not.toHaveBeenCalled();
        expect((replyMessage.channel as any).send).not.toHaveBeenCalled();
      });

      it('should handle errors and send to thread when targetChannel is provided', async () => {
        const mockThread = {
          send: vi.fn(),
          isThread: vi.fn().mockReturnValue(true),
        } as any as ThreadChannel;

        const replyMessage = createMockMessage({
          content: 'Reply that will cause error',
          channel: {
            isThread: vi.fn().mockReturnValue(false),
            send: vi.fn(),
          } as any,
        } as Partial<Message<boolean>>);

        mockOpenAIClient.createResponse.mockRejectedValue(
          new Error('OpenAI API error'),
        );
        mockDiscordService.getRooivalkResponse.mockReturnValue(
          'Error occurred',
        );

        await (rooivalk as any).processMessage(replyMessage, mockThread);

        // Should send error to the thread, not reply to original message
        expect(mockThread.send).toHaveBeenCalledWith(
          'Error occurred\n```OpenAI API error```',
        );
        expect(replyMessage.reply).not.toHaveBeenCalled();
        expect((replyMessage.channel as any).send).not.toHaveBeenCalled();
      });
    });

    describe('when creating a thread from a reply', () => {
      it('should store initial context when history is available', async () => {
        const mockHistory =
          '- user: Original question\n- rooivalk: Previous response';
        const mockThread = {
          id: 'new-thread-123',
          members: { add: vi.fn() },
        } as any as ThreadChannel;

        const replyMessage = createMockMessage({
          content: 'Follow-up question',
          author: { id: 'user-123', displayName: 'TestUser' },
          startThread: vi.fn().mockResolvedValue(mockThread),
        } as unknown as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(
          mockHistory,
        );
        mockOpenAIClient.generateThreadName.mockResolvedValue(
          'Discussion Thread',
        );

        const result = await rooivalk.createRooivalkThread(replyMessage);

        expect(result).toBe(mockThread);
        expect(mockOpenAIClient.generateThreadName).toHaveBeenCalledWith(
          mockHistory,
        );
        expect(replyMessage.startThread).toHaveBeenCalledWith({
          name: 'Discussion Thread',
          autoArchiveDuration: 60,
        });
        expect(mockThread.members.add).toHaveBeenCalledWith('user-123');
      });

      it('should store current message as initial context when no history is available', async () => {
        const mockThread = {
          id: 'new-thread-456',
          members: { add: vi.fn() },
        } as any as ThreadChannel;

        const replyMessage = createMockMessage({
          content: 'First message',
          author: { id: 'user-456', displayName: 'TestUser' },
          startThread: vi.fn().mockResolvedValue(mockThread),
        } as unknown as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        mockOpenAIClient.generateThreadName.mockResolvedValue('New Discussion');

        const result = await rooivalk.createRooivalkThread(replyMessage);

        expect(result).toBe(mockThread);
        expect(mockOpenAIClient.generateThreadName).toHaveBeenCalledWith(
          'First message',
        );
      });

      it('should handle thread creation failure gracefully', async () => {
        const replyMessage = createMockMessage({
          content: 'Message',
          author: { id: 'user-789' },
          startThread: vi
            .fn()
            .mockRejectedValue(new Error('Thread creation failed')),
        } as unknown as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(
          'some history',
        );
        mockOpenAIClient.generateThreadName.mockResolvedValue('Thread Name');

        await expect(
          rooivalk.createRooivalkThread(replyMessage),
        ).rejects.toThrow('Thread creation failed');
      });

      it('should use message content for thread name when history is null', async () => {
        const mockThread = {
          id: 'new-thread-789',
          members: { add: vi.fn() },
        } as any as ThreadChannel;

        const replyMessage = createMockMessage({
          content: 'Question about something',
          author: { id: 'user-789' },
          startThread: vi.fn().mockResolvedValue(mockThread),
        } as unknown as Partial<Message<boolean>>);

        mockDiscordService.buildMessageChainFromMessage.mockResolvedValue(null);
        mockOpenAIClient.generateThreadName.mockResolvedValue(
          'Generated Thread Name',
        );

        const result = await rooivalk.createRooivalkThread(replyMessage);

        expect(result).toBe(mockThread);
        expect(mockOpenAIClient.generateThreadName).toHaveBeenCalledWith(
          'Question about something',
        );
      });
    });
  });
});
