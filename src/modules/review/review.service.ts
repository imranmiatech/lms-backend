import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  private async updateProfileReviewStats(tutorProfileId: string) {
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

  async create(userId: string, createReviewDto: CreateReviewDto) {
    const { rating, comment, tutorProfileId } = createReviewDto;

    const reviewer = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!reviewer) throw new NotFoundException('User not found');
    if (reviewer.role !== Role.STUDENT)
      throw new ForbiddenException('Only students can submit reviews');

    const tutorProfile = await this.prisma.userProfile.findUnique({
      where: { id: tutorProfileId },
      include: { user: true },
    });
    if (!tutorProfile) throw new NotFoundException('Tutor profile not found');
    if (tutorProfile.user.role !== Role.TUTOR)
      throw new BadRequestException('Invalid tutor profile');
    if (tutorProfile.userId === userId)
      throw new BadRequestException('You cannot review your own profile');

    const existingReview = await this.prisma.review.findUnique({
      where: {
        reviewerId_tutorProfileId: {
          reviewerId: userId,
          tutorProfileId,
        },
      },
    });

    if (existingReview)
      throw new BadRequestException('You have already reviewed this tutor');

    const review = await this.prisma.review.create({
      data: { rating, comment, reviewerId: userId, tutorProfileId },
      include: { reviewer: { select: { id: true, fullName: true } } },
    });

    await this.updateProfileReviewStats(tutorProfileId);

    return {
      success: true,
      message: 'Review submitted successfully',
      data: review,
    };
  }

  async findAll(tutorProfileId?: string) {
    const where = tutorProfileId ? { tutorProfileId } : undefined;
    const rows = await this.prisma.review.findMany({
      where,
      include: {
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
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((review) => ({
      id: review.id,
      studentId: review.reviewerId,
      reviewerId: review.reviewerId,
      tutorProfileId: review.tutorProfileId,
      tutorId: review.tutorProfile.userId,
      rating: review.rating,
      description: review.comment,
      comment: review.comment,
      reviewer: {
        id: review.reviewer.id,
        name: review.reviewer.fullName,
        image: review.reviewer.profile?.avatarUrl ?? null,
        completedLessons: 0,
      },
      student: {
        id: review.reviewer.id,
        name: review.reviewer.fullName,
        image: review.reviewer.profile?.avatarUrl ?? null,
      },
      tutor: {
        id: review.tutorProfile.user.id,
        profileId: review.tutorProfile.id,
        name: review.tutorProfile.user.fullName,
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }));
  }

  async findTutorReviewList(
    tutorProfileId: string,
    page: number = 1,
    limit: number = 5,
  ) {
    return this.getTutorReviews(tutorProfileId, page, limit);
  }

  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        reviewer: { select: { id: true, fullName: true } },
        tutorProfile: true,
      },
    });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  async update(id: string, updateReviewDto: UpdateReviewDto) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Review not found');

    const updated = await this.prisma.review.update({
      where: { id },
      data: updateReviewDto,
    });

    await this.updateProfileReviewStats(existing.tutorProfileId);

    return { success: true, message: 'Review updated', data: updated };
  }

  async remove(id: string) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Review not found');

    await this.prisma.review.delete({ where: { id } });

    await this.updateProfileReviewStats(existing.tutorProfileId);

    return { success: true, message: 'Review removed' };
  }

  async getTutorReviews(
    tutorProfileId: string,
    page: number = 1,
    limit: number = 5,
  ) {
    const currentPage = Math.max(1, page);
    const pageSize = Math.max(1, limit);
    const where: Prisma.ReviewWhereInput = { tutorProfileId };

    const tutorProfile = await this.prisma.userProfile.findUnique({
      where: { id: tutorProfileId },
      select: { id: true },
    });

    if (!tutorProfile) {
      throw new NotFoundException('Tutor profile not found');
    }

    const [
      totalReviews,
      ratingStats,
      fiveStarCount,
      fourStarCount,
      threeStarCount,
      twoStarCount,
      oneStarCount,
      reviews,
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
        orderBy: {
          createdAt: 'desc',
        },
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
        include: {
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
        },
      }),
    ]);

    const averageRating = Number((ratingStats._avg.rating ?? 0).toFixed(1));

    const ratingCounts = {
      5: fiveStarCount,
      4: fourStarCount,
      3: threeStarCount,
      2: twoStarCount,
      1: oneStarCount,
    };

    const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => {
      const count = ratingCounts[star as keyof typeof ratingCounts];
      const percentage =
        totalReviews > 0
          ? Number(((count / totalReviews) * 100).toFixed(2))
          : 0;

      return { star, count, percentage };
    });

    const totalPages = Math.ceil(totalReviews / pageSize);

    return {
      totalReviews,
      averageRating,
      ratingBreakdown,
      reviews: reviews.map((review) => ({
        id: review.id,
        studentId: review.reviewerId,
        reviewerId: review.reviewerId,
        tutorProfileId: review.tutorProfileId,
        tutorId: review.tutorProfile.userId,
        studentName: review.reviewer.fullName || 'Anonymous',
        studentAvatar: review.reviewer.profile?.avatarUrl ?? null,
        rating: review.rating,
        comment: review.comment,
        reviewDate: review.createdAt,
      })),
      pagination: {
        currentPage,
        totalPages,
        hasNextPage: currentPage < totalPages,
      },
    };
  }
}
