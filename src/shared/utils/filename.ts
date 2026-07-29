const reserved = /[<>:"/\\|?*]/g;
const windowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function replaceControlCharacters(input: string): string {
  return Array.from(input, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? '_' : character;
  }).join('');
}

export function sanitizeFilename(input: string, fallback = 'video'): string {
  const normalized = replaceControlCharacters(input.normalize('NFKC'));
  let value = normalized.replace(reserved, '_').replace(/[. ]+$/g, '').trim();
  if (windowsNames.test(value)) value = `_${value}`;
  if (!value) value = fallback;
  return value.slice(0, 220);
}
