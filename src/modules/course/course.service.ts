import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PaymentStatus,
  PaymentType,
  PayoutStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import Stripe = require('stripe');
import { PrismaService } from 'src/prisma/prisma.service';
import { S3StorageService } from '../common/s3/s3.service';
import {
  CoursePriceFilter,
  CourseSubjectFilter,
  CreateCourseLessonDto,
  CreateCourseDto,
  UpcomingCourseDateFilter,
  UpcomingCourseQueryDto,
  UpdateCourseLessonDto,
} from './dto/course.dto';

type CourseWithTutor = Prisma.CourseGetPayload<{
  include: {
    tutor: {
      select: {
        id: true;
        fullName: true;
        email: true;
        role: true;
        profile: {
          select: {
            avatarUrl: true;
            averageRating: true;
            totalReviews: true;
            teachingCategory: true;
          };
        };
      };
    };
  };
}>;

type CourseWithEnrollmentStats = CourseWithTutor & {
  enrolledStudentCount: number;
  enrollmentPercentage: number;
};

type EnrollmentRow = {
  id: string;
  courseId: string;
  studentId: string;
  createdAt: Date;
};

@Injectable()
export class CourseService {
  private readonly stripe?: Stripe.Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (secretKey) {
      this.stripe = new Stripe(secretKey);
    }
  }

  async createCourse(tutorId: string, dto: CreateCourseDto, imageFile?: any) {
    const isTutor = await this.prisma.user.findFirst({
      where: {
        id: tutorId,
        role: Role.TUTOR,
      },
    });

    if (!isTutor) {
      throw new UnauthorizedException(
        'You are not authorized to create a course',
      );
    }

    if (dto.minStudent > dto.maxStudent) {
      throw new BadRequestException(
        'Minimum student must be less than or equal to maximum student',
      );
    }

    const curriculumItems = this.normalizeCourseLessons(dto);
    const { curriculumItems: _curriculumItems, ...courseDto } = dto;
    const image = await this.uploadCourseImage(dto.image, imageFile);
    const course = await this.prisma.course.create({
      data: {
        ...courseDto,
        ...(image !== undefined && { image }),
        curriculums: this.getCourseCurriculums(dto, curriculumItems),
        startDate: new Date(dto.startDate ?? curriculumItems[0].date),
        time: dto.time ?? curriculumItems[0].time,
        enrollmentDeadline: new Date(dto.enrollmentDeadline),
        tutorId,
        curriculumItems: {
          createMany: {
            data: curriculumItems.map((item) => ({
              title: item.title,
              date: new Date(item.date),
              time: item.time,
            })),
          },
        },
      },
      include: this.getCourseMutationInclude(),
    });

    return {
      success: true,
      message: 'Course created successfully',
      data: course,
    };
  }

  async getCourseById(id: string) {
    const course = await this.prisma.course.findUnique({
      where: {
        id,
      },
      include: this.getCourseTutorInclude(),
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return {
      success: true,
      data: (await this.withTutorCompletedCoursesCount([course]))[0],
    };
  }

  async getAllCourse(query: UpcomingCourseQueryDto = {}) {
    const courses = await this.prisma.course.findMany({
      where: this.buildCourseFilter(query),
      include: this.getCourseTutorInclude(),
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      filters: {
        subject: query.subject ?? CourseSubjectFilter.ALL,
        price: query.price ?? CoursePriceFilter.ALL,
        date: query.date ?? UpcomingCourseDateFilter.ALL,
      },
      data: await this.withTutorCompletedCoursesCount(
        await this.withEnrollmentStats(courses),
      ),
    };
  }

  async updateCourse(courseId: string, tutorId: string, dto: CreateCourseDto) {
    const course = await this.prisma.course.findUnique({
      where: {
        id: courseId,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot update this course');
    }

    if (dto.minStudent && dto.maxStudent && dto.minStudent > dto.maxStudent) {
      throw new BadRequestException(
        'Minimum student must be less than maximum student',
      );
    }

    const curriculumItems = dto.curriculumItems
      ? this.normalizeCourseLessons(dto)
      : null;
    const { curriculumItems: _curriculumItems, ...courseDto } = dto;
    const image = await this.uploadCourseImage(dto.image);
    const updatedCourse = await this.prisma.course.update({
      where: {
        id: courseId,
      },
      data: {
        ...courseDto,
        ...(image !== undefined && { image }),
        ...(curriculumItems && {
          curriculums: this.getCourseCurriculums(dto, curriculumItems),
          startDate: new Date(dto.startDate ?? curriculumItems[0].date),
          time: dto.time ?? curriculumItems[0].time,
          curriculumItems: {
            deleteMany: {},
            createMany: {
              data: curriculumItems.map((item) => ({
                title: item.title,
                date: new Date(item.date),
                time: item.time,
              })),
            },
          },
        }),
        ...(dto.startDate &&
          !curriculumItems && {
            startDate: new Date(dto.startDate),
          }),
        ...(dto.enrollmentDeadline && {
          enrollmentDeadline: new Date(dto.enrollmentDeadline),
        }),
      },
      include: this.getCourseMutationInclude(),
    });

    return {
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse,
    };
  }

  async updateCurriculumItem(
    courseId: string,
    curriculumItemId: string,
    tutorId: string,
    dto: UpdateCourseLessonDto,
  ) {
    await this.assertTutorCourse(courseId, tutorId);

    if (!dto.title && !dto.date && !dto.time) {
      throw new BadRequestException(
        'Provide title, date, or time to update this lesson',
      );
    }

    const existingItem = await this.prisma.curriculum.findFirst({
      where: {
        id: curriculumItemId,
        courseId,
      },
      select: {
        id: true,
      },
    });

    if (!existingItem) {
      throw new NotFoundException('Course lesson not found');
    }

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      const item = await tx.curriculum.update({
        where: {
          id: curriculumItemId,
        },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.date && { date: new Date(dto.date) }),
          ...(dto.time && { time: dto.time }),
        },
      });

      await this.syncCourseCurriculumTitles(tx, courseId);

      return item;
    });

    return {
      success: true,
      message: 'Course lesson updated successfully',
      data: updatedItem,
    };
  }

  async deleteCurriculumItem(
    courseId: string,
    curriculumItemId: string,
    tutorId: string,
  ) {
    await this.assertTutorCourse(courseId, tutorId);

    const items = await this.getOrderedCurriculumItems(courseId);
    const deleteIndex = items.findIndex((item) => item.id === curriculumItemId);

    if (deleteIndex === -1) {
      throw new NotFoundException('Course lesson not found');
    }

    if (items.length <= 1) {
      throw new BadRequestException('A course must have at least one lesson');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.curriculum.delete({
        where: {
          id: curriculumItemId,
        },
      });

      await tx.curriculumProgress.deleteMany({
        where: {
          courseId,
          curriculumIndex: deleteIndex,
        },
      });

      await tx.studentLessonState.deleteMany({
        where: {
          courseId,
          curriculumIndex: deleteIndex,
        },
      });

      await tx.curriculumProgress.updateMany({
        where: {
          courseId,
          curriculumIndex: {
            gt: deleteIndex,
          },
        },
        data: {
          curriculumIndex: {
            decrement: 1,
          },
        },
      });

      await tx.studentLessonState.updateMany({
        where: {
          courseId,
          curriculumIndex: {
            gt: deleteIndex,
          },
        },
        data: {
          curriculumIndex: {
            decrement: 1,
          },
        },
      });

      await this.syncCourseCurriculumTitles(tx, courseId);
    });

    return {
      success: true,
      message: 'Course lesson deleted successfully',
      data: {
        courseId,
        deletedCurriculumItemId: curriculumItemId,
        remainingLessons: items.length - 1,
      },
    };
  }

  async deleteCoursebyId(courseId: string, tutorId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot delete this course');
    }

    await this.prisma.course.delete({
      where: { id: courseId },
    });

    return {
      success: true,
      message: 'Course deleted successfully',
    };
  }

  async completeCurriculum(
    courseId: string,
    curriculumIndex: number,
    studentId: string,
  ) {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: Role.STUDENT,
      },
      select: {
        id: true,
      },
    });

    if (!student) {
      throw new UnauthorizedException('Only students can complete classes');
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        curriculums: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.curriculums.length === 0) {
      throw new BadRequestException('Course has no classes to complete');
    }

    if (curriculumIndex < 0 || curriculumIndex >= course.curriculums.length) {
      throw new BadRequestException('Invalid curriculum index');
    }

    await this.prisma.curriculumProgress.upsert({
      where: {
        courseId_studentId_curriculumIndex: {
          courseId,
          studentId,
          curriculumIndex,
        },
      },
      update: {},
      create: {
        courseId,
        studentId,
        curriculumIndex,
      },
    });

    const totalClasses = course.curriculums.length;
    const completedClasses = await this.prisma.curriculumProgress.count({
      where: {
        courseId,
        studentId,
      },
    });

    const isCourseCompleted = completedClasses >= totalClasses;

    if (isCourseCompleted) {
      await this.prisma.courseCompletion.upsert({
        where: {
          courseId_studentId: {
            courseId,
            studentId,
          },
        },
        update: {},
        create: {
          courseId,
          studentId,
        },
      });
    }

    return {
      success: true,
      message: isCourseCompleted
        ? 'Course completed successfully'
        : 'Class completed successfully',
      data: {
        courseId,
        curriculumIndex,
        curriculum: course.curriculums[curriculumIndex],
        completedClasses,
        totalClasses,
        isCourseCompleted,
      },
    };
  }

  async getTutorCompletedCoursesCount(tutorId: string) {
    const completedCourses = await this.prisma.courseCompletion.findMany({
      where: {
        course: {
          tutorId,
        },
      },
      distinct: ['courseId'],
      select: {
        courseId: true,
      },
    });

    return completedCourses.length;
  }

  async enrollCourse(courseId: string, studentId: string) {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: Role.STUDENT,
      },
      select: {
        id: true,
      },
    });

    if (!student) {
      throw new UnauthorizedException('Only students can enroll in courses');
    }

    const course = await this.prisma.course.findUnique({
      where: {
        id: courseId,
      },
      select: {
        id: true,
        maxStudent: true,
        startDate: true,
        enrollmentDeadline: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const now = new Date();

    if (course.startDate <= now) {
      throw new BadRequestException('Course has already started');
    }

    if (course.enrollmentDeadline < now) {
      throw new BadRequestException('Enrollment deadline has passed');
    }

    const enrolledStudentCount = await this.getCourseEnrollmentCount(courseId);

    if (enrolledStudentCount >= course.maxStudent) {
      throw new BadRequestException('Course enrollment is full');
    }

    const existingEnrollment = await this.getStudentCourseEnrollment(
      courseId,
      studentId,
    );

    if (existingEnrollment) {
      throw new BadRequestException('Student is already enrolled');
    }

    const enrollment = await this.createCourseEnrollment(courseId, studentId);
    const updatedEnrolledStudentCount = enrolledStudentCount + 1;

    return {
      success: true,
      message: 'Student enrolled successfully',
      data: {
        ...enrollment,
        enrolledStudentCount: updatedEnrolledStudentCount,
        maxStudent: course.maxStudent,
        enrollmentPercentage: this.calculateEnrollmentPercentage(
          updatedEnrolledStudentCount,
          course.maxStudent,
        ),
      },
    };
  }

  async getUpcomingCourses(query: UpcomingCourseQueryDto) {
    const courses = await this.prisma.course.findMany({
      where: this.buildCourseFilter(query, true),
      include: this.getCourseTutorInclude(),
      orderBy: {
        startDate: 'asc',
      },
    });

    return {
      success: true,
      filters: {
        subject: query.subject ?? CourseSubjectFilter.ALL,
        price: query.price ?? CoursePriceFilter.ALL,
        date: query.date ?? UpcomingCourseDateFilter.ALL,
      },
      data: await this.withTutorCompletedCoursesCount(
        await this.withEnrollmentStats(courses),
      ),
    };
  }

  private buildCourseFilter(
    query: UpcomingCourseQueryDto = {},
    upcomingOnly = false,
  ): Prisma.CourseWhereInput {
    const { subject, price, date } = query;
    const where: Prisma.CourseWhereInput = {};

    if (upcomingOnly || (date && date !== UpcomingCourseDateFilter.ALL)) {
      where.startDate = this.getUpcomingStartDateFilter(date);
    }

    if (subject && subject !== CourseSubjectFilter.ALL) {
      where.category = {
        equals: subject,
        mode: 'insensitive',
      };
    }

    if (price && price !== CoursePriceFilter.ALL) {
      where.pricePerStudent = this.getCoursePriceFilter(price);
    }

    return where;
  }

  private getCoursePriceFilter(price: CoursePriceFilter): Prisma.FloatFilter {
    if (price === CoursePriceFilter.ZERO_TO_FORTY) {
      return {
        gte: 0,
        lte: 40,
      };
    }

    if (price === CoursePriceFilter.FORTY_TO_SIXTY) {
      return {
        gte: 40,
        lte: 60,
      };
    }

    return {
      gte: 60,
    };
  }

  private getCourseTutorInclude() {
    return {
      curriculumItems: {
        orderBy: {
          date: 'asc',
        },
      },
      tutor: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          profile: {
            select: {
              avatarUrl: true,
              averageRating: true,
              totalReviews: true,
              teachingCategory: true,
            },
          },
        },
      },
    } satisfies Prisma.CourseInclude;
  }

  private getCourseMutationInclude() {
    return {
      curriculumItems: {
        orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      },
    } satisfies Prisma.CourseInclude;
  }

  private async uploadCourseImage(image?: string, imageFile?: any) {
    if (imageFile) {
      return this.uploadCourseImageFile(imageFile);
    }

    if (!image || !image.startsWith('data:')) {
      return image;
    }

    const file = this.dataUrlToFile(image);
    return this.uploadCourseImageFile(file);
  }

  private async uploadCourseImageFile(file: any) {
    const upload = await this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/courses',
      resourceType: 'image',
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
      ],
      maxBytes: 10 * 1024 * 1024,
    });

    return upload.url;
  }

  private dataUrlToFile(dataUrl: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);

    if (!match) {
      throw new BadRequestException('Invalid course image data URL');
    }

    const [, mimetype, base64] = match;
    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Invalid course image data');
    }

    return {
      buffer,
      mimetype,
      size: buffer.length,
      originalname: `course-image.${this.getImageExtension(mimetype)}`,
    };
  }

  private getImageExtension(mimetype: string) {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };

    return extensions[mimetype] ?? 'png';
  }

  private async assertTutorCourse(courseId: string, tutorId: string) {
    const course = await this.prisma.course.findUnique({
      where: {
        id: courseId,
      },
      select: {
        id: true,
        tutorId: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot modify this course');
    }

    return course;
  }

  private getOrderedCurriculumItems(courseId: string) {
    return this.prisma.curriculum.findMany({
      where: {
        courseId,
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
      },
    });
  }

  private async syncCourseCurriculumTitles(
    tx: Prisma.TransactionClient,
    courseId: string,
  ) {
    const items = await tx.curriculum.findMany({
      where: {
        courseId,
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      select: {
        title: true,
        date: true,
        time: true,
      },
    });

    if (items.length === 0) {
      return;
    }

    await tx.course.update({
      where: {
        id: courseId,
      },
      data: {
        curriculums: items.map((item) => item.title),
        startDate: items[0].date,
        time: items[0].time,
      },
    });
  }

  private normalizeCourseLessons(
    dto: CreateCourseDto,
  ): CreateCourseLessonDto[] {
    const validCurriculumItems = this.getValidCurriculumItems(
      dto.curriculumItems,
    );

    if (validCurriculumItems.length) {
      return validCurriculumItems;
    }

    if (!dto.curriculums?.length) {
      throw new BadRequestException(
        'Provide curriculums or curriculumItems for this course',
      );
    }

    if (!dto.startDate || !dto.time) {
      throw new BadRequestException(
        'startDate and time are required when using curriculums as lesson titles only',
      );
    }

    return dto.curriculums.map((title, index) => {
      const date = new Date(dto.startDate as string);
      date.setDate(date.getDate() + index);

      return {
        title,
        date: date.toISOString(),
        time: dto.time as string,
      };
    });
  }

  private getValidCurriculumItems(curriculumItems?: CreateCourseLessonDto[]) {
    if (!Array.isArray(curriculumItems)) {
      return [];
    }

    return curriculumItems
      .filter((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }

        return Boolean(
          item.title &&
            item.date &&
            !Number.isNaN(new Date(item.date).getTime()) &&
            item.time,
        );
      })
      .map((item) => ({
        title: item.title,
        date: item.date,
        time: item.time,
      }));
  }

  private getCourseCurriculums(
    dto: CreateCourseDto,
    curriculumItems: CreateCourseLessonDto[],
  ) {
    return dto.curriculums?.length
      ? dto.curriculums
      : curriculumItems.map((item) => item.title);
  }

  private getUpcomingStartDateFilter(
    date?: UpcomingCourseDateFilter,
  ): Prisma.DateTimeFilter {
    const now = new Date();

    if (date === UpcomingCourseDateFilter.STARTING_SOON) {
      const sevenDaysFromNow = new Date(now);
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      return {
        gte: now,
        lte: sevenDaysFromNow,
      };
    }

    if (date === UpcomingCourseDateFilter.THIS_WEEK) {
      const endOfWeek = new Date(now);
      const daysUntilSunday = (7 - endOfWeek.getDay()) % 7;
      endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
      endOfWeek.setHours(23, 59, 59, 999);

      return {
        gte: now,
        lte: endOfWeek,
      };
    }

    if (date === UpcomingCourseDateFilter.THIS_MONTH) {
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      return {
        gte: now,
        lte: endOfMonth,
      };
    }

    return {
      gte: now,
    };
  }

  private async withEnrollmentStats(
    courses: CourseWithTutor[],
  ): Promise<CourseWithEnrollmentStats[]> {
    const courseIds = courses.map((course) => course.id);

    if (courseIds.length === 0) {
      return [];
    }

    await this.syncPaidCourseEnrollments(courseIds);

    const enrollmentCounts = await this.prisma.$queryRaw<
      { courseId: string; count: number }[]
    >`
      SELECT "courseId", COUNT(*)::integer AS "count"
      FROM "CourseEnrollment"
      WHERE "courseId" IN (${Prisma.join(courseIds)})
      GROUP BY "courseId"
    `;

    const enrollmentCountByCourse = enrollmentCounts.reduce<
      Record<string, number>
    >((counts, enrollmentCount) => {
      counts[enrollmentCount.courseId] = enrollmentCount.count;
      return counts;
    }, {});

    return courses.map((course) => {
      const enrolledStudentCount = enrollmentCountByCourse[course.id] ?? 0;

      return {
        ...course,
        enrolledStudentCount,
        enrollmentPercentage: this.calculateEnrollmentPercentage(
          enrolledStudentCount,
          course.maxStudent,
        ),
      };
    });
  }

  private async syncPaidCourseEnrollments(courseIds: string[]) {
    await this.syncPaidStripeCheckoutSessions(courseIds);

    const paidGroupPayments = await this.prisma.payment.findMany({
      where: {
        courseId: {
          in: courseIds,
          not: null,
        },
        type: PaymentType.GROUP,
        status: PaymentStatus.PAID,
      },
      select: {
        courseId: true,
        userId: true,
      },
    });

    const enrollments = paidGroupPayments
      .filter(
        (payment): payment is { courseId: string; userId: string } =>
          Boolean(payment.courseId),
      )
      .map((payment) => ({
        courseId: payment.courseId,
        studentId: payment.userId,
      }));

    if (enrollments.length === 0) {
      return;
    }

    await this.prisma.courseEnrollment.createMany({
      data: enrollments,
      skipDuplicates: true,
    });
  }

  private async syncPaidStripeCheckoutSessions(courseIds: string[]) {
    if (!this.stripe) {
      return;
    }

    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        courseId: {
          in: courseIds,
          not: null,
        },
        type: PaymentType.GROUP,
        status: PaymentStatus.PENDING,
        stripeSessionId: {
          not: null,
        },
      },
      select: {
        id: true,
        courseId: true,
        userId: true,
        amount: true,
        stripeSessionId: true,
      },
      take: 25,
    });

    for (const payment of pendingPayments) {
      if (!payment.courseId || !payment.stripeSessionId) {
        continue;
      }

      try {
        const session = await this.stripe.checkout.sessions.retrieve(
          payment.stripeSessionId,
        );

        if (session.payment_status !== 'paid') {
          continue;
        }

        const paidAt = new Date();
        const commissionRate = Number(
          process.env.PLATFORM_COMMISSION_RATE ?? 0.2,
        );
        const commissionAmount = payment.amount * commissionRate;
        const tutorAmount = payment.amount - commissionAmount;

        await this.prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              status: PaymentStatus.PAID,
              payoutStatus: PayoutStatus.ON_HOLD,
              paidAt,
              holdUntil: this.addHours(
                paidAt,
                Number(process.env.PAYOUT_HOLD_HOURS ?? 48),
              ),
              commissionRate,
              commissionAmount,
              tutorAmount,
              payoutFailureReason: null,
              stripePaymentIntentId:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : session.payment_intent?.id,
            },
          });

          await tx.courseEnrollment.upsert({
            where: {
              courseId_studentId: {
                courseId: payment.courseId as string,
                studentId: payment.userId,
              },
            },
            update: {},
            create: {
              courseId: payment.courseId as string,
              studentId: payment.userId,
            },
          });
        });
      } catch (error) {
        console.error(
          `Failed to sync Stripe checkout session ${payment.stripeSessionId}`,
          error,
        );
      }
    }
  }

  private addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  private async getCourseEnrollmentCount(courseId: string) {
    const [enrollmentCount] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::integer AS "count"
      FROM "CourseEnrollment"
      WHERE "courseId" = ${courseId}
    `;

    return enrollmentCount?.count ?? 0;
  }

  private async getStudentCourseEnrollment(
    courseId: string,
    studentId: string,
  ) {
    const [enrollment] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "CourseEnrollment"
      WHERE "courseId" = ${courseId}
        AND "studentId" = ${studentId}
      LIMIT 1
    `;

    return enrollment ?? null;
  }

  private async createCourseEnrollment(courseId: string, studentId: string) {
    const [enrollment] = await this.prisma.$queryRaw<EnrollmentRow[]>`
      INSERT INTO "CourseEnrollment" ("id", "courseId", "studentId")
      VALUES (${randomUUID()}, ${courseId}, ${studentId})
      RETURNING "id", "courseId", "studentId", "createdAt"
    `;

    return enrollment;
  }

  private calculateEnrollmentPercentage(
    enrolledStudentCount: number,
    maxStudent: number,
  ) {
    if (maxStudent <= 0) {
      return 0;
    }

    return Math.round((enrolledStudentCount / maxStudent) * 100);
  }

  private async withTutorCompletedCoursesCount(courses: CourseWithTutor[]) {
    const tutorIds = [...new Set(courses.map((course) => course.tutorId))];

    if (tutorIds.length === 0) {
      return courses;
    }

    const completedCourses = await this.prisma.courseCompletion.findMany({
      where: {
        course: {
          tutorId: {
            in: tutorIds,
          },
        },
      },
      distinct: ['courseId'],
      select: {
        course: {
          select: {
            tutorId: true,
          },
        },
      },
    });

    const completedCourseCountByTutor = completedCourses.reduce<
      Record<string, number>
    >((counts, completion) => {
      const tutorId = completion.course.tutorId;
      counts[tutorId] = (counts[tutorId] ?? 0) + 1;
      return counts;
    }, {});

    return courses.map((course) => ({
      ...course,
      tutor: {
        ...course.tutor,
        profile: course.tutor.profile
          ? {
              ...course.tutor.profile,
              completedCoursesCount:
                completedCourseCountByTutor[course.tutorId] ?? 0,
            }
          : null,
      },
    }));
  }
}
