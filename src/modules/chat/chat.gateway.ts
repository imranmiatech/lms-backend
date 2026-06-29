import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import * as jwt from 'jsonwebtoken';

import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { WsAuthGuard } from './guards/ws-auth.guard';
import type {
  AuthenticatedSocket,
  WsJoinLeavePayload,
  WsMarkAsReadPayload,
  WsSendMessagePayload,
  WsTypingPayload,
} from './interfaces/chat.interfaces';
import { MessageType } from '@prisma/client';

interface JwtUserPayload {
  userId: string;
  email: string;
  role: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Tighten this to your frontend URL in production
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatPresenceService: ChatPresenceService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Lifecycle Hooks
  // ─────────────────────────────────────────────────────────────────────────

  afterInit() {
    this.logger.log('ChatGateway initialized');
  }

  /**
   * On connection: verify JWT from handshake, attach user, log connected client.
   */
  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('No token provided');
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET!,
      ) as JwtUserPayload;

      client.user = decoded;
      const connectionCount = this.chatPresenceService.addConnection(
        decoded.userId,
        client.id,
      );

      this.logger.log(
        `Client connected: ${client.id} | User: ${decoded.email} (${decoded.role})`,
      );

      client.emit('presenceSnapshot', {
        onlineUserIds: this.chatPresenceService.getOnlineUserIds(),
      });

      if (connectionCount === 1) {
        this.server.emit('userPresence', {
          userId: decoded.userId,
          isOnline: true,
        });
      }
    } catch {
      this.logger.warn(`Unauthorized connection attempt: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.user?.userId) {
      const remainingConnections = this.chatPresenceService.removeConnection(
        client.user.userId,
        client.id,
      );

      if (remainingConnections === 0) {
        this.server.emit('userPresence', {
          userId: client.user.userId,
          isOnline: false,
        });
      }
    }

    this.logger.log(
      `Client disconnected: ${client.id}${client.user ? ` | User: ${client.user.email}` : ''}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Room Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Client joins a conversation room.
   * Only participants of the conversation can join.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsJoinLeavePayload,
  ) {
    try {
      await this.chatService.getConversationById(
        payload.conversationId,
        client.user.userId,
      );
      await client.join(payload.conversationId);
      this.logger.log(
        `User ${client.user.email} joined room: ${payload.conversationId}`,
      );
      return {
        event: 'joinedConversation',
        data: { conversationId: payload.conversationId },
      };
    } catch (error: unknown) {
      throw new WsException(
        this.getErrorMessage(error, 'Could not join conversation'),
      );
    }
  }

  /**
   * Client leaves a conversation room.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('leaveConversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsJoinLeavePayload,
  ) {
    await client.leave(payload.conversationId);
    this.logger.log(
      `User ${client.user.email} left room: ${payload.conversationId}`,
    );
    return {
      event: 'leftConversation',
      data: { conversationId: payload.conversationId },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Messaging
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Real-time message send.
   * Broadcasts the new message to all participants in the room.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsSendMessagePayload,
  ) {
    try {
      const message = await this.chatService.sendMessage(
        payload.conversationId,
        client.user.userId,
        {
          content: payload.content,
          messageType: payload.messageType ?? MessageType.TEXT,
          fileUrl: payload.fileUrl,
        },
      );

      // Broadcast to all sockets in the conversation room (including sender)
      this.server.to(payload.conversationId).emit('newMessage', message);

      return { event: 'messageSent', data: message };
    } catch (error: unknown) {
      throw new WsException(
        this.getErrorMessage(error, 'Failed to send message'),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Typing Indicators
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Broadcast typing indicator to other participants in the room.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsTypingPayload,
  ) {
    // Broadcast to everyone in room EXCEPT the sender
    client.to(payload.conversationId).emit('userTyping', {
      userId: client.user.userId,
      email: client.user.email,
      conversationId: payload.conversationId,
    });
  }

  /**
   * Broadcast typing stopped indicator.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsTypingPayload,
  ) {
    client.to(payload.conversationId).emit('userStoppedTyping', {
      userId: client.user.userId,
      conversationId: payload.conversationId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read Receipts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Mark conversation as read and notify other participants.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: WsMarkAsReadPayload,
  ) {
    try {
      await this.chatService.markAsRead(
        payload.conversationId,
        client.user.userId,
      );

      // Notify other participants that this user has read the messages
      client.to(payload.conversationId).emit('messageRead', {
        conversationId: payload.conversationId,
        userId: client.user.userId,
        readAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      throw new WsException(
        this.getErrorMessage(error, 'Failed to mark as read'),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Gateway Helper (called by ChatController after REST send)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a new message event to a room from outside the gateway (e.g., REST controller).
   */
  emitNewMessage(conversationId: string, message: any) {
    this.server.to(conversationId).emit('newMessage', message);
  }

  private extractToken(client: AuthenticatedSocket): string | undefined {
    const auth = client.handshake?.auth as Record<string, unknown> | undefined;
    const authToken = auth?.token;

    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const authHeader = client.handshake?.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }

    return undefined;
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof WsException) {
      const wsError = error.getError();
      if (typeof wsError === 'string') {
        return wsError;
      }
    }

    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }

    return fallback;
  }
}
