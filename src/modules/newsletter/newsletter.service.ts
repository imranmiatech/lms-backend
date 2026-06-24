import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { CreateSubscriberDto } from './dto/newsletter.dto';
import { PrismaService } from 'src/prisma/prisma.service';


@Injectable()
export class NewsletterService {
  constructor(private prisma: PrismaService) {}

  async subscribe(dto: CreateSubscriberDto) {
    const exists = await this.prisma.newsletterSubscriber.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (exists) {
      throw new BadRequestException(
        'Email already subscribed',
      );
    }

    return this.prisma.newsletterSubscriber.create({
      data: {
        email: dto.email,
      },
    });
  }

  async getSubscribers() {
    return this.prisma.newsletterSubscriber.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}