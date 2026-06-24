import { Module } from '@nestjs/common';
import { S3StorageModule } from '../common/s3/s3.module';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';

@Module({
  imports: [S3StorageModule],
  providers: [CourseService],
  controllers: [CourseController],
})
export class CourseModule {}
