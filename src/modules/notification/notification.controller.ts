import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { NotificationService } from './notification.service';
import {
  CreateNotificationDto,
  NotificationQueryDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller(['notifications', 'notification'])
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create role-based, user-based, or global notifications',
  })
  @ApiResponse({ status: 201, description: 'Notification created.' })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get current user notifications' })
  @ApiResponse({ status: 200, description: 'Notification list retrieved.' })
  findMine(
    @CurrentUser() user: { userId: string },
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationService.findMine(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get current user unread notification count' })
  getUnreadCount(@CurrentUser() user: { userId: string }) {
    return this.notificationService.getUnreadCount(user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all current user notifications as read' })
  markAllAsRead(@CurrentUser() user: { userId: string }) {
    return this.notificationService.markAllAsRead(user.userId);
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Mark one current user notification as read' })
  @ApiParam({ name: 'notificationId', description: 'Notification UUID' })
  markOneAsRead(
    @CurrentUser() user: { userId: string },
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.markOneAsRead(
      user.userId,
      notificationId,
    );
  }

  @Delete('all')
  @ApiOperation({ summary: 'Delete all current user notifications' })
  deleteAllMine(@CurrentUser() user: { userId: string }) {
    return this.notificationService.deleteAllMine(user.userId);
  }

  @Delete(':notificationId')
  @ApiOperation({ summary: 'Delete one current user notification' })
  @ApiParam({ name: 'notificationId', description: 'Notification UUID' })
  deleteMine(
    @CurrentUser() user: { userId: string },
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.deleteMine(user.userId, notificationId);
  }

  @Delete('admin/:notificationId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete any notification as admin' })
  @ApiParam({ name: 'notificationId', description: 'Notification UUID' })
  deleteByAdmin(@Param('notificationId') notificationId: string) {
    return this.notificationService.deleteByAdmin(notificationId);
  }
}
