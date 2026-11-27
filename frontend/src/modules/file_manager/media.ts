import { apiErrorMessage, getAuthHeader } from './utils';

/** Fetch a file as a Blob through the authenticated download endpoint. */
export async function fetchFileBlob(path: string, signal?: AbortSignal, forceType?: string): Promise<Blob> {
  const res = await fetch(`/api/file_manager/download?path=${encodeURIComponent(path)}`, {
    headers: getAuthHeader(),
    signal,
  });
  if (!res.ok) {
    let data: unknown = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(apiErrorMessage(data, `HTTP ${res.status}`));
  }
  const blob = await res.blob();
  return forceType ? new Blob([blob], { type: forceType }) : blob;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
};

export function mimeFor(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return MIME[ext];
}
