import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AgoraService } from '../agora/agora.service';
import {
  combineDateAndTime,
  getTimedClassStatus,
} from '../common/time/lesson-status.util';
import {
  StudentLessonQueryDto,
  StudentLessonReviewListQueryDto,
  StudentLessonReviewDto,
} from './dto/student-lessons.dto';
import { PrismaService } from 'src/prisma/prisma.service';

type LessonStatus = 'upcoming' | 'live' | 'completed' | 'cancelled';

type EnrolledCourse = Prisma.CourseEnrollmentGetPayload<{
  include: {
    course: {
      include: {
        tutor: {
          select: {
            id: true;
            fullName: true;
            profile: {
              select: {
                id: true;
                avatarUrl: true;
                averageRating: true;
                totalReviews: true;
                bio: true;
                yearOfExperience: true;
              };
            };
          };
        };
      };
    };
  };
}>;

type StudentLesson = {
  id: string;
  courseId: string;
  curriculumIndex: number;
  title: string;
  courseTitle: string;
  image: string | null;
  lessonType: 'Private' | 'Group';
  tutor: {
    id: string;
    name: string;
    avatarUrl: string | null;
    profileId: string | null;
    bio: string | null;
    yearOfExperience: number | null;
    averageRating: number | null;
    totalReviews: number;
  };
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  dateLabel: string;
  timeLabel: string;
  durationMinutes: number;
  status: LessonStatus;
  joinAvailable: boolean;
  review: {
    id: string;
    rating: number;
    comment: string | null;
  } | null;
};

type LessonStateOverride = {
  status: string;
  reason: string | null;
};

type ReviewWithPeople = Prisma.ReviewGetPayload<{
  include: {
    reviewer: {
      select: {
        id: true;
        fullName: true;
        profile: {
          select: {
            avatarUrl: true;
          };
        };
      };
    };
    tutorProfile: {
      select: {
        id: true;
        userId: true;
      };
    };
  };
}>;

@Injectable()
export class StudentLessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agoraService: AgoraService,
  ) {}

  async listLessons(studentId: string, query: StudentLessonQueryDto) {
    await this.assertStudent(studentId);

    const lessons = await this.buildStudentLessons(studentId);
    const tabCounts = {
      upcoming: lessons.filter((lesson) =>
        ['upcoming', 'live'].includes(lesson.status),
      ).length,
      completed: lessons.filter((lesson) => lesson.status === 'completed')
        .length,
      cancelled: lessons.filter((lesson) => lesson.status === 'cancelled')
        .length,
    };

    const filtered = query.status
      ? lessons.filter((lesson) =>
          query.status === 'upcoming'
            ? ['upcoming', 'live'].includes(lesson.status)
            : lesson.status === query.status,
        )
      : lessons;

    return {
      success: true,
      data: {
        tabs: tabCounts,
        lessons: filtered.map((lesson) => this.serializeLesson(lesson)),
      },
    };
  }

  async getJoinPreview(studentId: string, lessonId: string) {
    const lesson = await this.assertStudentLesson(studentId, lessonId);

    if (lesson.status !== 'live') {
      throw new BadRequestException('This lesson cannot be joined');
    }

    return {
      success: true,
      data: {
        lesson: this.serializeLesson(lesson),
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
          channelName: this.agoraService.buildChannelName(
            lesson.courseId,
            lesson.curriculumIndex,
          ),
        },
      },
    };
  }

  async joinLesson(studentId: string, lessonId: string) {
    const lesson = await this.assertStudentLesson(studentId, lessonId);

    if (lesson.status !== 'live') {
      throw new BadRequestException('This lesson cannot be joined');
    }

    const channelName = this.agoraService.buildChannelName(
      lesson.courseId,
      lesson.curriculumIndex,
    );

    return {
      success: true,
      data: {
        lesson: this.serializeLesson(lesson),
        agora: this.agoraService.buildRtcToken({
          channelName,
          account: studentId,
          role: 'publisher',
        }),
        screenShare: this.agoraService.buildRtcJoinCredentials({
          channelName,
          account: studentId,
          role: 'publisher',
        }).screenShare,
      },
    };
  }

  async reviewLesson(
    studentId: string,
    lessonId: string,
    dto: StudentLessonReviewDto,
  ) {
    const lesson = await this.assertStudentLesson(studentId, lessonId);

    if (lesson.status !== 'completed') {
      throw new BadRequestException(
        'You can review a lesson after it is completed',
      );
    }

    if (!lesson.tutor.profileId) {
      throw new BadRequestException(
        'Tutor profile is not available for review',
      );
    }

    const review = await this.prisma.review.upsert({
      where: {
        reviewerId_tutorProfileId: {
          reviewerId: studentId,
          tutorProfileId: lesson.tutor.profileId,
        },
      },
      update: {
        rating: dto.rating,
        comment: dto.comment,
      },
      create: {
        reviewerId: studentId,
        tutorProfileId: lesson.tutor.profileId,
        rating: dto.rating,
        comment: dto.comment,
      },
      include: this.getReviewInclude(),
    });

    await this.updateTutorReviewStats(lesson.tutor.profileId);

    return {
      success: true,
      message: 'Review submitted successfully',
      data: {
        lessonId,
        review: this.serializeReview(review),
      },
    };
  }

  async getLessonReviews(
    studentId: string,
    lessonId: string,
    query: StudentLessonReviewListQueryDto,
  ) {
    const lesson = await this.assertStudentLesson(studentId, lessonId);

    if (!lesson.tutor.profileId) {
      throw new BadRequestException(
        'Tutor profile is not available for reviews',
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(50, query.limit ?? 10));
    const where: Prisma.ReviewWhereInput = {
      tutorProfileId: lesson.tutor.profileId,
    };

    const [
      totalReviews,
      ratingStats,
      fiveStarCount,
      fourStarCount,
      threeStarCount,
      twoStarCount,
      oneStarCount,
      reviews,
      currentStudentReview,
    ] = await this.prisma.$transaction([
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({
        where,
        _avg: {
          rating: true,
        },
      }),
      this.prisma.review.count({ where: { ...where, rating: 5 } }),
      this.prisma.review.count({ where: { ...where, rating: 4 } }),
      this.prisma.review.count({ where: { ...where, rating: 3 } }),
      this.prisma.review.count({ where: { ...where, rating: 2 } }),
      this.prisma.review.count({ where: { ...where, rating: 1 } }),
      this.prisma.review.findMany({
        where,
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: this.getReviewInclude(),
      }),
      this.prisma.review.findUnique({
        where: {
          reviewerId_tutorProfileId: {
            reviewerId: studentId,
            tutorProfileId: lesson.tutor.profileId,
          },
        },
        include: this.getReviewInclude(),
      }),
    ]);

    const ratingCounts = {
      5: fiveStarCount,
      4: fourStarCount,
      3: threeStarCount,
      2: twoStarCount,
      1: oneStarCount,
    };
    const totalPages = Math.ceil(totalReviews / limit);

    return {
      success: true,
      data: {
        lesson: {
          id: lesson.id,
          courseId: lesson.courseId,
          curriculumIndex: lesson.curriculumIndex,
          title: lesson.title,
          courseTitle: lesson.courseTitle,
        },
        tutor: {
          id: lesson.tutor.id,
          tutorId: lesson.tutor.id,
          profileId: lesson.tutor.profileId,
          name: lesson.tutor.name,
          avatarUrl: lesson.tutor.avatarUrl,
        },
        summary: {
          totalReviews,
          averageRating: Number((ratingStats._avg.rating ?? 0).toFixed(1)),
          ratingBreakdown: [5, 4, 3, 2, 1].map((star) => {
            const count = ratingCounts[star as keyof typeof ratingCounts];
            const percentage =
              totalReviews > 0
                ? Number(((count / totalReviews) * 100).toFixed(2))
                : 0;

            return { star, count, percentage };
          }),
        },
        currentStudentReview: currentStudentReview
          ? this.serializeReview(currentStudentReview)
          : null,
        reviews: reviews.map((review) => this.serializeReview(review)),
        pagination: {
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    };
  }

  async getAllReviews() {
    const limit = 12;

    const [
      totalReviews,
      ratingStats,
      fiveStarCount,
      fourStarCount,
      threeStarCount,
      twoStarCount,
      oneStarCount,
      reviews,
    ] = await Promise.all([
      this.prisma.review.count(),
      this.prisma.review.aggregate({
        _avg: {
          rating: true,
        },
      }),
      this.prisma.review.count({ where: { rating: 5 } }),
      this.prisma.review.count({ where: { rating: 4 } }),
      this.prisma.review.count({ where: { rating: 3 } }),
      this.prisma.review.count({ where: { rating: 2 } }),
      this.prisma.review.count({ where: { rating: 1 } }),
      this.prisma.review.findMany({
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        include: this.getReviewInclude(),
      }),
    ]);

    const ratingCounts = {
      5: fiveStarCount,
      4: fourStarCount,
      3: threeStarCount,
      2: twoStarCount,
      1: oneStarCount,
    };

    return {
      success: true,
      data: {
        summary: {
          totalReviews,
          averageRating: Number((ratingStats._avg.rating ?? 0).toFixed(1)),
          ratingBreakdown: [5, 4, 3, 2, 1].map((star) => {
            const count = ratingCounts[star as keyof typeof ratingCounts];
            const percentage =
              totalReviews > 0
                ? Number(((count / totalReviews) * 100).toFixed(2))
                : 0;

            return { star, count, percentage };
          }),
        },
        reviews: reviews.map((review) => this.serializeReview(review)),
        meta: {
          limit,
          returned: reviews.length,
        },
      },
    };
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
      throw new ForbiddenException('Only students can access these lessons');
    }
  }

  private async assertStudentLesson(studentId: string, lessonId: string) {
    await this.assertStudent(studentId);
    const lessons = await this.buildStudentLessons(studentId);
    const lesson = lessons.find((item) => item.id === lessonId);

    if (!lesson) {
      throw new NotFoundException('Lesson not found for this student');
    }

    return lesson;
  }

  private async buildStudentLessons(
    studentId: string,
  ): Promise<StudentLesson[]> {
    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          include: {
            curriculumItems: {
              orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
              select: {
                title: true,
                date: true,
                time: true,
              },
            },
            tutor: {
              select: {
                id: true,
                fullName: true,
                profile: {
                  select: {
                    id: true,
                    avatarUrl: true,
                    averageRating: true,
                    totalReviews: true,
                    bio: true,
                    yearOfExperience: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const tutorProfileIds = enrollments
      .map((enrollment) => enrollment.course.tutor.profile?.id)
      .filter((id): id is string => Boolean(id));

    const reviews = await this.prisma.review.findMany({
      where: {
        reviewerId: studentId,
        tutorProfileId: {
          in: tutorProfileIds,
        },
      },
      select: {
        id: true,
        tutorProfileId: true,
        rating: true,
        comment: true,
      },
    });
    const reviewByTutorProfile = new Map(
      reviews.map((review) => [review.tutorProfileId, review]),
    );
    const lessonStates = await this.prisma.$queryRaw<
      {
        courseId: string;
        curriculumIndex: number;
        status: string;
        reason: string | null;
      }[]
    >`
      SELECT "courseId", "curriculumIndex", "status", "reason"
      FROM "StudentLessonState"
      WHERE "studentId" = ${studentId}
    `;
    const stateByLesson = new Map<string, LessonStateOverride>(
      lessonStates.map((state) => [
        this.getLessonKey(state.courseId, state.curriculumIndex),
        {
          status: state.status,
          reason: state.reason,
        },
      ]),
    );

    return enrollments
      .flatMap((enrollment) =>
        this.courseToLessons(enrollment, reviewByTutorProfile, stateByLesson),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  private courseToLessons(
    enrollment: EnrolledCourse,
    reviewByTutorProfile: Map<
      string,
      { id: string; rating: number; comment: string | null }
    >,
    stateByLesson: Map<string, LessonStateOverride>,
  ): StudentLesson[] {
    const { course } = enrollment;
    const lessonItems = this.getCourseLessonItems(course);
    const tutorProfile = course.tutor.profile;
    const review = tutorProfile?.id
      ? (reviewByTutorProfile.get(tutorProfile.id) ?? null)
      : null;

    return lessonItems.map((item, curriculumIndex) => {
      const startsAt = this.getLessonStartAt(
        item.date,
        item.time,
        course.timeZone,
      );
      const endsAt = new Date(
        startsAt.getTime() + course.classDuration * 60 * 1000,
      );
      const lessonState = stateByLesson.get(
        this.getLessonKey(course.id, curriculumIndex),
      );
      const status =
        lessonState?.status === 'cancelled'
          ? 'cancelled'
          : this.getLessonStatus(startsAt, endsAt);

      return {
        id: `${course.id}:${curriculumIndex}`,
        courseId: course.id,
        curriculumIndex,
        title: item.title,
        courseTitle: course.title,
        image: course.image,
        lessonType: course.maxStudent > 1 ? 'Group' : 'Private',
        tutor: {
          id: course.tutor.id,
          name: course.tutor.fullName,
          avatarUrl: tutorProfile?.avatarUrl ?? null,
          profileId: tutorProfile?.id ?? null,
          bio: tutorProfile?.bio ?? null,
          yearOfExperience: tutorProfile?.yearOfExperience ?? null,
          averageRating: tutorProfile?.averageRating ?? null,
          totalReviews: tutorProfile?.totalReviews ?? 0,
        },
        startsAt,
        endsAt,
        timeZone: course.timeZone,
        dateLabel: this.formatDate(startsAt),
        timeLabel: this.formatTimeRange(startsAt, endsAt),
        durationMinutes: course.classDuration,
        status,
        joinAvailable: status === 'live',
        review,
      };
    });
  }

  private serializeLesson(lesson: StudentLesson) {
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      curriculumIndex: lesson.curriculumIndex,
      title: lesson.title,
      courseTitle: lesson.courseTitle,
      image: lesson.image,
      lessonType: lesson.lessonType,
      tutor: lesson.tutor,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      timeZone: lesson.timeZone,
      dateLabel: lesson.dateLabel,
      timeLabel: lesson.timeLabel,
      durationMinutes: lesson.durationMinutes,
      status: lesson.status,
      joinAvailable: lesson.joinAvailable,
      canReview: lesson.status === 'completed',
      review: lesson.review,
    };
  }

  private getReviewInclude() {
    return {
      reviewer: {
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
      tutorProfile: {
        select: {
          id: true,
          userId: true,
        },
      },
    } satisfies Prisma.ReviewInclude;
  }

  private serializeReview(review: ReviewWithPeople) {
    return {
      id: review.id,
      tutorId: review.tutorProfile.userId,
      tutorProfileId: review.tutorProfileId,
      reviewerId: review.reviewerId,
      reviewerName: review.reviewer.fullName || 'Anonymous',
      reviewerImage: review.reviewer.profile?.avatarUrl ?? null,
      name: review.reviewer.fullName || 'Anonymous',
      image: review.reviewer.profile?.avatarUrl ?? null,
      reviewer: {
        id: review.reviewer.id,
        name: review.reviewer.fullName || 'Anonymous',
        avatarUrl: review.reviewer.profile?.avatarUrl ?? null,
      },
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private getLessonStatus(startsAt: Date, endsAt: Date): LessonStatus {
    return getTimedClassStatus(startsAt, endsAt);
  }

  private getLessonKey(courseId: string, curriculumIndex: number) {
    return `${courseId}:${curriculumIndex}`;
  }

  private getLessonStartAt(
    courseStartDate: Date,
    courseTime: string,
    timeZone?: string | null,
  ) {
    return combineDateAndTime(new Date(courseStartDate), courseTime, timeZone);
  }

  private getCourseLessonItems(course: {
    title: string;
    curriculums: string[];
    curriculumItems?: {
      title: string;
      date: Date;
      time: string;
    }[];
    startDate: Date;
    time: string;
  }) {
    if (course.curriculumItems?.length) {
      return course.curriculumItems;
    }

    const lessonTitles = course.curriculums.length
      ? course.curriculums
      : [course.title];

    return lessonTitles.map((title, index) => {
      const date = new Date(course.startDate);
      date.setDate(date.getDate() + index);

      return {
        title,
        date,
        time: course.time,
      };
    });
  }

  private parseTime(time: string) {
    const match = time
      .trim()
      .toLowerCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);

    if (!match) {
      return null;
    }

    let hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3];

    if (meridiem === 'pm' && hours < 12) {
      hours += 12;
    }

    if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }

    if (hours > 23 || minutes > 59) {
      return null;
    }

    return { hours, minutes };
  }

  private formatDate(date: Date) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  private formatTimeRange(start: Date, end: Date) {
    return `${this.formatTime(start)} - ${this.formatTime(end)}`;
  }

  private formatTime(date: Date) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  private async updateTutorReviewStats(tutorProfileId: string) {
    const stats = await this.prisma.review.aggregate({
      _avg: { rating: true },
      _count: { rating: true },
      where: { tutorProfileId },
    });

    await this.prisma.userProfile.update({
      where: { id: tutorProfileId },
      data: {
        averageRating: stats._avg.rating ?? null,
        totalReviews: stats._count.rating,
      },
    });
  }
}
