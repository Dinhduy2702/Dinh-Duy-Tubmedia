import { PROGRESS_MARKER } from '@shared/constants/app.js';

export interface ParsedYtDlpProgress {
  percent: number;
  speed: string | null;
  etaSeconds: number | null;
}

// `--print` can make yt-dlp quiet or simulated depending on the selected
// print stage. Keep these flags together and covered by tests so metadata
// capture never disables the real download or its progress stream.
export const YTDLP_PROGRESS_FLAGS = ['--newline', '--no-simulate', '--progress'] as const;

// yt-dlp on Windows can otherwise encode redirected stdout with the active
// system code page. Node reads the pipe as UTF-8, which corrupts Vietnamese
// titles and output paths. yt-dlp officially supports forcing this encoding.
export const YTDLP_UTF8_FLAGS = ['--encoding', 'utf-8'] as const;

function parseEta(value: string): number | null {
  const clean = value.trim();
  if (!clean || /^(?:n\/a|na|unknown|-)$/i.test(clean)) return null;
  if (/^\d+$/.test(clean)) return Number(clean);
  const parts = clean.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

export function parseYtDlpProgress(line: string): ParsedYtDlpProgress | null {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const clean = line.replace(ansiPattern, '');
  const markerIndex = clean.indexOf(`${PROGRESS_MARKER}|`);
  if (markerIndex < 0) return null;

  const fields = clean.slice(markerIndex).split('|');
  const percentText = fields[1]?.replace('%', '').trim() ?? '';
  const downloadedBytes = Number(fields[4] ?? 0);
  const totalBytes = Number(fields[5] ?? 0);
  const parsedPercent = Number(percentText);
  const fallbackPercent = totalBytes > 0 ? downloadedBytes / totalBytes * 100 : 0;
  const percent = Math.max(
    0,
    Math.min(100, Number.isFinite(parsedPercent) ? parsedPercent : fallbackPercent)
  );

  const speedText = fields[2]?.trim() ?? '';
  return {
    percent,
    speed: speedText && !/^(?:n\/a|na|unknown|-)$/i.test(speedText)
      ? speedText
      : null,
    etaSeconds: parseEta(fields[3] ?? '')
  };
}
