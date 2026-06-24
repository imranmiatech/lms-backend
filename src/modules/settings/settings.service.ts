import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
    ChangePasswordDto,
    CreatePaymentDto,
    UpdateNotificationPreferencesDto,
    UpdateSettingsDto,
    UpsertLegalContentDto,
    UpsertPlatformSettingsDto,
} from './dto/settings.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from "bcrypt";

const LEGAL_CONTENT_ID = 'platform_legal_content';
const PLATFORM_SETTINGS_ID = 'platform_settings';

@Injectable()
export class SettingsService {
    constructor(private prisma: PrismaService) { }

    async createOrUpdatePaymentInfo(
        userId: string,
        dto: CreatePaymentDto,
    ) {
        // Check if payment info exists for this user
        let paymentInfo = await this.prisma.paymentInformation.findUnique({
            where: {
                userId,
            },
        });

        if (paymentInfo) {
            // If it exists, update it
            paymentInfo = await this.prisma.paymentInformation.update({
                where: {
                    userId,
                },
                data: {
                    paymentMethod: dto.paymentMethod,
                    legalName: dto.legalName,
                    bankName: dto.bankName,
                    bankAccountName: dto.bankAccountName,
                    bankAccountNumber: dto.bankAccountNumber,
                    routingNumber: dto.routingNumber,
                },
            });

            return {
                success: true,
                message: 'Payment information updated successfully',
                data: paymentInfo,
            };
        } else {
            // If it doesn't exist, create new
            const result = await this.prisma.paymentInformation.create({
                data: {
                    userId,
                    paymentMethod: dto.paymentMethod,
                    legalName: dto.legalName,
                    bankName: dto.bankName,
                    bankAccountName: dto.bankAccountName,
                    bankAccountNumber: dto.bankAccountNumber,
                    routingNumber: dto.routingNumber,
                },
            });

            return {
                success: true,
                message: 'Payment information created successfully',
                data: result,
            };
        }
    }

    async getPaymentInfo(userId: string) {
        const paymentInfo = await this.prisma.paymentInformation.findUnique({
            where: {
                userId,
            },
        });

        if (!paymentInfo) {
            throw new NotFoundException('Payment information not found');
        }

        return {
            success: true,
            data: paymentInfo,
        };
    }

    async updatePaymentInfo(userId: string, dto: UpdateSettingsDto) {
        const paymentInfo = await this.prisma.paymentInformation.findUnique({
            where: {
                userId,
            },
        });

        if (!paymentInfo) {
            throw new NotFoundException('Payment information not found');
        }

        const updated = await this.prisma.paymentInformation.update({
            where: {
                userId,
            },
            data: {
                ...dto,
            },
        });

        return {
            success: true,
            message: 'Payment information updated successfully',
            data: updated,
        };
    }

    ///////---------CHANGE PASSWORD----------//////
    async changePassword(
        userId: string,
        dto: ChangePasswordDto,
    ) {
        const user =
            await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });

        if (!user) {
            throw new NotFoundException(
                'User not found',
            );
        }

        const isMatch =
            await bcrypt.compare(
                dto.currentPassword,
                user.password,
            );

        if (!isMatch) {
            throw new BadRequestException(
                'Current password is incorrect',
            );
        }

        if (
            dto.currentPassword ===
            dto.newPassword
        ) {
            throw new BadRequestException(
                'New password must be different from current password',
            );
        }

        const hashedPassword =
            await bcrypt.hash(
                dto.newPassword,
                10,
            );

        await this.prisma.user.update({
            where: {
                id: userId,
            },
            data: {
                password: hashedPassword,
            },
        });

        return {
            success: true,
            message:
                'Password changed successfully',
        };
    }

    async getNotificationPreferences(userId: string) {
        const preferences = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                notifyCourseUpdates: true,
                notifyNewContent: true,
                notifyLessonReminders: true,
                notifyNewMessages: true,
                notifyWeeklyDigest: true,
            },
        });

        if (!preferences) {
            throw new NotFoundException('User not found');
        }

        return {
            success: true,
            data: preferences,
        };
    }

    async updateNotificationPreferences(
        userId: string,
        dto: UpdateNotificationPreferencesDto,
    ) {
        const preferences = await this.prisma.user.update({
            where: {
                id: userId,
            },
            data: dto,
            select: {
                notifyCourseUpdates: true,
                notifyNewContent: true,
                notifyLessonReminders: true,
                notifyNewMessages: true,
                notifyWeeklyDigest: true,
            },
        });

        return {
            success: true,
            message: 'Notification preferences updated successfully',
            data: preferences,
        };
    }

    async upsertLegalContent(dto: UpsertLegalContentDto) {
        const content = await this.prisma.platformLegalContent.upsert({
            where: {
                id: LEGAL_CONTENT_ID,
            },
            update: {
                ...(dto.privacyPolicy !== undefined && {
                    privacyPolicy: dto.privacyPolicy,
                }),
                ...(dto.termsAndConditions !== undefined && {
                    termsAndConditions: dto.termsAndConditions,
                }),
            },
            create: {
                id: LEGAL_CONTENT_ID,
                privacyPolicy: dto.privacyPolicy,
                termsAndConditions: dto.termsAndConditions,
            },
        });

        return {
            success: true,
            message: 'Legal content saved successfully',
            data: content,
        };
    }

    async upsertPlatformSettings(dto: UpsertPlatformSettingsDto) {
        const settings = await this.prisma.platformSetting.upsert({
            where: {
                id: PLATFORM_SETTINGS_ID,
            },
            update: {
                ...(dto.platformName !== undefined && {
                    platformName: dto.platformName,
                }),
                ...(dto.contactEmail !== undefined && {
                    contactEmail: dto.contactEmail,
                }),
                ...(dto.location !== undefined && {
                    location: dto.location,
                }),
            },
            create: {
                id: PLATFORM_SETTINGS_ID,
                platformName: dto.platformName,
                contactEmail: dto.contactEmail,
                location: dto.location,
            },
        });

        return {
            success: true,
            message: 'Platform settings saved successfully',
            data: settings,
        };
    }

    async getPlatformSettings() {
        const settings = await this.prisma.platformSetting.findUnique({
            where: {
                id: PLATFORM_SETTINGS_ID,
            },
        });

        return {
            success: true,
            data: settings ?? {
                id: PLATFORM_SETTINGS_ID,
                platformName: null,
                contactEmail: null,
                location: null,
                createdAt: null,
                updatedAt: null,
            },
        };
    }

    async getLegalContent() {
        const content = await this.findLegalContent();

        return {
            success: true,
            data: content,
        };
    }

    async getPrivacyPolicy() {
        const content = await this.findLegalContent();

        return {
            success: true,
            data: {
                privacyPolicy: content.privacyPolicy,
            },
        };
    }

    async getTermsAndConditions() {
        const content = await this.findLegalContent();

        return {
            success: true,
            data: {
                termsAndConditions: content.termsAndConditions,
            },
        };
    }

    private async findLegalContent() {
        const content = await this.prisma.platformLegalContent.findUnique({
            where: {
                id: LEGAL_CONTENT_ID,
            },
        });

        return content ?? {
            id: LEGAL_CONTENT_ID,
            privacyPolicy: null,
            termsAndConditions: null,
            createdAt: null,
            updatedAt: null,
        };
    }

}
