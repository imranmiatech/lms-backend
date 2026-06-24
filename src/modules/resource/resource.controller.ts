import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { ResourceService } from './resource.service';
import { CreateResourceDto, UpdateResourceDto } from './dto/resource.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser, Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Resource')
@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Create a new resource (Tutor/Admin only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'Course Syllabus.pdf',
        },
        url: {
          type: 'string',
          example: 'https://example.com/resource.pdf',
        },
        courseId: {
          type: 'string',
          example: 'course_uuid',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Optional image or document file. If sent, url is saved as an S3 URL.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Resource created successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  createResource(
    @Body() dto: CreateResourceDto,
    @CurrentUser() user: any,
    @UploadedFile() file?: any,
  ) {
    return this.resourceService.createResource(user.userId, dto, file);
  }

  @Get('my')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all my resources (Tutor/Admin only)' })
  @ApiResponse({ status: 200, description: 'Resources retrieved successfully.' })
  getMyResources(@CurrentUser() user: any) {
    return this.resourceService.getMyResources(user.userId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Update a resource (Tutor/Admin only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'Updated Syllabus.pdf',
        },
        url: {
          type: 'string',
          example: 'https://example.com/updated-resource.pdf',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Optional image or document file. If sent, url is updated with an S3 URL.',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Resource updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Resource not found.' })
  updateResource(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateResourceDto,
    @UploadedFile() file?: any,
  ) {
    return this.resourceService.updateResource(id, user.userId, dto, file);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.TUTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a resource (Tutor/Admin only)' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Resource not found.' })
  deleteResource(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.resourceService.deleteResource(id, user.userId);
  }
}
