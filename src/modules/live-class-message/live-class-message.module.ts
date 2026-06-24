import { Module } from '@nestjs/common';
import { LiveClassMessageController } from './live-class-message.controller';
import { LiveClassMessageGateway } from './live-class-message.gateway';
import { LiveClassMessageService } from './live-class-message.service';

@Module({
  controllers: [LiveClassMessageController],
  providers: [LiveClassMessageService, LiveClassMessageGateway],
  exports: [LiveClassMessageService, LiveClassMessageGateway],
})
export class LiveClassMessageModule {}
