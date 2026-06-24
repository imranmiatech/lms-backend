import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, DayOfWeek } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
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
    const uploadedFiles = await this.uploadProfileFiles(files);
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

  async getProfile(userId: string) {
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

    return {
      ...profile,
      completedCoursesCount: completedCourses.length,
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

    const uploadedFiles = await this.uploadProfileFiles(files);

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

  private async uploadProfileFiles(files?: { avatarFile?: any; videoFile?: any }) {
    const [avatarUpload, videoUpload] = await Promise.all([
      files?.avatarFile
        ? this.s3StorageService.uploadFile(files.avatarFile, {
            folder: 'daanklerk/profiles',
            resourceType: 'image',
            allowedMimeTypes: [
              'image/jpeg',
              'image/png',
              'image/webp',
              'image/gif',
            ],
            maxBytes: 5 * 1024 * 1024,
          })
        : Promise.resolve(null),
      files?.videoFile
        ? this.s3StorageService.uploadFile(files.videoFile, {
            folder: 'daanklerk/profile-videos',
            resourceType: 'video',
            allowedMimeTypes: [
              'video/mp4',
              'video/webm',
              'video/quicktime',
              'video/x-msvideo',
            ],
            maxBytes: 50 * 1024 * 1024,
          })
        : Promise.resolve(null),
    ]);

    return {
      avatarUrl: avatarUpload?.url,
      videoUrl: videoUpload?.url,
    };
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
