import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LiveClassMessageType,
  LiveClassRoomType,
  PaymentStatus,
  PaymentType,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  LiveClassRoomPayloadDto,
  ShareLiveClassResourceDto,
  ShareLiveClassResourceUploadDto,
  WsShareLiveClassResourceDto,
} from './dto/live-class-message.dto';
import { S3StorageService } from '../common/s3/s3.service';

type CurrentUser = {
  userId: string;
  role: Role | string;
};

type LiveClassTarget =
  | {
      roomType: 'GROUP';
      courseId: string;
      curriculumIndex: number;
    }
  | {
      roomType: 'PRIVATE';
      paymentId: string;
    };

const ROOM_TYPE = {
  GROUP: 'GROUP',
  PRIVATE: 'PRIVATE',
} as const satisfies Record<string, LiveClassRoomType>;

const MESSAGE_TYPE = {
  TEXT: 'TEXT',
  RESOURCE: 'RESOURCE',
} as const satisfies Record<string, LiveClassMessageType>;

@Injectable()
export class LiveClassMessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  async getGroupMessages(
    user: CurrentUser,
    courseId: string,
    curriculumIndex: number,
    query: { cursor?: string; limit?: number },
  ) {
    await this.assertGroupAccess(user, courseId, curriculumIndex);

    return this.getMessages(
      {
        roomType: ROOM_TYPE.GROUP,
        courseId,
        curriculumIndex,
      },
      query,
    );
  }

  async sendGroupMessage(
    user: CurrentUser,
    courseId: string,
    curriculumIndex: number,
    content: string,
  ) {
    await this.assertGroupAccess(user, courseId, curriculumIndex);

    return this.createTextMessage(
      user.userId,
      {
        roomType: ROOM_TYPE.GROUP,
        courseId,
        curriculumIndex,
      },
      content,
    );
  }

  async shareGroupResource(
    user: CurrentUser,
    courseId: string,
    curriculumIndex: number,
    dto: ShareLiveClassResourceUploadDto,
    file: any,
  ) {
    await this.assertGroupAccess(user, courseId, curriculumIndex);

    return this.createUploadedResourceMessage(
      user.userId,
      {
        roomType: ROOM_TYPE.GROUP,
        courseId,
        curriculumIndex,
      },
      dto,
      file,
    );
  }

  async getPrivateMessages(
    user: CurrentUser,
    paymentId: string,
    query: { cursor?: string; limit?: number },
  ) {
    await this.assertPrivateAccess(user, paymentId);

    return this.getMessages(
      {
        roomType: ROOM_TYPE.PRIVATE,
        paymentId,
      },
      query,
    );
  }

  async sendPrivateMessage(
    user: CurrentUser,
    paymentId: string,
    content: string,
  ) {
    await this.assertPrivateAccess(user, paymentId);

    return this.createTextMessage(
      user.userId,
      {
        roomType: ROOM_TYPE.PRIVATE,
        paymentId,
      },
      content,
    );
  }

  async sharePrivateResource(
    user: CurrentUser,
    paymentId: string,
    dto: ShareLiveClassResourceUploadDto,
    file: any,
  ) {
    await this.assertPrivateAccess(user, paymentId);

    return this.createUploadedResourceMessage(
      user.userId,
      {
        roomType: ROOM_TYPE.PRIVATE,
        paymentId,
      },
      dto,
      file,
    );
  }

  async resolveTargetAndAssertAccess(
    user: CurrentUser,
    payload: LiveClassRoomPayloadDto,
  ) {
    const target = this.resolveTarget(payload);
    await this.assertAccess(user, target);

    return {
      target,
      roomId: this.buildRoomId(target),
    };
  }

  async sendSocketMessage(
    user: CurrentUser,
    payload: LiveClassRoomPayloadDto & { content: string },
  ) {
    const { target } = await this.resolveTargetAndAssertAccess(user, payload);
    return this.createTextMessage(user.userId, target, payload.content);
  }

  async shareSocketResource(
    user: CurrentUser,
    payload: WsShareLiveClassResourceDto,
  ) {
    const { target } = await this.resolveTargetAndAssertAccess(user, payload);
    return this.createResourceMessage(user.userId, target, payload);
  }

  buildRoomId(target: LiveClassTarget) {
    if (target.roomType === ROOM_TYPE.GROUP) {
      return `live-class:group:${target.courseId}:${target.curriculumIndex}`;
    }

    return `live-class:private:${target.paymentId}`;
  }

  private async getMessages(
    target: LiveClassTarget,
    query: { cursor?: string; limit?: number },
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const messages = await this.prisma.liveClassMessage.findMany({
      where: {
        ...this.targetWhere(target),
        isDeleted: false,
      },
      take: limit + 1,
      ...(query.cursor && {
        cursor: {
          id: query.cursor,
        },
        skip: 1,
      }),
      orderBy: {
        createdAt: 'desc',
      },
      select: this.messageSelect(),
    });
    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const chronologicalMessages = page.reverse();

    return {
      roomId: this.buildRoomId(target),
      messages: chronologicalMessages,
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]?.id : null,
      },
    };
  }

  private async createTextMessage(
    senderId: string,
    target: LiveClassTarget,
    content: string,
  ) {
    const normalized = content.trim();

    if (!normalized) {
      throw new BadRequestException('Message content is required');
    }

    return this.prisma.liveClassMessage.create({
      data: {
        ...this.targetData(target),
        senderId,
        messageType: MESSAGE_TYPE.TEXT,
        content: normalized,
      },
      select: this.messageSelect(),
    });
  }

  private async createResourceMessage(
    senderId: string,
    target: LiveClassTarget,
    dto: ShareLiveClassResourceDto | WsShareLiveClassResourceDto,
  ) {
    return this.prisma.liveClassMessage.create({
      data: {
        ...this.targetData(target),
        senderId,
        messageType: MESSAGE_TYPE.RESOURCE,
        content: dto.content?.trim() || null,
        resourceName: dto.resourceName,
        resourceUrl: dto.resourceUrl,
        resourceMimeType: dto.resourceMimeType ?? null,
        resourceSize: dto.resourceSize ?? null,
      },
      select: this.messageSelect(),
    });
  }

  private async createUploadedResourceMessage(
    senderId: string,
    target: LiveClassTarget,
    dto: ShareLiveClassResourceUploadDto,
    file: any,
  ) {
    const upload = await this.uploadLiveClassResourceFile(file);

    return this.prisma.liveClassMessage.create({
      data: {
        ...this.targetData(target),
        senderId,
        messageType: MESSAGE_TYPE.RESOURCE,
        content: dto.content?.trim() || null,
        resourceName: upload.originalName,
        resourceUrl: upload.url,
        resourceMimeType: upload.mimeType,
        resourceSize: this.formatBytes(upload.bytes),
      },
      select: this.messageSelect(),
    });
  }

  private uploadLiveClassResourceFile(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/live-class-resources',
      resourceType: 'auto',
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
      ],
      maxBytes: 20 * 1024 * 1024,
    });
  }

  private formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private async assertAccess(user: CurrentUser, target: LiveClassTarget) {
    if (target.roomType === ROOM_TYPE.GROUP) {
      return this.assertGroupAccess(
        user,
        target.courseId,
        target.curriculumIndex,
      );
    }

    return this.assertPrivateAccess(user, target.paymentId);
  }

  private async assertGroupAccess(
    user: CurrentUser,
    courseId: string,
    curriculumIndex: number,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        tutorId: true,
        curriculums: true,
        curriculumItems: {
          select: { id: true },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const lessonCount =
      course.curriculumItems.length > 0
        ? course.curriculumItems.length
        : course.curriculums.length;

    if (curriculumIndex < 0 || curriculumIndex >= lessonCount) {
      throw new NotFoundException('Lesson not found for this class');
    }

    if (user.role === Role.ADMIN || course.tutorId === user.userId) {
      return;
    }

    if (user.role === Role.STUDENT) {
      const enrollment = await this.prisma.courseEnrollment.findUnique({
        where: {
          courseId_studentId: {
            courseId,
            studentId: user.userId,
          },
        },
        select: { id: true },
      });

      if (enrollment) {
        return;
      }
    }

    throw new ForbiddenException('You cannot access this live class chat');
  }

  private async assertPrivateAccess(user: CurrentUser, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        type: PaymentType.PRIVATE,
        status: PaymentStatus.PAID,
      },
      select: {
        userId: true,
        tutorId: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Private class not found');
    }

    if (
      user.role === Role.ADMIN ||
      payment.tutorId === user.userId ||
      payment.userId === user.userId
    ) {
      return;
    }

    throw new ForbiddenException('You cannot access this private class chat');
  }

  private resolveTarget(payload: LiveClassRoomPayloadDto): LiveClassTarget {
    if (payload.roomType === ROOM_TYPE.GROUP) {
      if (!payload.courseId || payload.curriculumIndex === undefined) {
        throw new BadRequestException(
          'courseId and curriculumIndex are required for group class chat',
        );
      }

      return {
        roomType: ROOM_TYPE.GROUP,
        courseId: payload.courseId,
        curriculumIndex: payload.curriculumIndex,
      };
    }

    if (!payload.paymentId) {
      throw new BadRequestException(
        'paymentId is required for private class chat',
      );
    }

    return {
      roomType: ROOM_TYPE.PRIVATE,
      paymentId: payload.paymentId,
    };
  }

  private targetWhere(target: LiveClassTarget) {
    if (target.roomType === ROOM_TYPE.GROUP) {
      return {
        roomType: target.roomType,
        courseId: target.courseId,
        curriculumIndex: target.curriculumIndex,
      };
    }

    return {
      roomType: target.roomType,
      paymentId: target.paymentId,
    };
  }

  private targetData(target: LiveClassTarget) {
    if (target.roomType === ROOM_TYPE.GROUP) {
      return {
        roomType: target.roomType,
        courseId: target.courseId,
        curriculumIndex: target.curriculumIndex,
        paymentId: null,
      };
    }

    return {
      roomType: target.roomType,
      courseId: null,
      curriculumIndex: null,
      paymentId: target.paymentId,
    };
  }

  private messageSelect() {
    return {
      id: true,
      roomType: true,
      courseId: true,
      curriculumIndex: true,
      paymentId: true,
      messageType: true,
      content: true,
      resourceName: true,
      resourceUrl: true,
      resourceMimeType: true,
      resourceSize: true,
      createdAt: true,
      updatedAt: true,
      sender: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          profile: {
            select: {
              avatarUrl: true,
            },
          },
        },
      },
    };
  }
}
