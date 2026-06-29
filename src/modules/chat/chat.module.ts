import { Module } from '@nestjs/common';
import { S3StorageModule } from '../common/s3/s3.module';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [S3StorageModule],
  controllers: [ChatController],
  providers: [ChatPresenceService, ChatService, ChatGateway],
  exports: [ChatPresenceService, ChatService, ChatGateway],
})
export class ChatModule {}
