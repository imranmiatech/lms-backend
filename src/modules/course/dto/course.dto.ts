import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

function toMinuteNumber(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const match = value.trim().match(/^(\d+)\s*(m|min|mins|minute|minutes)?$/i);

  return match ? Number(match[1]) : Number(value);
}

function toNumber(value: unknown) {
  return typeof value === 'string' ? Number(value) : value;
}

function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function toCourseLessons(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

export class CreateCourseLessonDto {
  @IsString()
  title!: string;

  @IsDateString()
  date!: string;

  @IsString()
  time!: string;
}

export class UpdateCourseLessonDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  time?: string;
}

export class CreateCourseDto {
  @IsString()
  title!: string;

  @IsString()
  category!: string;

  @IsString()
  description!: string;

  @IsArray()
  @Transform(({ value }) => toStringArray(value))
  extraInfos!: string[];

  @IsArray()
  @Transform(({ value }) => toStringArray(value))
  topics!: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) => emptyToUndefined(value))
  requirement?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => emptyToUndefined(value))
  image?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => toStringArray(value))
  curriculums?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Transform(({ value }) => toCourseLessons(value))
  @Type(() => CreateCourseLessonDto)
  curriculumItems?: CreateCourseLessonDto[];

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => emptyToUndefined(value))
  startDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => emptyToUndefined(value))
  time?: string;

  @IsString()
  timeZone!: string;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toMinuteNumber(value))
  classDuration!: number;

  @IsString()
  language!: string;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toMinuteNumber(value))
  courseDuration!: number;

  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  pricePerStudent!: number;

  @IsNumber()
  @Min(1)
  @Transform(({ value }) => toNumber(value))
  minStudent!: number;

  @IsNumber()
  @Min(1)
  @Transform(({ value }) => toNumber(value))
  maxStudent!: number;

  @IsDateString()
  enrollmentDeadline!: string;
}

export enum CourseSubjectFilter {
  ALL = 'All Subjects',
  PROGRAMMING = 'Programming',
  LANGUAGES = 'Languages',
  MATHEMATICS = 'Mathematics',
  MUSIC = 'Music',
  SCIENCE = 'Science',
  BUSINESS = 'Business',
  DESIGN = 'Design',
  WRITING = 'Writing',
}

export enum CoursePriceFilter {
  ALL = 'All Prices',
  ZERO_TO_FORTY = '$0 - $40/hr',
  FORTY_TO_SIXTY = '$40 - $60/hr',
  SIXTY_PLUS = '$60+/hr',
}

export enum UpcomingCourseDateFilter {
  ALL = 'All Upcoming',
  STARTING_SOON = 'Starting Soon',
  THIS_WEEK = 'This Week',
  THIS_MONTH = 'This Month',
}

export class UpcomingCourseQueryDto {
  @IsOptional()
  @IsEnum(CourseSubjectFilter)
  subject?: CourseSubjectFilter;

  @IsOptional()
  @IsEnum(CoursePriceFilter)
  price?: CoursePriceFilter;

  @IsOptional()
  @IsEnum(UpcomingCourseDateFilter)
  date?: UpcomingCourseDateFilter;
}
