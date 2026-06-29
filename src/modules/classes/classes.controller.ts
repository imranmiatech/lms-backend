import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClassesService } from './classes.service';
import {
  ClassStudentsQueryDto,
  CreateClassResourceDto,
  TutorGroupClassesQueryDto,
} from './dto/classes.dto';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.TUTOR)
@ApiBearerAuth()
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get('student/group-classes')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary: 'Get group classes enrolled by the current student',
  })
  @ApiResponse({
    status: 200,
    description: 'Student group classes retrieved.',
    schema: {
      example: {
        success: true,
        data: [
          {
            enrollmentId: 'enrollment_01',
            courseId: 'course_javascript_advanced',
            title: 'JavaScript Advanced Concepts',
            image: 'https://example.com/images/javascript-course.jpg',
            tutor: {
              id: 'tutor_01',
              name: 'David Chen',
              avatarUrl: 'https://example.com/avatars/david-chen.jpg',
            },
            enrolledAt: '2026-06-01T10:00:00.000Z',
            studentCount: 12,
            durationMinutes: 90,
            durationLabel: '90 min',
            progress: {
              completedSessions: 9,
              totalSessions: 15,
              percentage: 60,
              label: '9/15 Sessions Completed',
            },
            upcomingSessions: [
              {
                id: 'course_javascript_advanced:13',
                curriculumIndex: 13,
                title: 'Session 14',
                date: '2026-06-16T00:00:00.000Z',
                startsAt: '2026-06-16T15:00:00.000Z',
                time: '3:00 pm',
                dateLabel: 'Jun 16, 2026',
                timeLabel: '3:00 PM',
                status: 'upcoming',
                joinAvailable: true,
              },
            ],
            resources: [
              {
                resourceId: 'resource_01',
                name: 'Course Syllabus.pdf',
                url: 'https://example.com/resources/syllabus.pdf',
                size: '2.4 MB',
                downloads: 18,
                createdAt: '2026-06-01T12:00:00.000Z',
              },
            ],
          },
        ],
      },
    },
  })
  getStudentGroupClasses(@CurrentUser() user: { userId: string }) {
    return this.classesService.getStudentGroupClasses(user.userId);
  }

  @Get('tutor/group-classes')
  @ApiOperation({
    summary: 'Get tutor group class cards with search and status filters',
  })
  @ApiResponse({
    status: 200,
    description: 'Tutor group class cards retrieved.',
    schema: {
      example: {
        success: true,
        filters: {
          search: null,
          status: 'all',
        },
        data: [
          {
            courseId: 'course_data_science_bootcamp',
            title: 'Data Science Bootcamp',
            category: 'Data Science',
            image: 'https://example.com/courses/data-science.jpg',
            status: 'upcoming',
            statusLabel: 'Active',
            progress: {
              completedLessons: 13,
              totalLessons: 20,
              percentage: 65,
              label: 'Course Completion',
            },
            nextClass: {
              id: 'course_data_science_bootcamp-13',
              title: 'Model Evaluation',
              date: '2026-05-24T00:00:00.000Z',
              dateLabel: 'May 24',
              time: '2:20 pm',
              status: 'upcoming',
            },
            price: '€206',
            enrolled: {
              current: 8,
              max: 15,
              label: '8/15 students',
            },
            actions: {
              manageCourse: '/classes/course_data_science_bootcamp/overview',
              viewStudents:
                '/classes/course_data_science_bootcamp/enrolled-students',
              deleteCourse: '/course/course_data_science_bootcamp',
            },
          },
        ],
      },
    },
  })
  getTutorGroupClasses(
    @CurrentUser() user: { userId: string },
    @Query() query: TutorGroupClassesQueryDto,
  ) {
    return this.classesService.getTutorGroupClasses(user.userId, query);
  }

  @Get(':courseId/meta')
  @ApiOperation({ summary: 'Get tutor class page metadata cards' })
  @ApiResponse({ status: 200, description: 'Class metadata retrieved.' })
  getMeta(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
  ) {
    return this.classesService.getMeta(user.userId, courseId);
  }

  @Get(':courseId/overview')
  @ApiOperation({ summary: 'Get tutor class page overview' })
  @ApiResponse({ status: 200, description: 'Class overview retrieved.' })
  getOverview(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
  ) {
    return this.classesService.getOverview(user.userId, courseId);
  }

  @Get(':courseId/students')
  @ApiOperation({ summary: 'Get enrolled students for a tutor class' })
  getStudents(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Query() query: ClassStudentsQueryDto,
  ) {
    return this.classesService.getStudents(user.userId, courseId, query);
  }

  @Get(':courseId/enrolled-students')
  @ApiOperation({ summary: 'Get enrolled student names and enrollment dates' })
  getEnrolledStudents(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
  ) {
    return this.classesService.getEnrolledStudents(user.userId, courseId);
  }

  @Delete(':courseId/enrolled-students/:studentId')
  @ApiOperation({
    summary: 'Remove a student from a tutor class by student ID',
  })
  deleteEnrolledStudent(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.classesService.deleteEnrolledStudent(
      user.userId,
      courseId,
      studentId,
    );
  }

  @Get(':courseId/lessons')
  @ApiOperation({ summary: 'Get lessons for a tutor class' })
  getLessons(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
  ) {
    return this.classesService.getLessons(user.userId, courseId);
  }

  @Get(':courseId/lessons/:curriculumIndex/join-preview')
  @ApiOperation({ summary: 'Get tutor live-class join preview' })
  getLessonJoinPreview(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Param('curriculumIndex', ParseIntPipe) curriculumIndex: number,
  ) {
    return this.classesService.getLessonJoinPreview(
      user.userId,
      courseId,
      curriculumIndex,
    );
  }

  @Post(':courseId/lessons/:curriculumIndex/join')
  @ApiOperation({
    summary: 'Join/start a tutor live class and receive Agora credentials',
  })
  joinLesson(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Param('curriculumIndex', ParseIntPipe) curriculumIndex: number,
  ) {
    return this.classesService.joinLesson(
      user.userId,
      courseId,
      curriculumIndex,
    );
  }

  @Get(':courseId/resources')
  @ApiOperation({ summary: 'Get resources for a tutor class' })
  getResources(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
  ) {
    return this.classesService.getResources(user.userId, courseId);
  }

  @Post(':courseId/resources')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Add resource to a tutor class' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['name', 'file'],
      properties: {
        name: { type: 'string', example: 'Course Syllabus.pdf' },
        size: { type: 'string', example: '2.4 MB' },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Resource file. Uploaded to S3.',
        },
      },
    },
  })
  addResource(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Body() dto: CreateClassResourceDto,
    @UploadedFiles() files?: any[],
  ) {
    const file = files?.[0];
    return this.classesService.addResource(user.userId, courseId, dto, file);
  }

  @Delete(':courseId/resources/:resourceId')
  @ApiOperation({ summary: 'Delete resource from a tutor class' })
  deleteResource(
    @CurrentUser() user: { userId: string },
    @Param('courseId') courseId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.classesService.deleteResource(
      user.userId,
      courseId,
      resourceId,
    );
  }
}
