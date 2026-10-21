// P4 (2026-10-21, YouTube 1JtdsqPbsXw): yt-dlp báo mã 0 nhưng luồng hình mất trọn 10 mảnh HLS (586,7 s hình / 640,75 s tiếng).
// Thời lượng tệp lấy max(hình, tiếng, container) nên vẫn khớp YouTube → kiểm tra cũ cho đạt. Hàm này so riêng luồng hình.

/** Luồng hình và tiếng của một bản tải lành chênh nhau dưới 0,2 s; một mảnh HLS/DASH dài 2–10 s. */
export const VIDEO_STREAM_SHORTFALL_TOLERANCE_SECONDS = 3;

export interface VideoStreamShortfall {
  /** So với luồng tiếng của chính tệp, hay với thời lượng nền tảng công bố (khi không có luồng tiếng). */
  reference: 'audio' | 'expected';
  videoSeconds: number;
  referenceSeconds: number;
  missingSeconds: number;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function detectVideoStreamShortfall(input: {
  videoStreamDuration?: number | null | undefined;
  audioStreamDuration?: number | null | undefined;
  expectedDuration?: number | null | undefined;
}): VideoStreamShortfall | null {
  const video = positive(input.videoStreamDuration);
  if (video === null) return null;
  const audio = positive(input.audioStreamDuration);
  const expected = positive(input.expectedDuration);
  const tolerance = VIDEO_STREAM_SHORTFALL_TOLERANCE_SECONDS;

  if (audio !== null && audio - video > tolerance) {
    // Hình khớp thời lượng nền tảng mà tiếng dài hơn → nguồn vốn vậy (tiếng kéo dài sau hình), không phải mất dữ liệu.
    if (expected !== null && expected - video <= tolerance) return null;
    return { reference: 'audio', videoSeconds: video, referenceSeconds: audio, missingSeconds: audio - video };
  }
  // Không có luồng tiếng để đối chiếu: dùng thời lượng nền tảng, cùng dung sai với kiểm tra thời lượng của FileVerifier.
  if (audio === null && expected !== null && expected - video > Math.max(tolerance, expected * 0.02)) {
    return { reference: 'expected', videoSeconds: video, referenceSeconds: expected, missingSeconds: expected - video };
  }
  return null;
}
