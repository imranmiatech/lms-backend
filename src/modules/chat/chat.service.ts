import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageType, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3StorageService } from '../common/s3/s3.service';
import { ChatPresenceService } from './chat-presence.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto, EditMessageDto } from './dto/send-message.dto';
import { ChatQueryDto } from './dto/chat-query.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
    private readonly chatPresenceService: ChatPresenceService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Conversations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find or create a 1-on-1 conversation between two users.
   * If a conversation already exists between them, return the existing one.
   */
  async findOrCreateConversation(
    currentUserId: string,
    role: Role | undefined,
    dto: CreateConversationDto,
  ) {
    this.assertReadOnlyAdmin(role);

    const { participantId } = dto;

    if (currentUserId === participantId) {
      throw new ForbiddenException('You cannot start a conversation with yourself');
    }

    // Check if the other user exists
    const otherUser = await this.prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true, fullName: true, email: true, role: true },
    });

    if (!otherUser) {
      throw new NotFoundException('User not found');
    }

    // Check for existing 1-on-1 conversation between both users
    const existing = await this.prisma.conversation.findFirst({
      where: {
        participants: {
          every: {
            userId: { in: [currentUserId, participantId] },
          },
        },
        AND: [
          { participants: { some: { userId: currentUserId } } },
          { participants: { some: { userId: participantId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                profile: { select: { avatarUrl: true } },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (existing) {
      return {
        conversation: this.attachPresenceToConversation(existing),
        isNew: false,
      };
    }

    // Create new conversation with both participants
    const conversation = await this.prisma.conversation.create({
      data: {
        participants: {
          create: [{ userId: currentUserId }, { userId: participantId }],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                profile: { select: { avatarUrl: true } },
              },
            },
          },
        },
        messages: true,
      },
    });

    return {
      conversation: this.attachPresenceToConversation(conversation),
      isNew: true,
    };
  }

  /**
   * Get all conversations for a user, ordered by most recent message.
   */
  async getMyConversations(userId: string, role?: Role) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        ...(role === Role.ADMIN
          ? {}
          : {
              participants: { some: { userId } },
            }),
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                profile: { select: { avatarUrl: true } },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          where: { isDeleted: false },
          select: {
            id: true,
            content: true,
            messageType: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Admin can audit all chats without joining them, so unread counts do not apply.
    if (role === Role.ADMIN) {
      return conversations.map((conversation) => ({
        ...this.attachPresenceToConversation(conversation),
        unreadCount: 0,
      }));
    }

    // Enrich each conversation with unread count for the current user
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const participant = conv.participants.find((p) => p.userId === userId);
        const lastReadAt = participant?.lastReadAt;

        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            isDeleted: false,
            createdAt: lastReadAt ? { gt: lastReadAt } : undefined,
          },
        });

        return {
          ...this.attachPresenceToConversation(conv),
          unreadCount,
        };
      }),
    );

    return enriched;
  }

  /**
   * Get a single conversation by ID — validates that the requester is a participant.
   */
  async getConversationById(
    conversationId: string,
    userId: string,
    role?: Role,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                profile: { select: { avatarUrl: true } },
              },
            },
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    if (role === Role.ADMIN) {
      return this.attachPresenceToConversation(conversation);
    }

    const isParticipant = conversation.participants.some(
      (p) => p.userId === userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    return this.attachPresenceToConversation(conversation);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Messages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a message to a conversation.
   * Returns the full message with sender info for broadcasting.
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    role: Role | undefined,
    dto: SendMessageDto,
    file?: any,
  ) {
    this.assertReadOnlyAdmin(role);

    // Ensure the sender is a participant
    await this._assertParticipant(conversationId, senderId);

    const upload = file ? await this.uploadChatAttachment(file) : null;

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: dto.content,
        messageType: dto.messageType ?? MessageType.TEXT,
        fileUrl: upload?.url ?? dto.fileUrl,
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            profile: { select: { avatarUrl: true } },
          },
        },
      },
    });

    // Bump conversation updatedAt for ordering
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  private uploadChatAttachment(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/chat-attachments',
      resourceType: 'auto',
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
      maxBytes: 20 * 1024 * 1024,
    });
  }

  /**
   * Get paginated messages for a conversation using cursor-based pagination.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    role: Role | undefined,
    query: ChatQueryDto,
  ) {
    await this._assertReadAccess(conversationId, userId, role);

    const limit = query.limit ?? 30;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
        ...(query.cursor && {
          createdAt: { lt: (await this._getMessageDate(query.cursor)) },
        }),
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            profile: { select: { avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // fetch one extra to determine hasMore
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;

    return {
      messages: data.reverse(), // return in chronological order
      hasMore,
      nextCursor: hasMore ? data[0].id : null,
    };
  }

  /**
   * Edit the content of a message. Only the sender can edit.
   */
  async editMessage(
    messageId: string,
    userId: string,
    role: Role | undefined,
    dto: EditMessageDto,
  ) {
    this.assertReadOnlyAdmin(role);

    const message = await this._findMessage(messageId);

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content, isEdited: true },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            profile: { select: { avatarUrl: true } },
          },
        },
      },
    });
  }

  /**
   * Soft-delete a message. Only the sender can delete.
   */
  async deleteMessage(
    messageId: string,
    userId: string,
    role: Role | undefined,
  ) {
    this.assertReadOnlyAdmin(role);

    const message = await this._findMessage(messageId);

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, content: 'This message was deleted' },
    });
  }

  /**
   * Mark a conversation as read by updating lastReadAt for the current user.
   */
  async markAsRead(
    conversationId: string,
    userId: string,
    role?: Role,
  ) {
    this.assertReadOnlyAdmin(role);

    await this._assertParticipant(conversationId, userId);

    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { lastReadAt: new Date() },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async _assertParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException('You are not part of this conversation');
    }
    return participant;
  }

  private async _assertReadAccess(
    conversationId: string,
    userId: string,
    role?: Role,
  ) {
    if (role === Role.ADMIN) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      return;
    }

    await this._assertParticipant(conversationId, userId);
  }

  private assertReadOnlyAdmin(role?: Role) {
    if (role === Role.ADMIN) {
      throw new ForbiddenException('Admins have read-only access to chats');
    }
  }

  private async _findMessage(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.isDeleted) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  private async _getMessageDate(messageId: string): Promise<Date> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });
    if (!msg) throw new NotFoundException('Cursor message not found');
    return msg.createdAt;
  }

  private attachPresenceToConversation<T extends { participants: any[] }>(
    conversation: T,
  ) {
    return {
      ...conversation,
      participants: conversation.participants.map((participant) => {
        const isOnline = this.chatPresenceService.isUserOnline(
          participant.userId,
        );

        return {
          ...participant,
          isOnline,
          user: participant.user
            ? {
                ...participant.user,
                isOnline,
              }
            : participant.user,
        };
      }),
    };
  }
}
