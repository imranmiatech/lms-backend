import { Injectable } from '@nestjs/common';
import { S3StorageService } from '../common/s3/s3.service';

@Injectable()
export class UploadService {
  constructor(private readonly s3StorageService: S3StorageService) {}

  async uploadPublicFile(file: any, folder?: string) {
    const upload = await this.s3StorageService.uploadFile(file, {
      folder: this.normalizeFolder(folder),
      resourceType: 'auto',
      maxBytes: 20 * 1024 * 1024,
    });

    return {
      success: true,
      message: 'File uploaded to S3 successfully',
      data: upload,
    };
  }

  private normalizeFolder(folder?: string) {
    const fallback = 'daanklerk/public';
    const value = folder?.trim() || fallback;
    const cleaned = value
      .replace(/\\/g, '/')
      .replace(/[^a-zA-Z0-9/_-]+/g, '-')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+|\/+$/g, '');

    return cleaned || fallback;
  }
}
