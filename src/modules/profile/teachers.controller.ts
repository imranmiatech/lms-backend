import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileService } from './profile.service';

@ApiTags('Teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':userId')
  @ApiOperation({
    summary:
      'Get teacher profile with dated availability and private booking slots',
  })
  getTeacherProfile(
    @Param('userId') userId: string,
    @Query('date') date?: string,
  ) {
    return this.profileService.getProfile(userId, date);
  }
}
