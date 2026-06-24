import { Module } from '@nestjs/common';
import { S3StorageModule } from '../common/s3/s3.module';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  imports: [S3StorageModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
