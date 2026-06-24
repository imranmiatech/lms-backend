import { Module } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { NewsletterController } from './newsletter.controller';

@Module({
  providers: [NewsletterService],
  controllers: [NewsletterController]
})
export class NewsletterModule {}
