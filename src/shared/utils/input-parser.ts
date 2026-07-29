import type { AudioMode, ParsedInputLine } from '../types/domain.js';
import { detectPlatform, normalizeUrl } from './url.js';
import { parseTimestampRange, parseTimestampValue } from './timestamp.js';

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

function inferAudioMode(note: string): AudioMode {
  const lower = note.toLowerCase();
  if (/bỏ âm|tắt âm|mute|không lấy tiếng/.test(lower)) return 'mute';
  if (/giữ âm|âm gốc|keep audio/.test(lower)) return 'keep';
  return 'default';
}

function stripComments(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) return '';
  return trimmed;
}

function parseOne(originalText: string, lineNumber: number, urlText: string): ParsedInputLine {
  const normalizedUrl = normalizeUrl(urlText);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!normalizedUrl) errors.push('URL không hợp lệ.');
  const note = originalText
    .replace(URL_REGEX, '')
    .replace(/^[\s"'“”;,]+|[\s"'“”;,]+$/g, '')
    .trim();
  let timestampStartSeconds: number | null = null;
  let timestampEndSeconds: number | null = null;
  if (normalizedUrl) {
    const url = new URL(normalizedUrl);
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    timestampStartSeconds = t ? parseTimestampValue(t) : null;
  }
  const range = parseTimestampRange(note);
  if (range.start !== null) timestampStartSeconds = range.start;
  if (range.end !== null) timestampEndSeconds = range.end;
  if (timestampEndSeconds !== null && timestampStartSeconds !== null && timestampEndSeconds <= timestampStartSeconds) {
    warnings.push('Thời điểm kết thúc phải lớn hơn thời điểm bắt đầu.');
  }
  const platformInfo = normalizedUrl ? detectPlatform(normalizedUrl) : null;
  return {
    id: crypto.randomUUID(),
    lineNumber,
    originalText,
    url: normalizedUrl ? urlText.replace(/^["'“”]+|["'“”,;]+$/g, '') : null,
    normalizedUrl,
    platform: platformInfo?.platform ?? null,
    extractorKey: platformInfo?.extractorKey ?? null,
    mediaId: platformInfo?.mediaId ?? null,
    timestampStartSeconds,
    timestampEndSeconds,
    note,
    audioMode: inferAudioMode(note),
    validity: errors.length ? 'invalid' : warnings.length ? 'warning' : 'valid',
    warnings,
    errors
  };
}

export function parseInputText(text: string): ParsedInputLine[] {
  const cleaned = text.replace(ZERO_WIDTH, '').replace(/^\uFEFF/, '');
  const output: ParsedInputLine[] = [];
  const seen = new Map<string, number>();
  for (const [index, raw] of cleaned.split(/\r?\n/).entries()) {
    const line = stripComments(raw);
    if (!line) continue;
    const urls = line.match(URL_REGEX) ?? [];
    if (!urls.length) {
      output.push({
        id: crypto.randomUUID(), lineNumber: index + 1, originalText: raw, url: null, normalizedUrl: null,
        platform: null, extractorKey: null, mediaId: null, timestampStartSeconds: null, timestampEndSeconds: null,
        note: raw.trim(), audioMode: 'default', validity: 'invalid', warnings: [], errors: ['Không tìm thấy URL trong dòng.']
      });
      continue;
    }
    for (const url of urls) {
      const parsed = parseOne(raw, index + 1, url.replace(/[),.;]+$/, ''));
      if (parsed.normalizedUrl) {
        const duplicateKey = parsed.mediaId && parsed.platform && parsed.extractorKey
          ? `${parsed.platform}:${parsed.extractorKey}:${parsed.mediaId}`
          : parsed.normalizedUrl;
        const count = seen.get(duplicateKey) ?? 0;
        seen.set(duplicateKey, count + 1);
        if (count > 0) {
          parsed.warnings.push('Cùng source đã xuất hiện; source chỉ tải một lần nhưng vẫn giữ nhiều vị trí timeline.');
          parsed.validity = 'warning';
        }
      }
      output.push(parsed);
    }
  }
  return output;
}
