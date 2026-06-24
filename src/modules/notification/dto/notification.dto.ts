import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export enum NotificationAudience {
  USER = 'USER',
  ROLE = 'ROLE',
  ALL = 'ALL',
}

export class CreateNotificationDto {
  @ApiProperty({
    enum: NotificationAudience,
    example: NotificationAudience.ROLE,
  })
  @IsEnum(NotificationAudience)
  audience!: NotificationAudience;

  @ApiPropertyOptional({
    description: 'Single user ID. Required when audience is USER.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Multiple user IDs. Alternative to userId when audience is USER.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    description: 'Role target. Required when audience is ROLE.',
    enum: Role,
    example: Role.TUTOR,
  })
  @ValidateIf((dto: CreateNotificationDto) => dto.audience === NotificationAudience.ROLE)
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({
    description: 'Notification type/category.',
    example: 'COURSE_UPDATE',
  })
  @IsNotEmpty()
  @IsString()
  type!: string;

  @ApiProperty({
    example: 'New course update',
  })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 'Your tutor added a new lesson.',
  })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    example: { courseId: '550e8400-e29b-41d4-a716-446655440000' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '/dashboard/courses/550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  targetUrl?: string;
}

export class NotificationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') {
      return true;
    }

    if (value === false || value === 'false' || value === '0') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({ example: 'COURSE_UPDATE' })
  @IsOptional()
  @IsString()
  type?: string;
}
