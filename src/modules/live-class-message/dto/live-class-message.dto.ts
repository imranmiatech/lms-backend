import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class LiveClassMessageQueryDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination. Pass a message id to load older rows.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of messages to return.',
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class SendLiveClassMessageDto {
  @ApiProperty({ example: 'Can you explain this formula again?' })
  @IsNotEmpty()
  @IsString()
  content!: string;
}

export class ShareLiveClassResourceDto {
  @ApiProperty({ example: 'Lesson worksheet.pdf' })
  @IsNotEmpty()
  @IsString()
  resourceName!: string;

  @ApiProperty({ example: 'https://storage.example.com/classes/worksheet.pdf' })
  @IsNotEmpty()
  @IsString()
  @IsUrl()
  resourceUrl!: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  resourceMimeType?: string;

  @ApiPropertyOptional({ example: '2.4 MB' })
  @IsOptional()
  @IsString()
  resourceSize?: string;

  @ApiPropertyOptional({ example: 'Please download this before the exercise.' })
  @IsOptional()
  @IsString()
  content?: string;
}

export class ShareLiveClassResourceUploadDto {
  @ApiPropertyOptional({ example: 'Please download this before the exercise.' })
  @IsOptional()
  @IsString()
  content?: string;
}

export class LiveClassRoomPayloadDto {
  @ApiProperty({ enum: ['GROUP', 'PRIVATE'], example: 'GROUP' })
  @IsIn(['GROUP', 'PRIVATE'])
  roomType!: 'GROUP' | 'PRIVATE';

  @ApiPropertyOptional({ example: 'course_advanced_math_101' })
  @IsOptional()
  @IsString()
  courseId?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  curriculumIndex?: number;

  @ApiPropertyOptional({ example: 'payment_private_01' })
  @IsOptional()
  @IsString()
  paymentId?: string;
}

export class WsSendLiveClassMessageDto extends LiveClassRoomPayloadDto {
  @ApiProperty({ example: 'Can everyone see my screen?' })
  @IsNotEmpty()
  @IsString()
  content!: string;
}

export class WsShareLiveClassResourceDto extends LiveClassRoomPayloadDto {
  @ApiProperty({ example: 'Class notes.pdf' })
  @IsNotEmpty()
  @IsString()
  resourceName!: string;

  @ApiProperty({ example: 'https://storage.example.com/classes/notes.pdf' })
  @IsNotEmpty()
  @IsString()
  @IsUrl()
  resourceUrl!: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  resourceMimeType?: string;

  @ApiPropertyOptional({ example: '1.8 MB' })
  @IsOptional()
  @IsString()
  resourceSize?: string;

  @ApiPropertyOptional({ example: 'Use this for today lesson.' })
  @IsOptional()
  @IsString()
  content?: string;
}

export class WsPresenceDto extends LiveClassRoomPayloadDto {
  @ApiProperty({ example: 12345678 })
  @IsNotEmpty()
  @IsInt()
  uid!: number;

  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  name!: string;
}
