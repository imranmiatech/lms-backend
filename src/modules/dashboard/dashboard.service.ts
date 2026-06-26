import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  combineDateAndTime,
  getTimedClassStatusByDuration,
} from '../common/time/lesson-status.util';

type DashboardLesson = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  date: Date;
  startsAt: Date;
  endsAt: Date;
  time: string;
  timeZone: string;
  status: 'completed' | 'live' | 'upcoming';
};

type CourseLessonItem = {
  title: string;
  date: Date;
  time: string;
};

type StudentCourse = {
  id: string;
  title: string;
  image: string | null;
  curriculums: string[];
  curriculumItems?: CourseLessonItem[];
  startDate: Date;
  time: string;
  timeZone: string;
  classDuration: number;
  courseDuration: number;
  tutor: {
    id: string;
    fullName: string;
    email: string;
    profile: {
      avatarUrl: string | null;
    } | null;
  };
  courseCompletions: { id: string }[];
  curriculumProgress: { curriculumIndex: number }[];
};

type StudentLesson = DashboardLesson & {
  courseImage: string | null;
  tutor: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  durationMinutes: number;
  curriculumIndex: number;
  isCompletedByStudent: boolean;
};

type StudentDashboardContext = {
  student: {
    id: string;
    fullName: string;
    profile: {
      avatarUrl: string | null;
    } | null;
  };
  enrollments: {
    id: string;
    createdAt: Date;
    course: StudentCourse;
  }[];
  courses: StudentCourse[];
  lessons: StudentLesson[];
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentHome(studentId: string) {
    const [
      overview,
      nextLesson,
      todaySchedule,
      learningProgress,
      recentActivity,
    ] = await Promise.all([
      this.getStudentOverviewData(studentId),
      this.getStudentNextLessonData(studentId),
      this.getStudentTodayScheduleData(studentId),
      this.getStudentLearningProgressData(studentId),
      this.getStudentRecentActivityData(studentId),
    ]);

    return {
      success: true,
      data: {
        ...overview,
        todaySchedule,
        nextLesson,
        learningProgress,
        recentActivity,
      },
    };
  }

  async getStudentOverview(studentId: string) {
    return {
      success: true,
      data: await this.getStudentOverviewData(studentId),
    };
  }

  async getStudentNextLesson(studentId: string) {
    return {
      success: true,
      data: await this.getStudentNextLessonData(studentId),
    };
  }

  async getStudentTodaySchedule(studentId: string) {
    return {
      success: true,
      data: await this.getStudentTodayScheduleData(studentId),
    };
  }

  async getStudentLearningProgress(studentId: string) {
    return {
      success: true,
      data: await this.getStudentLearningProgressData(studentId),
    };
  }

  async getStudentRecentActivity(studentId: string) {
    return {
      success: true,
      data: await this.getStudentRecentActivityData(studentId),
    };
  }

  async getTutorHome(tutorId: string) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const tomorrowStart = this.addDays(todayStart, 1);
    const weekStart = this.startOfWeek(now);
    const nextWeekStart = this.addDays(weekStart, 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const tutor = await this.prisma.user.findUnique({
      where: { id: tutorId },
      select: {
        id: true,
        fullName: true,
        profile: {
          select: {
            avatarUrl: true,
            id: true,
          },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const [
      courses,
      weeklyRevenue,
      previousWeekRevenue,
      revenueRows,
      totalStudents,
      previousMonthStudents,
      recentNotifications,
      recentPayments,
      recentReviews,
    ] = await Promise.all([
      this.prisma.course.findMany({
        where: { tutorId },
        select: {
          id: true,
          title: true,
          curriculums: true,
          startDate: true,
          time: true,
          timeZone: true,
          classDuration: true,
          courseDuration: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: weekStart,
            lt: nextWeekStart,
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: this.addDays(weekStart, -7),
            lt: weekStart,
          },
        },
        _sum: {
          amount: true,
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
          amount: true,
          createdAt: true,
        },
      }),
      this.getTotalTutorStudents(tutorId),
      this.getTotalTutorStudents(tutorId, {
        lt: monthStart,
      }),
      this.prisma.notification.findMany({
        where: { userId: tutorId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          createdAt: true,
          targetUrl: true,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: {
            select: {
              fullName: true,
            },
          },
          course: {
            select: {
              title: true,
            },
          },
        },
      }),
      tutor.profile?.id
        ? this.prisma.review.findMany({
            where: {
              tutorProfileId: tutor.profile.id,
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              reviewer: {
                select: {
                  fullName: true,
                },
              },
            },
          })
        : [],
    ]);

    const lessons = courses.flatMap((course) =>
      this.buildCourseLessons(course, now),
    );
    const todayLessons = lessons.filter(
      (lesson) => lesson.date >= todayStart && lesson.date < tomorrowStart,
    );
    const upcomingLessons = lessons
      .filter(
        (lesson) => lesson.status === 'live' || lesson.status === 'upcoming',
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 3);

    const weeklyAmount = weeklyRevenue._sum.amount ?? 0;
    const previousWeeklyAmount = previousWeekRevenue._sum.amount ?? 0;

    return {
      success: true,
      data: {
        welcome: {
          tutorId: tutor.id,
          name: tutor.fullName,
          image: tutor.profile?.avatarUrl ?? null,
        },
        cards: {
          todaysLessons: {
            count: todayLessons.length,
            changeFromYesterday: this.getLessonChangeFromYesterday(
              lessons,
              todayStart,
            ),
          },
          weeklyRevenue: {
            amount: weeklyAmount,
            changePercentage: this.calculateChangePercentage(
              weeklyAmount,
              previousWeeklyAmount,
            ),
          },
          activeCourses: {
            count: this.getActiveCourseCount(lessons),
          },
          totalStudents: {
            count: totalStudents,
            changeThisMonth: Math.max(0, totalStudents - previousMonthStudents),
          },
        },
        upcomingLessons: upcomingLessons.map((lesson) =>
          this.mapLesson(lesson),
        ),
        weeklyLessons: this.buildWeeklyLessons(lessons, weekStart),
        revenueOverview: {
          period: `${yearStart.toLocaleString('en-US', { month: 'short' })}-${now.toLocaleString('en-US', { month: 'short' })} ${now.getFullYear()}`,
          data: this.buildMonthlyRevenueOverview(revenueRows, now),
        },
        recentActivity: this.buildRecentActivity(
          recentNotifications,
          recentPayments,
          recentReviews,
        ),
      },
    };
  }

  async getTutorWelcome(tutorId: string) {
    const tutor = await this.getTutorProfile(tutorId);

    return {
      success: true,
      data: {
        tutorId: tutor.id,
        name: tutor.fullName,
        image: tutor.profile?.avatarUrl ?? null,
      },
    };
  }

  async getTutorCards(tutorId: string) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const weekStart = this.startOfWeek(now);
    const nextWeekStart = this.addDays(weekStart, 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const courses = await this.getTutorCourses(tutorId);
    const lessons = courses.flatMap((course) =>
      this.buildCourseLessons(course, now),
    );

    const [
      weeklyRevenue,
      previousWeekRevenue,
      totalStudents,
      previousStudents,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: weekStart,
            lt: nextWeekStart,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          status: PaymentStatus.PAID,
          createdAt: {
            gte: this.addDays(weekStart, -7),
            lt: weekStart,
          },
        },
        _sum: { amount: true },
      }),
      this.getTotalTutorStudents(tutorId),
      this.getTotalTutorStudents(tutorId, { lt: monthStart }),
    ]);

    const weeklyAmount = weeklyRevenue._sum.amount ?? 0;
    const previousWeeklyAmount = previousWeekRevenue._sum.amount ?? 0;

    return {
      success: true,
      data: {
        todaysLessons: {
          count: lessons.filter(
            (lesson) =>
              lesson.date >= todayStart &&
              lesson.date < this.addDays(todayStart, 1),
          ).length,
          changeFromYesterday: this.getLessonChangeFromYesterday(
            lessons,
            todayStart,
          ),
        },
        weeklyRevenue: {
          amount: weeklyAmount,
          changePercentage: this.calculateChangePercentage(
            weeklyAmount,
            previousWeeklyAmount,
          ),
        },
        activeCourses: {
          count: this.getActiveCourseCount(lessons),
        },
        totalStudents: {
          count: totalStudents,
          changeThisMonth: Math.max(0, totalStudents - previousStudents),
        },
      },
    };
  }

  async getTutorUpcomingLessons(tutorId: string) {
    const now = new Date();
    const courses = await this.getTutorCourses(tutorId);
    const lessons = courses
      .flatMap((course) => this.buildCourseLessons(course, now))
      .filter(
        (lesson) => lesson.status === 'live' || lesson.status === 'upcoming',
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);

    return {
      success: true,
      data: lessons.map((lesson) => this.mapLesson(lesson)),
    };
  }

  async getTutorWeeklyLessons(tutorId: string) {
    const now = new Date();
    const weekStart = this.startOfWeek(now);
    const courses = await this.getTutorCourses(tutorId);
    const lessons = courses.flatMap((course) =>
      this.buildCourseLessons(course, now),
    );

    return {
      success: true,
      data: this.buildWeeklyLessons(lessons, weekStart),
    };
  }

  async getTutorRevenueOverview(tutorId: string) {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const revenueRows = await this.prisma.payment.findMany({
      where: {
        tutorId,
        status: PaymentStatus.PAID,
        createdAt: {
          gte: yearStart,
          lt: nextMonthStart,
        },
      },
      select: {
        amount: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: {
        period: `${yearStart.toLocaleString('en-US', { month: 'short' })}-${now.toLocaleString('en-US', { month: 'short' })} ${now.getFullYear()}`,
        data: this.buildMonthlyRevenueOverview(revenueRows, now),
      },
    };
  }

  async getTutorRecentActivity(tutorId: string) {
    const tutor = await this.getTutorProfile(tutorId);
    const [recentNotifications, recentPayments, recentReviews] =
      await Promise.all([
        this.prisma.notification.findMany({
          where: { userId: tutorId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            createdAt: true,
            targetUrl: true,
          },
        }),
        this.prisma.payment.findMany({
          where: {
            tutorId,
            status: PaymentStatus.PAID,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            user: {
              select: {
                fullName: true,
              },
            },
            course: {
              select: {
                title: true,
              },
            },
          },
        }),
        tutor.profile?.id
          ? this.prisma.review.findMany({
              where: {
                tutorProfileId: tutor.profile.id,
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: {
                reviewer: {
                  select: {
                    fullName: true,
                  },
                },
              },
            })
          : [],
      ]);

    return {
      success: true,
      data: this.buildRecentActivity(
        recentNotifications,
        recentPayments,
        recentReviews,
      ),
    };
  }

  private async getTotalTutorStudents(
    tutorId: string,
    createdAt?: Prisma.DateTimeFilter,
  ) {
    const [groupStudents, privateStudents] = await Promise.all([
      this.prisma.courseEnrollment.findMany({
        where: {
          ...(createdAt && { createdAt }),
          course: {
            tutorId,
          },
        },
        distinct: ['studentId'],
        select: {
          studentId: true,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          tutorId,
          type: PaymentType.PRIVATE,
          status: PaymentStatus.PAID,
          ...(createdAt && { createdAt }),
        },
        distinct: ['userId'],
        select: {
          userId: true,
        },
      }),
    ]);

    return new Set([
      ...groupStudents.map((student) => student.studentId),
      ...privateStudents.map((student) => student.userId),
    ]).size;
  }

  private async getStudentOverviewData(studentId: string) {
    const now = new Date();
    const weekStart = this.startOfWeek(now);
    const nextWeekStart = this.addDays(weekStart, 7);
    const { student, courses, lessons } = await this.getStudentDashboardContext(
      studentId,
      now,
    );
    const learnedMinutes = lessons
      .filter((lesson) => lesson.isCompletedByStudent)
      .reduce((total, lesson) => total + lesson.durationMinutes, 0);
    const thisWeekLearnedMinutes = lessons
      .filter(
        (lesson) =>
          lesson.isCompletedByStudent &&
          lesson.date >= weekStart &&
          lesson.date < nextWeekStart,
      )
      .reduce((total, lesson) => total + lesson.durationMinutes, 0);

    return {
      welcome: {
        name: student.fullName,
        message: 'Ready to continue your learning journey?',
      },
      cards: {
        totalLessons: lessons.length,
        activeCourses: courses.filter(
          (course) => course.courseCompletions.length === 0,
        ).length,
        learnedHours: Math.round(learnedMinutes / 60),
      },
      meta: {
        studentId: student.id,
        image: student.profile?.avatarUrl ?? null,
        completedLessons: lessons.filter(
          (lesson) => lesson.isCompletedByStudent,
        ).length,
        learnedMinutes,
        thisWeekLearnedHours: Math.round(thisWeekLearnedMinutes / 60),
      },
    };
  }

  private async getStudentNextLessonData(studentId: string) {
    const { lessons } = await this.getStudentDashboardContext(studentId);
    const nextLesson = lessons
      .filter(
        (lesson) =>
          !lesson.isCompletedByStudent &&
          (lesson.status === 'live' || lesson.status === 'upcoming'),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

    return nextLesson ? this.mapStudentNextLesson(nextLesson) : null;
  }

  private async getStudentTodayScheduleData(studentId: string) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const tomorrowStart = this.addDays(todayStart, 1);
    const { lessons } = await this.getStudentDashboardContext(studentId, now);

    return lessons
      .filter(
        (lesson) => lesson.date >= todayStart && lesson.date < tomorrowStart,
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((lesson) => this.mapStudentScheduleLesson(lesson));
  }

  private async getStudentLearningProgressData(studentId: string) {
    const { courses } = await this.getStudentDashboardContext(studentId);

    return courses.map((course) => this.mapStudentCourseProgress(course));
  }

  private async getStudentRecentActivityData(studentId: string) {
    const { enrollments, lessons } =
      await this.getStudentDashboardContext(studentId);
    const [privatePayments, recentReviews] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          userId: studentId,
          type: PaymentType.PRIVATE,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
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
        },
      }),
      this.prisma.review.findMany({
        where: { reviewerId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          tutorProfile: {
            select: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return this.buildStudentRecentActivity(
      enrollments,
      lessons,
      privatePayments,
      recentReviews,
    );
  }

  private async getStudentDashboardContext(
    studentId: string,
    now = new Date(),
  ): Promise<StudentDashboardContext> {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        fullName: true,
        profile: {
          select: {
            avatarUrl: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            image: true,
            curriculums: true,
            curriculumItems: {
              orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
              select: {
                title: true,
                date: true,
                time: true,
              },
            },
            startDate: true,
            time: true,
            timeZone: true,
            classDuration: true,
            courseDuration: true,
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
            courseCompletions: {
              where: { studentId },
              select: { id: true },
            },
            curriculumProgress: {
              where: { studentId },
              select: { curriculumIndex: true },
            },
          },
        },
      },
    });
    const courses = enrollments.map((enrollment) => enrollment.course);
    const lessons = courses.flatMap((course) =>
      this.buildStudentCourseLessons(course, now),
    );

    return {
      student,
      enrollments,
      courses,
      lessons,
    };
  }

  private buildStudentCourseLessons(
    course: StudentCourse,
    now: Date,
  ): StudentLesson[] {
    const completedIndexes = new Set(
      course.curriculumProgress.map((item) => item.curriculumIndex),
    );

    return this.buildCourseLessons(course, now).map((lesson, index) => ({
      ...lesson,
      courseImage: course.image,
      tutor: {
        id: course.tutor.id,
        name: course.tutor.fullName,
        email: course.tutor.email,
        image: course.tutor.profile?.avatarUrl ?? null,
      },
      durationMinutes: this.getSessionDuration(course),
      curriculumIndex: index,
      isCompletedByStudent: completedIndexes.has(index),
    }));
  }

  private mapStudentNextLesson(lesson: StudentLesson) {
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      courseTitle: lesson.courseTitle,
      title: lesson.title,
      image: lesson.courseImage,
      tutor: lesson.tutor,
      date: lesson.date,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      time: lesson.time,
      timeZone: lesson.timeZone,
      duration: {
        minutes: lesson.durationMinutes,
        label: this.formatDuration(lesson.durationMinutes),
      },
      status: lesson.status,
      canJoin: lesson.status === 'live',
    };
  }

  private mapStudentScheduleLesson(lesson: StudentLesson) {
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      courseTitle: lesson.courseTitle,
      tutorName: lesson.tutor.name,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      timeZone: lesson.timeZone,
      time: lesson.date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }),
      status: lesson.isCompletedByStudent ? 'completed' : lesson.status,
    };
  }

  private mapStudentCourseProgress(course: StudentCourse) {
    const totalLessons = course.curriculums.length;
    const completedLessons = course.curriculumProgress.length;
    const percentage =
      totalLessons === 0
        ? 0
        : Math.min(100, Math.round((completedLessons / totalLessons) * 100));

    return {
      courseId: course.id,
      courseTitle: course.title,
      completedLessons,
      totalLessons,
      percentage,
      isCompleted: course.courseCompletions.length > 0,
    };
  }

  private buildStudentRecentActivity(
    enrollments: {
      id: string;
      createdAt: Date;
      course: { id: string; title: string };
    }[],
    lessons: StudentLesson[],
    privatePayments: {
      id: string;
      createdAt: Date;
      type: PaymentType;
      status: PaymentStatus;
      tutor: { fullName: string };
    }[],
    reviews: {
      id: string;
      rating: number;
      createdAt: Date;
      tutorProfile: { user: { fullName: string } };
    }[],
  ) {
    const completedLessons = lessons
      .filter((lesson) => lesson.isCompletedByStudent)
      .map((lesson) => ({
        id: lesson.id,
        type: 'COMPLETED_LESSON',
        title: 'Completed lesson',
        description: lesson.courseTitle,
        createdAt: lesson.date,
        targetUrl: `/courses/${lesson.courseId}`,
      }));
    const activity = [
      ...completedLessons,
      ...privatePayments.map((payment) => ({
        id: payment.id,
        type: 'BOOKED_LESSON',
        title: 'Booked lesson',
        description: `Private lesson with ${payment.tutor.fullName}`,
        createdAt: payment.createdAt,
        targetUrl: null,
      })),
      ...reviews.map((review) => ({
        id: review.id,
        type: 'REVIEW',
        title: 'Left a review',
        description: `${review.tutorProfile.user.fullName} - ${review.rating} stars`,
        createdAt: review.createdAt,
        targetUrl: null,
      })),
      ...enrollments.map((enrollment) => ({
        id: enrollment.id,
        type: 'JOINED_GROUP_CLASS',
        title: 'Joined group class',
        description: enrollment.course.title,
        createdAt: enrollment.createdAt,
        targetUrl: `/courses/${enrollment.course.id}`,
      })),
    ];

    return activity
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map((item) => ({
        ...item,
        timeAgo: this.formatTimeAgo(item.createdAt),
      }));
  }

  private async getTutorProfile(tutorId: string) {
    const tutor = await this.prisma.user.findUnique({
      where: { id: tutorId },
      select: {
        id: true,
        fullName: true,
        profile: {
          select: {
            id: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    return tutor;
  }

  private async getTutorCourses(tutorId: string) {
    return this.prisma.course.findMany({
      where: { tutorId },
      select: {
        id: true,
        title: true,
        curriculums: true,
        curriculumItems: {
          orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
          select: {
            title: true,
            date: true,
            time: true,
          },
        },
        startDate: true,
        time: true,
        timeZone: true,
        classDuration: true,
        courseDuration: true,
      },
    });
  }

  private buildCourseLessons(
    course: {
      id: string;
      title: string;
      curriculums: string[];
      curriculumItems?: CourseLessonItem[];
      startDate: Date;
      time: string;
      timeZone: string;
      classDuration: number;
      courseDuration: number;
    },
    now: Date,
  ): DashboardLesson[] {
    const lessonItems = this.getCourseLessonItems(course);

    return lessonItems.map((item, index) => {
      const date = new Date(item.date);
      const lessonDate = combineDateAndTime(date, item.time, course.timeZone);
      const durationMinutes = this.getSessionDuration(course);
      const endsAt = new Date(
        lessonDate.getTime() + durationMinutes * 60 * 1000,
      );

      return {
        id: `${course.id}-${index}`,
        courseId: course.id,
        courseTitle: course.title,
        title: item.title,
        date: lessonDate,
        startsAt: lessonDate,
        endsAt,
        time: item.time,
        timeZone: course.timeZone,
        status: this.getLessonStatus(lessonDate, durationMinutes, now),
      };
    });
  }

  private getCourseLessonItems(course: {
    title: string;
    curriculums: string[];
    curriculumItems?: CourseLessonItem[];
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

  private buildWeeklyLessons(lessons: DashboardLesson[], weekStart: Date) {
    return Array.from({ length: 7 }, (_, index) => {
      const dayStart = this.addDays(weekStart, index);
      const dayEnd = this.addDays(dayStart, 1);
      const dayLessons = lessons.filter(
        (lesson) => lesson.date >= dayStart && lesson.date < dayEnd,
      );

      return {
        day: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
        private: 0,
        group: dayLessons.length,
        total: dayLessons.length,
      };
    });
  }

  private buildMonthlyRevenueOverview(
    payments: { amount: number; createdAt: Date }[],
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
      if (payment.createdAt.getFullYear() === now.getFullYear()) {
        totals[payment.createdAt.getMonth()].amount += payment.amount;
      }
    }

    return totals;
  }

  private buildRecentActivity(
    notifications: {
      id: string;
      type: string;
      title: string;
      body: string | null;
      createdAt: Date;
      targetUrl: string | null;
    }[],
    payments: {
      id: string;
      amount: number;
      createdAt: Date;
      type: PaymentType;
      user: { fullName: string };
      course: { title: string } | null;
    }[],
    reviews: {
      id: string;
      rating: number;
      createdAt: Date;
      reviewer: { fullName: string };
    }[],
  ) {
    const activity = [
      ...notifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.body,
        createdAt: item.createdAt,
        targetUrl: item.targetUrl,
      })),
      ...payments.map((payment) => ({
        id: payment.id,
        type: 'BOOKED_LESSON',
        title:
          payment.type === PaymentType.PRIVATE
            ? 'Booked lesson'
            : 'Course enrollment',
        description:
          payment.type === PaymentType.PRIVATE
            ? `${payment.user.fullName} booked a private lesson`
            : `${payment.user.fullName} enrolled in ${payment.course?.title ?? 'a course'}`,
        createdAt: payment.createdAt,
        targetUrl: null,
      })),
      ...reviews.map((review) => ({
        id: review.id,
        type: 'REVIEW',
        title: 'Left a review',
        description: `${review.reviewer.fullName} left ${review.rating} stars`,
        createdAt: review.createdAt,
        targetUrl: null,
      })),
    ];

    return activity
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map((item) => ({
        ...item,
        timeAgo: this.formatTimeAgo(item.createdAt),
      }));
  }

  private mapLesson(lesson: DashboardLesson) {
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      courseTitle: lesson.courseTitle,
      title: lesson.title,
      date: lesson.date,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      time: lesson.time,
      timeZone: lesson.timeZone,
      status: lesson.status,
    };
  }

  private getActiveCourseCount(lessons: DashboardLesson[]) {
    return new Set(
      lessons
        .filter(
          (lesson) => lesson.status === 'live' || lesson.status === 'upcoming',
        )
        .map((lesson) => lesson.courseId),
    ).size;
  }

  private getLessonChangeFromYesterday(
    lessons: DashboardLesson[],
    today: Date,
  ) {
    const yesterday = this.addDays(today, -1);
    const todayCount = lessons.filter(
      (lesson) => lesson.date >= today && lesson.date < this.addDays(today, 1),
    ).length;
    const yesterdayCount = lessons.filter(
      (lesson) => lesson.date >= yesterday && lesson.date < today,
    ).length;

    return todayCount - yesterdayCount;
  }

  private calculateChangePercentage(current: number, previous: number) {
    if (previous <= 0) {
      return current > 0 ? 100 : 0;
    }

    return Math.round(((current - previous) / previous) * 100);
  }

  private getLessonStatus(
    lessonDate: Date,
    durationMinutes: number,
    now: Date,
  ): 'completed' | 'live' | 'upcoming' {
    return getTimedClassStatusByDuration(lessonDate, durationMinutes, now);
  }

  private getSessionDuration(course: {
    courseDuration?: number | null;
    classDuration: number;
  }) {
    return course.classDuration;
  }

  private parseTime(time: string) {
    const normalized = time.trim().toLowerCase();
    const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);

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

  private startOfDay(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private startOfWeek(date: Date) {
    const start = this.startOfDay(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return this.addDays(start, diff);
  }

  private addDays(date: Date, days: number) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
  }

  private formatTimeAgo(date: Date) {
    const seconds = Math.max(
      1,
      Math.floor((Date.now() - date.getTime()) / 1000),
    );
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} d ago`;
    }

    if (hours > 0) {
      return `${hours} h ago`;
    }

    if (minutes > 0) {
      return `${minutes} min ago`;
    }

    return 'just now';
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
}
