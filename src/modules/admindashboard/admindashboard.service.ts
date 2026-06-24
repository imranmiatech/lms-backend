import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  PaymentStatus,
  PaymentType,
  PayoutStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3StorageService } from '../common/s3/s3.service';
import {
  combineDateAndTime,
  getTimedClassStatusByDuration,
} from '../common/time/lesson-status.util';
import { AdminBookingManagementQueryDto } from './dto/admin-booking-management-query.dto';
import { UpsertAdminProfileDto } from './dto/admin-profile.dto';
import {
  AdminGroupClassDetailQueryDto,
  AdminGroupClassesQueryDto,
  AdminGroupClassStatusFilter,
} from './dto/admin-group-classes-query.dto';
import { AdminPaymentOverviewQueryDto } from './dto/admin-payment-overview-query.dto';
import { AdminPayoutManagementQueryDto } from './dto/admin-payout-management-query.dto';
import { TutorStatusFilter } from './dto/tutor-status-query.dto';

type AdminBookingPayment = Prisma.PaymentGetPayload<{
  include: {
    course: {
      select: {
        startDate: true;
        time: true;
        timeZone: true;
        classDuration: true;
      };
    };
  };
}>;

type AdminGroupCourse = Prisma.CourseGetPayload<{
  include: {
    tutor: {
      select: {
        id: true;
        fullName: true;
        email: true;
      };
    };
    curriculumItems: {
      select: {
        title: true;
        date: true;
        time: true;
      };
    };
    _count: {
      select: {
        enrollments: true;
      };
    };
  };
}>;

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  async getAdminProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true },
    });

    if (!user || user.role !== Role.ADMIN) {
      throw new NotFoundException('Admin not found');
    }

    return {
      success: true,
      data: this.toAdminProfileResponse(user),
    };
  }

  async upsertAdminProfile(
    userId: string,
    dto: UpsertAdminProfileDto,
    files?: { avatarFile?: any },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true },
    });

    if (!user || user.role !== Role.ADMIN) {
      throw new NotFoundException('Admin not found');
    }

    if (dto.email && dto.email !== user.email) {
      const emailOwner = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });

      if (emailOwner && emailOwner.id !== userId) {
        throw new BadRequestException('Email is already in use');
      }
    }

    const avatarUpload = files?.avatarFile
      ? await this.s3StorageService.uploadFile(files.avatarFile, {
          folder: 'daanklerk/admin-profiles',
          resourceType: 'image',
          allowedMimeTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
          ],
          maxBytes: 5 * 1024 * 1024,
        })
      : null;

    const firstName = dto.firstName ?? user.adminProfile?.firstName;
    const lastName = dto.lastName ?? user.adminProfile?.lastName;
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.email ? { email: dto.email } : {}),
          ...(fullName ? { fullName } : {}),
        },
      });

      return tx.adminProfile.upsert({
        where: { userId },
        update: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          avatarUrl: avatarUpload?.url ?? dto.avatarUrl,
        },
        create: {
          userId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          avatarUrl: avatarUpload?.url ?? dto.avatarUrl,
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
      });
    });

    return {
      success: true,
      message: 'Admin profile saved successfully',
      data: this.toAdminProfileResponse({
        id: updated.user.id,
        fullName: updated.user.fullName,
        email: updated.user.email,
        role: updated.user.role,
        adminProfile: updated,
      }),
    };
  }

  async getHome() {
    const [cards, revenueOverview, userJoining] = await Promise.all([
      this.buildCards(),
      this.buildRevenueOverview(),
      this.buildUserJoining(),
    ]);

    return {
      success: true,
      data: {
        title: 'Dashboard Overview',
        subtitle:
          "Welcome back! Here's what's happening with your platform today.",
        cards,
        revenueOverview,
        userJoining,
      },
    };
  }

  async getCards() {
    return {
      success: true,
      data: await this.buildCards(),
    };
  }

  async getUsersByRole(role: Role) {
    const users = await this.prisma.user.findMany({
      where: {
        role,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: this.userListSelect(),
    });

    return {
      success: true,
      data: users,
    };
  }

  async getTutors(status: TutorStatusFilter = 'all') {
    const where: Prisma.UserWhereInput = {
      role: Role.TUTOR,
      ...(status !== 'all' && {
        profile: {
          applicationStatus: status,
        },
      }),
    };

    const users = await this.prisma.user.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: this.userListSelect(),
    });

    return {
      success: true,
      filters: {
        status,
      },
      data: users,
    };
  }

  async updateUserRole(userId: string, role: Role) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        role,
      },
      select: this.userListSelect(),
    });

    return {
      success: true,
      message: `User role updated to ${role} successfully`,
      data: updatedUser,
    };
  }

  async deleteUser(userId: string, adminUserId: string) {
    if (userId === adminUserId) {
      throw new BadRequestException(
        'You cannot delete your own account from the admin dashboard',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({
      where: {
        id: userId,
      },
    });

    return {
      success: true,
      message: 'User deleted successfully',
      data: user,
    };
  }

  async getTutorApplications() {
    const users = await this.prisma.user.findMany({
      where: {
        role: Role.TUTOR,
        profile: {
          applicationStatus: {
            in: [ApplicationStatus.PENDING, ApplicationStatus.REJECTED],
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            id: true,
            avatarUrl: true,
            country: true,
            city: true,
            teachingCategory: true,
            yearOfExperience: true,
            pricePerHour: true,
            applicationStatus: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return {
      success: true,
      data: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        profile: user.profile,
      })),
    };
  }

  async getProfileById(profileId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: {
        id: profileId,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isEmailVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        education: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        availability: {
          orderBy: {
            dayOfWeek: 'asc',
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      success: true,
      data: profile,
    };
  }

  async updateTutorApplicationStatus(
    profileId: string,
    status: ApplicationStatus,
  ) {
    const profile = await this.prisma.userProfile.findFirst({
      where: {
        id: profileId,
        user: {
          role: Role.TUTOR,
        },
      },
      select: {
        id: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Tutor profile not found');
    }

    const updatedProfile = await this.prisma.userProfile.update({
      where: {
        id: profileId,
      },
      data: {
        applicationStatus: status,
      },
      select: {
        id: true,
        avatarUrl: true,
        country: true,
        city: true,
        teachingCategory: true,
        yearOfExperience: true,
        pricePerHour: true,
        applicationStatus: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return {
      success: true,
      message: `Tutor application status updated to ${status} successfully`,
      data: {
        id: updatedProfile.user.id,
        fullName: updatedProfile.user.fullName,
        email: updatedProfile.user.email,
        role: updatedProfile.user.role,
        profile: {
          id: updatedProfile.id,
          avatarUrl: updatedProfile.avatarUrl,
          country: updatedProfile.country,
          city: updatedProfile.city,
          teachingCategory: updatedProfile.teachingCategory,
          yearOfExperience: updatedProfile.yearOfExperience,
          pricePerHour: updatedProfile.pricePerHour,
          applicationStatus: updatedProfile.applicationStatus,
          createdAt: updatedProfile.createdAt,
          updatedAt: updatedProfile.updatedAt,
        },
      },
    };
  }

  async approveTutorProfile(profileId: string) {
    return this.updateTutorApplicationStatus(
      profileId,
      ApplicationStatus.APPROVED,
    );
  }

  async rejectTutorProfile(profileId: string) {
    return this.updateTutorApplicationStatus(
      profileId,
      ApplicationStatus.REJECTED,
    );
  }

  async getRevenueOverview() {
    return {
      success: true,
      data: await this.buildRevenueOverview(),
    };
  }

  async getUserJoining() {
    return {
      success: true,
      data: await this.buildUserJoining(),
    };
  }

  async getGroupClasses(query: AdminGroupClassesQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);
    const search = query.search?.trim();
    const status = query.status ?? 'all';
    const category = query.category?.trim();
    const teacherId = query.teacherId?.trim();

    const where: Prisma.CourseWhereInput = {
      ...(teacherId && { tutorId: teacherId }),
      ...(category && category !== 'all' && { category }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
          {
            tutor: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            tutor: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    const [courses, categories, teachers] = await Promise.all([
      this.prisma.course.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: this.adminGroupCourseInclude(),
      }),
      this.prisma.course.findMany({
        distinct: ['category'],
        orderBy: { category: 'asc' },
        select: { category: true },
      }),
      this.prisma.user.findMany({
        where: {
          role: Role.TUTOR,
          courses: { some: {} },
        },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, email: true },
      }),
    ]);

    const revenueByCourse = await this.getCourseRevenueMap(
      courses.map((course) => course.id),
    );
    const rows = courses
      .map((course) => this.mapAdminGroupCourse(course, revenueByCourse))
      .filter((course) => this.matchesAdminGroupStatus(course.status, status));
    const total = rows.length;
    const skip = (page - 1) * limit;
    const paginatedRows = rows.slice(skip, skip + limit);
    const meta = this.buildPaginationMeta(
      page,
      limit,
      total,
      paginatedRows.length,
    );

    return {
      success: true,
      data: {
        title: 'Group Classes',
        subtitle: 'Manage group learning sessions and classes.',
        classes: paginatedRows,
        filters: {
          search: search ?? null,
          status,
          category: category ?? 'all',
          teacherId: teacherId ?? 'all',
          options: {
            statuses: [
              { label: 'All Status', value: 'all' },
              { label: 'Active', value: 'active' },
              { label: 'Upcoming', value: 'upcoming' },
              { label: 'Live', value: 'live' },
              { label: 'Completed', value: 'completed' },
            ],
            categories: [
              { label: 'All Category', value: 'all' },
              ...categories.map((item) => ({
                label: item.category,
                value: item.category,
              })),
            ],
            teachers: [
              { label: 'All Teacher', value: 'all' },
              ...teachers.map((teacher) => ({
                label: teacher.fullName,
                value: teacher.id,
                email: teacher.email,
              })),
            ],
          },
        },
        meta: {
          ...meta,
          showingLabel: `Showing ${meta.from} to ${meta.to} of ${meta.total} classes`,
        },
      },
    };
  }

  async getGroupClassById(
    courseId: string,
    query: AdminGroupClassDetailQueryDto = {},
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);
    const search = query.search?.trim();

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        ...this.adminGroupCourseInclude(),
        resources: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Group class not found');
    }

    const revenueByCourse = await this.getCourseRevenueMap([course.id]);
    const summary = this.mapAdminGroupCourse(course, revenueByCourse);
    const studentWhere: Prisma.CourseEnrollmentWhereInput = {
      courseId,
      ...(search && {
        student: {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };
    const [totalStudents, enrollments] = await Promise.all([
      this.prisma.courseEnrollment.count({ where: studentWhere }),
      this.prisma.courseEnrollment.findMany({
        where: studentWhere,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: { avatarUrl: true },
              },
            },
          },
        },
      }),
    ]);
    const meta = this.buildPaginationMeta(
      page,
      limit,
      totalStudents,
      enrollments.length,
    );

    return {
      success: true,
      data: {
        backLink: '/admindashboard/group-classes',
        course: {
          id: course.id,
          title: course.title,
          description: course.description,
          image: course.image,
          category: course.category,
          language: course.language,
          classDuration: course.classDuration,
          pricePerStudent: course.pricePerStudent,
          minStudent: course.minStudent,
          maxStudent: course.maxStudent,
          enrollmentDeadline: course.enrollmentDeadline,
          startDate: course.startDate,
          time: course.time,
          timeZone: course.timeZone,
          status: summary.status,
          statusLabel: summary.statusLabel,
        },
        teacher: summary.teacher,
        cards: {
          teacher: summary.teacher,
          enrolledStudents: {
            value: summary.studentCount,
            label: String(summary.studentCount),
          },
          totalRevenue: {
            value: summary.revenue,
            label: summary.revenueLabel,
          },
        },
        lessons: this.getAdminCourseLessonItems(course),
        enrolledStudents: enrollments.map((enrollment) => ({
          enrollmentId: enrollment.id,
          studentId: enrollment.student.id,
          studentName: enrollment.student.fullName,
          studentEmail: enrollment.student.email,
          studentAvatarUrl: enrollment.student.profile?.avatarUrl ?? null,
          enrolledAt: enrollment.createdAt,
          enrolledAtLabel: this.formatFullDate(enrollment.createdAt),
          enrolledTimeLabel: this.formatClockTime(enrollment.createdAt),
          student: {
            id: enrollment.student.id,
            name: enrollment.student.fullName,
            email: enrollment.student.email,
            avatarUrl: enrollment.student.profile?.avatarUrl ?? null,
          },
          actions: {
            delete: `/admindashboard/group-classes/${course.id}/students/${enrollment.student.id}`,
          },
        })),
        resources: course.resources,
        filters: {
          search: search ?? null,
        },
        meta: {
          ...meta,
          showingLabel: `Showing ${meta.from} to ${meta.to} of ${meta.total} users`,
        },
      },
    };
  }

  async deleteGroupClassStudent(courseId: string, studentId: string) {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: {
        courseId_studentId: {
          courseId,
          studentId,
        },
      },
      select: {
        id: true,
        courseId: true,
        studentId: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    await this.prisma.$transaction([
      this.prisma.curriculumProgress.deleteMany({
        where: { courseId, studentId },
      }),
      this.prisma.courseCompletion.deleteMany({
        where: { courseId, studentId },
      }),
      this.prisma.studentLessonState.deleteMany({
        where: { courseId, studentId },
      }),
      this.prisma.courseEnrollment.delete({
        where: {
          courseId_studentId: {
            courseId,
            studentId,
          },
        },
      }),
    ]);

    return {
      success: true,
      message: 'Student removed from group class successfully',
      data: enrollment,
    };
  }

  async deleteGroupClass(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });

    if (!course) {
      throw new NotFoundException('Group class not found');
    }

    await this.prisma.course.delete({
      where: { id: courseId },
    });

    return {
      success: true,
      message: 'Group class deleted successfully',
      data: course,
    };
  }

  async getPaymentOverview(query: AdminPaymentOverviewQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const type = query.type ?? 'all';
    const status = query.status ?? 'all';

    const where: Prisma.PaymentWhereInput = {
      ...(type !== 'all' && { type }),
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          {
            tutor: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            tutor: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
          {
            user: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            user: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
          {
            course: {
              title: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    const [
      summary,
      total,
      payments,
      filteredTotalRevenue,
      filteredCommissionRevenue,
    ] = await Promise.all([
      this.buildPaymentOverviewSummary(),
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
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
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
      this.prisma.payment.aggregate({
        where,
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          ...where,
          status: PaymentStatus.PAID,
        },
        _sum: {
          commissionAmount: true,
        },
      }),
    ]);

    return {
      success: true,
      data: {
        title: 'Payment Overview',
        subtitle: 'Track all platform payments and transactions.',
        summary,
        transactions: payments.map((payment) => ({
          transactionId: payment.id,
          transactionCode: this.formatTransactionCode(payment.id),
          teacher: {
            id: payment.tutor.id,
            name: payment.tutor.fullName,
            email: payment.tutor.email,
          },
          student: {
            id: payment.user.id,
            name: payment.user.fullName,
            email: payment.user.email,
          },
          course: payment.course
            ? {
                id: payment.course.id,
                title: payment.course.title,
              }
            : null,
          amount: payment.amount,
          amountLabel: this.formatCurrency(payment.amount),
          commissionAmount: payment.commissionAmount,
          commissionAmountLabel: this.formatCurrency(payment.commissionAmount),
          tutorAmount: payment.tutorAmount,
          tutorAmountLabel: this.formatCurrency(payment.tutorAmount),
          currency: payment.currency,
          type: payment.type,
          typeLabel: this.formatPaymentType(payment.type),
          date: payment.createdAt,
          dateLabel: this.formatFullDate(payment.createdAt),
          status: payment.status,
          statusLabel: this.formatPaymentStatus(payment.status),
          payoutStatus: payment.payoutStatus,
          payoutStatusLabel: this.formatPayoutStatus(payment.payoutStatus),
          holdUntil: payment.holdUntil,
          holdUntilLabel: payment.holdUntil
            ? this.formatFullDate(payment.holdUntil)
            : null,
          paidOutAt: payment.paidOutAt,
          payoutTransferId: payment.payoutTransferId,
          payoutFailureReason: payment.payoutFailureReason,
        })),
        filteredSummary: {
          totalRevenue: filteredTotalRevenue._sum.amount ?? 0,
          commissionRevenue:
            filteredCommissionRevenue._sum.commissionAmount ?? 0,
        },
        filters: {
          search: search ?? null,
          type,
          status,
        },
        meta: this.buildPaginationMeta(page, limit, total, payments.length),
      },
    };
  }

  async getPayoutManagement(query: AdminPayoutManagementQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const status = query.status ?? 'all';

    const where: Prisma.PaymentWhereInput = {
      status: PaymentStatus.PAID,
      ...(status !== 'all' && { payoutStatus: status }),
      ...(search && {
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          {
            tutor: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            tutor: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    const [total, payouts] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          {
            paidOutAt: 'desc',
          },
          {
            holdUntil: 'desc',
          },
          {
            createdAt: 'desc',
          },
        ],
        include: {
          tutor: {
            select: {
              id: true,
              fullName: true,
              email: true,
              paymentInfo: {
                select: {
                  paymentMethod: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        title: 'Payout Management',
        subtitle: 'Manage teacher payouts and payment processing.',
        payouts: payouts.map((payment) => {
          const date =
            payment.paidOutAt ?? payment.holdUntil ?? payment.createdAt;

          return {
            payoutId: payment.id,
            teacher: {
              id: payment.tutor.id,
              name: payment.tutor.fullName,
              email: payment.tutor.email,
            },
            amount: payment.tutorAmount,
            amountLabel: this.formatCurrency(payment.tutorAmount),
            grossAmount: payment.amount,
            grossAmountLabel: this.formatCurrency(payment.amount),
            commissionAmount: payment.commissionAmount,
            commissionAmountLabel: this.formatCurrency(
              payment.commissionAmount,
            ),
            currency: payment.currency,
            method:
              payment.tutor.paymentInfo?.paymentMethod ?? 'Stripe Connect',
            date,
            dateLabel: this.formatFullDate(date),
            status: payment.payoutStatus,
            statusLabel: this.formatPayoutStatus(payment.payoutStatus),
            paidAt: payment.paidAt,
            holdUntil: payment.holdUntil,
            paidOutAt: payment.paidOutAt,
            payoutTransferId: payment.payoutTransferId,
            payoutFailureReason: payment.payoutFailureReason,
          };
        }),
        filters: {
          search: search ?? null,
          status,
        },
        meta: this.buildPaginationMeta(page, limit, total, payouts.length),
      },
    };
  }

  async getBookingManagement(query: AdminBookingManagementQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const type = query.type ?? 'all';
    const status = query.status ?? 'all';

    const where: Prisma.PaymentWhereInput = {
      ...(type !== 'all' && { type }),
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          {
            tutor: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            tutor: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
          {
            user: {
              fullName: { contains: search, mode: 'insensitive' },
            },
          },
          {
            user: {
              email: { contains: search, mode: 'insensitive' },
            },
          },
          {
            course: {
              title: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };

    const [total, bookings] = await Promise.all([
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
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              startDate: true,
              time: true,
              timeZone: true,
              classDuration: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        title: 'Booking Management',
        subtitle: 'View and manage all platform bookings and sessions.',
        bookings: bookings.map((booking) => ({
          bookingId: booking.id,
          bookingCode:
            booking.course?.title ??
            `${this.formatPaymentType(booking.type)} Session`,
          course: booking.course
            ? {
                id: booking.course.id,
                title: booking.course.title,
              }
            : null,
          teacher: {
            id: booking.tutor.id,
            name: booking.tutor.fullName,
            email: booking.tutor.email,
          },
          student: {
            id: booking.user.id,
            name: booking.user.fullName,
            email: booking.user.email,
          },
          type: booking.type,
          typeLabel: this.formatPaymentType(booking.type),
          dateTime: this.getBookingDateTime(booking),
          status: booking.status,
          statusLabel: this.formatBookingStatus(booking.status),
          amount: booking.amount,
          amountLabel: this.formatCurrency(booking.amount),
        })),
        filters: {
          search: search ?? null,
          type,
          status,
        },
        meta: this.buildPaginationMeta(page, limit, total, bookings.length),
      },
    };
  }

  private userListSelect() {
    return {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isEmailVerified: true,
      createdAt: true,
      updatedAt: true,
      profile: {
        select: {
          id: true,
          avatarUrl: true,
          country: true,
          city: true,
          teachingCategory: true,
          yearOfExperience: true,
          pricePerHour: true,
          applicationStatus: true,
          averageRating: true,
          totalReviews: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    };
  }

  private adminGroupCourseInclude() {
    return {
      tutor: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      curriculumItems: {
        orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          date: true,
          time: true,
        },
      },
      _count: {
        select: {
          enrollments: true,
        },
      },
    } satisfies Prisma.CourseInclude;
  }

  private async getCourseRevenueMap(courseIds: string[]) {
    if (courseIds.length === 0) {
      return new Map<string, number>();
    }

    const revenueRows = await this.prisma.payment.groupBy({
      by: ['courseId'],
      where: {
        courseId: { in: courseIds },
        type: PaymentType.GROUP,
        status: PaymentStatus.PAID,
      },
      _sum: {
        amount: true,
      },
    });

    return new Map(
      revenueRows
        .filter((row) => row.courseId)
        .map((row) => [row.courseId!, row._sum.amount ?? 0]),
    );
  }

  private mapAdminGroupCourse(
    course: AdminGroupCourse,
    revenueByCourse: Map<string, number>,
  ) {
    const revenue = revenueByCourse.get(course.id) ?? 0;
    const status = this.getAdminGroupCourseStatus(course);

    return {
      courseId: course.id,
      courseName: course.title,
      teacher: {
        id: course.tutor.id,
        name: course.tutor.fullName,
        email: course.tutor.email,
      },
      category: course.category,
      studentCount: course._count.enrollments,
      studentLabel: String(course._count.enrollments),
      revenue,
      revenueLabel: this.formatCurrency(revenue),
      status,
      statusLabel: this.formatAdminGroupCourseStatus(status),
      actions: {
        view: `/admindashboard/group-classes/${course.id}`,
        delete: `/admindashboard/group-classes/${course.id}`,
      },
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }

  private getAdminGroupCourseStatus(
    course: Pick<
      AdminGroupCourse,
      | 'startDate'
      | 'time'
      | 'timeZone'
      | 'classDuration'
      | 'courseDuration'
      | 'curriculums'
      | 'curriculumItems'
    >,
  ): AdminGroupClassStatusFilter {
    const lessons = this.getAdminCourseLessonItems(course);

    if (lessons.length === 0) {
      return 'upcoming';
    }

    if (lessons.some((lesson) => lesson.status === 'live')) {
      return 'live';
    }

    if (lessons.some((lesson) => lesson.status === 'upcoming')) {
      return 'upcoming';
    }

    return 'completed';
  }

  private matchesAdminGroupStatus(
    status: AdminGroupClassStatusFilter,
    filter: AdminGroupClassStatusFilter,
  ) {
    if (filter === 'all') {
      return true;
    }

    if (filter === 'active') {
      return status === 'upcoming' || status === 'live';
    }

    return status === filter;
  }

  private formatAdminGroupCourseStatus(status: AdminGroupClassStatusFilter) {
    const labels: Record<AdminGroupClassStatusFilter, string> = {
      all: 'All',
      active: 'Active',
      upcoming: 'Upcoming',
      live: 'Live',
      completed: 'Completed',
    };

    return labels[status];
  }

  private getAdminCourseLessonItems(
    course: Pick<
      AdminGroupCourse,
      | 'startDate'
      | 'time'
      | 'timeZone'
      | 'classDuration'
      | 'courseDuration'
      | 'curriculums'
      | 'curriculumItems'
    >,
  ) {
    const sourceItems =
      course.curriculumItems.length > 0
        ? course.curriculumItems
        : course.curriculums.map((title, index) => ({
            title,
            date: new Date(
              course.startDate.getTime() + index * 24 * 60 * 60 * 1000,
            ),
            time: course.time,
          }));

    return sourceItems.map((item, index) => {
      const startsAt = combineDateAndTime(
        new Date(item.date),
        item.time,
        course.timeZone,
      );
      const durationMinutes = this.getSessionDuration(course);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      const status = getTimedClassStatusByDuration(startsAt, durationMinutes);

      return {
        index,
        title: item.title,
        date: item.date,
        time: item.time,
        startsAt,
        endsAt,
        durationMinutes,
        status,
      };
    });
  }

  private getSessionDuration(course: {
    courseDuration?: number | null;
    classDuration: number;
  }) {
    return course.courseDuration ?? course.classDuration;
  }

  private combineDateAndTime(date: Date, time: string) {
    const combined = new Date(date);
    const parsed = this.parseTime(time);

    if (parsed) {
      combined.setHours(parsed.hours, parsed.minutes, 0, 0);
    }

    return combined;
  }

  private parseTime(time: string) {
    const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

    if (!match) {
      return null;
    }

    let hours = Number(match[1]);
    const minutes = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    if (hours > 23 || minutes > 59) {
      return null;
    }

    return { hours, minutes };
  }

  private async buildCards() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

    const [
      totalUsers,
      previousMonthUsers,
      activeStudents,
      activeTeachers,
      pendingTeacher,
      activeCourses,
      activeGroup,
      paidRevenue,
      previousMonthRevenue,
      pendingPayouts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          createdAt: {
            lt: monthStart,
          },
        },
      }),
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
      this.prisma.userProfile.count({
        where: {
          applicationStatus: ApplicationStatus.PENDING,
        },
      }),
      this.prisma.course.count({
        where: {
          enrollmentDeadline: {
            gte: now,
          },
        },
      }),
      this.prisma.course.count({
        where: {
          enrollmentDeadline: {
            gte: now,
          },
          maxStudent: {
            gt: 1,
          },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
          createdAt: {
            gte: previousMonthStart,
            lt: monthStart,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
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
    ]);

    const totalRevenue = paidRevenue._sum.amount ?? 0;
    const lastMonthRevenue = previousMonthRevenue._sum.amount ?? 0;
    const pendingPayoutAmount = pendingPayouts._sum.tutorAmount ?? 0;

    return {
      totalRevenue: {
        amount: totalRevenue,
        changePercentage: this.calculateChangePercentage(
          totalRevenue,
          lastMonthRevenue,
        ),
      },
      totalUser: {
        count: totalUsers,
        changeThisMonth: Math.max(0, totalUsers - previousMonthUsers),
      },
      activeStudents: {
        count: activeStudents,
      },
      activeTeacher: {
        count: activeTeachers,
      },
      pendingTeacher: {
        count: pendingTeacher,
      },
      activeCourses: {
        count: activeCourses,
      },
      pendingPayouts: {
        amount: pendingPayoutAmount,
      },
      activeGroup: {
        count: activeGroup,
      },
      items: [
        {
          key: 'totalRevenue',
          label: 'Total Revenue',
          value: totalRevenue,
          valueType: 'currency',
        },
        {
          key: 'totalUser',
          label: 'Total User',
          value: totalUsers,
          valueType: 'number',
        },
        {
          key: 'activeStudents',
          label: 'Active Students',
          value: activeStudents,
          valueType: 'number',
        },
        {
          key: 'activeTeacher',
          label: 'Active Teacher',
          value: activeTeachers,
          valueType: 'number',
        },
        {
          key: 'pendingTeacher',
          label: 'Pending teacher',
          value: pendingTeacher,
          valueType: 'number',
        },
        {
          key: 'activeCourses',
          label: 'Active Courses',
          value: activeCourses,
          valueType: 'number',
        },
        {
          key: 'pendingPayouts',
          label: 'Pending Payouts',
          value: pendingPayoutAmount,
          valueType: 'currency',
        },
        {
          key: 'activeGroup',
          label: 'Active Group',
          value: activeGroup,
          valueType: 'number',
        },
      ],
    };
  }

  private async buildRevenueOverview() {
    const { startDate, endDate, period, startMonth, year } =
      this.getCurrentHalfYearRange();

    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PAID,
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      select: {
        amount: true,
        createdAt: true,
      },
    });

    return {
      period,
      total: payments.reduce((sum, payment) => sum + payment.amount, 0),
      data: this.buildMonthSeries(year, startMonth).map(
        ({ month, monthIndex }) => {
          const revenue = payments
            .filter((payment) => payment.createdAt.getMonth() === monthIndex)
            .reduce((sum, payment) => sum + payment.amount, 0);

          return {
            month,
            revenue,
          };
        },
      ),
    };
  }

  private async buildUserJoining() {
    const { startDate, endDate, period, startMonth, year } =
      this.getCurrentHalfYearRange();

    const users = await this.prisma.user.findMany({
      where: {
        role: {
          in: [Role.STUDENT, Role.TUTOR],
        },
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      select: {
        role: true,
        createdAt: true,
      },
    });

    return {
      period,
      data: this.buildMonthSeries(year, startMonth).map(
        ({ month, monthIndex }) => ({
          month,
          teacher: users.filter(
            (user) =>
              user.role === Role.TUTOR &&
              user.createdAt.getMonth() === monthIndex,
          ).length,
          student: users.filter(
            (user) =>
              user.role === Role.STUDENT &&
              user.createdAt.getMonth() === monthIndex,
          ).length,
        }),
      ),
    };
  }

  private getCurrentHalfYearRange() {
    const now = new Date();
    const year = now.getFullYear();
    const startMonth = now.getMonth() < 6 ? 0 : 6;
    const endMonth = startMonth + 6;
    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, endMonth, 1);
    const endLabelDate = new Date(year, endMonth - 1, 1);

    return {
      startDate,
      endDate,
      startMonth,
      year,
      period: `${startDate.toLocaleString('en-US', { month: 'short' })}-${endLabelDate.toLocaleString('en-US', { month: 'short' })} ${year}`,
    };
  }

  private buildMonthSeries(year: number, startMonth: number) {
    return Array.from({ length: 6 }, (_, index) => {
      const monthIndex = startMonth + index;
      const date = new Date(year, monthIndex, 1);

      return {
        month: date.toLocaleString('en-US', { month: 'short' }),
        monthIndex,
      };
    });
  }

  private calculateChangePercentage(current: number, previous: number) {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }

    return Number((((current - previous) / previous) * 100).toFixed(2));
  }

  private async buildPaymentOverviewSummary() {
    const [totalRevenue, paidRevenue, pendingPayments, completedPayouts] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.PAID,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.PAID,
          },
          _sum: {
            commissionAmount: true,
          },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.PENDING,
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: PaymentStatus.PAID,
            payoutStatus: PayoutStatus.PAID,
          },
          _sum: {
            tutorAmount: true,
          },
        }),
      ]);

    const totalRevenueAmount = totalRevenue._sum.amount ?? 0;
    const commissionRevenue = paidRevenue._sum.commissionAmount ?? 0;
    const pendingPaymentsAmount = pendingPayments._sum.amount ?? 0;
    const completedPayoutsAmount = completedPayouts._sum.tutorAmount ?? 0;

    return {
      totalRevenue: {
        amount: totalRevenueAmount,
        amountLabel: this.formatCurrency(totalRevenueAmount),
      },
      commissionRevenue: {
        amount: commissionRevenue,
        amountLabel: this.formatCurrency(commissionRevenue),
      },
      pendingPayments: {
        amount: pendingPaymentsAmount,
        amountLabel: this.formatCurrency(pendingPaymentsAmount),
      },
      completedPayouts: {
        amount: completedPayoutsAmount,
        amountLabel: this.formatCurrency(completedPayoutsAmount),
      },
    };
  }

  private buildPaginationMeta(
    page: number,
    limit: number,
    total: number,
    rowCount: number,
  ) {
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + rowCount, total);

    return {
      page,
      limit,
      total,
      totalPages,
      from,
      to,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
      showingLabel: `Showing ${from} to ${to} of ${total} users`,
    };
  }

  private calculateCommission(amount: number) {
    const commissionRate = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.2);

    return Number((amount * commissionRate).toFixed(2));
  }

  private formatCurrency(amount: number, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  private formatFullDate(date: Date) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatTransactionCode(id: string) {
    return `TXN${id.replace(/-/g, '').slice(0, 7).toUpperCase()}`;
  }

  private formatPaymentType(type: PaymentType) {
    return type === PaymentType.GROUP ? 'Group' : 'Private';
  }

  private formatPaymentStatus(status: PaymentStatus) {
    const labels: Record<PaymentStatus, string> = {
      [PaymentStatus.PENDING]: 'Pending',
      [PaymentStatus.PAID]: 'Paid',
      [PaymentStatus.FAILED]: 'Failed',
      [PaymentStatus.CANCELLED]: 'Cancelled',
    };

    return labels[status];
  }

  private formatBookingStatus(status: PaymentStatus) {
    if (status === PaymentStatus.PAID) {
      return 'Active';
    }

    return this.formatPaymentStatus(status);
  }

  private formatPayoutStatus(status: PayoutStatus) {
    const labels: Record<PayoutStatus, string> = {
      [PayoutStatus.PENDING]: 'Pending',
      [PayoutStatus.ON_HOLD]: 'On Hold',
      [PayoutStatus.PROCESSING]: 'Processing',
      [PayoutStatus.PAID]: 'Paid',
      [PayoutStatus.FAILED]: 'Failed',
    };

    return labels[status];
  }

  private getBookingDateTime(booking: AdminBookingPayment) {
    const date = booking.course?.startDate ?? booking.createdAt;
    const time = booking.course?.time ?? null;

    return {
      date,
      dateLabel: this.formatFullDate(date),
      time,
      timeLabel: time ? this.formatTimeLabel(time) : null,
      timeZone: booking.course?.timeZone ?? null,
      durationMinutes: booking.course?.classDuration ?? null,
    };
  }

  private formatTimeLabel(time: string) {
    const [hourPart, minutePart = '0'] = time.split(':');
    const hour = Number(hourPart);
    const minute = Number(minutePart);

    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return time;
    }

    const date = new Date();
    date.setHours(hour, minute, 0, 0);

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private formatClockTime(date: Date) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private toAdminProfileResponse(user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
    adminProfile: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      avatarUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }) {
    return {
      id: user.adminProfile?.id ?? null,
      userId: user.id,
      fullName: user.fullName,
      firstName: user.adminProfile?.firstName ?? null,
      lastName: user.adminProfile?.lastName ?? null,
      email: user.email,
      phone: user.adminProfile?.phone ?? null,
      avatarUrl: user.adminProfile?.avatarUrl ?? null,
      role: user.role,
      createdAt: user.adminProfile?.createdAt ?? null,
      updatedAt: user.adminProfile?.updatedAt ?? null,
    };
  }
}
