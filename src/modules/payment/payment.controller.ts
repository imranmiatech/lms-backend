import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateCheckoutSessionDto,
  CreateGroupClassCheckoutSessionDto,
  CreatePrivateBookingCheckoutSessionDto,
} from './dto/create-payment.dto';
import { PaymentService } from './payment.service';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('group-class/create-checkout-session')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create Stripe Checkout session for a group class',
    description:
      'Use this endpoint when a student pays to enroll in a tutor-created group class/course.',
  })
  @ApiBody({
    type: CreateGroupClassCheckoutSessionDto,
    examples: {
      groupClassPayment: {
        summary: 'Group class payment',
        value: {
          courseId: 'course_advanced_math_101',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Group class checkout session created.',
    schema: {
      example: {
        success: true,
        message: 'Checkout session created successfully',
        data: {
          payment: {
            id: 'payment_01',
            userId: 'student_jacob_jones',
            tutorId: 'tutor_albert_flores',
            courseId: 'course_advanced_math_101',
            amount: 94,
            currency: 'usd',
            status: 'PENDING',
            type: 'GROUP',
            payoutStatus: 'PENDING',
            stripeSessionId: 'cs_test_123',
            createdAt: '2026-06-15T10:00:00.000Z',
            updatedAt: '2026-06-15T10:00:00.000Z',
          },
          sessionId: 'cs_test_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  createGroupClassCheckoutSession(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateGroupClassCheckoutSessionDto,
  ) {
    return this.paymentService.createGroupClassCheckoutSession(
      user.userId,
      dto,
    );
  }

  @Post('private-booking/create-checkout-session')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create Stripe Checkout session for a private tutor booking',
    description:
      'Use this endpoint when a student books a private 1-on-1 tutor lesson. The tutor price comes from the tutor profile pricePerHour.',
  })
  @ApiBody({
    type: CreatePrivateBookingCheckoutSessionDto,
    examples: {
      privateBookingPayment: {
        summary: 'Private tutor booking payment',
        value: {
          tutorId: 'tutor_albert_flores',
          scheduledDate: '2026-06-25',
          scheduledTime: '14:00',
          durationMinutes: 60,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Private booking checkout session created.',
    schema: {
      example: {
        success: true,
        message: 'Private checkout session created successfully',
        data: {
          payment: {
            id: 'payment_private_01',
            userId: 'student_jacob_jones',
            tutorId: 'tutor_albert_flores',
            courseId: null,
            amount: 240,
            currency: 'usd',
            status: 'PENDING',
            type: 'PRIVATE',
            payoutStatus: 'PENDING',
            privateLessonStartsAt: '2026-06-18T15:00:00.000Z',
            privateLessonDuration: 120,
            privateLessonSessions: 2,
            stripeSessionId: 'cs_test_private_123',
            createdAt: '2026-06-15T10:00:00.000Z',
            updatedAt: '2026-06-15T10:00:00.000Z',
          },
          sessionId: 'cs_test_private_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_private_123',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  createPrivateBookingCheckoutSession(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePrivateBookingCheckoutSessionDto,
  ) {
    return this.paymentService.createPrivateCheckoutSession(user.userId, dto);
  }

  @Post('create-checkout-session')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create Stripe Checkout session for group class or private tutor',
    description:
      'Unified payment API. Send courseId for group class enrollment payment, or send tutorId for a private 1-on-1 tutor booking. Never send both in the same request.',
  })
  @ApiBody({
    type: CreateCheckoutSessionDto,
    examples: {
      groupClassPayment: {
        summary: 'Group class payment',
        description:
          'Use this when a student enrolls in a tutor-created course/group class.',
        value: {
          courseId: 'course_advanced_math_101',
        },
      },
      privateSessionPayment: {
        summary: 'Private session payment',
        description:
          'Use this when a student books a tutor individually from the tutor list.',
        value: {
          tutorId: 'tutor_albert_flores',
          scheduledDate: '2026-06-25',
          scheduledTime: '14:00',
          durationMinutes: 60,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Checkout session created.',
    schema: {
      example: {
        success: true,
        message: 'Checkout session created successfully',
        data: {
          payment: {
            id: 'payment_01',
            userId: 'student_jacob_jones',
            tutorId: 'tutor_albert_flores',
            courseId: 'course_advanced_math_101',
            amount: 94,
            currency: 'usd',
            status: 'PENDING',
            type: 'GROUP',
            payoutStatus: 'PENDING',
            stripeSessionId: 'cs_test_123',
            createdAt: '2026-06-15T10:00:00.000Z',
            updatedAt: '2026-06-15T10:00:00.000Z',
          },
          sessionId: 'cs_test_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid request, for example both courseId and tutorId were sent together.',
    schema: {
      example: {
        message:
          'Provide either courseId for group course payment or tutorId for private tutor payment',
        error: 'Bad Request',
        statusCode: 400,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  createCheckoutSession(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.paymentService.createCheckoutSession(user.userId, dto);
  }

  @Post('webhook')
  @ApiOperation({
    summary: 'Stripe webhook endpoint',
    description:
      'Stripe calls this endpoint after checkout completion, expiry, or failed async payment. Frontend developers do not call this directly.',
  })
  @ApiResponse({
    status: 201,
    description: 'Webhook received.',
    schema: {
      example: {
        received: true,
      },
    },
  })
  handleWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.paymentService.handleWebhook(req.rawBody, signature);
  }

  @Get('checkout/success')
  @Redirect()
  @ApiOperation({
    summary: 'Stripe Checkout success redirect and payment sync',
    description:
      'Stripe redirects here after checkout. The backend verifies the Checkout Session with Stripe, marks the payment paid when Stripe reports paid, then redirects to the frontend success page.',
  })
  @ApiQuery({
    name: 'session_id',
    required: true,
    description: 'Stripe Checkout Session ID',
    example: 'cs_test_123',
  })
  async handleCheckoutSuccessRedirect(
    @Query('session_id') sessionId: string,
  ) {
    return this.paymentService.handleCheckoutSuccessRedirect(sessionId);
  }

  @Get('my')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get logged-in user payments',
    description:
      'Returns all payments for the logged-in user. Students see their purchases; tutors/admins should use dashboard-specific APIs where possible.',
  })
  @ApiResponse({
    status: 200,
    description: 'Payments retrieved.',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'payment_01',
            userId: 'student_jacob_jones',
            tutorId: 'tutor_albert_flores',
            courseId: 'course_advanced_math_101',
            amount: 94,
            currency: 'usd',
            status: 'PAID',
            type: 'GROUP',
            payoutStatus: 'PENDING',
            tutor: {
              id: 'tutor_albert_flores',
              fullName: 'Albert Flores',
              email: 'albert.flores@example.com',
              profile: {
                avatarUrl: 'https://example.com/avatars/albert.png',
              },
            },
            course: {
              id: 'course_advanced_math_101',
              title: 'Advanced Mathematics',
              image: 'https://example.com/courses/math.png',
              startDate: '2026-06-20T00:00:00.000Z',
              pricePerStudent: 94,
            },
          },
        ],
      },
    },
  })
  findMyPayments(@Req() req: any) {
    return this.paymentService.findMyPayments(req.user.userId);
  }

  @Get('student/dashboard/meta')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get student billing dashboard metadata' })
  @ApiResponse({
    status: 200,
    description: 'Student billing cards retrieved.',
    schema: {
      example: {
        success: true,
        data: {
          cards: {
            totalSpent: {
              amount: 328,
              paymentCount: 4,
            },
            totalCourses: {
              count: 3,
              enrolledThisMonth: 1,
            },
            thisMonth: {
              amount: 94,
              paymentCount: 1,
            },
          },
        },
      },
    },
  })
  findStudentDashboardMeta(@CurrentUser() user: { userId: string }) {
    return this.paymentService.findStudentDashboardMeta(user.userId);
  }

  @Get('student/dashboard/transactions')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get student billing payment history table' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'PAID', 'FAILED', 'CANCELLED'],
    example: 'PAID',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['GROUP', 'PRIVATE'],
    example: 'GROUP',
  })
  @ApiResponse({
    status: 200,
    description: 'Student payment history retrieved.',
    schema: {
      example: {
        success: true,
        data: [
          {
            invoice: 'INV-2026-PAYMENT_',
            transactionId: 'payment_01',
            paymentMethod: {
              label: 'Stripe',
              provider: 'stripe',
              brand: null,
              last4: null,
            },
            teacher: {
              id: 'tutor_albert_flores',
              name: 'Albert Flores',
              email: 'albert.flores@example.com',
              image: 'https://example.com/avatars/albert.png',
            },
            course: {
              id: 'course_advanced_math_101',
              title: 'Advanced Mathematics',
              image: 'https://example.com/courses/math.png',
            },
            amount: 94,
            type: 'group',
            date: '2026-06-15T10:00:00.000Z',
            status: 'paid',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 35,
          totalPages: 4,
          from: 1,
          to: 10,
          hasPreviousPage: false,
          hasNextPage: true,
        },
      },
    },
  })
  findStudentDashboardTransactions(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.paymentService.findStudentDashboardTransactions(user.userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      type,
    });
  }

  @Get('tutor/dashboard/meta')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tutor earnings dashboard metadata' })
  @ApiResponse({
    status: 200,
    description: 'Tutor earnings dashboard metadata retrieved.',
    schema: {
      example: {
        success: true,
        data: {
          cards: {
            totalEarning: {
              amount: 262800,
              label: 'all time',
            },
            thisMonth: {
              amount: 8500,
              changePercentage: 12.5,
              label: 'vs last month',
            },
            pendingPayout: {
              amount: 8450,
              label: 'Processing',
            },
          },
          paidStudent: {
            total: 24,
            group: {
              count: 18,
              percentage: 75,
            },
            private: {
              count: 6,
              percentage: 25,
            },
          },
        },
      },
    },
  })
  findTutorDashboardMeta(@CurrentUser() user: { userId: string }) {
    return this.paymentService.findTutorDashboardMeta(user.userId);
  }

  @Get('tutor/dashboard/transactions')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tutor earnings dashboard transactions table' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'PAID', 'FAILED', 'CANCELLED'],
    example: 'PAID',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['GROUP', 'PRIVATE'],
    example: 'PRIVATE',
  })
  @ApiResponse({
    status: 200,
    description: 'Tutor transaction table retrieved.',
    schema: {
      example: {
        success: true,
        data: [
          {
            transactionId: 'payment_02',
            studentId: 'student_robert_fox',
            studentName: 'Robert Fox',
            studentEmail: 'robert.fox@example.com',
            courseId: null,
            courseTitle: null,
            amount: 120,
            type: 'private',
            date: '2026-06-15T11:00:00.000Z',
            status: 'paid',
            payoutStatus: 'pending',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 12,
          totalPages: 2,
          from: 1,
          to: 10,
          hasPreviousPage: false,
          hasNextPage: true,
        },
      },
    },
  })
  findTutorDashboardTransactions(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.paymentService.findTutorDashboardTransactions(user.userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      type,
    });
  }

  @Get('tutor/private-lessons')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get tutor private 1-on-1 lesson bookings',
    description:
      'Tutor-side private session list. This is only for private bookings created through the unified checkout API with tutorId.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['upcoming', 'live', 'completed', 'cancelled'],
    example: 'upcoming',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    example: 'Jacob',
  })
  @ApiResponse({
    status: 200,
    description: 'Tutor private lesson bookings retrieved.',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'payment_private_01',
            paymentId: 'payment_private_01',
            student: {
              id: 'student_jacob_jones',
              name: 'Jacob Jones',
              email: 'jacob.jones@example.com',
              image: null,
            },
            dateTime: {
              startsAt: '2026-06-15T10:00:00.000Z',
              endsAt: '2026-06-15T11:00:00.000Z',
              date: '2026-06-15T10:00:00.000Z',
              time: '2026-06-15T10:00:00.000Z',
            },
            duration: {
              minutes: 60,
              label: '1 hr',
              sessionCount: 1,
            },
            amount: 120,
            currency: 'usd',
            status: 'upcoming',
            paymentStatus: 'paid',
            payoutStatus: 'pending',
            canJoin: false,
            createdAt: '2026-06-15T10:00:00.000Z',
            updatedAt: '2026-06-15T10:00:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
          from: 1,
          to: 1,
          hasPreviousPage: false,
          hasNextPage: false,
          filters: {
            status: 'upcoming',
            search: 'Jacob',
          },
        },
      },
    },
  })
  findTutorPrivateLessons(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.paymentService.findTutorPrivateLessons(user.userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      search,
    });
  }

  @Get('student/private-lessons')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get student private 1-on-1 lesson bookings',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['upcoming', 'live', 'completed', 'cancelled'],
    example: 'upcoming',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    example: 'David',
  })
  findStudentPrivateLessons(
    @CurrentUser() user: { userId: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.paymentService.findStudentPrivateLessons(user.userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      search,
    });
  }

  @Get('tutor/private-lessons/:paymentId/join-preview')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tutor private lesson join preview' })
  @ApiParam({
    name: 'paymentId',
    description: 'Private lesson payment ID',
    example: 'payment_private_01',
  })
  getTutorPrivateLessonJoinPreview(
    @CurrentUser() user: { userId: string },
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentService.getTutorPrivateLessonJoinPreview(
      user.userId,
      paymentId,
    );
  }

  @Post('tutor/private-lessons/:paymentId/join')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join/start a tutor private lesson and receive Agora credentials',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Private lesson payment ID',
    example: 'payment_private_01',
  })
  joinTutorPrivateLesson(
    @CurrentUser() user: { userId: string },
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentService.joinTutorPrivateLesson(user.userId, paymentId);
  }

  @Get('student/private-lessons/:paymentId/join-preview')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get student private lesson join preview' })
  @ApiParam({
    name: 'paymentId',
    description: 'Private lesson payment ID',
    example: 'payment_private_01',
  })
  getStudentPrivateLessonJoinPreview(
    @CurrentUser() user: { userId: string },
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentService.getStudentPrivateLessonJoinPreview(
      user.userId,
      paymentId,
    );
  }

  @Post('student/private-lessons/:paymentId/join')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join a student private lesson and receive Agora credentials',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Private lesson payment ID',
    example: 'payment_private_01',
  })
  joinStudentPrivateLesson(
    @CurrentUser() user: { userId: string },
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentService.joinStudentPrivateLesson(user.userId, paymentId);
  }

  @Post('tutor/connect/onboarding')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create Stripe Connect onboarding link for tutor payouts',
    description:
      'Tutor uses this URL to connect a bank account through Stripe. Automatic payouts require payoutsEnabled to be true.',
  })
  createTutorConnectOnboarding(@CurrentUser() user: { userId: string }) {
    return this.paymentService.createTutorConnectOnboarding(user.userId);
  }

  @Get('tutor/connect/status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync and get tutor Stripe Connect payout status' })
  syncTutorConnectStatus(@CurrentUser() user: { userId: string }) {
    return this.paymentService.syncTutorConnectStatus(user.userId);
  }

  @Post('admin/payouts/process-due')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manually run the automatic payout processor',
    description:
      'Processes paid payments whose 48-hour hold period has ended. The same processor also runs in the background.',
  })
  processDuePayouts() {
    return this.paymentService.processDuePayouts();
  }

  @Get('checkout-session/:sessionId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify a Stripe Checkout session and sync enrollment',
    description:
      'Use this on the payment success page with the Stripe session_id. If Stripe confirms the session is paid, the payment is marked paid and group-course enrollment is created.',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'Stripe Checkout Session ID returned by create-checkout-session',
    example: 'cs_test_123',
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout session status synced.',
    schema: {
      example: {
        success: true,
        data: {
          sessionId: 'cs_test_123',
          paymentId: 'payment_01',
          paymentStatus: 'PAID',
          stripePaymentStatus: 'paid',
          enrolled: true,
          courseId: 'course_advanced_math_101',
        },
      },
    },
  })
  syncCheckoutSession(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ) {
    return this.paymentService.syncCheckoutSession(user.userId, sessionId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one logged-in user payment' })
  @ApiParam({
    name: 'id',
    description: 'Payment ID',
    example: 'payment_01',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment retrieved.',
    schema: {
      example: {
        success: true,
        data: {
          id: 'payment_01',
          userId: 'student_jacob_jones',
          tutorId: 'tutor_albert_flores',
          courseId: 'course_advanced_math_101',
          amount: 94,
          currency: 'usd',
          status: 'PAID',
          type: 'GROUP',
          payoutStatus: 'PENDING',
          tutor: {
            id: 'tutor_albert_flores',
            fullName: 'Albert Flores',
            email: 'albert.flores@example.com',
          },
          course: {
            id: 'course_advanced_math_101',
            title: 'Advanced Mathematics',
          },
        },
      },
    },
  })
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.paymentService.findOne(req.user.userId, id);
  }
}
