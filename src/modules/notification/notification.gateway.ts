import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import { Notification } from '@prisma/client';
import { WsAuthGuard } from '../chat/guards/ws-auth.guard';

type NotificationSocket = Socket & {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
};

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  afterInit() {
    this.logger.log('NotificationGateway initialized');
  }

  handleConnection(client: NotificationSocket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('No token provided');
      }

      client.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
        userId: string;
        email: string;
        role: string;
      };

      client.join(this.userRoom(client.user.userId));
      this.logger.log(
        `Notification socket connected: ${client.id} | ${client.user.email}`,
      );
    } catch {
      this.logger.warn(`Unauthorized notification socket: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: NotificationSocket) {
    this.logger.log(
      `Notification socket disconnected: ${client.id}${client.user ? ` | ${client.user.email}` : ''}`,
    );
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('notifications:join')
  async joinOwnRoom(@ConnectedSocket() client: NotificationSocket) {
    if (!client.user) {
      throw new WsException('Unauthorized');
    }

    await client.join(this.userRoom(client.user.userId));

    return {
      event: 'notifications:joined',
      data: { userId: client.user.userId },
    };
  }

  emitNewNotification(userId: string, notification: Notification) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:new', notification);
  }

  emitUnreadCount(userId: string, unreadCount: number) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:unread-count', { unreadCount });
  }

  emitNotificationRead(userId: string, notification: Notification) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:read', notification);
  }

  emitAllNotificationsRead(userId: string, updatedCount: number) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:read-all', { updatedCount });
  }

  emitNotificationDeleted(userId: string, notificationId: string) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:deleted', { notificationId });
  }

  emitAllNotificationsDeleted(userId: string, deletedCount: number) {
    this.server
      ?.to(this.userRoom(userId))
      .emit('notification:deleted-all', { deletedCount });
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private extractToken(client: NotificationSocket): string | undefined {
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
}
