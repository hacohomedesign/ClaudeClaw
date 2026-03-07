// mailhub/sanitizer.ts — Anti prompt-injection pipeline (Layers 1 & 2)
// Layer 3 (LLM isolation) is handled in summarizer.ts

import type { SanitizeResult } from './types.js';

// --- Layer 1: Deterministic cleanup ---

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;
const HTML_TAGS = /<[^>]*>/g;
const BASE64_BLOCKS = /data:[^;]*;base64,[A-Za-z0-9+/=]+/g;
const HTML_ENTITIES_RE = /&(?:amp|lt|gt|quot|nbsp|#39);/g;
const FORWARDED_HEADER = /^-{5,}\s*Forwarded message\s*-{5,}$/m;

function stripHtml(text: string): string {
  return text.replace(HTML_TAGS, '');
}

function decodeHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITIES_RE, (match) => HTML_ENTITY_MAP[match] ?? match);
}

function removeZeroWidthChars(text: string): string {
  return text.replace(ZERO_WIDTH_CHARS, '');
}

function stripBase64Blocks(text: string): string {
  return text.replace(BASE64_BLOCKS, '[base64-removed]');
}

function processQuotedReplies(text: string, depth: number = 0): string {
  if (depth >= 3) return '[quoted-content-truncated]';

  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('>')) {
      const unquoted = line.replace(/^>+\s?/, '');
      result.push('> ' + processQuotedReplies(unquoted, depth + 1));
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

function processForwardedBlocks(text: string, depth: number = 0): string {
  if (depth >= 3) return text;

  const match = text.match(FORWARDED_HEADER);
  if (!match || match.index === undefined) return text;

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return before + '[forwarded-message]\n' + processForwardedBlocks(after, depth + 1);
}

function layer1Cleanup(html: string): string {
  let text = stripHtml(html);
  text = decodeHtmlEntities(text);
  text = text.normalize('NFC');
  text = removeZeroWidthChars(text);
  text = stripBase64Blocks(text);
  text = processForwardedBlocks(text);
  text = processQuotedReplies(text);
  return text.trim();
}

// --- Layer 2: Regex pattern detection ---

const INJECTION_PATTERNS: { pattern: RegExp; weight: number }[] = [
  { pattern: /ignore\s+previous\s+instructions/i, weight: 3 },
  { pattern: /ignore\s+all\s+previous/i, weight: 3 },
  { pattern: /ignore\s+the\s+above/i, weight: 3 },
  { pattern: /you\s+are\s+now/i, weight: 2 },
  { pattern: /act\s+as\b/i, weight: 1 },
  { pattern: /pretend\s+you\s+are/i, weight: 2 },
  { pattern: /\[INST\]/i, weight: 3 },
  { pattern: /\[\/INST\]/i, weight: 3 },
  { pattern: /<<SYS>>/i, weight: 3 },
  { pattern: /<\/SYS>>/i, weight: 3 },
  { pattern: /\bsystem:/i, weight: 2 },
  { pattern: /\bSYSTEM:/i, weight: 2 },
  { pattern: /<\|im_start\|>/i, weight: 3 },
  { pattern: /<\|im_end\|>/i, weight: 3 },
  { pattern: /\bHuman:/i, weight: 2 },
  { pattern: /\bAssistant:/i, weight: 2 },
  { pattern: /<system>/i, weight: 3 },
  { pattern: /<\/system>/i, weight: 3 },
  { pattern: /\bdisregard\b/i, weight: 2 },
  { pattern: /new\s+instructions/i, weight: 2 },
  { pattern: /forget\s+everything/i, weight: 3 },
];

function layer2Score(text: string): number {
  let rawScore = 0;

  for (const { pattern, weight } of INJECTION_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      rawScore += matches.length * weight;
    }
  }

  return Math.min(rawScore, 10);
}

// --- Public API ---

export function sanitizeEmailBody(html: string): SanitizeResult {
  const sanitized = layer1Cleanup(html);
  const injectionScore = layer2Score(sanitized);

  return { sanitized, injectionScore };
}
