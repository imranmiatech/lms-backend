import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ApplicationStatus,
  PaymentStatus,
  PaymentType,
  Prisma,
  Role,
} from '@prisma/client';
import {
  TutorStudentCourseTypeFilter,
  TutorStudentsQueryDto,
} from './dto/tutor-students-query.dto';
import { TutorQueryDto } from './dto/tutor-query.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      include: {
        profile: true,
      },
    });
  }

  async findAllTutors(query: TutorQueryDto = {}) {
    return this.buildTutorListResponse(query);
  }

  async findStudentTutors(studentId: string, query: TutorQueryDto = {}) {
    await this.assertStudent(studentId);
    return this.buildTutorListResponse(query, studentId);
  }

  async findAllFavoriteTutors(studentId: string) {
    await this.assertStudent(studentId);

    const favorites = await this.prisma.studentFavoriteTutor.findMany({
      where: {
        studentId,
        tutor: {
          role: Role.TUTOR,
          profile: {
            applicationStatus: ApplicationStatus.APPROVED,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        tutor: {
          include: {
            profile: true,
          },
        },
      },
    });

    const tutorIds = favorites.map((favorite) => favorite.tutorId);
    const completedCourseCountByTutor =
      await this.getCompletedCourseCountByTutorIds(tutorIds);

    return {
      success: true,
      data: favorites.map(({ tutor }) => ({
        ...tutor,
        isFavorite: true,
        profile: tutor.profile
          ? {
              ...tutor.profile,
              completedCoursesCount: completedCourseCountByTutor[tutor.id] ?? 0,
            }
          : null,
      })),
    };
  }

  async toggleFavoriteTutor(studentId: string, tutorId: string) {
    await this.assertStudent(studentId);

    const tutor = await this.prisma.user.findFirst({
      where: {
        id: tutorId,
        role: Role.TUTOR,
        profile: {
          applicationStatus: ApplicationStatus.APPROVED,
        },
      },
      select: { id: true },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const existingFavorite = await this.prisma.studentFavoriteTutor.findUnique({
      where: {
        studentId_tutorId: {
          studentId,
          tutorId,
        },
      },
    });

    if (existingFavorite) {
      await this.prisma.studentFavoriteTutor.delete({
        where: { id: existingFavorite.id },
      });

      return {
        success: true,
        data: {
          tutorId,
          isFavorite: false,
        },
      };
    }

    await this.prisma.studentFavoriteTutor.create({
      data: {
        studentId,
        tutorId,
      },
    });

    return {
      success: true,
      data: {
        tutorId,
        isFavorite: true,
      },
    };
  }

  async findBestRatedTutors() {
    return this.buildBestRatedTutorListResponse();
  }

  async findStudentBestRatedTutors(studentId: string) {
    await this.assertStudent(studentId);
    return this.buildBestRatedTutorListResponse(studentId);
  }

  private async buildTutorListResponse(
    query: TutorQueryDto = {},
    studentId?: string,
  ) {
    const [profiles, completedCourses] = await Promise.all([
      this.prisma.userProfile.findMany({
        where: this.buildTutorWhere(query),
        include: {
          user: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.courseCompletion.findMany({
        where: {
          course: {
            tutor: {
              profile: {
                applicationStatus: ApplicationStatus.APPROVED,
              },
              role: 'TUTOR',
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
      }),
    ]);

    const completedCourseCountByTutor =
      this.getCompletedCourseCountByTutor(completedCourses);
    const favoriteTutorIds = studentId
      ? await this.getFavoriteTutorIdSet(studentId)
      : new Set<string>();

    return {
      success: true,
      filters: {
        subject: query.subject || 'All Subjects',
        price: query.price || 'All Prices',
      },
      data: profiles.map(({ user, ...profile }) => ({
        ...user,
        isFavorite: favoriteTutorIds.has(user.id),
        profile: {
          ...profile,
          completedCoursesCount: completedCourseCountByTutor[user.id] ?? 0,
        },
      })),
    };
  }

  private async buildBestRatedTutorListResponse(studentId?: string) {
    const [profiles, completedCourses] = await Promise.all([
      this.prisma.userProfile.findMany({
        where: this.buildTutorWhere(),
        include: {
          user: true,
        },
        orderBy: [
          {
            averageRating: {
              sort: 'desc',
              nulls: 'last',
            },
          },
          { totalReviews: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.courseCompletion.findMany({
        where: {
          course: {
            tutor: {
              profile: {
                applicationStatus: ApplicationStatus.APPROVED,
              },
              role: 'TUTOR',
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
      }),
    ]);

    const completedCourseCountByTutor =
      this.getCompletedCourseCountByTutor(completedCourses);
    const favoriteTutorIds = studentId
      ? await this.getFavoriteTutorIdSet(studentId)
      : new Set<string>();

    return {
      success: true,
      data: profiles.map(({ user, ...profile }) => ({
        ...user,
        isFavorite: favoriteTutorIds.has(user.id),
        profile: {
          ...profile,
          completedCoursesCount: completedCourseCountByTutor[user.id] ?? 0,
        },
      })),
    };
  }

  private buildTutorWhere(
    query: TutorQueryDto = {},
  ): Prisma.UserProfileWhereInput {
    const subject = query.subject?.trim();
    const priceFilter = this.getTutorPriceFilter(query.price);

    return {
      applicationStatus: ApplicationStatus.APPROVED,
      user: {
        role: 'TUTOR',
      },
      ...(subject &&
        !this.isAllFilter(subject) && {
          teachingCategory: {
            equals: subject,
            mode: 'insensitive',
          },
        }),
      ...(priceFilter && {
        pricePerHour: priceFilter,
      }),
    };
  }

  private getTutorPriceFilter(
    price?: string,
  ): Prisma.FloatNullableFilter | undefined {
    if (!price || this.isAllFilter(price)) {
      return undefined;
    }

    const normalized = price.toLowerCase().replace(/\s/g, '');

    if (
      ['$0-$40/hr', '$0-40/hr', '0-40', '0_40', '0to40'].includes(normalized)
    ) {
      return {
        gte: 0,
        lte: 40,
      };
    }

    if (
      ['$40-$60/hr', '$40-60/hr', '40-60', '40_60', '40to60'].includes(
        normalized,
      )
    ) {
      return {
        gte: 40,
        lte: 60,
      };
    }

    if (['$60+/hr', '60+', '60plus', '60_plus'].includes(normalized)) {
      return {
        gte: 60,
      };
    }

    return undefined;
  }

  private isAllFilter(value: string) {
    const normalized = value.toLowerCase().replace(/\s/g, '');

    return ['all', 'allsubjects', 'allprices'].includes(normalized);
  }

  private getCompletedCourseCountByTutor(
    completedCourses: { course: { tutorId: string } }[],
  ) {
    return completedCourses.reduce<Record<string, number>>(
      (counts, completion) => {
        const tutorId = completion.course.tutorId;
        counts[tutorId] = (counts[tutorId] ?? 0) + 1;
        return counts;
      },
      {},
    );
  }

  private async getCompletedCourseCountByTutorIds(tutorIds: string[]) {
    if (tutorIds.length === 0) {
      return {};
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

    return this.getCompletedCourseCountByTutor(completedCourses);
  }

  private async getFavoriteTutorIdSet(studentId: string) {
    const favorites = await this.prisma.studentFavoriteTutor.findMany({
      where: { studentId },
      select: {
        tutorId: true,
      },
    });

    return new Set(favorites.map((favorite) => favorite.tutorId));
  }

  private async assertStudent(studentId: string) {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: Role.STUDENT,
      },
      select: { id: true },
    });

    if (!student) {
      throw new ForbiddenException('Only students can manage favorite tutors');
    }
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findTutorStudents(tutorId: string, query: TutorStudentsQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const type = query.type ?? TutorStudentCourseTypeFilter.ALL;
    const search = query.search?.trim();
    const includeGroup =
      type === TutorStudentCourseTypeFilter.ALL ||
      type === TutorStudentCourseTypeFilter.GROUP;
    const includePrivate =
      type === TutorStudentCourseTypeFilter.ALL ||
      type === TutorStudentCourseTypeFilter.PRIVATE;

    const enrollmentFilters: Prisma.UserWhereInput[] = [];

    if (includeGroup) {
      enrollmentFilters.push({
        courseEnrollments: {
          some: {
            course: {
              tutorId,
            },
          },
        },
      });
    }

    if (includePrivate) {
      enrollmentFilters.push({
        payments: {
          some: {
            tutorId,
            type: PaymentType.PRIVATE,
            status: PaymentStatus.PAID,
          },
        },
      });
    }

    const where: Prisma.UserWhereInput = {
      role: 'STUDENT',
      ...(search && {
        OR: [
          {
            fullName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      }),
      ...(enrollmentFilters.length > 0 && {
        AND: [
          {
            OR: enrollmentFilters,
          },
        ],
      }),
    };

    const [total, students] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          fullName: 'asc',
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          profile: {
            select: {
              avatarUrl: true,
            },
          },
          courseEnrollments: {
            where: {
              course: {
                tutorId,
              },
            },
            select: {
              id: true,
              createdAt: true,
              courseId: true,
              course: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
          curriculumProgress: {
            where: {
              course: {
                tutorId,
              },
            },
            select: {
              id: true,
            },
          },
          payments: {
            where: {
              tutorId,
              type: PaymentType.PRIVATE,
              status: PaymentStatus.PAID,
            },
            select: {
              id: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + students.length, total);

    return {
      success: true,
      data: students.map((student) => {
        const groupCourseIds = new Set(
          student.courseEnrollments.map((enrollment) => enrollment.courseId),
        );
        const privateHireCount = student.payments.length;
        const joinedDates = [
          ...student.courseEnrollments.map(
            (enrollment) => enrollment.createdAt,
          ),
          ...student.payments.map((payment) => payment.createdAt),
        ];
        const activeCourses = [
          ...(student.courseEnrollments.length > 0 ? ['group'] : []),
          ...(privateHireCount > 0 ? ['private'] : []),
        ];

        return {
          studentId: student.id,
          studentName: student.fullName,
          studentEmail: student.email,
          studentImage: student.profile?.avatarUrl ?? null,
          courses: groupCourseIds.size + privateHireCount,
          lessonCompleted: student.curriculumProgress.length,
          joined: this.getEarliestDate(joinedDates),
          activeCourses,
          groupCourses: student.courseEnrollments.map((enrollment) => ({
            id: enrollment.course.id,
            title: enrollment.course.title,
            joined: enrollment.createdAt,
          })),
          privateHireCount,
        };
      }),
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
      filters: {
        search: search ?? null,
        type,
      },
    };
  }

  async findTutorStudentById(tutorId: string, studentId: string) {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: 'STUDENT',
        OR: [
          {
            courseEnrollments: {
              some: {
                course: {
                  tutorId,
                },
              },
            },
          },
          {
            payments: {
              some: {
                tutorId,
                type: PaymentType.PRIVATE,
                status: PaymentStatus.PAID,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        profile: {
          select: {
            avatarUrl: true,
            country: true,
            city: true,
          },
        },
        courseEnrollments: {
          where: {
            course: {
              tutorId,
            },
          },
          select: {
            id: true,
            createdAt: true,
            courseId: true,
            course: {
              select: {
                id: true,
                title: true,
                image: true,
                startDate: true,
              },
            },
          },
        },
        curriculumProgress: {
          where: {
            course: {
              tutorId,
            },
          },
          select: {
            id: true,
            courseId: true,
            curriculumIndex: true,
            completedAt: true,
          },
        },
        payments: {
          where: {
            tutorId,
            type: PaymentType.PRIVATE,
            status: PaymentStatus.PAID,
          },
          select: {
            id: true,
            amount: true,
            createdAt: true,
            status: true,
            type: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found in your roster');
    }

    const joinedDates = [
      ...student.courseEnrollments.map((enrollment) => enrollment.createdAt),
      ...student.payments.map((payment) => payment.createdAt),
    ];

    return {
      success: true,
      data: {
        studentId: student.id,
        studentName: student.fullName,
        studentEmail: student.email,
        studentImage: student.profile?.avatarUrl ?? null,
        country: student.profile?.country ?? null,
        city: student.profile?.city ?? null,
        courses: student.courseEnrollments.length + student.payments.length,
        lessonCompleted: student.curriculumProgress.length,
        joined: this.getEarliestDate(joinedDates),
        activeCourses: [
          ...(student.courseEnrollments.length > 0 ? ['group'] : []),
          ...(student.payments.length > 0 ? ['private'] : []),
        ],
        groupCourses: student.courseEnrollments.map((enrollment) => ({
          enrollmentId: enrollment.id,
          id: enrollment.course.id,
          title: enrollment.course.title,
          image: enrollment.course.image,
          startDate: enrollment.course.startDate,
          joined: enrollment.createdAt,
        })),
        completedLessons: student.curriculumProgress,
        privatePayments: student.payments.map((payment) => ({
          paymentId: payment.id,
          amount: payment.amount,
          date: payment.createdAt,
          status: payment.status.toLowerCase(),
          type: payment.type.toLowerCase(),
        })),
      },
    };
  }

  async deleteTutorStudent(tutorId: string, studentId: string) {
    const tutorCourseIds = await this.prisma.course.findMany({
      where: {
        tutorId,
        enrollments: {
          some: {
            studentId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    const courseIds = tutorCourseIds.map((course) => course.id);

    if (courseIds.length === 0) {
      throw new NotFoundException(
        'No group course enrollment found for this student in your roster',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const deletedProgress = await tx.curriculumProgress.deleteMany({
        where: {
          studentId,
          courseId: {
            in: courseIds,
          },
        },
      });

      const deletedCompletions = await tx.courseCompletion.deleteMany({
        where: {
          studentId,
          courseId: {
            in: courseIds,
          },
        },
      });

      const deletedEnrollments = await tx.courseEnrollment.deleteMany({
        where: {
          studentId,
          courseId: {
            in: courseIds,
          },
        },
      });

      return {
        deletedProgress: deletedProgress.count,
        deletedCompletions: deletedCompletions.count,
        deletedEnrollments: deletedEnrollments.count,
      };
    });

    return {
      success: true,
      message:
        'Student removed from your group courses. Private payment history was kept.',
      data: {
        studentId,
        courseIds,
        ...result,
      },
    };
  }

  async updateProfileStatus(profileId: string, status: ApplicationStatus) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException(
        `User profile with ID ${profileId} not found`,
      );
    }

    const updatedProfile = await this.prisma.userProfile.update({
      where: { id: profileId },
      data: { applicationStatus: status },
    });

    return {
      success: true,
      message: `Application status updated to ${status} successfully`,
      data: updatedProfile,
    };
  }

  async updateUserRole(userId: string, role: Role) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
      },
    });

    return {
      success: true,
      message: `User role updated to ${role} successfully`,
      data: updatedUser,
    };
  }

  private getEarliestDate(dates: Date[]) {
    if (dates.length === 0) {
      return null;
    }

    return dates.reduce((earliest, date) =>
      date < earliest ? date : earliest,
    );
  }
}
