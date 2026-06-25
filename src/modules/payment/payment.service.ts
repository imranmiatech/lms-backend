import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  PaymentStatus,
  PaymentType,
  PayoutStatus,
  Prisma,
  Role,
} from '@prisma/client';
import Stripe = require('stripe');
import { PrismaService } from 'src/prisma/prisma.service';
import { AgoraService } from '../agora/agora.service';
import { getTimedClassStatus } from '../common/time/lesson-status.util';
import { NotificationService } from '../notification/notification.service';
import { NotificationAudience } from '../notification/dto/notification.dto';
import {
  CreateCheckoutSessionDto,
  CreateGroupClassCheckoutSessionDto,
  CreatePrivateBookingCheckoutSessionDto,
} from './dto/create-payment.dto';

type TutorDashboardTransactionQuery = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
};

type StudentDashboardTransactionQuery = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
};

type TutorPrivateLessonsQuery = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
};

type PrivateLessonQuery = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
};

@Injectable()
export class PaymentService implements OnModuleInit, OnModuleDestroy {
  private readonly stripe: Stripe.Stripe;
  private payoutInterval?: NodeJS.Timeout;
  private isProcessingPayouts = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agoraService: AgoraService,
    private readonly notificationService: NotificationService,
  ) {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new InternalServerErrorException('STRIPE_SECRET_KEY is not set');
    }

    this.stripe = new Stripe(secretKey);
  }

  onModuleInit() {
    const intervalMs = Number(
      process.env.PAYOUT_PROCESSOR_INTERVAL_MS ?? 10 * 60 * 1000,
    );

    if (intervalMs > 0) {
      this.payoutInterval = setInterval(() => {
        this.processDuePayouts().catch((error) => {
          console.error('Auto payout processor failed', error);
        });
      }, intervalMs);
    }
  }

  onModuleDestroy() {
    if (this.payoutInterval) {
      clearInterval(this.payoutInterval);
    }
  }

  async createCheckoutSession(userId: string, dto: CreateCheckoutSessionDto) {
    const isGroupPayment = Boolean(dto.courseId);
    const isPrivatePayment = Boolean(dto.tutorId);

    if (isGroupPayment === isPrivatePayment) {
      throw new BadRequestException(
        'Provide either courseId for group course payment or tutorId for private tutor payment',
      );
    }

    if (isPrivatePayment) {
      return this.createPrivateCheckoutSession(userId, {
        tutorId: dto.tutorId!,
        sessionCount: dto.sessionCount,
        scheduledAt: dto.scheduledAt,
      });
    }

    return this.createGroupClassCheckoutSession(userId, {
      courseId: dto.courseId!,
    });
  }

  async createGroupClassCheckoutSession(
    userId: string,
    dto: CreateGroupClassCheckoutSessionDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.STUDENT) {
      throw new BadRequestException(
        'Only students can create checkout sessions',
      );
    }

    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: {
        id: true,
        tutorId: true,
        title: true,
        pricePerStudent: true,
        maxStudent: true,
        enrollmentDeadline: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.enrollmentDeadline < new Date()) {
      throw new BadRequestException('Enrollment deadline has passed');
    }

    const existingEnrollment = await this.prisma.courseEnrollment.findUnique({
      where: {
        courseId_studentId: {
          courseId: course.id,
          studentId: userId,
        },
      },
    });

    if (existingEnrollment) {
      throw new BadRequestException('Student is already enrolled');
    }

    const enrolledStudentCount = await this.prisma.courseEnrollment.count({
      where: { courseId: course.id },
    });

    if (enrolledStudentCount >= course.maxStudent) {
      throw new BadRequestException('Course enrollment is full');
    }

    const amount = course.pricePerStudent;

    if (amount <= 0) {
      throw new BadRequestException('Course price must be greater than 0');
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        tutorId: course.tutorId,
        courseId: course.id,
        amount,
        currency: 'usd',
        status: PaymentStatus.PENDING,
        type: PaymentType.GROUP,
        payoutStatus: PayoutStatus.PENDING,
      },
    });

    const frontendUrl = this.getFrontendUrl();
    const backendUrl = this.getBackendUrl();
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: payment.currency,
            product_data: {
              name: course.title,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: payment.id,
        courseId: course.id,
        tutorId: course.tutorId,
        userId,
        type: PaymentType.GROUP,
      },
      success_url: `${backendUrl}/payment/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/payment/cancel`,
    });

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { stripeSessionId: session.id },
    });

    return {
      success: true,
      message: 'Checkout session created successfully',
      data: {
        payment: updatedPayment,
        sessionId: session.id,
        url: session.url,
      },
    };
  }

  async createPrivateCheckoutSession(
    userId: string,
    dto: CreatePrivateBookingCheckoutSessionDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.STUDENT) {
      throw new BadRequestException('Only students can hire tutors');
    }

    if (userId === dto.tutorId) {
      throw new BadRequestException('Students cannot hire themselves');
    }

    const tutor = await this.prisma.user.findFirst({
      where: {
        id: dto.tutorId,
        role: Role.TUTOR,
      },
      select: {
        id: true,
        fullName: true,
        profile: {
          select: {
            pricePerHour: true,
            sessionDuration: true,
          },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const pricePerHour = tutor.profile?.pricePerHour;

    if (!pricePerHour || pricePerHour <= 0) {
      throw new BadRequestException('Tutor private session price is not set');
    }

    const sessionCount = dto.sessionCount ?? 1;
    const sessionDuration = tutor.profile?.sessionDuration ?? 60;
    const durationMinutes = sessionCount * sessionDuration;
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid date');
    }

    const amount = pricePerHour * sessionCount;

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        tutorId: tutor.id,
        amount,
        currency: 'usd',
        status: PaymentStatus.PENDING,
        type: PaymentType.PRIVATE,
        payoutStatus: PayoutStatus.PENDING,
        privateLessonStartsAt: scheduledAt,
        privateLessonDuration: durationMinutes,
        privateLessonSessions: sessionCount,
      },
    });

    const frontendUrl = this.getFrontendUrl();
    const backendUrl = this.getBackendUrl();
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: payment.currency,
            product_data: {
              name: `Private session with ${tutor.fullName}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: payment.id,
        tutorId: tutor.id,
        userId,
        type: PaymentType.PRIVATE,
        sessionCount: String(sessionCount),
        durationMinutes: String(durationMinutes),
        ...(scheduledAt && { scheduledAt: scheduledAt.toISOString() }),
      },
      success_url: `${backendUrl}/payment/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/payment/cancel`,
    });

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { stripeSessionId: session.id },
    });

    return {
      success: true,
      message: 'Private checkout session created successfully',
      data: {
        payment: updatedPayment,
        sessionId: session.id,
        url: session.url,
      },
    };
  }

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Missing raw request body. Restart the backend after enabling rawBody for Stripe webhooks.',
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'STRIPE_WEBHOOK_SECRET is not set',
      );
    }

    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid webhook';
      throw new BadRequestException(
        `Webhook signature verification failed: ${message}`,
      );
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object);
        break;
      case 'checkout.session.expired':
        await this.updatePaymentFromSession(
          event.data.object,
          PaymentStatus.CANCELLED,
        );
        break;
      case 'checkout.session.async_payment_failed':
        await this.updatePaymentFromSession(
          event.data.object,
          PaymentStatus.FAILED,
        );
        break;
      default:
        break;
    }

    return { received: true };
  }

  async syncCheckoutSession(userId: string, sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);

    const payment = await this.prisma.payment.findFirst({
      where: {
        stripeSessionId: session.id,
        userId,
      },
      select: {
        id: true,
        courseId: true,
        userId: true,
        status: true,
        type: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Checkout session payment not found');
    }

    if (session.payment_status === 'paid') {
      await this.handleCheckoutCompleted(session);
    } else if (session.status === 'expired') {
      await this.updatePaymentFromSession(session, PaymentStatus.CANCELLED);
    }

    const syncedPayment = await this.prisma.payment.findUnique({
      where: {
        id: payment.id,
      },
      select: {
        id: true,
        courseId: true,
        status: true,
        type: true,
      },
    });

    const enrolled =
      syncedPayment?.type === PaymentType.GROUP && syncedPayment.courseId
        ? Boolean(
            await this.prisma.courseEnrollment.findUnique({
              where: {
                courseId_studentId: {
                  courseId: syncedPayment.courseId,
                  studentId: userId,
                },
              },
              select: {
                id: true,
              },
            }),
          )
        : false;

    return {
      success: true,
      data: {
        sessionId: session.id,
        paymentId: payment.id,
        paymentStatus: syncedPayment?.status ?? payment.status,
        stripePaymentStatus: session.payment_status,
        stripeSessionStatus: session.status,
        enrolled,
        courseId: syncedPayment?.courseId ?? payment.courseId,
      },
    };
  }

  async handleCheckoutSuccessRedirect(sessionId?: string) {
    const frontendUrl = this.getFrontendUrl();

    if (!sessionId) {
      return {
        url: `${frontendUrl}/payment/cancel?reason=missing_session`,
        statusCode: 302,
      };
    }

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    const payment = await this.prisma.payment.findFirst({
      where: {
        stripeSessionId: session.id,
      },
      select: {
        id: true,
        courseId: true,
        status: true,
        type: true,
      },
    });

    if (!payment) {
      return {
        url: `${frontendUrl}/payment/cancel?reason=payment_not_found&session_id=${encodeURIComponent(session.id)}`,
        statusCode: 302,
      };
    }

    if (session.payment_status === 'paid') {
      await this.handleCheckoutCompleted(session);
    } else if (session.status === 'expired') {
      await this.updatePaymentFromSession(session, PaymentStatus.CANCELLED);
    }

    const syncedPayment = await this.prisma.payment.findUnique({
      where: {
        id: payment.id,
      },
      select: {
        id: true,
        courseId: true,
        status: true,
        type: true,
      },
    });

    const query = new URLSearchParams({
      session_id: session.id,
      payment_id: payment.id,
      status: syncedPayment?.status ?? payment.status,
      type: syncedPayment?.type ?? payment.type,
    });

    if (syncedPayment?.courseId) {
      query.set('course_id', syncedPayment.courseId);
    }

    return {
      url: `${frontendUrl}/payment/success?${query.toString()}`,
      statusCode: 302,
    };
  }

  async findMyPayments(userId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        tutor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: {
              select: {
                avatarUrl: true,
              },
            },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            image: true,
            startDate: true,
            pricePerStudent: true,
          },
        },
      },
    });

    return {
      success: true,
      data: payments,
    };
  }

  async findStudentDashboard(userId: string) {
    const [totalPaid, totalPending, payments] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          userId,
          status: PaymentStatus.PAID,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          userId,
          status: PaymentStatus.PENDING,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          tutor: {
            select: {
              id: true,
              fullName: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              image: true,
              startDate: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        totalPaid: totalPaid._sum.amount ?? 0,
        totalPending: totalPending._sum.amount ?? 0,
        transactions: payments.map((payment) => ({
          transactionId: payment.id,
          tutorId: payment.tutorId,
          tutorName: payment.tutor.fullName,
          tutorImage: payment.tutor.profile?.avatarUrl ?? null,
          courseId: payment.courseId,
          courseTitle: payment.course?.title ?? null,
          courseImage: payment.course?.image ?? null,
          amount: payment.amount,
          type: this.formatPaymentType(payment.type),
          date: payment.createdAt,
          status: this.formatPaymentStatus(payment.status),
        })),
      },
    };
  }

  async findStudentDashboardMeta(userId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      totalSpent,
      totalPayments,
      totalCourses,
      enrolledThisMonth,
      thisMonthSpent,
      thisMonthPayments,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          userId,
          status: PaymentStatus.PAID,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          userId,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.courseEnrollment.count({
        where: {
          studentId: userId,
        },
      }),
      this.prisma.courseEnrollment.count({
        where: {
          studentId: userId,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          userId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          userId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        cards: {
          totalSpent: {
            amount: totalSpent._sum.amount ?? 0,
            paymentCount: totalPayments,
          },
          totalCourses: {
            count: totalCourses,
            enrolledThisMonth,
          },
          thisMonth: {
            amount: thisMonthSpent._sum.amount ?? 0,
            paymentCount: thisMonthPayments,
          },
        },
      },
    };
  }

  async findStudentDashboardTransactions(
    userId: string,
    query: StudentDashboardTransactionQuery,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const status = this.parsePaymentStatus(query.status);
    const type = this.parsePaymentType(query.type);

    const where: Prisma.PaymentWhereInput = {
      userId,
      ...(status && { status }),
      ...(type && { type }),
    };

    const [total, payments] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          tutor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              image: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + payments.length, total);

    return {
      success: true,
      data: payments.map((payment) => this.mapStudentTransaction(payment)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        from,
        to,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }

  async findTutorDashboard(tutorId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      totalEarning,
      thisMonthEarning,
      totalPendingPayout,
      groupPaymentsCount,
      groupPaidPaymentsCount,
      privatePaymentsCount,
      privatePaidPaymentsCount,
      payments,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          payoutStatus: {
            in: [
              PayoutStatus.ON_HOLD,
              PayoutStatus.PROCESSING,
              PayoutStatus.FAILED,
            ],
          },
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.GROUP,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.GROUP,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.PRIVATE,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.PRIVATE,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.payment.findMany({
        where: { tutorId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        totalEarning: totalEarning._sum.tutorAmount ?? 0,
        thisMonthEarning: thisMonthEarning._sum.tutorAmount ?? 0,
        totalPendingPayout: totalPendingPayout._sum.tutorAmount ?? 0,
        paidStudentPercentage: {
          group: this.calculatePercentage(
            groupPaidPaymentsCount,
            groupPaymentsCount,
          ),
          private: this.calculatePercentage(
            privatePaidPaymentsCount,
            privatePaymentsCount,
          ),
        },
        transactions: payments.map((payment) => ({
          transactionId: payment.id,
          studentId: payment.userId,
          studentName: payment.user.fullName,
          studentImage: payment.user.profile?.avatarUrl ?? null,
          studentEmail: payment.user.email,
          courseId: payment.courseId,
          courseTitle: payment.course?.title ?? null,
          amount: payment.amount,
          type: this.formatPaymentType(payment.type),
          date: payment.createdAt,
          status: this.formatPaymentStatus(payment.status),
          payoutStatus: payment.payoutStatus.toLowerCase(),
        })),
      },
    };
  }

  async findTutorDashboardMeta(tutorId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      totalEarning,
      thisMonthEarning,
      previousMonthEarning,
      totalPendingPayout,
      paidGroupStudents,
      paidPrivateStudents,
      revenueRows,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: previousMonthStart,
            lt: monthStart,
          },
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          payoutStatus: {
            in: [
              PayoutStatus.ON_HOLD,
              PayoutStatus.PROCESSING,
              PayoutStatus.FAILED,
            ],
          },
        },
        _sum: {
          tutorAmount: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.GROUP,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.payment.count({
        where: {
          tutorId,
          type: PaymentType.PRIVATE,
          status: PaymentStatus.PAID,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: yearStart,
            lt: nextMonthStart,
          },
        },
        select: {
          tutorAmount: true,
          createdAt: true,
        },
      }),
    ]);

    const thisMonthAmount = thisMonthEarning._sum.tutorAmount ?? 0;
    const previousMonthAmount = previousMonthEarning._sum.tutorAmount ?? 0;
    const totalPaidStudents = paidGroupStudents + paidPrivateStudents;

    return {
      success: true,
      data: {
        cards: {
          totalEarning: {
            amount: totalEarning._sum.tutorAmount ?? 0,
            label: 'all time',
          },
          thisMonth: {
            amount: thisMonthAmount,
            changePercentage: this.calculateChangePercentage(
              thisMonthAmount,
              previousMonthAmount,
            ),
            label: 'vs last month',
          },
          pendingPayout: {
            amount: totalPendingPayout._sum.tutorAmount ?? 0,
            label: 'Processing',
          },
        },
        revenueOverview: {
          period: `${yearStart.toLocaleString('en-US', { month: 'short' })}-${now.toLocaleString('en-US', { month: 'short' })} ${now.getFullYear()}`,
          interval: 'monthly',
          data: this.buildMonthlyRevenueOverview(revenueRows, now),
        },
        paidStudent: {
          total: totalPaidStudents,
          group: {
            count: paidGroupStudents,
            percentage: this.calculatePercentage(
              paidGroupStudents,
              totalPaidStudents,
            ),
          },
          private: {
            count: paidPrivateStudents,
            percentage: this.calculatePercentage(
              paidPrivateStudents,
              totalPaidStudents,
            ),
          },
        },
      },
    };
  }

  async findTutorDashboardTransactions(
    tutorId: string,
    query: TutorDashboardTransactionQuery,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const status = this.parsePaymentStatus(query.status);
    const type = this.parsePaymentType(query.type);

    const where: Prisma.PaymentWhereInput = {
      tutorId,
      ...(status && { status }),
      ...(type && { type }),
    };

    const [total, payments] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + payments.length, total);

    return {
      success: true,
      data: payments.map((payment) => this.mapTutorTransaction(payment)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        from,
        to,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }

  async findTutorPrivateLessons(
    tutorId: string,
    query: TutorPrivateLessonsQuery,
  ) {
    await this.syncPendingPrivateCheckoutSessions({ tutorId });

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const requestedStatus = this.parsePrivateLessonStatus(query.status);

    const where: Prisma.PaymentWhereInput = {
      tutorId,
      type: PaymentType.PRIVATE,
      ...(search && {
        OR: [
          {
            user: {
              fullName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
          {
            user: {
              email: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        ],
      }),
    };

    if (requestedStatus === 'upcoming') {
      where.status = { in: [PaymentStatus.PENDING, PaymentStatus.PAID] };
    }

    if (requestedStatus === 'cancelled') {
      where.status = { in: [PaymentStatus.CANCELLED, PaymentStatus.FAILED] };
    }

    if (requestedStatus === 'live' || requestedStatus === 'completed') {
      where.status = PaymentStatus.PAID;
    }

    const querySkip =
      requestedStatus === 'live' || requestedStatus === 'completed' ? 0 : skip;
    const queryTake =
      requestedStatus === 'live' || requestedStatus === 'completed'
        ? undefined
        : limit;

    const [totalBeforeDerivedFilter, payments, tutor] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip: querySkip,
        ...(queryTake && { take: queryTake }),
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: tutorId },
        select: {
          profile: {
            select: {
              pricePerHour: true,
              sessionDuration: true,
              teachingCategory: true,
            },
          },
        },
      }),
    ]);

    const pricePerHour = tutor?.profile?.pricePerHour ?? null;
    const defaultDurationMinutes = tutor?.profile?.sessionDuration ?? 60;
    const rows = payments
      .map((payment) =>
        this.mapPrivateLesson(payment, pricePerHour, defaultDurationMinutes),
      )
      .filter((lesson) =>
        requestedStatus ? lesson.status === requestedStatus : true,
      );
    const pageRows =
      requestedStatus === 'live' || requestedStatus === 'completed'
        ? rows.slice(skip, skip + limit)
        : rows;
    const total =
      requestedStatus === 'live' || requestedStatus === 'completed'
        ? rows.length
        : totalBeforeDerivedFilter;
    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + pageRows.length, total);

    return {
      success: true,
      data: pageRows,
      meta: {
        page,
        limit,
        total,
        totalPages,
        from,
        to,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
        filters: {
          status: requestedStatus ?? 'all',
          search: search ?? null,
        },
      },
    };
  }

  async findStudentPrivateLessons(
    studentId: string,
    query: PrivateLessonQuery,
  ) {
    await this.syncPendingPrivateCheckoutSessions({ studentId });

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const requestedStatus = this.parsePrivateLessonStatus(query.status);

    const where: Prisma.PaymentWhereInput = {
      userId: studentId,
      type: PaymentType.PRIVATE,
      ...(search && {
        OR: [
          {
            tutor: {
              fullName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
          {
            tutor: {
              email: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        ],
      }),
    };

    if (requestedStatus === 'upcoming') {
      where.status = { in: [PaymentStatus.PENDING, PaymentStatus.PAID] };
    }

    if (requestedStatus === 'cancelled') {
      where.status = { in: [PaymentStatus.CANCELLED, PaymentStatus.FAILED] };
    }

    if (requestedStatus === 'live' || requestedStatus === 'completed') {
      where.status = PaymentStatus.PAID;
    }

    const querySkip = requestedStatus ? 0 : skip;
    const queryTake = requestedStatus ? undefined : limit;

    const [totalBeforeDerivedFilter, payments] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip: querySkip,
        ...(queryTake && { take: queryTake }),
        orderBy: [{ privateLessonStartsAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
          tutor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                  pricePerHour: true,
                  sessionDuration: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const rows = payments
      .map((payment) => this.serializePrivateLesson(payment))
      .filter((lesson) =>
        requestedStatus ? lesson.status === requestedStatus : true,
      );
    const pageRows = requestedStatus ? rows.slice(skip, skip + limit) : rows;
    const total = requestedStatus ? rows.length : totalBeforeDerivedFilter;
    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + pageRows.length, total);

    return {
      success: true,
      data: pageRows,
      meta: {
        page,
        limit,
        total,
        totalPages,
        from,
        to,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
        filters: {
          status: requestedStatus ?? 'all',
          search: search ?? null,
        },
      },
    };
  }

  async getTutorPrivateLessonJoinPreview(tutorId: string, paymentId: string) {
    const lesson = await this.getPrivateLessonForTutor(tutorId, paymentId);
    const channelName = this.agoraService.buildPrivateLessonChannelName(
      lesson.paymentId,
    );

    return {
      success: true,
      data: {
        lesson,
        deviceChecks: [
          {
            type: 'camera',
            label: 'Camera is ready',
            required: true,
          },
          {
            type: 'microphone',
            label: 'Microphone is ready',
            required: true,
          },
        ],
        agora: {
          ...this.agoraService.getClientConfig(),
          channelName,
        },
      },
    };
  }

  async joinTutorPrivateLesson(tutorId: string, paymentId: string) {
    const lesson = await this.getPrivateLessonForTutor(tutorId, paymentId);

    return this.buildPrivateLessonJoinResponse({
      lesson,
      account: tutorId,
    });
  }

  async getStudentPrivateLessonJoinPreview(
    studentId: string,
    paymentId: string,
  ) {
    const lesson = await this.getPrivateLessonForStudent(studentId, paymentId);
    const channelName = this.agoraService.buildPrivateLessonChannelName(
      lesson.paymentId,
    );

    return {
      success: true,
      data: {
        lesson,
        deviceChecks: [
          {
            type: 'camera',
            label: 'Camera is ready',
            required: true,
          },
          {
            type: 'microphone',
            label: 'Microphone is ready',
            required: true,
          },
        ],
        agora: {
          ...this.agoraService.getClientConfig(),
          channelName,
        },
      },
    };
  }

  async joinStudentPrivateLesson(studentId: string, paymentId: string) {
    const lesson = await this.getPrivateLessonForStudent(studentId, paymentId);

    return this.buildPrivateLessonJoinResponse({
      lesson,
      account: studentId,
    });
  }

  async createTutorConnectOnboarding(userId: string) {
    const tutor = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: Role.TUTOR,
      },
      include: {
        paymentInfo: true,
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    let stripeAccountId = tutor.paymentInfo?.stripeAccountId;

    if (!stripeAccountId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        email: tutor.email,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          userId: tutor.id,
        },
      });

      stripeAccountId = account.id;

      await this.prisma.paymentInformation.upsert({
        where: { userId: tutor.id },
        update: {
          paymentMethod: 'Stripe Connect',
          legalName: tutor.fullName,
          stripeAccountId,
          payoutsEnabled: Boolean(account.payouts_enabled),
          chargesEnabled: Boolean(account.charges_enabled),
          verifiedAt: account.payouts_enabled ? new Date() : null,
        },
        create: {
          userId: tutor.id,
          paymentMethod: 'Stripe Connect',
          legalName: tutor.fullName,
          stripeAccountId,
          payoutsEnabled: Boolean(account.payouts_enabled),
          chargesEnabled: Boolean(account.charges_enabled),
          verifiedAt: account.payouts_enabled ? new Date() : null,
        },
      });
    }

    const frontendUrl = this.getFrontendUrl();
    const accountLink = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${frontendUrl}/tutor/settings/payment?connect=refresh`,
      return_url: `${frontendUrl}/tutor/settings/payment?connect=success`,
      type: 'account_onboarding',
    });

    return {
      success: true,
      data: {
        stripeAccountId,
        url: accountLink.url,
      },
    };
  }

  async syncTutorConnectStatus(userId: string) {
    const paymentInfo = await this.prisma.paymentInformation.findUnique({
      where: { userId },
    });

    if (!paymentInfo?.stripeAccountId) {
      throw new NotFoundException('Stripe Connect account not found');
    }

    const account = await this.stripe.accounts.retrieve(
      paymentInfo.stripeAccountId,
    );
    const bankAccount = account.external_accounts?.data.find(
      (externalAccount) => externalAccount.object === 'bank_account',
    );

    const updated = await this.prisma.paymentInformation.update({
      where: { userId },
      data: {
        payoutsEnabled: Boolean(account.payouts_enabled),
        chargesEnabled: Boolean(account.charges_enabled),
        bankLast4:
          bankAccount && 'last4' in bankAccount ? bankAccount.last4 : null,
        verifiedAt: account.payouts_enabled ? new Date() : null,
      },
    });

    return {
      success: true,
      data: {
        stripeAccountId: updated.stripeAccountId,
        payoutsEnabled: updated.payoutsEnabled,
        chargesEnabled: updated.chargesEnabled,
        bankLast4: updated.bankLast4,
        verifiedAt: updated.verifiedAt,
      },
    };
  }

  async findOne(userId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, userId },
      include: {
        course: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return {
      success: true,
      data: payment,
    };
  }

  private async handleCheckoutCompleted(session: any) {
    const paymentId = session.metadata?.paymentId;
    const paidAt = new Date();
    const { commissionRate, holdHours } = this.getPayoutConfig();

    const payment = await this.prisma.payment.findFirst({
      where: paymentId ? { id: paymentId } : { stripeSessionId: session.id },
      select: {
        id: true,
        courseId: true,
        userId: true,
        type: true,
        amount: true,
        status: true,
        course: {
          select: {
            id: true,
            title: true,
          },
        },
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!payment) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          payoutStatus: PayoutStatus.ON_HOLD,
          paidAt,
          holdUntil: this.addHours(paidAt, holdHours),
          commissionRate,
          commissionAmount: this.calculateCommission(payment.amount),
          tutorAmount: this.calculateTutorAmount(payment.amount),
          payoutFailureReason: null,
          stripePaymentIntentId:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id,
        },
      });

      if (payment.type === PaymentType.GROUP && payment.courseId) {
        await tx.courseEnrollment.upsert({
          where: {
            courseId_studentId: {
              courseId: payment.courseId,
              studentId: payment.userId,
            },
          },
          update: {},
          create: {
            courseId: payment.courseId,
            studentId: payment.userId,
          },
        });
      }
    });

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.type === PaymentType.GROUP &&
      payment.courseId
    ) {
      await this.notifyAdmins({
        type: 'COURSE_ENROLLMENT',
        title: 'New course enrollment',
        body: `${payment.user.fullName} enrolled in ${payment.course?.title ?? 'a course'}.`,
        targetUrl: `/admindashboard/group-classes/${payment.courseId}`,
        data: {
          paymentId: payment.id,
          courseId: payment.courseId,
          courseTitle: payment.course?.title,
          studentId: payment.user.id,
          studentName: payment.user.fullName,
          studentEmail: payment.user.email,
          amount: payment.amount,
        },
      });
    }
  }

  private async notifyAdmins(payload: {
    type: string;
    title: string;
    body?: string;
    targetUrl?: string;
    data?: Record<string, unknown>;
  }) {
    try {
      await this.notificationService.create({
        audience: NotificationAudience.ROLE,
        role: Role.ADMIN,
        ...payload,
      });
    } catch (error) {
      console.error('Failed to create admin notification', error);
    }
  }

  private async updatePaymentFromSession(session: any, status: PaymentStatus) {
    const paymentId = session.metadata?.paymentId;

    if (!paymentId) {
      return;
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [{ id: paymentId }, { stripeSessionId: session.id }],
      },
      select: { id: true },
    });

    if (!payment) {
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status },
    });
  }

  private async syncPendingPrivateCheckoutSessions(input: {
    studentId?: string;
    tutorId?: string;
  }) {
    if (!input.studentId && !input.tutorId) {
      return;
    }

    const payments = await this.prisma.payment.findMany({
      where: {
        type: PaymentType.PRIVATE,
        status: PaymentStatus.PENDING,
        stripeSessionId: {
          not: null,
        },
        ...(input.studentId && { userId: input.studentId }),
        ...(input.tutorId && { tutorId: input.tutorId }),
      },
      select: {
        id: true,
        stripeSessionId: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 25,
    });

    for (const payment of payments) {
      if (!payment.stripeSessionId) {
        continue;
      }

      try {
        const session = await this.stripe.checkout.sessions.retrieve(
          payment.stripeSessionId,
        );

        if (session.payment_status === 'paid') {
          await this.handleCheckoutCompleted(session);
        } else if (session.status === 'expired') {
          await this.updatePaymentFromSession(session, PaymentStatus.CANCELLED);
        }
      } catch (error) {
        console.error(
          `Failed to sync Stripe checkout session for payment ${payment.id}`,
          error,
        );
      }
    }
  }

  async processDuePayouts(limit = 25) {
    if (this.isProcessingPayouts) {
      return { success: true, processed: 0, skipped: true };
    }

    this.isProcessingPayouts = true;

    try {
      const now = new Date();
      const duePayments = await this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          payoutStatus: {
            in: [PayoutStatus.ON_HOLD, PayoutStatus.FAILED],
          },
          holdUntil: {
            lte: now,
          },
        },
        take: limit,
        orderBy: {
          holdUntil: 'asc',
        },
        include: {
          tutor: {
            select: {
              id: true,
              paymentInfo: {
                select: {
                  stripeAccountId: true,
                  payoutsEnabled: true,
                },
              },
            },
          },
        },
      });

      let processed = 0;

      for (const payment of duePayments) {
        const claimedPayment = await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PAID,
            payoutStatus: payment.payoutStatus,
          },
          data: {
            payoutStatus: PayoutStatus.PROCESSING,
            payoutFailureReason: null,
          },
        });

        if (claimedPayment.count === 0) {
          continue;
        }

        await this.releaseTutorPayout(payment);
        processed += 1;
      }

      return { success: true, processed };
    } finally {
      this.isProcessingPayouts = false;
    }
  }

  private async releaseTutorPayout(
    payment: Prisma.PaymentGetPayload<{
      include: {
        tutor: {
          select: {
            id: true;
            paymentInfo: {
              select: {
                stripeAccountId: true;
                payoutsEnabled: true;
              };
            };
          };
        };
      };
    }>,
  ) {
    const stripeAccountId = payment.tutor.paymentInfo?.stripeAccountId;

    if (!stripeAccountId || !payment.tutor.paymentInfo?.payoutsEnabled) {
      await this.markPayoutFailed(
        payment.id,
        'Tutor Stripe Connect account is missing or payouts are not enabled',
      );
      return;
    }

    if (payment.tutorAmount <= 0) {
      await this.markPayoutFailed(payment.id, 'Tutor payout amount is zero');
      return;
    }

    try {
      const transfer = await this.stripe.transfers.create({
        amount: Math.round(payment.tutorAmount * 100),
        currency: payment.currency,
        destination: stripeAccountId,
        metadata: {
          paymentId: payment.id,
          tutorId: payment.tutorId,
          studentId: payment.userId,
          commissionAmount: String(payment.commissionAmount),
          tutorAmount: String(payment.tutorAmount),
        },
      });

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          payoutStatus: PayoutStatus.PAID,
          paidOutAt: new Date(),
          payoutTransferId: transfer.id,
          payoutFailureReason: null,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Stripe transfer failed';
      await this.markPayoutFailed(payment.id, message);
    }
  }

  private async markPayoutFailed(paymentId: string, reason: string) {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        payoutStatus: PayoutStatus.FAILED,
        payoutFailureReason: reason,
      },
    });
  }

  private async getPrivateLessonForTutor(tutorId: string, paymentId: string) {
    const payment = await this.getPrivateLessonPayment({
      paymentId,
      tutorId,
    });

    return this.serializePrivateLesson(payment);
  }

  private async getPrivateLessonForStudent(
    studentId: string,
    paymentId: string,
  ) {
    const payment = await this.getPrivateLessonPayment({
      paymentId,
      studentId,
    });

    return this.serializePrivateLesson(payment);
  }

  private async getPrivateLessonPayment(input: {
    paymentId: string;
    tutorId?: string;
    studentId?: string;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: input.paymentId,
        type: PaymentType.PRIVATE,
        ...(input.tutorId && { tutorId: input.tutorId }),
        ...(input.studentId && { userId: input.studentId }),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: {
              select: {
                avatarUrl: true,
              },
            },
          },
        },
        tutor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: {
              select: {
                avatarUrl: true,
                pricePerHour: true,
                sessionDuration: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Private lesson not found');
    }

    return payment;
  }

  private serializePrivateLesson(
    payment: Prisma.PaymentGetPayload<{
      include: {
        user: {
          select: {
            id: true;
            fullName: true;
            email: true;
            profile: {
              select: {
                avatarUrl: true;
              };
            };
          };
        };
        tutor: {
          select: {
            id: true;
            fullName: true;
            email: true;
            profile: {
              select: {
                avatarUrl: true;
                pricePerHour: true;
                sessionDuration: true;
              };
            };
          };
        };
      };
    }>,
  ) {
    const pricePerHour = payment.tutor.profile?.pricePerHour ?? null;
    const defaultDurationMinutes = payment.tutor.profile?.sessionDuration ?? 60;
    const sessionCount =
      payment.privateLessonSessions ??
      (pricePerHour && pricePerHour > 0
        ? Math.max(1, Math.round(payment.amount / pricePerHour))
        : 1);
    const durationMinutes =
      payment.privateLessonDuration ?? sessionCount * defaultDurationMinutes;
    const startsAt = payment.privateLessonStartsAt ?? payment.createdAt;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
    const status = this.getPrivateLessonStatus(
      payment.status,
      startsAt,
      endsAt,
    );

    return {
      id: payment.id,
      paymentId: payment.id,
      student: {
        id: payment.user.id,
        name: payment.user.fullName,
        email: payment.user.email,
        image: payment.user.profile?.avatarUrl ?? null,
      },
      tutor: {
        id: payment.tutor.id,
        name: payment.tutor.fullName,
        email: payment.tutor.email,
        image: payment.tutor.profile?.avatarUrl ?? null,
      },
      dateTime: {
        startsAt,
        endsAt,
        date: startsAt,
        time: startsAt,
      },
      duration: {
        minutes: durationMinutes,
        label: this.formatDuration(durationMinutes),
        sessionCount,
      },
      amount: payment.amount,
      currency: payment.currency,
      status,
      paymentStatus: this.formatPaymentStatus(payment.status),
      payoutStatus: payment.payoutStatus.toLowerCase(),
      canJoin: payment.status === PaymentStatus.PAID && status === 'live',
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private buildPrivateLessonJoinResponse(input: {
    lesson: ReturnType<PaymentService['serializePrivateLesson']>;
    account: string;
  }) {
    if (input.lesson.paymentStatus !== 'paid') {
      throw new BadRequestException('Private lesson payment is not paid');
    }

    if (input.lesson.status !== 'live') {
      throw new BadRequestException('This private lesson cannot be joined');
    }

    const channelName = this.agoraService.buildPrivateLessonChannelName(
      input.lesson.paymentId,
    );
    const credentials = this.agoraService.buildRtcJoinCredentials({
      channelName,
      account: input.account,
      role: 'publisher',
    });

    return {
      success: true,
      data: {
        lesson: input.lesson,
        agora: credentials.camera,
        screenShare: credentials.screenShare,
      },
    };
  }

  private getPayoutConfig() {
    return {
      commissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.2),
      holdHours: Number(process.env.PAYOUT_HOLD_HOURS ?? 48),
    };
  }

  private getFrontendUrl() {
    return 'https://braens.eu';
  }

  private getBackendUrl() {
    return (
      process.env.BACKEND_URL ??
      process.env.API_URL ??
      'https://api.braens.eu'
    ).replace(/\/$/, '');
  }

  private calculateCommission(amount: number) {
    const { commissionRate } = this.getPayoutConfig();

    return Number((amount * commissionRate).toFixed(2));
  }

  private calculateTutorAmount(amount: number) {
    return Number((amount - this.calculateCommission(amount)).toFixed(2));
  }

  private addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  private calculatePercentage(part: number, total: number) {
    if (total <= 0) {
      return 0;
    }

    return Math.round((part / total) * 100);
  }

  private calculateChangePercentage(current: number, previous: number) {
    if (previous <= 0) {
      return current > 0 ? 100 : 0;
    }

    return Math.round(((current - previous) / previous) * 100);
  }

  private buildMonthlyRevenueOverview(
    payments: { amount?: number; tutorAmount?: number; createdAt: Date }[],
    now: Date,
  ) {
    const monthCount = now.getMonth() + 1;
    const totals = Array.from({ length: monthCount }, (_, monthIndex) => ({
      month: new Date(now.getFullYear(), monthIndex, 1).toLocaleString(
        'en-US',
        { month: 'short' },
      ),
      amount: 0,
    }));

    for (const payment of payments) {
      const paymentMonth = payment.createdAt.getMonth();

      if (payment.createdAt.getFullYear() === now.getFullYear()) {
        totals[paymentMonth].amount +=
          payment.tutorAmount ?? payment.amount ?? 0;
      }
    }

    return totals;
  }

  private parsePaymentStatus(status?: string) {
    if (!status) {
      return undefined;
    }

    const normalizedStatus = status.toUpperCase();

    if (
      !Object.values(PaymentStatus).includes(normalizedStatus as PaymentStatus)
    ) {
      throw new BadRequestException(
        `Invalid status. Use one of: ${Object.values(PaymentStatus).join(', ')}`,
      );
    }

    return normalizedStatus as PaymentStatus;
  }

  private parsePaymentType(type?: string) {
    if (!type) {
      return undefined;
    }

    const normalizedType = type.toUpperCase();

    if (!Object.values(PaymentType).includes(normalizedType as PaymentType)) {
      throw new BadRequestException(
        `Invalid type. Use one of: ${Object.values(PaymentType).join(', ')}`,
      );
    }

    return normalizedType as PaymentType;
  }

  private parsePrivateLessonStatus(status?: string) {
    if (!status || status.toLowerCase() === 'all') {
      return undefined;
    }

    const normalizedStatus = status.toLowerCase();
    const allowedStatuses = ['live', 'upcoming', 'completed', 'cancelled'];

    if (!allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Invalid status. Use one of: all, ${allowedStatuses.join(', ')}`,
      );
    }

    return normalizedStatus;
  }

  private mapPrivateLesson(
    payment: Prisma.PaymentGetPayload<{
      include: {
        user: {
          select: {
            id: true;
            fullName: true;
            email: true;
            profile: {
              select: {
                avatarUrl: true;
              };
            };
          };
        };
      };
    }>,
    pricePerHour: number | null,
    defaultDurationMinutes: number,
  ) {
    const sessionCount =
      payment.privateLessonSessions ??
      (pricePerHour && pricePerHour > 0
        ? Math.max(1, Math.round(payment.amount / pricePerHour))
        : 1);
    const durationMinutes =
      payment.privateLessonDuration ?? sessionCount * defaultDurationMinutes;
    const scheduledAt = payment.privateLessonStartsAt ?? payment.createdAt;
    const endsAt = new Date(
      scheduledAt.getTime() + durationMinutes * 60 * 1000,
    );
    const status = this.getPrivateLessonStatus(
      payment.status,
      scheduledAt,
      endsAt,
    );

    return {
      id: payment.id,
      paymentId: payment.id,
      student: {
        id: payment.userId,
        name: payment.user.fullName,
        email: payment.user.email,
        image: payment.user.profile?.avatarUrl ?? null,
      },
      dateTime: {
        startsAt: scheduledAt,
        endsAt,
        date: scheduledAt,
        time: scheduledAt,
      },
      duration: {
        minutes: durationMinutes,
        label: this.formatDuration(durationMinutes),
        sessionCount,
      },
      amount: payment.amount,
      commissionAmount: payment.commissionAmount,
      tutorAmount: payment.tutorAmount,
      holdUntil: payment.holdUntil,
      paidOutAt: payment.paidOutAt,
      currency: payment.currency,
      status,
      paymentStatus: this.formatPaymentStatus(payment.status),
      payoutStatus: payment.payoutStatus.toLowerCase(),
      canJoin: status === 'live',
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private getPrivateLessonStatus(
    paymentStatus: PaymentStatus,
    startsAt: Date,
    endsAt: Date,
  ) {
    if (
      paymentStatus === PaymentStatus.CANCELLED ||
      paymentStatus === PaymentStatus.FAILED
    ) {
      return 'cancelled';
    }

    if (paymentStatus === PaymentStatus.PENDING) {
      return 'upcoming';
    }

    return getTimedClassStatus(startsAt, endsAt);
  }

  private formatDuration(minutes: number) {
    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (remainingMinutes === 0) {
      return hours === 1 ? '1 hr' : `${hours} hrs`;
    }

    return `${hours} hr ${remainingMinutes} min`;
  }

  private mapTutorTransaction(
    payment: Prisma.PaymentGetPayload<{
      include: {
        user: {
          select: {
            id: true;
            fullName: true;
            email: true;
            profile: {
              select: {
                avatarUrl: true;
              };
            };
          };
        };
        course: {
          select: {
            id: true;
            title: true;
          };
        };
      };
    }>,
  ) {
    return {
      transactionId: payment.id,
      studentId: payment.userId,
      studentName: payment.user.fullName,
      studentImage: payment.user.profile?.avatarUrl ?? null,
      studentEmail: payment.user.email,
      courseId: payment.courseId,
      courseTitle: payment.course?.title ?? null,
      amount: payment.amount,
      commissionAmount: payment.commissionAmount,
      tutorAmount: payment.tutorAmount,
      holdUntil: payment.holdUntil,
      paidOutAt: payment.paidOutAt,
      type: this.formatPaymentType(payment.type),
      date: payment.createdAt,
      status: this.formatPaymentStatus(payment.status),
      payoutStatus: payment.payoutStatus.toLowerCase(),
    };
  }

  private mapStudentTransaction(
    payment: Prisma.PaymentGetPayload<{
      include: {
        tutor: {
          select: {
            id: true;
            fullName: true;
            email: true;
            profile: {
              select: {
                avatarUrl: true;
              };
            };
          };
        };
        course: {
          select: {
            id: true;
            title: true;
            image: true;
          };
        };
      };
    }>,
  ) {
    return {
      invoice: this.formatInvoiceNumber(payment),
      transactionId: payment.id,
      paymentMethod: {
        label: payment.stripePaymentIntentId ? 'Stripe' : 'Not paid yet',
        provider: payment.stripePaymentIntentId ? 'stripe' : null,
        brand: null,
        last4: null,
      },
      teacher: {
        id: payment.tutorId,
        name: payment.tutor.fullName,
        email: payment.tutor.email,
        image: payment.tutor.profile?.avatarUrl ?? null,
      },
      course: payment.course
        ? {
            id: payment.course.id,
            title: payment.course.title,
            image: payment.course.image,
          }
        : null,
      amount: payment.amount,
      commissionAmount: payment.commissionAmount,
      tutorAmount: payment.tutorAmount,
      holdUntil: payment.holdUntil,
      paidOutAt: payment.paidOutAt,
      type: this.formatPaymentType(payment.type),
      date: payment.createdAt,
      status: this.formatPaymentStatus(payment.status),
    };
  }

  private formatInvoiceNumber(payment: { id: string; createdAt: Date }) {
    return `INV-${payment.createdAt.getFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`;
  }

  private formatPaymentType(type: PaymentType) {
    return type.toLowerCase();
  }

  private formatPaymentStatus(status: PaymentStatus) {
    return status.toLowerCase();
  }
}
