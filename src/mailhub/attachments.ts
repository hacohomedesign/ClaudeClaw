// mailhub/attachments.ts — Attachment metadata extraction and risk classification

import type { AttachmentMeta } from './types.js';

const SAFE_EXTENSIONS = new Set([
  'csv', 'txt', 'json', 'xml',
]);

const SAFE_MIME_PREFIXES = ['image/'];

const CAUTION_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar',
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dmg', 'pkg', 'app', 'bat', 'cmd', 'sh', 'ps1',
  'vbs', 'js', 'msi', 'dll', 'com', 'scr',
]);

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function classifyRisk(
  filename: string,
  mimeType: string,
): 'safe' | 'caution' | 'blocked' {
  const ext = getExtension(filename);

  if (BLOCKED_EXTENSIONS.has(ext)) return 'blocked';

  if (SAFE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return 'safe';
  }

  if (SAFE_EXTENSIONS.has(ext)) return 'safe';
  if (CAUTION_EXTENSIONS.has(ext)) return 'caution';

  // Unknown extension/mime — treat as caution
  return 'caution';
}

export function classifyAttachment(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): AttachmentMeta {
  return {
    filename,
    mimeType,
    sizeBytes,
    riskLevel: classifyRisk(filename, mimeType),
  };
}

// Placeholder — will be implemented when Google Drive integration is ready
export async function uploadAttachmentToDrive(
  _emailId: number,
  _attachmentId: string,
  _filename: string,
  _mimeType: string,
): Promise<{ driveFileId: string; driveUrl: string } | null> {
  // TODO: implement with Google Drive API
  return null;
}
