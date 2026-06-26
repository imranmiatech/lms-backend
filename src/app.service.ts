import { Injectable } from '@nestjs/common';
import { PaymentStatus, PaymentType, Role } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getPlatformMeta() {
    const now = new Date();
    const [
      activeStudents,
      expertTeachers,
      countries,
      groupLessonsCompleted,
      privateLessonsCompleted,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          role: Role.STUDENT,
        },
      }),
      this.prisma.user.count({
        where: {
          role: Role.TUTOR,
        },
      }),
      this.prisma.userProfile.findMany({
        where: {
          country: {
            not: null,
          },
        },
        distinct: ['country'],
        select: {
          country: true,
        },
      }),
      this.prisma.curriculumProgress.count(),
      this.prisma.payment.count({
        where: {
          type: PaymentType.PRIVATE,
          status: PaymentStatus.PAID,
          privateLessonStartsAt: {
            lte: now,
          },
        },
      }),
    ]);

    const lessonsCompleted = groupLessonsCompleted + privateLessonsCompleted;
    const items = [
      {
        key: 'activeStudents',
        label: 'Active Students',
        value: activeStudents,
      },
      {
        key: 'expertTeachers',
        label: 'Expert Teachers',
        value: expertTeachers,
      },
      {
        key: 'countries',
        label: 'Countries',
        value: countries.length,
      },
      {
        key: 'lessonsCompleted',
        label: 'Lessons Completed',
        value: lessonsCompleted,
      },
    ].map((item) => ({
      ...item,
      displayValue: this.formatCounter(item.value),
    }));

    return {
      success: true,
      data: {
        activeStudents: items[0],
        expertTeachers: items[1],
        countries: items[2],
        lessonsCompleted: items[3],
        items,
      },
    };
  }

  private formatCounter(value: number) {
    if (value >= 1000) {
      const compact = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 0,
      }).format(value);

      return `${compact}+`;
    }

    return `${value}`;
  }
}
