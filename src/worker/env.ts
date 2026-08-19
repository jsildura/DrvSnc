export interface Env {
  // Cloudflare storage and workflow bindings
  DB: D1Database;
  UPLOADS: R2Bucket;
  DRIVE_TRANSFER: Workflow;
  DRIVE_COPY: Workflow;
  ASSETS: Fetcher;

  // Environment variables and secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  ENVIRONMENT?: string;

  // R2 S3 API credentials for client-side direct multipart presigned URLs
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      UPLOADS: R2Bucket;
      DRIVE_TRANSFER: Workflow;
      DRIVE_COPY: Workflow;
      ASSETS: Fetcher;
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      TOKEN_ENCRYPTION_KEY: string;
      SESSION_SECRET: string;
      APP_ORIGIN: string;
      ENVIRONMENT?: string;
      R2_ACCESS_KEY_ID?: string;
      R2_SECRET_ACCESS_KEY?: string;
      R2_ACCOUNT_ID?: string;
      R2_BUCKET_NAME?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
