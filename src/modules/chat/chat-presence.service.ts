import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatPresenceService {
  private readonly userSockets = new Map<string, Set<string>>();

  addConnection(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.userSockets.set(userId, sockets);
    return sockets.size;
  }

  removeConnection(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId);

    if (!sockets) {
      return 0;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.userSockets.delete(userId);
      return 0;
    }

    this.userSockets.set(userId, sockets);
    return sockets.size;
  }

  isUserOnline(userId: string) {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  getOnlineUserIds() {
    return Array.from(this.userSockets.keys());
  }
}
