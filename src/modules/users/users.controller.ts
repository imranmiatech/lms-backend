import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';
import {
  UpdateStatusDto,
  UpdateStatusResponseDto,
} from './dto/update-status.dto';
import { TutorQueryDto } from './dto/tutor-query.dto';
import { TutorStudentsQueryDto } from './dto/tutor-students-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all users with their profiles',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users retrieved successfully.',
  })
  getAllUsers() {
    return this.usersService.findAll();
  }

  @Get('tutors')
  @ApiOperation({
    summary: 'Get approved tutors with subject and price filters',
  })
  @ApiResponse({
    status: 200,
    description: 'Tutor list retrieved successfully.',
  })
  getAllTutors(@Query() query: TutorQueryDto) {
    return this.usersService.findAllTutors(query);
  }

  @Get('student/tutors')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get approved tutors with favorite status for the current student',
  })
  getStudentTutors(
    @CurrentUser() user: { userId: string },
    @Query() query: TutorQueryDto,
  ) {
    return this.usersService.findStudentTutors(user.userId, query);
  }

  @Get('tutors/best-rated')
  @ApiOperation({
    summary: 'Get all approved tutors sorted by best rating first',
  })
  @ApiResponse({
    status: 200,
    description: 'Best rated tutor list retrieved successfully.',
  })
  getBestRatedTutors() {
    return this.usersService.findBestRatedTutors();
  }

  @Get('student/tutors/best-rated')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get best rated tutors with favorite status for the current student',
  })
  getStudentBestRatedTutors(@CurrentUser() user: { userId: string }) {
    return this.usersService.findStudentBestRatedTutors(user.userId);
  }

  @Get('student/favorite-tutors')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the current student favorite tutor list',
  })
  getStudentFavoriteTutors(@CurrentUser() user: { userId: string }) {
    return this.usersService.findAllFavoriteTutors(user.userId);
  }

  @Patch('student/favorite-tutors/:tutorId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Toggle favorite status for a tutor by the current student',
  })
  toggleFavoriteTutor(
    @CurrentUser() user: { userId: string },
    @Param('tutorId') tutorId: string,
  ) {
    return this.usersService.toggleFavoriteTutor(user.userId, tutorId);
  }

  @Get('tutor/students')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get students enrolled in the current tutor courses or private hire',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated tutor student roster retrieved successfully.',
  })
  findTutorStudents(
    @CurrentUser() user: { userId: string },
    @Query() query: TutorStudentsQueryDto,
  ) {
    return this.usersService.findTutorStudents(user.userId, query);
  }

  @Get('tutor/students/:studentId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get one student from the current tutor roster',
  })
  findTutorStudentById(
    @CurrentUser() user: { userId: string },
    @Param('studentId') studentId: string,
  ) {
    return this.usersService.findTutorStudentById(user.userId, studentId);
  }

  @Delete('tutor/students/:studentId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove a student from the current tutor group courses',
  })
  deleteTutorStudent(
    @CurrentUser() user: { userId: string },
    @Param('studentId') studentId: string,
  ) {
    return this.usersService.deleteTutorStudent(user.userId, studentId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/role')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user role (Admin Only)',
  })
  @ApiResponse({
    status: 200,
    description: 'User role updated successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN role.',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - User not found.',
  })
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateUserRole(id, dto.role);
  }

  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN role.',
  })
  findAll() {
    return this.usersService.findAll();
  }

  @Patch('profiles/:profileId/status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve or Reject a tutor application profile (Admin Only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile status updated successfully.',
    type: UpdateStatusResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Requires ADMIN role.',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - User profile not found.',
  })
  updateStatus(
    @Param('profileId') profileId: string,
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.usersService.updateProfileStatus(
      profileId,
      updateStatusDto.status,
    );
  }
}
