import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('tutor/home')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard home page data' })
  getTutorHome(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorHome(user.userId);
  }

  @Get('tutor/welcome')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard welcome data' })
  getTutorWelcome(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorWelcome(user.userId);
  }

  @Get('tutor/cards')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard statistic cards' })
  getTutorCards(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorCards(user.userId);
  }

  @Get('tutor/upcoming-lessons')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard upcoming lessons' })
  getTutorUpcomingLessons(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorUpcomingLessons(user.userId);
  }

  @Get('tutor/weekly-lessons')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard weekly lessons chart' })
  getTutorWeeklyLessons(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorWeeklyLessons(user.userId);
  }

  @Get('tutor/revenue-overview')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard revenue overview chart' })
  getTutorRevenueOverview(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorRevenueOverview(user.userId);
  }

  @Get('tutor/recent-activity')
  @Roles(Role.TUTOR)
  @ApiOperation({ summary: 'Get tutor dashboard recent activity' })
  getTutorRecentActivity(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getTutorRecentActivity(user.userId);
  }

  @Get('student/home')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard home page data' })
  getStudentHome(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentHome(user.userId);
  }

  @Get('student/overview')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard welcome and cards' })
  getStudentOverview(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentOverview(user.userId);
  }

  @Get('student/next-lesson')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard next lesson' })
  getStudentNextLesson(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentNextLesson(user.userId);
  }

  @Get('student/today-schedule')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard today schedule' })
  getStudentTodaySchedule(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentTodaySchedule(user.userId);
  }

  @Get('student/learning-progress')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard learning progress' })
  getStudentLearningProgress(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentLearningProgress(user.userId);
  }

  @Get('student/recent-activity')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard recent activity' })
  getStudentRecentActivity(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentRecentActivity(user.userId);
  }

  @Get('student/favorite-tutors')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student dashboard favorite tutors' })
  getStudentFavoriteTutors(@CurrentUser() user: { userId: string }) {
    return this.dashboardService.getStudentFavoriteTutors(user.userId);
  }
}
