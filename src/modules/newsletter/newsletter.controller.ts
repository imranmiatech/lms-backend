import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { CreateSubscriberDto } from './dto/newsletter.dto';


@Controller('newsletter')
export class NewsletterController {
  constructor(
    private readonly newsletterService: NewsletterService,
  ) {}

  @Post('subscribe')
  subscribe(
    @Body() dto: CreateSubscriberDto,
  ) {
    return this.newsletterService.subscribe(dto);
  }

  @Get()
  getSubscribers() {
    return this.newsletterService.getSubscribers();
  }
}
