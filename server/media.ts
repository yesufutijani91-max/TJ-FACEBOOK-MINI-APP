import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, supabaseConfigured } from './config.js';

export const BUCKET = 'media';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function classifyMime(mime: string): 'image' | 'video' | null {
  if (IMAGE_TYPES.has(mime)) return 'image';
  if (VIDEO_TYPES.has(mime)) return 'video';
  return null;
}

export const ALLOWED_MIME = [...IMAGE_TYPES, ...VIDEO_TYPES];
export const maxUploadBytes = () => config.maxUploadMb * 1024 * 1024;

let storageClient: SupabaseClient | null = null;
function supabaseStorage(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!storageClient) {
    storageClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return storageClient;
}

export interface StoredMedia {
  url: string;
  type: 'image' | 'video';
  path: string;
  storage: 'supabase' | 'local';
}

/**
 * Stores an uploaded file. Uses Supabase Storage when configured, otherwise a
 * local directory served by this API. File names are unguessable UUIDs, which
 * makes the public URLs capability URLs.
 */
export async function storeUpload(
  buffer: Buffer,
  mime: string,
  ownerId: string,
): Promise<StoredMedia> {
  const kind = classifyMime(mime);
  if (!kind) throw Object.assign(new Error('Unsupported file type'), { status: 400 });
  if (buffer.length > maxUploadBytes()) {
    throw Object.assign(new Error(`File exceeds ${config.maxUploadMb} MB limit`), { status: 413 });
  }
  const extension = EXTENSIONS[mime] ?? 'bin';
  const key = `${ownerId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const client = supabaseStorage();
  if (client) {
    const { error } = await client.storage.from(BUCKET).upload(key, buffer, {
      contentType: mime,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw Object.assign(new Error(`Storage upload failed: ${error.message}`), { status: 502 });
    const { data } = client.storage.from(BUCKET).getPublicUrl(key);
    return { url: data.publicUrl, type: kind, path: key, storage: 'supabase' };
  }

  const target = path.join(config.uploadDir, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return { url: `/api/media/${key}`, type: kind, path: key, storage: 'local' };
}

export async function deleteUpload(storedPath: string) {
  const client = supabaseStorage();
  if (client) {
    await client.storage.from(BUCKET).remove([storedPath]);
    return;
  }
  const target = path.join(config.uploadDir, storedPath);
  fs.rm(target, { force: true }, () => undefined);
}

export function resolveLocalUpload(key: string): string | null {
  const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(config.uploadDir, normalized);
  if (!target.startsWith(config.uploadDir)) return null;
  if (!fs.existsSync(target)) return null;
  return target;
}
