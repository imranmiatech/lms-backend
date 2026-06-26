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
    });

    await this.updateTutorReviewStats(lesson.tutor.profileId);

    return {
      success: true,
      message: 'Review submitted successfully',
      data: {
        lessonId,
        review,
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
