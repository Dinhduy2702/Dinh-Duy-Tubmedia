import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../stores/app-store';
import { formatRateLimitCountdown } from '../../../shared/utils/rate-limit-backoff';
import type { RateLimitWaitState } from '../../../shared/types/domain';

/** Hướng B 429: huy hiệu "Đang chờ do giới hạn {nền tảng}" có đếm ngược, cạnh "Đang giảm tải" ở thanh trên cùng. */
export function RateLimitWaitBadges(): React.JSX.Element | null {
  // Chỉ hiện lúc đang chờ hoặc đã dừng hẳn; giai đoạn tăng dần lại sau khi tự tiếp tục chạy ngầm, không treo huy hiệu mãi.
  const waits = useAppStore(
    useShallow((state) => (state.stats?.rateLimitWaits ?? []).filter((wait) => wait.stopped || wait.resumeAt !== null))
  );
  const [now, setNow] = useState(() => Date.now());
  const counting = waits.some((wait) => wait.resumeAt !== null);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [counting]);
  if (waits.length === 0) return null;
  return (
    <>
      {waits.map((wait) => (
        <span
          key={wait.platform}
          className={`topbar-load-throttled topbar-rate-limit${wait.stopped ? ' is-stopped' : ''}`}
          data-rate-limit-platform={wait.platform}
          title={rateLimitTitle(wait)}
        >
          {rateLimitText(wait, now)}
        </span>
      ))}
    </>
  );
}

function rateLimitText(wait: RateLimitWaitState, now: number): string {
  if (wait.stopped) return `Đã dừng do giới hạn ${wait.label}`;
  return `Đang chờ do giới hạn ${wait.label} · ${formatRateLimitCountdown((wait.resumeAt ?? now) - now)}`;
}

function rateLimitTitle(wait: RateLimitWaitState): string {
  if (wait.stopped) {
    return `${wait.label} vẫn giới hạn sau khi Tubmedia đã tự nghỉ và thử lại nhiều lần. Mở video trong trình duyệt, hoàn tất xác minh nếu được yêu cầu, rồi nhấn Tiếp tục ở danh sách.`;
  }
  return `${wait.label} đang giới hạn số yêu cầu (HTTP 429). Tubmedia tạm ngừng bắt đầu video mới của ${wait.label} ở mọi danh sách và tự tiếp tục khi hết giờ đếm ngược (lúc đầu từng video một rồi tăng dần) — không cần bấm gì.`;
}
