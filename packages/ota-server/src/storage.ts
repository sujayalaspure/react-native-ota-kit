/**
 * storage.ts
 * ──────────
 * Abstraction over file storage.
 *
 * LocalStorage    — saves ZIPs to ./uploads/ (dev / self-hosted)
 * SupabaseStorage — uploads to a Supabase Storage bucket (production)
 *
 * Set STORAGE_BACKEND=supabase in your environment to use Supabase.
 * Required env vars for Supabase:
 *   SUPABASE_URL              — e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (never expose to clients)
 *   OTA_BUCKET_NAME           — name of the storage bucket (default: ota-bundles)
 */

import path from 'path';
import fs from 'fs';
import { StorageClient } from '@supabase/storage-js';

export interface StorageBackend {
  /** Save an uploaded file buffer and return a stable storage key */
  save(fileName: string, buffer: Buffer): Promise<string>;
  /** Return the absolute local path for streaming, or null if remote */
  getLocalPath(storedKey: string): string | null;
  /** Return a public download URL for the given storage key */
  getDownloadUrl(storedKey: string, req?: any): string;
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
    return filePath;   // stored key = absolute local path
  }

  getLocalPath(storedKey: string): string | null {
    return storedKey;
  }

  getDownloadUrl(storedKey: string): string {
    const fileName = path.basename(storedKey);
    return `${this.baseUrl}/v1/download/${fileName}`;
  }
}

// ─── Supabase Storage ─────────────────────────────────────────────────────────

export class SupabaseStorage implements StorageBackend {
  private client: StorageClient;
  private bucket: string;
  private supabaseUrl: string;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.OTA_BUCKET_NAME ?? 'ota-bundles';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.bucket = bucket;
    this.client = new StorageClient(`${this.supabaseUrl}/storage/v1`, {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    });
  }

  async save(fileName: string, buffer: Buffer): Promise<string> {
    const key = `bundles/${fileName}`;
    const { error } = await this.client
      .from(this.bucket)
      .upload(key, buffer, {
        contentType: 'application/zip',
        upsert: false,
      });

    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return key;   // stored key = object path inside the bucket
  }

  getLocalPath(_storedKey: string): null {
    return null;  // always remote
  }

  getDownloadUrl(storedKey: string): string {
    return `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${storedKey}`;
  }
}
