import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProfileService } from './profile.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  CreateProfileDto,
  PublicCreateProfileDto,
  UpdateProfileDto,
} from './dto/profile.dto';

const profileJsonProperties = {
  fullName: { type: 'string', example: 'Morgan Pill' },
  country: { type: 'string', example: 'United States' },
  city: { type: 'string', example: 'Los Angeles' },
  avatarUrl: {
    type: 'string',
    example: 'https://example.com/avatar.jpg',
  },
  bio: {
    type: 'string',
    example: 'Programming tutor focused on practical learning.',
  },
  yearOfExperience: { type: 'number', example: 5 },
  pricePerHour: { type: 'number', example: 25 },
  languageExpertise: { type: 'string', example: 'English' },
  aboutMe: {
    type: 'string',
    example: 'I help students learn programming with real projects.',
  },
  teachingCategory: { type: 'string', example: 'Programming' },
  teachingSkills: {
    type: 'array',
    items: { type: 'string' },
    example: ['Python', 'Web Development'],
  },
  sessionDuration: { type: 'number', example: 60 },
  videoUrl: {
    type: 'string',
    example: 'https://example.com/profile-video.mp4',
  },
  education: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        institution: {
          type: 'string',
          example: 'National University of USA',
        },
        country: { type: 'string', example: 'United States' },
        city: { type: 'string', example: 'New York' },
        degree: { type: 'string', example: 'Bachelor of Philosophy' },
        passingYear: { type: 'number', example: 2020 },
      },
    },
  },
  availability: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        dayOfWeek: {
          type: 'string',
          enum: [
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
            'SATURDAY',
            'SUNDAY',
          ],
          example: 'MONDAY',
        },
        startTime: { type: 'string', example: '09:00' },
        endTime: { type: 'string', example: '17:00' },
        timezone: { type: 'string', example: 'Asia/Dhaka' },
      },
    },
  },
};

const profileMultipartProperties = {
  ...profileJsonProperties,
  teachingSkills: {
    type: 'string',
    description: 'JSON array or comma-separated list.',
    example: '["Python","Web Development"]',
  },
  education: {
    type: 'string',
    description: 'JSON array string.',
    example:
      '[{"institution":"National University of USA","country":"United States","city":"New York","degree":"Bachelor of Philosophy","passingYear":2020}]',
  },
  availability: {
    type: 'string',
    description: 'JSON array string.',
    example:
      '[{"dayOfWeek":"MONDAY","startTime":"09:00","endTime":"17:00","timezone":"Asia/Dhaka"}]',
  },
  avatarFile: {
    type: 'string',
    format: 'binary',
    description: 'Optional profile image. Saved to avatarUrl.',
  },
  videoFile: {
    type: 'string',
    format: 'binary',
    description: 'Optional profile video. Saved to videoUrl.',
  },
};

const profileJsonExample = {
  fullName: 'Morgan Pill',
  country: 'United States',
  city: 'Los Angeles',
  avatarUrl: 'https://example.com/avatar.jpg',
  bio: 'Programming tutor focused on practical learning.',
  yearOfExperience: 5,
  pricePerHour: 25,
  languageExpertise: 'English',
  aboutMe: 'I help students learn programming with real projects.',
  teachingCategory: 'Programming',
  teachingSkills: ['Python', 'Web Development'],
  sessionDuration: 60,
  videoUrl: 'https://example.com/profile-video.mp4',
  education: [
    {
      institution: 'National University of USA',
      country: 'United States',
      city: 'New York',
      degree: 'Bachelor of Philosophy',
      passingYear: 2020,
    },
  ],
  availability: [
    {
      dayOfWeek: 'MONDAY',
      startTime: '09:00',
      endTime: '17:00',
      timezone: 'Asia/Dhaka',
    },
    {
      dayOfWeek: 'FRIDAY',
      startTime: '20:00',
      endTime: '22:00',
      timezone: 'Asia/Dhaka',
    },
  ],
};

const createProfileExample = {
  userId: '5f5b9d3b-6e9f-4b08-8df0-1014a4c62f2d',
  ...profileJsonExample,
};

const updateProfileExample = {
  ...profileJsonExample,
  bio: 'Updated profile bio.',
  yearOfExperience: 6,
  pricePerHour: 30,
  teachingSkills: ['Python', 'JavaScript', 'React'],
};

const createProfileApiBody = {
  required: true,
  description: 'Use multipart/form-data for all profile create fields.',
  schema: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: {
        type: 'string',
        example: '5f5b9d3b-6e9f-4b08-8df0-1014a4c62f2d',
      },
      ...profileMultipartProperties,
    },
    example: createProfileExample,
  },
};

const updateProfileApiBody = {
  required: false,
  description:
    'Use application/json for URL fields, or multipart/form-data when uploading avatarFile/videoFile.',
  schema: {
    type: 'object',
    properties: profileMultipartProperties,
    example: updateProfileExample,
  },
};

@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('my')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get logged-in user profile details (includes education & availability)',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile details retrieved successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getMyProfile(@Req() req: any) {
    const userId = req.user.userId;
    return this.profileService.getProfile(userId);
  }

  @Get('tutor/:userId')
  getTutorProfile(
    @Param('userId') userId: string,
    @Query('date') date?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '5',
  ) {
    return this.profileService.getProfile(
      userId,
      date,
      Number(page),
      Number(limit),
    );
  }

  @Get(':tutorId/availability')
  getTutorAvailability(
    @Param('tutorId') tutorId: string,
    @Query('courseId') courseId?: string,
  ) {
    return this.profileService.getTutorAvailability(tutorId, courseId);
  }

  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatarFile', maxCount: 1 },
        { name: 'videoFile', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
      },
    ),
  )
  @ApiOperation({ summary: 'Create user profile details without login' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(createProfileApiBody)
  @ApiResponse({ status: 201, description: 'Profile created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  @ApiResponse({
    status: 415,
    description: 'Only multipart/form-data is supported.',
  })
  createMyProfile(
    @Headers('content-type') contentType: string | undefined,
    @Body() dto: PublicCreateProfileDto,
    @UploadedFiles()
    files?: {
      avatarFile?: any[];
      videoFile?: any[];
    },
  ) {
    if (!contentType?.toLowerCase().includes('multipart/form-data')) {
      throw new UnsupportedMediaTypeException(
        'Only multipart/form-data is supported for /profile/create',
      );
    }

    const normalizedDto = this.normalizeProfileBody(
      dto,
    ) as PublicCreateProfileDto;
    return this.profileService.createProfile(
      normalizedDto.userId,
      normalizedDto,
      {
        avatarFile: files?.avatarFile?.[0],
        videoFile: files?.videoFile?.[0],
      },
    );
  }

  @Patch('update')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatarFile', maxCount: 1 },
        { name: 'videoFile', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
      },
    ),
  )
  @ApiOperation({ summary: 'Update logged-in user profile details' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody(updateProfileApiBody)
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  updateMyProfile(
    @Req() req: any,
    @Body() dto: UpdateProfileDto,
    @UploadedFiles()
    files?: {
      avatarFile?: any[];
      videoFile?: any[];
    },
  ) {
    const userId = req.user.userId;
    return this.profileService.updateProfile(
      userId,
      this.normalizeProfileBody(dto),
      {
        avatarFile: files?.avatarFile?.[0],
        videoFile: files?.videoFile?.[0],
      },
    );
  }

  private normalizeProfileBody<T extends Record<string, any>>(dto: T): T {
    const normalizedVideoUrl =
      dto.videoUrl ?? (dto as T & { vedioUrl?: unknown }).vedioUrl;

    return {
      ...dto,
      videoUrl:
        typeof normalizedVideoUrl === 'string'
          ? normalizedVideoUrl
          : undefined,
      yearOfExperience: this.toNumber(dto.yearOfExperience),
      pricePerHour: this.toNumber(dto.pricePerHour),
      sessionDuration: this.toNumber(dto.sessionDuration),
      teachingSkills: this.toStringArray(dto.teachingSkills),
      education: this.toJsonArray(dto.education),
      availability: this.toJsonArray(dto.availability),
    };
  }

  private toNumber(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return Number(value);
  }

  private toStringArray(value: unknown) {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }

    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private toJsonArray(value: unknown) {
    if (value === undefined || value === null || Array.isArray(value)) {
      return value;
    }

    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    return JSON.parse(value);
  }
}
