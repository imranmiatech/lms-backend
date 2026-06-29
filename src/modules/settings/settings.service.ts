import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ChangePasswordDto,
  CreatePaymentDto,
  UpdateNotificationPreferencesDto,
  UpdateSettingsDto,
  UpsertLegalContentDto,
  UpsertPrivacyPolicyDto,
  UpsertPlatformSettingsDto,
  UpsertTermsAndConditionsDto,
} from './dto/settings.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const LEGAL_CONTENT_ID = 'platform_legal_content';
const PLATFORM_SETTINGS_ID = 'platform_settings';
const LEGACY_LEGAL_CONTENT_PREFIX = '__LEGAL_CONTENT_V1__:';
type LegalContentUpsertData = Omit<
  Prisma.PlatformLegalContentUncheckedCreateInput,
  'id'
>;
type LegacyLegalContentPayload = {
  content: string | null;
  sections: Array<{ title: string; description: string }>;
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async createOrUpdatePaymentInfo(userId: string, dto: CreatePaymentDto) {
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
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);

    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

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
      message: 'Password changed successfully',
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

  async upsertLegalContent(dto: UpsertLegalContentDto ) {
    const content = await this.saveLegalContent({
      ...(dto.privacyPolicy !== undefined && {
        privacyPolicy: dto.privacyPolicy,
      }),
      ...(dto.privacyPolicySections !== undefined && {
        privacyPolicySections:
          dto.privacyPolicySections as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.termsAndConditions !== undefined && {
        termsAndConditions: dto.termsAndConditions,
      }),
      ...(dto.termsAndConditionsSections !== undefined && {
        termsAndConditionsSections:
          dto.termsAndConditionsSections as unknown as Prisma.InputJsonValue,
      }),
    });

    return {
      success: true,
      message: 'Legal content saved successfully',
      data: content,
    };
  }

  async upsertPrivacyPolicy(dto: UpsertPrivacyPolicyDto) {
    const content = await this.saveLegalContent({
      ...(dto.privacyPolicy !== undefined && {
        privacyPolicy: dto.privacyPolicy,
      }),
      ...(dto.privacyPolicySections !== undefined && {
        privacyPolicySections:
          dto.privacyPolicySections as unknown as Prisma.InputJsonValue,
      }),
    });

    return {
      success: true,
      message: 'Privacy policy saved successfully',
      data: {
        privacyPolicy: content.privacyPolicy,
        privacyPolicySections: content.privacyPolicySections,
      },
    };
  }

  async upsertTermsAndConditions(dto: UpsertTermsAndConditionsDto) {
    const content = await this.saveLegalContent({
      ...(dto.termsAndConditions !== undefined && {
        termsAndConditions: dto.termsAndConditions,
      }),
      ...(dto.termsAndConditionsSections !== undefined && {
        termsAndConditionsSections:
          dto.termsAndConditionsSections as unknown as Prisma.InputJsonValue,
      }),
    });

    return {
      success: true,
      message: 'Terms and conditions saved successfully',
      data: {
        termsAndConditions: content.termsAndConditions,
        termsAndConditionsSections: content.termsAndConditionsSections,
      },
    };
  }

  private async saveLegalContent(
    data: LegalContentUpsertData,
  ) {
    try {
      return await this.prisma.platformLegalContent.upsert({
        where: {
          id: LEGAL_CONTENT_ID,
        },
        update: data,
        create: {
          id: LEGAL_CONTENT_ID,
          ...data,
        },
      });
    } catch (error) {
      if (!this.isMissingLegalContentSectionsColumnError(error)) {
        throw error;
      }

      const legacyData = this.buildLegacyLegalContentData(data);

      const legacyContent = await this.prisma.platformLegalContent.upsert({
        where: {
          id: LEGAL_CONTENT_ID,
        },
        update: legacyData,
        create: {
          id: LEGAL_CONTENT_ID,
          ...legacyData,
        },
        select: {
          id: true,
          privacyPolicy: true,
          termsAndConditions: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        ...this.normalizeLegacyLegalContentRecord(legacyContent),
        id: legacyContent.id,
        createdAt: legacyContent.createdAt,
        updatedAt: legacyContent.updatedAt,
      };
    }
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
        privacyPolicySections: content.privacyPolicySections,
      },
    };
  }

  async getTermsAndConditions() {
    const content = await this.findLegalContent();

    return {
      success: true,
      data: {
        termsAndConditions: content.termsAndConditions,
        termsAndConditionsSections: content.termsAndConditionsSections,
      },
    };
  }

  private async findLegalContent() {
    let content:
      | Awaited<ReturnType<typeof this.prisma.platformLegalContent.findUnique>>
      | {
          id: string;
          privacyPolicy: string | null;
          privacyPolicySections: never[];
          termsAndConditions: string | null;
          termsAndConditionsSections: never[];
          createdAt: Date | null;
          updatedAt: Date | null;
        }
      | null;

    try {
      content = await this.prisma.platformLegalContent.findUnique({
        where: {
          id: LEGAL_CONTENT_ID,
        },
      });
    } catch (error) {
      if (!this.isMissingLegalContentSectionsColumnError(error)) {
        throw error;
      }

      const legacyContent = await this.prisma.platformLegalContent.findUnique({
        where: {
          id: LEGAL_CONTENT_ID,
        },
        select: {
          id: true,
          privacyPolicy: true,
          termsAndConditions: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      content = legacyContent
        ? {
            ...this.normalizeLegacyLegalContentRecord(legacyContent),
            id: legacyContent.id,
            createdAt: legacyContent.createdAt,
            updatedAt: legacyContent.updatedAt,
          }
        : null;
    }

    return (
      content ?? {
        id: LEGAL_CONTENT_ID,
        privacyPolicy: null,
        privacyPolicySections: [],
        termsAndConditions: null,
        termsAndConditionsSections: [],
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  private isMissingLegalContentSectionsColumnError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2022') {
      return false;
    }

    const meta = error.meta as
      | {
          column?: string;
          driverAdapterError?: {
            cause?: {
              column?: string;
              originalMessage?: string;
            };
          };
        }
      | undefined;
    const column = String(
      meta?.column ?? meta?.driverAdapterError?.cause?.column ?? '',
    );
    const originalMessage = String(
      meta?.driverAdapterError?.cause?.originalMessage ?? '',
    );

    return (
      column.includes('privacyPolicySections') ||
      column.includes('termsAndConditionsSections') ||
      originalMessage.includes('privacyPolicySections') ||
      originalMessage.includes('termsAndConditionsSections')
    );
  }

  private buildLegacyLegalContentData(data: LegalContentUpsertData) {
    const legacyData: {
      privacyPolicy?: string | null;
      termsAndConditions?: string | null;
    } = {};

    if (
      data.privacyPolicy !== undefined ||
      data.privacyPolicySections !== undefined
    ) {
      legacyData.privacyPolicy = this.serializeLegacyLegalContentField(
        data.privacyPolicy,
        data.privacyPolicySections,
      );
    }

    if (
      data.termsAndConditions !== undefined ||
      data.termsAndConditionsSections !== undefined
    ) {
      legacyData.termsAndConditions = this.serializeLegacyLegalContentField(
        data.termsAndConditions,
        data.termsAndConditionsSections,
      );
    }

    return legacyData;
  }

  private serializeLegacyLegalContentField(
    content: string | null | undefined,
    sections:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput
      | undefined,
  ) {
    const payload: LegacyLegalContentPayload = {
      content: content ?? null,
      sections: this.normalizeSectionsInput(sections),
    };

    return `${LEGACY_LEGAL_CONTENT_PREFIX}${JSON.stringify(payload)}`;
  }

  private normalizeLegacyLegalContentRecord(content: {
    privacyPolicy: string | null;
    termsAndConditions: string | null;
  }) {
    const privacyPolicy = this.deserializeLegacyLegalContentField(
      content.privacyPolicy,
    );
    const termsAndConditions = this.deserializeLegacyLegalContentField(
      content.termsAndConditions,
    );

    return {
      privacyPolicy: privacyPolicy.content,
      privacyPolicySections: privacyPolicy.sections,
      termsAndConditions: termsAndConditions.content,
      termsAndConditionsSections: termsAndConditions.sections,
    };
  }

  private deserializeLegacyLegalContentField(value: string | null) {
    if (!value?.startsWith(LEGACY_LEGAL_CONTENT_PREFIX)) {
      return {
        content: value,
        sections: [],
      };
    }

    try {
      const payload = JSON.parse(
        value.slice(LEGACY_LEGAL_CONTENT_PREFIX.length),
      ) as Partial<LegacyLegalContentPayload>;

      return {
        content: typeof payload.content === 'string' ? payload.content : null,
        sections: Array.isArray(payload.sections)
          ? payload.sections.filter(this.isLegalContentSection)
          : [],
      };
    } catch {
      return {
        content: value,
        sections: [],
      };
    }
  }

  private normalizeSectionsInput(
    sections:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput
      | undefined,
  ) {
    if (!Array.isArray(sections)) {
      return [];
    }

    return sections.filter(this.isLegalContentSection);
  }

  private isLegalContentSection(
    section: unknown,
  ): section is { title: string; description: string } {
    return (
      typeof section === 'object' &&
      section !== null &&
      typeof (section as { title?: unknown }).title === 'string' &&
      typeof (section as { description?: unknown }).description === 'string'
    );
  }
}
