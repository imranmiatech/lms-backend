import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class TutorGroupClassesQueryDto {
  @ApiPropertyOptional({
    description: 'Search by course name or subject/category.',
    example: 'Data Science',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['all', 'active', 'live', 'upcoming', 'completed', 'cancelled'],
    default: 'all',
    description: 'Filter tutor group classes by display status.',
  })
  @IsOptional()
  @IsIn(['all', 'active', 'live', 'upcoming', 'completed', 'cancelled'])
  status?: 'all' | 'active' | 'live' | 'upcoming' | 'completed' | 'cancelled';
}

export class ClassStudentsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search by student name or email' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateClassResourceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  size?: string;
}
