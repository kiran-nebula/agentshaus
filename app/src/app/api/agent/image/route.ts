import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: 'BLOB_READ_WRITE_TOKEN is not configured' },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Image file is required' },
        { status: 400 },
      );
    }

    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported image format. Use PNG, JPG, GIF, or WebP' },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Image must be 5MB or smaller' },
        { status: 400 },
      );
    }

    const extension = MIME_EXTENSION[file.type] || 'bin';
    const filePath = `soul-images/${Date.now()}-${randomUUID()}.${extension}`;
    const blob = await put(filePath, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('Failed to upload Soul NFT image:', err);
    return NextResponse.json(
      { error: 'Failed to upload Soul NFT image' },
      { status: 500 },
    );
  }
}
