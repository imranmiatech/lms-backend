import { Logger, UseGuards } from '@nestjs/common';
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
import { Role } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import { WsAuthGuard } from '../chat/guards/ws-auth.guard';
import {
  LiveClassRoomPayloadDto,
  WsSendLiveClassMessageDto,
  WsShareLiveClassResourceDto,
  WsPresenceDto,
} from './dto/live-class-message.dto';
import { LiveClassMessageService } from './live-class-message.service';

type LiveClassSocket = Socket & {
  user: {
    userId: string;
    email: string;
    role: Role;
  };
};

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/live-class',
})
export class LiveClassMessageGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveClassMessageGateway.name);

  constructor(
    private readonly liveClassMessageService: LiveClassMessageService,
  ) {}

  afterInit() {
    this.logger.log('LiveClassMessageGateway initialized');
  }

  handleConnection(client: LiveClassSocket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new WsException('No token provided');
      }

      client.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
        userId: string;
        email: string;
        role: Role;
      };

      this.logger.log(
        `Live class socket connected: ${client.id} | ${client.user.email}`,
      );
    } catch {
      this.logger.warn(`Unauthorized live class socket: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: LiveClassSocket) {
    this.logger.log(
      `Live class socket disconnected: ${client.id}${client.user ? ` | ${client.user.email}` : ''}`,
    );
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:join')
  async joinLiveClass(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: LiveClassRoomPayloadDto,
  ) {
    try {
      const { roomId } =
        await this.liveClassMessageService.resolveTargetAndAssertAccess(
          client.user,
          payload,
        );

      await client.join(roomId);
      client.to(roomId).emit('live-class:user-joined', {
        roomId,
        user: this.socketUser(client),
      });

      return {
        event: 'live-class:joined',
        data: {
          roomId,
        },
      };
    } catch (error) {
      throw new WsException(this.getErrorMessage(error, 'Could not join room'));
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:leave')
  async leaveLiveClass(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: LiveClassRoomPayloadDto,
  ) {
    const { roomId } =
      await this.liveClassMessageService.resolveTargetAndAssertAccess(
        client.user,
        payload,
      );

    await client.leave(roomId);
    client.to(roomId).emit('live-class:user-left', {
      roomId,
      user: this.socketUser(client),
    });

    return {
      event: 'live-class:left',
      data: {
        roomId,
      },
    };
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:message')
  async sendMessage(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: WsSendLiveClassMessageDto,
  ) {
    try {
      const { roomId } =
        await this.liveClassMessageService.resolveTargetAndAssertAccess(
          client.user,
          payload,
        );
      const message = await this.liveClassMessageService.sendSocketMessage(
        client.user,
        payload,
      );

      this.emitMessage(roomId, message);

      return {
        event: 'live-class:message-sent',
        data: message,
      };
    } catch (error) {
      throw new WsException(
        this.getErrorMessage(error, 'Could not send message'),
      );
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:resource')
  async shareResource(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: WsShareLiveClassResourceDto,
  ) {
    try {
      const { roomId } =
        await this.liveClassMessageService.resolveTargetAndAssertAccess(
          client.user,
          payload,
        );
      const message = await this.liveClassMessageService.shareSocketResource(
        client.user,
        payload,
      );

      this.emitMessage(roomId, message);

      return {
        event: 'live-class:resource-shared',
        data: message,
      };
    } catch (error) {
      throw new WsException(
        this.getErrorMessage(error, 'Could not share resource'),
      );
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:typing')
  async typing(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: LiveClassRoomPayloadDto,
  ) {
    const { roomId } =
      await this.liveClassMessageService.resolveTargetAndAssertAccess(
        client.user,
        payload,
      );

    client.to(roomId).emit('live-class:typing', {
      roomId,
      user: this.socketUser(client),
    });
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:stop-typing')
  async stopTyping(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: LiveClassRoomPayloadDto,
  ) {
    const { roomId } =
      await this.liveClassMessageService.resolveTargetAndAssertAccess(
        client.user,
        payload,
      );

    client.to(roomId).emit('live-class:stop-typing', {
      roomId,
      user: this.socketUser(client),
    });
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('live-class:presence')
  async presence(
    @ConnectedSocket() client: LiveClassSocket,
    @MessageBody() payload: WsPresenceDto,
  ) {
    const { roomId } =
      await this.liveClassMessageService.resolveTargetAndAssertAccess(
        client.user,
        payload,
      );

    client.to(roomId).emit('live-class:presence', {
      roomId,
      uid: payload.uid,
      name: payload.name,
    });
  }

  emitMessage(roomId: string, message: unknown) {
    this.server.to(roomId).emit('live-class:new-message', message);
  }

  private extractToken(client: Socket) {
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

  private socketUser(client: LiveClassSocket) {
    return {
      id: client.user.userId,
      email: client.user.email,
      role: client.user.role,
    };
  }

  private getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }

    return fallback;
  }
}
