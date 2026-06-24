import { Module } from '@nestjs/common';
import { S3StorageModule } from '../common/s3/s3.module';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';

@Module({
  imports: [S3StorageModule],
  controllers: [ResourceController],
  providers: [ResourceService],
})
export class ResourceModule {}
