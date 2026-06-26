import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  StudentLessonQueryDto,
  StudentLessonReviewListQueryDto,
  StudentLessonReviewDto,
} from './dto/student-lessons.dto';
import { StudentLessonsService } from './student-lessons.service';

@ApiTags('Student Lessons')
@Controller('student-lessons')
export class StudentLessonsController {
  constructor(private readonly studentLessonsService: StudentLessonsService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get student lesson panel data' })
  listLessons(
    @CurrentUser() user: { userId: string },
    @Query() query: StudentLessonQueryDto,
  ) {
    return this.studentLessonsService.listLessons(user.userId, query);
  }

  @Get('reviews')
  @ApiOperation({
    summary: 'Get recent 12 tutor reviews, highest ratings first',
  })
  getAllReviews() {
    return this.studentLessonsService.getAllReviews();
  }

  @Get(':lessonId/join-preview')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get join modal details for a student lesson' })
  getJoinPreview(
    @CurrentUser() user: { userId: string },
    @Param('lessonId') lessonId: string,
  ) {
    return this.studentLessonsService.getJoinPreview(user.userId, lessonId);
  }

  @Post(':lessonId/join')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join a student lesson and receive Agora RTC credentials',
  })
  joinLesson(
    @CurrentUser() user: { userId: string },
    @Param('lessonId') lessonId: string,
  ) {
    return this.studentLessonsService.joinLesson(user.userId, lessonId);
  }

  @Get(':lessonId/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get tutor reviews for a student lesson, highest ratings first',
  })
  getLessonReviews(
    @CurrentUser() user: { userId: string },
    @Param('lessonId') lessonId: string,
    @Query() query: StudentLessonReviewListQueryDto,
  ) {
    return this.studentLessonsService.getLessonReviews(
      user.userId,
      lessonId,
      query,
    );
  }

  @Post(':lessonId/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit or update the review shown from completed lessons',
  })
  reviewLesson(
    @CurrentUser() user: { userId: string },
    @Param('lessonId') lessonId: string,
    @Body() dto: StudentLessonReviewDto,
  ) {
    return this.studentLessonsService.reviewLesson(user.userId, lessonId, dto);
  }
}
