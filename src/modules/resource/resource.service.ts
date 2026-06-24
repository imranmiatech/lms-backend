import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3StorageService } from '../common/s3/s3.service';
import { CreateResourceDto, UpdateResourceDto } from './dto/resource.dto';

@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  async createResource(tutorId: string, dto: CreateResourceDto, file?: any) {
    if (dto.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        select: { tutorId: true },
      });

      if (!course) {
        throw new NotFoundException('Course not found');
      }

      if (course.tutorId !== tutorId) {
        throw new UnauthorizedException('You cannot add resources to this course');
      }
    }

    const upload = file ? await this.uploadResourceFile(file) : null;
    const url = upload?.url ?? dto.url;

    if (!url) {
      throw new BadRequestException('Provide either url or file');
    }

    const resource = await this.prisma.resource.create({
      data: {
        tutorId,
        courseId: dto.courseId,
        name: dto.name,
        url,
        size: upload ? this.formatBytes(upload.bytes) : undefined,
      },
    });

    return {
      success: true,
      message: 'Resource created successfully',
      data: upload ? { ...resource, upload } : resource,
    };
  }

  async updateResource(
    resourceId: string,
    tutorId: string,
    dto: UpdateResourceDto,
    file?: any,
  ) {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    if (resource.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot update this resource');
    }

    const upload = file ? await this.uploadResourceFile(file) : null;

    const updated = await this.prisma.resource.update({
      where: { id: resourceId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(upload && {
          url: upload.url,
          size: this.formatBytes(upload.bytes),
        }),
      },
    });

    return {
      success: true,
      message: 'Resource updated successfully',
      data: upload ? { ...updated, upload } : updated,
    };
  }

  async deleteResource(resourceId: string, tutorId: string) {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    if (resource.tutorId !== tutorId) {
      throw new UnauthorizedException('You cannot delete this resource');
    }

    await this.prisma.resource.delete({
      where: { id: resourceId },
    });

    return {
      success: true,
      message: 'Resource deleted successfully',
    };
  }

  async getMyResources(tutorId: string) {
    const resources = await this.prisma.resource.findMany({
      where: { tutorId },
    });

    return {
      success: true,
      data: resources,
    };
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

  private uploadResourceFile(file: any) {
    return this.s3StorageService.uploadFile(file, {
      folder: 'daanklerk/resources',
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
}
