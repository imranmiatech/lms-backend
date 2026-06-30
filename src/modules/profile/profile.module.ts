import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { TeachersController } from './teachers.controller';

@Module({
  imports: [ReviewModule],
  controllers: [ProfileController, TeachersController],
  providers: [ProfileService],
})
export class ProfileModule {}
