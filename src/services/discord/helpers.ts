import type { Message } from 'discord.js';
import type { MessageInChain } from '../../types.ts';

export const parseMessageInChain = (
  message: Message<boolean>,
  discordClientId: string | undefined,
): MessageInChain | null => {
  const hasAttachments = message.attachments.size > 0;
  const trimmedContent = message.content.trim();
  const hasContent = trimmedContent.length > 0;
  const isRooivalkMessage = message.author.id === discordClientId;

  // Skip messages that have neither content nor attachments
  if (!hasContent && !hasAttachments) {
    return null;
  }

  return {
    author: isRooivalkMessage ? 'rooivalk' : message.author.displayName,
    content: hasContent ? trimmedContent : '',
    attachmentUrls: hasAttachments
      ? message.attachments.map((attachment) => attachment.url)
      : [],
  };
};

export const formatEmojiEntry = (name: string, tag: string): string =>
  `:${name}: → ${tag}`;

export const formatMessageInChain = (message: MessageInChain): string => {
  const content =
    message.content && message.content.length > 0
      ? message.content
      : '[no content]';

  let entry = `- ${message.author}: ${content}`;

  if (message.attachmentUrls.length > 0) {
    const formattedAttachments = message.attachmentUrls.join(', ');
    entry = `${entry} Attachments: ${formattedAttachments}`;
  }

  return entry;
};
