import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  DayOfWeek,
  PaymentStatus,
  PaymentType,
  Role,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  combineDateAndTime,
  parseClockTime,
} from '../common/time/lesson-status.util';
import { S3StorageService } from '../common/s3/s3.service';
import {
  AvailabilityDto,
  CreateProfileDto,
  UpdateProfileDto,
} from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  async createProfile(
    userId: string,
    dto: CreateProfileDto,
    files?: { avatarFile?: any; videoFile?: any },
  ) {
    const {
      fullName,
      country,
      city,
      avatarUrl,
      bio,
      yearOfExperience,
      pricePerHour,
      languageExpertise,
      aboutMe,
      teachingCategory,
      teachingSkills,
      sessionDuration,
      videoUrl,
      education,
      availability,
    } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const availabilityData = this.mapAvailability(availability);
    const uploadedFiles = await this.uploadProfileFiles(files, {
      avatarUrl,
      videoUrl,
    });
    const finalAvatarUrl = uploadedFiles.avatarUrl ?? avatarUrl;
    const finalVideoUrl = uploadedFiles.videoUrl ?? videoUrl;

    const profile = await this.prisma.$transaction(async (tx) => {
      const existingProfile = await tx.userProfile.findUnique({
        where: { userId },
      });

      if (fullName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { fullName },
        });
      }

      if (existingProfile) {
        await tx.education.deleteMany({
          where: { profileId: existingProfile.id },
        });
        await tx.availability.deleteMany({
          where: { profileId: existingProfile.id },
        });

        if (education && education.length > 0) {
          await tx.education.createMany({
            data: education.map((e) => ({
              profileId: existingProfile.id,
              institution: e.institution,
              country: e.country,
              city: e.city,
              degree: e.degree,
              passingYear: e.passingYear,
            })),
          });
        }

        if (availabilityData.length > 0) {
          await tx.availability.createMany({
            data: availabilityData.map((a) => ({
              profileId: existingProfile.id,
              ...a,
            })),
          });
        }

        return tx.userProfile.update({
          where: { userId },
          data: {
            country,
            city,
            avatarUrl: finalAvatarUrl,
            bio,
            yearOfExperience,
            pricePerHour,
            languageExpertise,
            aboutMe,
            teachingCategory,
            teachingSkills,
            sessionDuration,
            videoUrl: finalVideoUrl,
          },
          include: this.profileInclude(),
        });
      }

      return tx.userProfile.create({
        data: {
          userId,
          country,
          city,
          avatarUrl: finalAvatarUrl,
          bio,
          yearOfExperience,
          pricePerHour,
          languageExpertise,
          aboutMe,
          teachingCategory,
          teachingSkills,
          sessionDuration,
          videoUrl: finalVideoUrl,
          education:
            education && education.length > 0
              ? {
                  create: education.map((e) => ({
                    institution: e.institution,
                    country: e.country,
                    city: e.city,
                    degree: e.degree,
                    passingYear: e.passingYear,
                  })),
                }
              : undefined,
          availability:
            availabilityData.length > 0
              ? {
                  create: availabilityData,
                }
              : undefined,
        },
        include: this.profileInclude(),
      });
    });

    return {
      success: true,
      message: 'Profile created successfully',
      data: profile,
    };
  }

  async getProfile(userId: string, availabilityDate?: string) {
    const [profile, completedCourses] = await Promise.all([
      this.prisma.userProfile.findUnique({
        where: { userId },
        include: this.profileInclude(),
      }),
      this.prisma.courseCompletion.findMany({
        where: {
          course: {
            tutorId: userId,
          },
        },
        distinct: ['courseId'],
        select: {
          courseId: true,
        },
      }),
    ]);

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const privateBookingAvailability =
      profile.user.role === Role.TUTOR
        ? await this.getPrivateBookingAvailability(profile, availabilityDate)
        : undefined;

    return {
      ...profile,
      completedCoursesCount: completedCourses.length,
      ...(privateBookingAvailability && { privateBookingAvailability }),
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    files?: { avatarFile?: any; videoFile?: any },
  ) {
    const {
      fullName,
      country,
      city,
      avatarUrl,
      bio,
      yearOfExperience,
      pricePerHour,
      languageExpertise,
      aboutMe,
      teachingCategory,
      teachingSkills,
      sessionDuration,
      videoUrl,
      education,
      availability,
    } = dto;

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    if (fullName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fullName },
      });
    }

    if (education !== undefined) {
      await this.prisma.education.deleteMany({
        where: { profileId: profile.id },
      });
      if (education && education.length > 0) {
        await this.prisma.education.createMany({
          data: education.map((e) => ({
            profileId: profile.id,
            institution: e.institution,
            country: e.country,
            city: e.city,
            degree: e.degree,
            passingYear: e.passingYear,
          })),
        });
      }
    }

    if (availability !== undefined) {
      const availabilityData = this.mapAvailability(availability);

      await this.prisma.availability.deleteMany({
        where: { profileId: profile.id },
      });
      if (availabilityData.length > 0) {
        await this.prisma.availability.createMany({
          data: availabilityData.map((a) => ({
            profileId: profile.id,
            ...a,
          })),
        });
      }
    }

    const uploadedFiles = await this.uploadProfileFiles(files, {
      avatarUrl,
      videoUrl,
    });

    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        country,
        city,
        avatarUrl: uploadedFiles.avatarUrl ?? avatarUrl,
        bio,
        yearOfExperience,
        pricePerHour,
        languageExpertise,
        aboutMe,
        teachingCategory,
        teachingSkills,
        sessionDuration,
        videoUrl: uploadedFiles.videoUrl ?? videoUrl,
      },
      include: this.profileInclude(),
    });
  }

  private async uploadProfileFiles(
    files?: { avatarFile?: any; videoFile?: any },
    urls?: { avatarUrl?: string; videoUrl?: string },
  ) {
    const [avatarUpload, videoUpload] = await Promise.all([
      files?.avatarFile
        ? this.uploadProfileAvatarFile(files.avatarFile)
        : urls?.avatarUrl?.startsWith('data:')
          ? this.uploadProfileAvatarFile(
              this.dataUrlToFile(urls.avatarUrl, 'profile-avatar'),
            )
          : Promise.resolve(null),
      files?.videoFile
        ? this.uploadProfileVideoFile(files.videoFile)
        : urls?.videoUrl?.startsWith('data:')
          ? this.uploadProfileVideoFile(
              this.dataUrlToFile(urls.videoUrl, 'profile-video'),
            )
          : Promise.resolve(null),
    ]);

    return {
      avatarUrl: avatarUpload?.url,
      videoUrl: videoUpload?.url,
    };
  }

  private uploadProfileAvatarFile(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/profiles',
      resourceType: 'image',
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
      ],
      maxBytes: 5 * 1024 * 1024,
    });
  }

  private uploadProfileVideoFile(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/profile-videos',
      resourceType: 'video',
      allowedMimeTypes: [
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'video/x-msvideo',
      ],
      maxBytes: 50 * 1024 * 1024,
    });
  }

  private dataUrlToFile(dataUrl: string, fallbackName: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);

    if (!match) {
      throw new BadRequestException('Invalid profile media data URL');
    }

    const [, mimetype, base64] = match;
    const buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Invalid profile media data');
    }

    return {
      buffer,
      mimetype,
      size: buffer.length,
      originalname: `${fallbackName}.${this.getMediaExtension(mimetype)}`,
    };
  }

  private getMediaExtension(mimetype: string) {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
    };

    return extensions[mimetype] ?? 'bin';
  }

  async updateApplicationStatus(profileId: string, status: ApplicationStatus) {
    const profile = await this.prisma.userProfile.findUnique({
      where: {
        id: profileId,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return this.prisma.userProfile.update({
      where: {
        id: profileId,
      },
      data: {
        applicationStatus: status,
      },
    });
  }
  async getTutorAvailability(tutorId: string, courseId?: string) {
    // Support passing either a userId (users.id) or a profile id
    let profile = await this.prisma.userProfile.findUnique({
      where: { userId: tutorId },
    });

    if (!profile) {
      profile = await this.prisma.userProfile.findUnique({
        where: { id: tutorId },
      });
    }

    if (!profile) {
      throw new NotFoundException('Tutor profile not found');
    }

    const availabilities = await this.prisma.availability.findMany({
      where: {
        profileId: profile.id,
      },
      orderBy: {
        dayOfWeek: 'asc',
      },
    });

    if (courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { timeZone: true },
      });

      if (course && course.timeZone) {
        return availabilities.map((a) => ({
          ...a,
          timezone: (a as any).timezone ?? course.timeZone,
        }));
      }
    }

    return availabilities;
  }

  private async getPrivateBookingAvailability(
    profile: {
      userId: string;
      availability: {
        id: string;
        dayOfWeek: DayOfWeek;
        startTime: string;
        endTime: string;
        timezone: string | null;
      }[];
    },
    date?: string,
  ) {
    const now = new Date();
    const bookings = await this.prisma.payment.findMany({
      where: {
        tutorId: profile.userId,
        type: PaymentType.PRIVATE,
        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.PAID],
        },
        privateLessonStartsAt: {
          gte: now,
        },
      },
      orderBy: {
        privateLessonStartsAt: 'asc',
      },
      select: {
        id: true,
        userId: true,
        status: true,
        privateLessonStartsAt: true,
        privateLessonDuration: true,
      },
    });

    const bookedSlots = bookings
      .filter((booking) => booking.privateLessonStartsAt)
      .map((booking) => {
        const startsAt = booking.privateLessonStartsAt!;
        const durationMinutes = booking.privateLessonDuration ?? 60;

        return {
          paymentId: booking.id,
          studentId: booking.userId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60 * 1000),
          durationMinutes,
          paymentStatus: booking.status,
          status: 'booked',
        };
      });

    return {
      date: date ?? null,
      bookedSlots,
      ...(date && {
        availabilityForDate: this.buildAvailabilityForDate(
          date,
          profile.availability,
          bookedSlots,
        ),
      }),
    };
  }

  private buildAvailabilityForDate(
    date: string,
    availability: {
      id: string;
      dayOfWeek: DayOfWeek;
      startTime: string;
      endTime: string;
      timezone: string | null;
    }[],
    bookedSlots: {
      paymentId: string;
      studentId: string;
      startsAt: Date;
      endsAt: Date;
      durationMinutes: number;
      paymentStatus: PaymentStatus;
      status: string;
    }[],
  ) {
    const dayOfWeek = this.getDayOfWeekFromDateString(date);
    const dayAvailability = availability.filter(
      (item) => item.dayOfWeek === dayOfWeek,
    );

    const windows = dayAvailability.map((item) => {
      const startsAt = combineDateAndTime(
        new Date(`${date}T00:00:00.000Z`),
        item.startTime,
        item.timezone,
      );
      const endsAt = combineDateAndTime(
        new Date(`${date}T00:00:00.000Z`),
        item.endTime,
        item.timezone,
      );
      const windowBookedSlots = bookedSlots.filter(
        (slot) => slot.startsAt < endsAt && slot.endsAt > startsAt,
      );
      const freeSlots = this.getFreeSlots(startsAt, endsAt, windowBookedSlots);

      return {
        availabilityId: item.id,
        dayOfWeek: item.dayOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        timezone: item.timezone,
        startsAt,
        endsAt,
        status: freeSlots.length ? 'available' : 'booked',
        bookedSlots: windowBookedSlots,
        freeSlots,
      };
    });

    return {
      status: !windows.length
        ? 'unavailable'
        : windows.some((window) => window.freeSlots.length)
          ? 'available'
          : 'booked',
      windows,
    };
  }

  private getFreeSlots(
    startsAt: Date,
    endsAt: Date,
    bookedSlots: { startsAt: Date; endsAt: Date }[],
  ) {
    const sortedBookings = [...bookedSlots].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    const freeSlots: { startsAt: Date; endsAt: Date; status: string }[] = [];
    let cursor = startsAt;

    for (const booking of sortedBookings) {
      if (booking.startsAt > cursor) {
        freeSlots.push({
          startsAt: cursor,
          endsAt: booking.startsAt,
          status: 'free',
        });
      }

      if (booking.endsAt > cursor) {
        cursor = booking.endsAt;
      }
    }

    if (cursor < endsAt) {
      freeSlots.push({
        startsAt: cursor,
        endsAt,
        status: 'free',
      });
    }

    return freeSlots;
  }

  private getDayOfWeekFromDateString(date: string) {
    const parsedDate = new Date(`${date}T00:00:00.000Z`);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD value');
    }

    const days: DayOfWeek[] = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ];

    return days[parsedDate.getUTCDay()];
  }

  private mapAvailability(availability?: AvailabilityDto[]) {
    if (!availability) {
      return [];
    }

    return availability.map((a) => {
      if (!a.dayOfWeek || !a.startTime || !a.endTime) {
        throw new BadRequestException(
          'Availability requires dayOfWeek, startTime, and endTime',
        );
      }

      return {
        dayOfWeek: a.dayOfWeek as DayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
        timezone: a.timezone,
      };
    });
  }

  private profileInclude() {
    return {
      education: true,
      availability: true,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
        },
      },
    } as const;
  }
}
