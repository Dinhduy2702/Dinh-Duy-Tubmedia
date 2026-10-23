import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  WINDOWS_MAX_PATH_LENGTH,
  planDownloadName
} from '@shared/utils/download-path-budget.js';
import {
  classifyYtDlpFailure,
  exhaustedDownloadFailureMessage,
  pathTooLongLength,
  ytDlpFailureLogMessage
} from '@shared/utils/download-failure.js';

// 2026-10-23: video Facebook 1589967605531745 không tải được — tiêu đề FB dài ("610K views · 8.6K reactions | … | Arms Family
// Homestead") + tệp tạm ".f1205344837823463v.mp4.part" (mã định dạng FB 16–17 chữ số) → đường dẫn 260–262 ký tự, vượt MAX_PATH
// của Windows (LongPathsEnabled=0) → yt-dlp "unable to open for writing: [Errno 2] No such file or directory".

const TITLE =
  '610K views · 8.6K reactions ｜ These pigs are looking for a way into the pecan farm! It’s just a matter of time before they get in and become a huge problem. ｜ Arms Family Homestead';
const HOME = 'E:\\DinhDuy\\NA401_Bẫy lợn\\video';
const WORK = 'E:\\Tubmedia\\_dl\\5ce25a9e';
const TAIL = ' [LINK_AE98B42CCDF5]';
const ID = '1589967605531745';

/** Cắt theo byte UTF-8 như %(title).NB của yt-dlp (không cắt giữa ký tự). */
function truncateBytes(text: string, bytes: number): string {
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > bytes) break;
    out += char;
  }
  return out;
}

/** Mọi tệp yt-dlp ghi ra trong lượt tải (tệp tạm từng luồng, mảnh HLS, tệp ghép, tệp cuối). */
function workingPaths(name: string): string[] {
  return [
    join(WORK, `${name}.f1205344837823463v.mp4.part`),
    join(WORK, `${name}.f3228491137320918a.m4a.part`),
    join(WORK, `${name}.f270.mp4.part-Frag12345.part`),
    join(WORK, `${name}.temp.mp4`),
    join(HOME, `${name}.mp4`)
  ];
}

const fixedLength = ' ['.length + ']'.length + TAIL.length;

describe('planDownloadName — tên tệp tải về luôn vừa MAX_PATH của Windows', () => {
  it('đúng ca thật Facebook: mọi tệp tạm và tệp cuối ≤ 259 ký tự, mã video + mã liên kết vẫn ở cuối', () => {
    const plan = planDownloadName({ homeFolder: HOME, workFolder: WORK, fixedLength, mediaIdLength: ID.length, maxTitleBytes: 165 });
    expect(plan.kind).toBe('title');
    if (plan.kind !== 'title') return;
    expect(plan.titleBytes).toBeLessThan(165);
    expect(plan.titleBytes).toBeGreaterThanOrEqual(60);
    const name = `${truncateBytes(TITLE, plan.titleBytes)} [${ID}]${TAIL}`;
    for (const path of workingPaths(name)) expect(path.length).toBeLessThanOrEqual(WINDOWS_MAX_PATH_LENGTH);
    expect(name.endsWith(`[${ID}] [LINK_AE98B42CCDF5]`)).toBe(true);
  });

  it('thư mục ngắn: giữ nguyên mức cắt tiêu đề cũ (không đổi tên tệp của người dùng không vướng giới hạn)', () => {
    const plan = planDownloadName({ homeFolder: 'E:\\V', workFolder: 'E:\\T\\_dl\\5ce25a9e', fixedLength, mediaIdLength: 11, maxTitleBytes: 165 });
    expect(plan).toEqual({ kind: 'title', titleBytes: 165 });
  });

  it('lần thử lại sau lỗi đường dẫn dài: tiêu đề ngắn đi một nửa, lần sau nữa bỏ hẳn tiêu đề', () => {
    const base = { homeFolder: HOME, workFolder: WORK, fixedLength, mediaIdLength: ID.length, maxTitleBytes: 165 };
    const first = planDownloadName(base);
    const second = planDownloadName({ ...base, pathStrikes: 1 });
    expect(first.kind === 'title' && second.kind === 'title').toBe(true);
    if (first.kind !== 'title' || second.kind !== 'title') return;
    expect(second.titleBytes).toBe(Math.floor(first.titleBytes / 2));
    expect(planDownloadName({ ...base, pathStrikes: 2 })).toEqual({ kind: 'untitled' });
  });

  it('thư mục quá sâu, chỗ cho tiêu đề quá ít → đặt tên "Video [mã] [LINK_…]"', () => {
    const deep = `E:\\${'a'.repeat(172)}`;
    expect(planDownloadName({ homeFolder: deep, workFolder: WORK, fixedLength, mediaIdLength: ID.length, maxTitleBytes: 165 })).toEqual({
      kind: 'untitled'
    });
  });

  it('thư mục dài tới mức không tên nào vừa → báo đúng thư mục và độ dài tối đa cho phép', () => {
    const tooDeep = `E:\\${'b'.repeat(200)}`;
    const plan = planDownloadName({ homeFolder: HOME, workFolder: tooDeep, fixedLength, mediaIdLength: ID.length, maxTitleBytes: 165 });
    expect(plan.kind).toBe('folder-too-long');
    if (plan.kind !== 'folder-too-long') return;
    expect(plan.folder).toBe(tooDeep);
    expect(plan.folderLength).toBe(tooDeep.length);
    expect(plan.maxFolderLength).toBeLessThan(tooDeep.length);
    expect(plan.maxFolderLength).toBeGreaterThan(100);
  });

  it('mã video dài hơn mức dành sẵn vẫn được tính đủ', () => {
    const short = planDownloadName({ homeFolder: HOME, workFolder: WORK, fixedLength, mediaIdLength: 11, maxTitleBytes: 165 });
    const long = planDownloadName({ homeFolder: HOME, workFolder: WORK, fixedLength, mediaIdLength: 60, maxTitleBytes: 165 });
    expect(short.kind === 'title' && long.kind === 'title').toBe(true);
    if (short.kind !== 'title' || long.kind !== 'title') return;
    expect(long.titleBytes).toBeLessThan(short.titleBytes);
  });
});

// Đúng văn bản yt-dlp trong nhật ký thật (Python in đường dẫn dạng repr: dấu "\" nhân đôi).
const REAL_ERROR =
  "ERROR: unable to open for writing: [Errno 2] No such file or directory: 'E:\\\\DinhDuy\\\\NA401_Bẫy lợn\\\\video\\\\610K views · 8.6K reactions ｜ These pigs are looking for a way into the pecan farm! It’s just a matter of time before they get in and become a huge problem. ｜ Arm [1589967605531745] [LINK_AE98B42CCDF5].f1205344837823463v.mp4.part'";

describe('classifyYtDlpFailure — lỗi đường dẫn quá dài', () => {
  it('ca thật (đường dẫn 260 ký tự) → path_too_long, thử lại được', () => {
    expect(pathTooLongLength(REAL_ERROR)).toBe(260);
    expect(classifyYtDlpFailure(REAL_ERROR)).toEqual({
      category: 'retryable',
      subtype: 'path_too_long',
      httpStatus: null,
      retryable: true
    });
  });

  it('thư mục thật sự không tồn tại (đường dẫn ngắn) → không bị coi là đường dẫn dài', () => {
    const missing = "ERROR: unable to open for writing: [Errno 2] No such file or directory: 'X:\\\\Video\\\\a [id] [LINK_AE98B42CCDF5].mp4.part'";
    expect(pathTooLongLength(missing)).toBeNull();
    expect(classifyYtDlpFailure(missing).subtype).toBe('unknown');
  });

  it('Windows báo thẳng tên quá dài (WinError 206 / Errno 36) → path_too_long', () => {
    expect(classifyYtDlpFailure('ERROR: [WinError 206] The filename or extension is too long').subtype).toBe('path_too_long');
    expect(classifyYtDlpFailure("ERROR: [Errno 36] File name too long: 'a.mp4'").subtype).toBe('path_too_long');
  });

  it('tiêu đề trong đường dẫn chứa chữ "403"/"fragment"/"removed" vẫn được nhận đúng là đường dẫn dài', () => {
    const tricky = REAL_ERROR.replace('These pigs', 'HTTP Error 403 fragment video has been removed pigs');
    expect(classifyYtDlpFailure(tricky).subtype).toBe('path_too_long');
  });

  it('câu nhật ký và câu báo cuối cùng nói rõ nguyên nhân và cách xử lý', () => {
    expect(ytDlpFailureLogMessage('path_too_long')).toContain('đường dẫn tệp quá dài');
    const final = exhaustedDownloadFailureMessage('x', { failureSubtype: 'path_too_long' }, 3);
    expect(final).toContain('sau 3 lần thử');
    expect(final).toContain('thư mục lưu ngắn hơn');
  });
});
