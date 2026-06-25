import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';

import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateNotificationDto,
  NotificationAudience,
  NotificationQueryDto,
} from './dto/notification.dto';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  async create(dto: CreateNotificationDto) {
    const userIds = await this.resolveAudienceUserIds(dto);

    if (userIds.length === 0) {
      return {
        success: true,
        message: 'No matching users found',
        count: 0,
        data: [],
      };
    }

    const deliveredAt = new Date();
    const notifications = await this.prisma.$transaction(
      userIds.map((userId) =>
        this.prisma.notification.create({
          data: {
            userId,
            type: dto.type,
            title: dto.title,
            body: dto.body,
            data: dto.data as Prisma.InputJsonValue | undefined,
            targetUrl: dto.targetUrl,
            deliveredAt,
          },
        }),
      ),
    );

    await Promise.all(
      notifications.map((notification) =>
        this.emitNotificationCreated(notification.userId, notification),
      ),
    );

    return {
      success: true,
      message: 'Notification created successfully',
      count: userIds.length,
      data: notifications,
    };
  }

  async createForUser(
    userId: string,
    payload: Omit<CreateNotificationDto, 'audience' | 'role' | 'userId' | 'userIds'>,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data as Prisma.InputJsonValue | undefined,
        targetUrl: payload.targetUrl,
        deliveredAt: new Date(),
      },
    });

    await this.emitNotificationCreated(userId, notification);

    return notification;
  }

  async findMine(userId: string, query: NotificationQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const skip = (page - 1) * limit;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(typeof query.isRead === 'boolean' && { isRead: query.isRead }),
      ...(query.type && { type: query.type }),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        unreadCount,
      },
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { success: true, data: { unreadCount: count } };
  }

  async markOneAsRead(userId: string, notificationId: string) {
    const notification = await this.getOwnedNotification(userId, notificationId);

    if (notification.isRead) {
      return {
        success: true,
        message: 'Notification already read',
        data: notification,
      };
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    this.notificationGateway.emitNotificationRead(userId, updated);
    await this.emitUnreadCount(userId);

    return {
      success: true,
      message: 'Notification marked as read',
      data: updated,
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    this.notificationGateway.emitAllNotificationsRead(userId, result.count);
    await this.emitUnreadCount(userId);

    return {
      success: true,
      message: 'All notifications marked as read',
      data: { updatedCount: result.count },
    };
  }

  async deleteMine(userId: string, notificationId: string) {
    await this.getOwnedNotification(userId, notificationId);

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    this.notificationGateway.emitNotificationDeleted(userId, notificationId);
    await this.emitUnreadCount(userId);

    return { success: true, message: 'Notification deleted successfully' };
  }

  async deleteAllMine(userId: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });

    this.notificationGateway.emitAllNotificationsDeleted(userId, result.count);
    await this.emitUnreadCount(userId);

    return {
      success: true,
      message: 'All notifications deleted successfully',
      data: { deletedCount: result.count },
    };
  }

  async deleteByAdmin(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({ where: { id: notificationId } });

    this.notificationGateway.emitNotificationDeleted(
      notification.userId,
      notificationId,
    );
    await this.emitUnreadCount(notification.userId);

    return { success: true, message: 'Notification deleted successfully' };
  }

  private async emitNotificationCreated(userId: string, notification: any) {
    this.notificationGateway.emitNewNotification(userId, notification);
    await this.emitUnreadCount(userId);
  }

  private async emitUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    this.notificationGateway.emitUnreadCount(userId, unreadCount);
  }

  private async resolveAudienceUserIds(dto: CreateNotificationDto) {
    if (dto.audience === NotificationAudience.USER) {
      const ids = Array.from(
        new Set([...(dto.userIds ?? []), ...(dto.userId ? [dto.userId] : [])]),
      );

      if (ids.length === 0) {
        throw new BadRequestException('userId or userIds is required');
      }

      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });

      if (users.length !== ids.length) {
        throw new NotFoundException('One or more target users were not found');
      }

      return users.map((user) => user.id);
    }

    if (dto.audience === NotificationAudience.ROLE) {
      if (!dto.role) {
        throw new BadRequestException('role is required');
      }

      return this.findUserIdsByRole(dto.role);
    }

    if (dto.audience === NotificationAudience.ALL) {
      const users = await this.prisma.user.findMany({
        select: { id: true },
      });
      return users.map((user) => user.id);
    }

    throw new BadRequestException('Invalid notification audience');
  }

  private async findUserIdsByRole(role: Role) {
    const users = await this.prisma.user.findMany({
      where: { role },
      select: { id: true },
    });

    return users.map((user) => user.id);
  }

  private async getOwnedNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You cannot access this notification');
    }

    return notification;
  }
}
