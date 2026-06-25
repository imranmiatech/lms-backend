import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { AgoraModule } from '../agora/agora.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [AgoraModule, NotificationModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
