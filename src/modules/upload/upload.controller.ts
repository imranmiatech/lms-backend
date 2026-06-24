import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from './upload.service';

@ApiTags('Public Upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload a public file to S3' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload. Max 20MB.',
        },
        folder: {
          type: 'string',
          example: 'daanklerk/public',
          description:
            'Optional S3 folder prefix. Allowed characters: letters, numbers, slash, underscore, hyphen.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully.',
    schema: {
      example: {
        success: true,
        message: 'File uploaded to S3 successfully',
        data: {
          publicId:
            'daanklerk/public/1719123456789-uuid-example-document.pdf',
          key: 'daanklerk/public/1719123456789-uuid-example-document.pdf',
          url: 'https://bucket.s3.region.amazonaws.com/daanklerk/public/1719123456789-uuid-example-document.pdf',
          resourceType: 'auto',
          format: '.pdf',
          bytes: 12345,
          originalName: 'document.pdf',
          mimeType: 'application/pdf',
          width: null,
          height: null,
          createdAt: '2026-06-23T00:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'File is required or too large.' })
  async uploadPublicFile(
    @UploadedFile() file: any,
    @Body('folder') folder?: string,
  ) {
    return this.uploadService.uploadPublicFile(file, folder);
  }
}
