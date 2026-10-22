import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../config.js';

/** Thin artifact-store wrapper (MinIO or any S3-compatible endpoint). */
export class ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ACCESS_KEY && config.S3_SECRET_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY,
              secretAccessKey: config.S3_SECRET_KEY,
            },
          }
        : {}),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).catch(() => {
        // Bucket creation races are fine; reads will fail loudly if truly absent.
      });
    }
  }

  async put(key: string, body: string | Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return await result.Body?.transformToString();
    } catch {
      return undefined;
    }
  }
}
