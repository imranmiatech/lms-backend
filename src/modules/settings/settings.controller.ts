import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
    ChangePasswordDto,
    CreatePaymentDto,
    UpdateNotificationPreferencesDto,
    UpdateSettingsDto,
    UpsertLegalContentDto,
    UpsertPlatformSettingsDto,
} from './dto/settings.dto';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Post('payment')
    @UseGuards(AuthGuard)
    @Roles(Role.TUTOR, Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new payment information (Tutor/Admin only)' })
    @ApiResponse({ status: 201, description: 'Payment information created successfully.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.' })
    @ApiResponse({ status: 403, description: 'Forbidden.' })
    createPayment(
        @Body() createPaymentDto: CreatePaymentDto,
        @CurrentUser() user: any,
    ) {
        return this.settingsService.createOrUpdatePaymentInfo(user.userId, createPaymentDto);
    }


    @Patch('payment')
    @UseGuards(AuthGuard)
    @Roles(Role.TUTOR, Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update payment information (Tutor/Admin only)' })
    @ApiResponse({ status: 200, description: 'Payment information updated successfully.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.' })
    @ApiResponse({ status: 403, description: 'Forbidden.' })
    updatePayment(
        @Body() updatePaymentDto: UpdateSettingsDto,
        @CurrentUser() user: any,
        
    ) {
        return this.settingsService.updatePaymentInfo(user.userId, updatePaymentDto);
    }
    @Get("payment")
    @UseGuards(AuthGuard)
    @Roles(Role.TUTOR, Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get payment information (Tutor/Admin only)' })
    @ApiResponse({ status: 200, description: 'Payment information retrieved successfully.' })
    @ApiResponse({ status: 401, description: 'Unauthorized.' })
    @ApiResponse({ status: 403, description: 'Forbidden.' })
    getPayment(
        @CurrentUser() user: any,
    ) {
        return this.settingsService.getPaymentInfo(user.userId);
    }

    /////---change password----------////
    @Patch('change-password')
    @UseGuards(AuthGuard)
    @ApiBearerAuth()
    changePassword(
        @CurrentUser() user: any,
        @Body() dto: ChangePasswordDto,
    ) {
        return this.settingsService.changePassword(
            user.userId,
            dto,
        );
    }

    @Get('notifications')
    @UseGuards(AuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get notification preferences for current user' })
    getNotificationPreferences(@CurrentUser() user: any) {
        return this.settingsService.getNotificationPreferences(user.userId);
    }

    @Patch('notifications')
    @UseGuards(AuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update notification preferences for current user' })
    updateNotificationPreferences(
        @CurrentUser() user: any,
        @Body() dto: UpdateNotificationPreferencesDto,
    ) {
        return this.settingsService.updateNotificationPreferences(
            user.userId,
            dto,
        );
    }

    @Post('platform-settings')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update platform settings (Admin only)' })
    upsertPlatformSettings(@Body() dto: UpsertPlatformSettingsDto) {
        return this.settingsService.upsertPlatformSettings(dto);
    }

    @Patch('platform-settings')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update platform settings, creating them first if missing (Admin only)' })
    updatePlatformSettings(@Body() dto: UpsertPlatformSettingsDto) {
        return this.settingsService.upsertPlatformSettings(dto);
    }

    @Get('platform-settings')
    @ApiOperation({ summary: 'Get platform settings' })
    getPlatformSettings() {
        return this.settingsService.getPlatformSettings();
    }

    @Post('legal-content')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update platform privacy policy and terms (Admin only)' })
    upsertLegalContent(@Body() dto: UpsertLegalContentDto) {
        return this.settingsService.upsertLegalContent(dto);
    }

    @Patch('legal-content')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles(Role.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update platform privacy policy and terms, creating them first if missing (Admin only)' })
    updateLegalContent(@Body() dto: UpsertLegalContentDto) {
        return this.settingsService.upsertLegalContent(dto);
    }

    @Get('legal-content')
    @ApiOperation({ summary: 'Get platform privacy policy and terms' })
    getLegalContent() {
        return this.settingsService.getLegalContent();
    }

    @Get('legal-content/privacy-policy')
    @ApiOperation({ summary: 'Get platform privacy policy' })
    getPrivacyPolicy() {
        return this.settingsService.getPrivacyPolicy();
    }

    @Get('legal-content/terms-and-conditions')
    @ApiOperation({ summary: 'Get platform terms and conditions' })
    getTermsAndConditions() {
        return this.settingsService.getTermsAndConditions();
    }
}
