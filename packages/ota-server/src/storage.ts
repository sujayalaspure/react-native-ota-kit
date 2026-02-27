/**
 * storage.ts
 * ──────────
 * Abstraction over file storage.
 * LocalStorage: saves ZIPs to ./uploads/ (dev / self-hosted)
 * S3Storage: (stub) for production — swap in aws-sdk and an S3 bucket.
 */

import path from 'path';
import fs from 'fs';

export interface StorageBackend {
  /** Save an uploaded file buffer and return a stable download URL */
  save(fileName: string, buffer: Buffer): Promise<string>;
  /** Return the absolute local path for streaming, or null if remote */
  getLocalPath(storedPath: string): string | null;
  /** Return a public download URL for the given stored path */
  getDownloadUrl(storedPath: string, req?: any): string;
}

// ─── Local Storage ────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export class LocalStorage implements StorageBackend {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async save(fileName: string, buffer: Buffer): Promise<string> {
    const filePath = path.join(UPLOADS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    return filePath;   // stored path = absolute local path
  }

  getLocalPath(storedPath: string): string | null {
    return storedPath;
  }

  getDownloadUrl(storedPath: string): string {
    const fileName = path.basename(storedPath);
    return `${this.baseUrl}/v1/download/${fileName}`;
  }
}

// ─── S3 Storage (stub) ────────────────────────────────────────────────────────
// Swap this in for production. Install `@aws-sdk/client-s3` and uncomment.
//
// export class S3Storage implements StorageBackend {
//   async save(fileName: string, buffer: Buffer): Promise<string> {
//     // s3.putObject(...)
//     return `s3://my-bucket/ota/${fileName}`;
//   }
//   getLocalPath(_: string): null { return null; }
//   getDownloadUrl(key: string): string {
//     return `https://${BUCKET}.s3.amazonaws.com/${key}`;  // or pre-signed URL
//   }
// }
