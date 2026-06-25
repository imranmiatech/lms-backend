import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { TeachersController } from './teachers.controller';

@Module({
  controllers: [ProfileController, TeachersController],
  providers: [ProfileService],
})
export class ProfileModule {}
