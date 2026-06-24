import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CourseService } from './course.service';
import {
  CreateCourseDto,
  UpcomingCourseQueryDto,
  UpdateCourseLessonDto,
} from './dto/course.dto';

@ApiTags('Course')
@Controller('course')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Post('create')
  @UseGuards(AuthGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Create a new course (Tutor/Admin only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Create a course with multipart/form-data. Upload image to store the course image in S3.',
    schema: {
      type: 'object',
      required: [
        'title',
        'category',
        'description',
        'extraInfos',
        'topics',
        'timeZone',
        'classDuration',
        'language',
        'courseDuration',
        'pricePerStudent',
        'minStudent',
        'maxStudent',
        'enrollmentDeadline',
      ],
      properties: {
        title: { type: 'string', example: 'Advanced Python Programming' },
        category: { type: 'string', example: 'Programming' },
        description: {
          type: 'string',
          example: 'Learn advanced Python through live classes.',
        },
        extraInfos: {
          type: 'string',
          example:
            '["8 live sessions per week","Certificate of completion"]',
          description: 'JSON array string or comma-separated text.',
        },
        topics: {
          type: 'string',
          example: '["Python","OOP","Django"]',
          description: 'JSON array string or comma-separated text.',
        },
        requirement: { type: 'string', example: 'Basic Python knowledge' },
        image: {
          type: 'string',
          format: 'binary',
          description:
            'Optional course image file. Supported: JPEG, PNG, WebP, GIF. Max 10MB. Uploaded to S3.',
        },
        curriculums: {
          type: 'string',
          example: '["Introduction","Advanced Patterns"]',
          description:
            'JSON array string or comma-separated text. Use with startDate and time.',
        },
        curriculumItems: {
          type: 'string',
          example:
            '[{"title":"Introduction","date":"2026-07-06","time":"14:00"}]',
          description:
            'JSON array string of lesson objects. Preferred for per-lesson date/time.',
        },
        startDate: { type: 'string', example: '2026-07-06' },
        time: { type: 'string', example: '14:00' },
        timeZone: { type: 'string', example: 'UTC-5 (EST)' },
        classDuration: { type: 'number', example: 45 },
        language: { type: 'string', example: 'English' },
        courseDuration: { type: 'number', example: 8 },
        pricePerStudent: { type: 'number', example: 210 },
        minStudent: { type: 'number', example: 1 },
        maxStudent: { type: 'number', example: 20 },
        enrollmentDeadline: { type: 'string', example: '2026-07-01' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Course created successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  createCourse(
    @Body() createCourseDto: CreateCourseDto,
    @CurrentUser() user: { userId: string },
    @UploadedFile() image?: any,
  ) {
    return this.courseService.createCourse(
      user.userId,
      createCourseDto,
      image,
    );
  }

  @Get('upcoming')
  @ApiOperation({
    summary: 'Get upcoming courses with subject, price, and date filters',
  })
  @ApiResponse({
    status: 200,
    description: 'Upcoming courses retrieved successfully.',
  })
  getUpcomingCourses(@Query() query: UpcomingCourseQueryDto) {
    return this.courseService.getUpcomingCourses(query);
  }

  @Post(':id/enroll')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enroll the current student in a course' })
  @ApiResponse({ status: 201, description: 'Student enrolled successfully.' })
  @ApiResponse({ status: 400, description: 'Enrollment is not available.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  enrollCourse(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.courseService.enrollCourse(id, user.userId);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all courses with optional filters' })
  @ApiResponse({ status: 200, description: 'Courses retrieved successfully.' })
  getAllCourse(@Query() query: UpcomingCourseQueryDto) {
    return this.courseService.getAllCourse(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course by ID' })
  @ApiResponse({ status: 200, description: 'Course retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  getCourseById(@Param('id') id: string) {
    return this.courseService.getCourseById(id);
  }

  @Post(':id/curriculums/:curriculumIndex/complete')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a course class as completed' })
  @ApiResponse({ status: 201, description: 'Class marked as completed.' })
  @ApiResponse({ status: 400, description: 'Invalid curriculum index.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  completeCurriculum(
    @Param('id') id: string,
    @Param('curriculumIndex', ParseIntPipe) curriculumIndex: number,
    @CurrentUser() user: { userId: string },
  ) {
    return this.courseService.completeCurriculum(
      id,
      curriculumIndex,
      user.userId,
    );
  }

  @Patch(':id/curriculum-items/:curriculumItemId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a course lesson date, time, or title' })
  @ApiResponse({
    status: 200,
    description: 'Course lesson updated successfully.',
    schema: {
      example: {
        success: true,
        message: 'Course lesson updated successfully',
        data: {
          id: '4c3e4ece-1803-40ca-a53a-07cb8a1c6e2b-curriculum-0',
          courseId: '4c3e4ece-1803-40ca-a53a-07cb8a1c6e2b',
          title: 'JavaScript Fundamentals',
          date: '2026-06-20T00:00:00.000Z',
          time: '10:00',
        },
      },
    },
  })
  updateCurriculumItem(
    @Param('id') id: string,
    @Param('curriculumItemId') curriculumItemId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateCourseLessonDto,
  ) {
    return this.courseService.updateCurriculumItem(
      id,
      curriculumItemId,
      user.userId,
      dto,
    );
  }

  @Delete(':id/curriculum-items/:curriculumItemId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a lesson from a tutor course' })
  @ApiResponse({
    status: 200,
    description: 'Course lesson deleted successfully.',
    schema: {
      example: {
        success: true,
        message: 'Course lesson deleted successfully',
        data: {
          courseId: '4c3e4ece-1803-40ca-a53a-07cb8a1c6e2b',
          deletedCurriculumItemId:
            '4c3e4ece-1803-40ca-a53a-07cb8a1c6e2b-curriculum-0',
          remainingLessons: 4,
        },
      },
    },
  })
  deleteCurriculumItem(
    @Param('id') id: string,
    @Param('curriculumItemId') curriculumItemId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.courseService.deleteCurriculumItem(
      id,
      curriculumItemId,
      user.userId,
    );
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a course (Tutor/Admin only)' })
  @ApiResponse({ status: 200, description: 'Course updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  updateCourse(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCourseDto,
  ) {
    return this.courseService.updateCourse(id, user.userId, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a course (Tutor/Admin only)' })
  @ApiResponse({ status: 200, description: 'Course deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  deleteCourse(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.courseService.deleteCoursebyId(id, user.userId);
  }
}
