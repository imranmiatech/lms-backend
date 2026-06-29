import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgoraService } from '../agora/agora.service';
import { S3StorageService } from '../common/s3/s3.service';
import {
  combineDateAndTime,
  getTimedClassStatusByDuration,
} from '../common/time/lesson-status.util';
import {
  ClassStudentsQueryDto,
  CreateClassResourceDto,
  TutorGroupClassesQueryDto,
} from './dto/classes.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agoraService: AgoraService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  async getTutorGroupClasses(
    tutorId: string,
    query: TutorGroupClassesQueryDto,
  ) {
    const search = query.search?.trim();
    const status = query.status ?? 'all';

    const where: Prisma.CourseWhereInput = {
      tutorId,
      maxStudent: {
        gt: 1,
      },
      ...(search && {
        OR: [
          {
            title: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            category: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      }),
    };

    const courses = await this.prisma.course.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        category: true,
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
        pricePerStudent: true,
        maxStudent: true,
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    const cards = courses
      .map((course) => {
        const lessons = this.buildCourseLessonsFromCourse(course);
        const completedLessons = lessons.filter(
          (lesson) => lesson.status === 'completed',
        ).length;
        const totalLessons = lessons.length || 1;
        const progressPercentage = Math.round(
          (completedLessons / totalLessons) * 100,
        );
        const currentOrNextLesson =
          lessons.find((lesson) =>
            ['live', 'upcoming'].includes(lesson.status),
          ) ?? null;
        const courseStatus = this.getCourseCardStatus(lessons);

        return {
          courseId: course.id,
          title: course.title,
          category: course.category,
          image: course.image,
          status: courseStatus,
          statusLabel:
            courseStatus === 'completed'
              ? 'Completed'
              : courseStatus === 'live'
                ? 'Live'
                : 'Active',
          progress: {
            completedLessons,
            totalLessons,
            percentage: progressPercentage,
            label: 'Course Completion',
          },
          nextClass: currentOrNextLesson
            ? {
                id: currentOrNextLesson.id,
                title: currentOrNextLesson.title,
                date: currentOrNextLesson.date,
                startsAt: currentOrNextLesson.startsAt,
                endsAt: currentOrNextLesson.endsAt,
                dateLabel: this.formatShortDate(currentOrNextLesson.date),
                time: currentOrNextLesson.time,
                timeZone: currentOrNextLesson.timeZone,
                status: currentOrNextLesson.status,
              }
            : {
                id: null,
                title: null,
                date: null,
                startsAt: null,
                endsAt: null,
                dateLabel: 'Completed',
                time: null,
                timeZone: null,
                status: 'completed',
              },
          price: `€${course.pricePerStudent}`,
          enrolled: {
            current: course._count.enrollments,
            max: course.maxStudent,
            label: `${course._count.enrollments}/${course.maxStudent} students`,
          },
          actions: {
            manageCourse: `/classes/${course.id}/overview`,
            viewStudents: `/classes/${course.id}/enrolled-students`,
            deleteCourse: `/course/${course.id}`,
          },
        };
      })
      .filter((card) => this.matchesTutorClassStatus(card.status, status));

    return {
      success: true,
      filters: {
        search: search ?? null,
        status,
      },
      data: cards,
    };
  }

  async getStudentGroupClasses(studentId: string) {
    await this.assertStudent(studentId);

    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: {
        studentId,
        course: {
          maxStudent: {
            gt: 1,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        course: {
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
            resources: {
              orderBy: {
                createdAt: 'desc',
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
            curriculumProgress: {
              where: {
                studentId,
              },
              select: {
                curriculumIndex: true,
              },
            },
            _count: {
              select: {
                enrollments: true,
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: enrollments.map((enrollment) => {
        const course = enrollment.course;
        const totalSessions = course.curriculums.length || 1;
        const completedSessions = new Set(
          course.curriculumProgress.map((progress) => progress.curriculumIndex),
        ).size;
        const percentage =
          totalSessions === 0
            ? 0
            : Math.round((completedSessions / totalSessions) * 100);
        const sessions = this.getStudentCourseSessions(course);

        return {
          enrollmentId: enrollment.id,
          courseId: course.id,
          title: course.title,
          image: course.image,
          tutor: {
            id: course.tutor.id,
            name: course.tutor.fullName,
            avatarUrl: course.tutor.profile?.avatarUrl ?? null,
          },
          enrolledAt: enrollment.createdAt,
          studentCount: course._count.enrollments,
          durationMinutes: course.courseDuration,
          durationLabel: `${course.courseDuration} min`,
          progress: {
            completedSessions,
            totalSessions,
            percentage,
            label: `${completedSessions}/${totalSessions} Sessions Completed`,
          },
          upcomingSessions: sessions.slice(0, 3),
          resources: course.resources.map((resource) => ({
            resourceId: resource.id,
            name: resource.name,
            url: resource.url,
            size: resource.size ?? 'N/A',
            downloads: resource.downloads,
            createdAt: resource.createdAt,
          })),
        };
      }),
    };
  }

  async getMeta(tutorId: string, courseId: string) {
    await this.assertTutorCourse(tutorId, courseId);

    const [enrolledStudents, totalEarning, lessons] = await Promise.all([
      this.prisma.courseEnrollment.count({
        where: { courseId },
      }),
      this.prisma.payment.aggregate({
        where: {
          tutorId,
          courseId,
          type: PaymentType.GROUP,
          status: PaymentStatus.PAID,
        },
        _sum: {
          amount: true,
        },
      }),
      this.getCourseLessons(courseId),
    ]);

    const nextLesson = this.getNextLesson(lessons);

    return {
      success: true,
      data: {
        enrolledStudents,
        totalEarning: totalEarning._sum.amount ?? 0,
        nextLesson: nextLesson
          ? {
              id: nextLesson.id,
              title: nextLesson.title,
              date: nextLesson.date,
              startsAt: nextLesson.startsAt,
              endsAt: nextLesson.endsAt,
              time: nextLesson.time,
              timeZone: nextLesson.timeZone,
              status: nextLesson.status,
            }
          : null,
      },
    };
  }

  async getOverview(tutorId: string, courseId: string) {
    const course = await this.assertTutorCourse(tutorId, courseId);

    const [enrolledStudents, totalEarning, curriculumItems] = await Promise.all(
      [
        this.prisma.courseEnrollment.count({
          where: { courseId },
        }),
        this.prisma.payment.aggregate({
          where: {
            tutorId,
            courseId,
            type: PaymentType.GROUP,
            status: PaymentStatus.PAID,
          },
          _sum: {
            amount: true,
          },
        }),
        this.getCourseLessons(courseId),
      ],
    );

    const nextLesson = this.getNextLesson(curriculumItems);

    return {
      success: true,
      data: {
        course: {
          id: course.id,
          title: course.title,
          description: course.description,
          image: course.image,
          category: course.category,
          startDate: course.startDate,
          time: course.time,
          timeZone: course.timeZone,
        },
        stats: {
          enrolledStudents,
          totalEarning: totalEarning._sum.amount ?? 0,
          nextLesson: nextLesson
            ? {
                id: nextLesson.id,
                title: nextLesson.title,
                date: nextLesson.date,
                startsAt: nextLesson.startsAt,
                endsAt: nextLesson.endsAt,
                time: nextLesson.time,
                timeZone: nextLesson.timeZone,
                status: nextLesson.status,
              }
            : null,
        },
      },
    };
  }

  async getStudents(
    tutorId: string,
    courseId: string,
    query: ClassStudentsQueryDto,
  ) {
    await this.assertTutorCourse(tutorId, courseId);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 10), 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.CourseEnrollmentWhereInput = {
      courseId,
      ...(search && {
        student: {
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
        },
      }),
    };

    const [total, enrollments] = await Promise.all([
      this.prisma.courseEnrollment.count({ where }),
      this.prisma.courseEnrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              email: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
              curriculumProgress: {
                where: {
                  courseId,
                },
                select: {
                  id: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + enrollments.length, total);

    return {
      success: true,
      data: enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        studentName: enrollment.student.fullName,
        studentEmail: enrollment.student.email,
        studentImage: enrollment.student.profile?.avatarUrl ?? null,
        enrolled: enrollment.createdAt,
        lessonCompleted: enrollment.student.curriculumProgress.length,
      })),
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
      },
    };
  }

  async getEnrolledStudents(tutorId: string, courseId: string) {
    await this.assertTutorCourse(tutorId, courseId);

    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: { courseId },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        student: {
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
    });

    return {
      success: true,
      data: enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        studentImage: enrollment.student.profile?.avatarUrl ?? null,
        studentName: enrollment.student.fullName,
        studentEmail: enrollment.student.email,
        enrolledAt: enrollment.createdAt,
        enrolledDate: this.formatDate(enrollment.createdAt),
        enrolledTime: this.formatTime(enrollment.createdAt),
      })),
    };
  }

  async deleteEnrolledStudent(
    tutorId: string,
    courseId: string,
    studentId: string,
  ) {
    await this.assertTutorCourse(tutorId, courseId);

    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: {
        courseId_studentId: {
          courseId,
          studentId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        'Student enrollment not found for this class',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const deletedProgress = await tx.curriculumProgress.deleteMany({
        where: {
          courseId,
          studentId,
        },
      });

      const deletedCompletion = await tx.courseCompletion.deleteMany({
        where: {
          courseId,
          studentId,
        },
      });

      await tx.courseEnrollment.delete({
        where: {
          courseId_studentId: {
            courseId,
            studentId,
          },
        },
      });

      return {
        deletedProgress: deletedProgress.count,
        deletedCompletion: deletedCompletion.count,
      };
    });

    return {
      success: true,
      message: 'Student removed from this class successfully',
      data: {
        courseId,
        studentId,
        deletedEnrollment: 1,
        ...result,
      },
    };
  }

  async getLessons(tutorId: string, courseId: string) {
    await this.assertTutorCourse(tutorId, courseId);

    const lessons = await this.getCourseLessons(courseId);
    const enrolledStudents = await this.prisma.courseEnrollment.count({
      where: { courseId },
    });

    return {
      success: true,
      data: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        date: lesson.date,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        time: lesson.time,
        timeZone: lesson.timeZone,
        status: lesson.status,
        attendant:
          lesson.status === 'completed'
            ? `${enrolledStudents} attendant`
            : null,
        joinAvailable: lesson.status === 'live',
      })),
    };
  }

  async getLessonJoinPreview(
    tutorId: string,
    courseId: string,
    curriculumIndex: number,
  ) {
    await this.assertTutorCourse(tutorId, courseId);
    const lesson = await this.getCourseLesson(courseId, curriculumIndex);

    if (lesson.status !== 'live') {
      throw new BadRequestException('This lesson is not live yet');
    }

    const enrolledStudents = await this.prisma.courseEnrollment.count({
      where: { courseId },
    });

    return {
      success: true,
      data: {
        lesson: {
          id: lesson.id,
          courseId,
          curriculumIndex,
          title: lesson.title,
          date: lesson.date,
          startsAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          time: lesson.time,
          timeZone: lesson.timeZone,
          durationMinutes: lesson.durationMinutes,
          status: lesson.status,
          enrolledStudents,
        },
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
            courseId,
            curriculumIndex,
          ),
        },
      },
    };
  }

  async joinLesson(tutorId: string, courseId: string, curriculumIndex: number) {
    await this.assertTutorCourse(tutorId, courseId);
    const lesson = await this.getCourseLesson(courseId, curriculumIndex);

    if (lesson.status !== 'live') {
      throw new BadRequestException('This lesson is not live yet');
    }

    const channelName = this.agoraService.buildChannelName(
      courseId,
      curriculumIndex,
    );

    return {
      success: true,
      data: {
        lesson: {
          id: lesson.id,
          courseId,
          curriculumIndex,
          title: lesson.title,
          date: lesson.date,
          startsAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          time: lesson.time,
          timeZone: lesson.timeZone,
          durationMinutes: lesson.durationMinutes,
          status: lesson.status,
        },
        agora: this.agoraService.buildRtcToken({
          channelName,
          account: tutorId,
          role: 'publisher',
        }),
        screenShare: this.agoraService.buildRtcJoinCredentials({
          channelName,
          account: tutorId,
          role: 'publisher',
        }).screenShare,
      },
    };
  }

  async getResources(tutorId: string, courseId: string) {
    await this.assertTutorCourse(tutorId, courseId);

    const resources = await this.prisma.resource.findMany({
      where: {
        tutorId,
        courseId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      data: resources.map((resource) => ({
        resourceId: resource.id,
        name: resource.name,
        url: resource.url,
        size: resource.size ?? 'N/A',
        downloads: resource.downloads,
        createdAt: resource.createdAt,
      })),
    };
  }

  async addResource(
    tutorId: string,
    courseId: string,
    dto: CreateClassResourceDto,
    file?: any,
  ) {
    await this.assertTutorCourse(tutorId, courseId);

    if (!file) {
      throw new BadRequestException(
        'Resource file is required. Send multipart/form-data with field name "file".',
      );
    }

    const upload = await this.uploadClassResourceFile(file);

    const resource = await this.prisma.resource.create({
      data: {
        tutorId,
        courseId,
        name: dto.name,
        url: upload.url,
        size: this.formatBytes(upload.bytes),
      },
    });

    return {
      success: true,
      message: 'Resource added successfully',
      data: {
        resourceId: resource.id,
        name: resource.name,
        url: resource.url,
        size: resource.size ?? 'N/A',
        ...(upload && { upload }),
        downloads: resource.downloads,
        createdAt: resource.createdAt,
      },
    };
  }

  private uploadClassResourceFile(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/class-resources',
      resourceType: 'auto',
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
      maxBytes: 20 * 1024 * 1024,
    });
  }

  async deleteResource(tutorId: string, courseId: string, resourceId: string) {
    await this.assertTutorCourse(tutorId, courseId);

    const resource = await this.prisma.resource.findFirst({
      where: {
        id: resourceId,
        tutorId,
        courseId,
      },
      select: {
        id: true,
      },
    });

    if (!resource) {
      throw new NotFoundException('Resource not found for this class');
    }

    await this.prisma.resource.delete({
      where: { id: resource.id },
    });

    return {
      success: true,
      message: 'Resource deleted successfully',
    };
  }

  private async assertTutorCourse(tutorId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        tutorId: true,
        title: true,
        category: true,
        description: true,
        image: true,
        curriculums: true,
        startDate: true,
        time: true,
        timeZone: true,
        classDuration: true,
        courseDuration: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot access this class');
    }

    return course;
  }

  private async assertStudent(studentId: string) {
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
      throw new ForbiddenException('Only students can access group classes');
    }
  }

  private getStudentCourseSessions(course: {
    id: string;
    title: string;
    curriculums: string[];
    curriculumItems?: {
      title: string;
      date: Date;
      time: string;
    }[];
    startDate: Date;
    time: string;
    classDuration: number;
    courseDuration: number;
    timeZone: string;
  }) {
    const lessonItems = this.getCourseLessonItems(course);

    return lessonItems.map((item, curriculumIndex) => {
      const date = new Date(item.date);
      const startsAt = combineDateAndTime(date, item.time, course.timeZone);
      const durationMinutes = this.getSessionDuration(course);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      const status = this.getLessonStatus(startsAt, durationMinutes);

      return {
        id: `${course.id}:${curriculumIndex}`,
        curriculumIndex,
        title: item.title || `Session ${curriculumIndex + 1}`,
        date,
        startsAt,
        endsAt,
        time: item.time,
        timeZone: course.timeZone,
        dateLabel: this.formatDate(date),
        timeLabel: this.formatTime(startsAt),
        durationMinutes,
        status,
        joinAvailable: status === 'live',
      };
    });
  }

  private buildCourseLessonsFromCourse(course: {
    id: string;
    title: string;
    curriculums: string[];
    curriculumItems?: {
      title: string;
      date: Date;
      time: string;
    }[];
    startDate: Date;
    time: string;
    classDuration: number;
    courseDuration: number;
    timeZone: string;
  }) {
    const lessonItems = this.getCourseLessonItems(course);

    return lessonItems.map((item, index) => {
      const date = new Date(item.date);
      const startsAt = combineDateAndTime(date, item.time, course.timeZone);
      const durationMinutes = this.getSessionDuration(course);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

      return {
        id: `${course.id}-${index}`,
        title: item.title || `Session ${index + 1}`,
        date,
        startsAt,
        endsAt,
        time: item.time,
        timeZone: course.timeZone,
        durationMinutes,
        status: this.getLessonStatus(startsAt, durationMinutes),
      };
    });
  }

  private getCourseCardStatus(
    lessons: {
      status: string;
    }[],
  ) {
    if (lessons.some((lesson) => lesson.status === 'live')) {
      return 'live';
    }

    if (lessons.some((lesson) => lesson.status === 'upcoming')) {
      return 'upcoming';
    }

    return 'completed';
  }

  private matchesTutorClassStatus(
    courseStatus: string,
    filter: NonNullable<TutorGroupClassesQueryDto['status']>,
  ) {
    if (filter === 'all') {
      return true;
    }

    if (filter === 'active') {
      return courseStatus === 'live' || courseStatus === 'upcoming';
    }

    return courseStatus === filter;
  }

  private async getCourseLessons(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
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

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return this.getCourseLessonItems(course).map((item, index) => {
      const date = new Date(item.date);
      const startsAt = combineDateAndTime(date, item.time, course.timeZone);
      const durationMinutes = this.getSessionDuration(course);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

      return {
        id: `${courseId}-${index}`,
        title: item.title,
        date,
        startsAt,
        endsAt,
        time: item.time,
        timeZone: course.timeZone,
        durationMinutes,
        status: this.getLessonStatus(startsAt, durationMinutes),
      };
    });
  }

  private async getCourseLesson(courseId: string, curriculumIndex: number) {
    const lessons = await this.getCourseLessons(courseId);
    const lesson = lessons[curriculumIndex];

    if (!lesson) {
      throw new NotFoundException('Lesson not found for this class');
    }

    return lesson;
  }

  private getNextLesson(
    lessons: {
      id: string;
      title: string;
      date: Date;
      startsAt: Date;
      endsAt: Date;
      time: string;
      timeZone: string;
      status: string;
    }[],
  ) {
    return (
      lessons.find(
        (lesson) => lesson.status === 'live' || lesson.status === 'upcoming',
      ) ?? null
    );
  }

  private getLessonStatus(lessonDate: Date, durationMinutes: number) {
    return getTimedClassStatusByDuration(lessonDate, durationMinutes);
  }

  private getSessionDuration(course: {
    courseDuration?: number | null;
    classDuration: number;
  }) {
    return course.classDuration;
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

  private formatDate(date: Date) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatShortDate(date: Date) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  private formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private formatTime(date: Date) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}
