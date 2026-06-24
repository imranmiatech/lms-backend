import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ObjectCannedACL,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { extname } from 'path';
import { randomUUID } from 'crypto';

type UploadResourceType = 'image' | 'video' | 'raw' | 'auto';

type UploadOptions = {
  folder: string;
  resourceType?: UploadResourceType;
  allowedMimeTypes?: string[];
  maxBytes?: number;
};

@Injectable()
export class S3StorageService {
  private readonly bucket: string | undefined;
  private readonly region: string;
  private readonly endpoint: string | undefined;
  private readonly publicBaseUrl: string | undefined;
  private readonly objectAcl: ObjectCannedACL | undefined;
  private readonly client: S3Client;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('AWS_S3_BUCKET');
    this.region = this.config.get<string>('AWS_REGION') ?? 'us-east-1';
    this.endpoint = this.config.get<string>('AWS_S3_ENDPOINT');
    this.publicBaseUrl =
      this.config.get<string>('AWS_S3_PUBLIC_BASE_URL') ??
      this.config.get<string>('AWS_CLOUDFRONT_URL');
    this.objectAcl = this.config.get<ObjectCannedACL>('AWS_S3_OBJECT_ACL');

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: this.config.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true',
      credentials: this.resolveCredentials(),
    });
  }

  async uploadFile(file: any, options: UploadOptions) {
    this.assertConfigured();
    this.validateFile(file, options);

    const key = this.buildObjectKey(file, options.folder);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
        ...(this.objectAcl ? { ACL: this.objectAcl } : {}),
      }),
    );

    return {
      publicId: key,
      key,
      url: this.buildPublicUrl(key),
      resourceType: options.resourceType ?? 'auto',
      format: this.getFileExtension(file.originalname),
      bytes: file.size,
      originalName: file.originalname,
      mimeType: file.mimetype,
      width: null,
      height: null,
      createdAt: new Date().toISOString(),
    };
  }

  private assertConfigured() {
    if (!this.bucket) {
      throw new InternalServerErrorException(
        'S3 is not configured. Set AWS_S3_BUCKET and AWS_REGION, plus AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY when not using an instance role.',
      );
    }
  }

  private validateFile(file: any, options: UploadOptions) {
    if (!file?.buffer) {
      throw new BadRequestException('File is required');
    }

    const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;

    if (file.size > maxBytes) {
      throw new BadRequestException(
        `File is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)}MB`,
      );
    }

    if (
      options.allowedMimeTypes?.length &&
      !options.allowedMimeTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${options.allowedMimeTypes.join(', ')}`,
      );
    }
  }

  private resolveCredentials() {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!accessKeyId || !secretAccessKey) {
      return undefined;
    }

    return {
      accessKeyId,
      secretAccessKey,
    };
  }

  private buildObjectKey(file: any, folder: string) {
    const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
    const extension = this.getFileExtension(file.originalname);
    const safeName = this.getBaseName(file.originalname);
    const filename = `${Date.now()}-${randomUUID()}-${safeName}${extension}`;

    return normalizedFolder ? `${normalizedFolder}/${filename}` : filename;
  }

  private getBaseName(originalName?: string) {
    const fallback = 'upload';
    const base = (originalName ?? fallback).replace(/\.[^/.]+$/, '');
    const safe = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return safe || fallback;
  }

  private getFileExtension(originalName?: string) {
    return extname(originalName ?? '').toLowerCase();
  }

  private buildPublicUrl(key: string) {
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/+$/g, '')}/${encodedKey}`;
    }

    if (this.endpoint) {
      return `${this.endpoint.replace(/\/+$/g, '')}/${this.bucket}/${encodedKey}`;
    }

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
  }
}
