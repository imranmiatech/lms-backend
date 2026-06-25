import { Module } from '@nestjs/common';
import { AgoraModule } from '../agora/agora.module';
import { S3StorageModule } from '../common/s3/s3.module';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';

@Module({
  imports: [AgoraModule, S3StorageModule],
  controllers: [ClassesController],
  providers: [ClassesService],
})
export class ClassesModule {}
