import { useEffect, useState } from 'react';
import { isLightTheme } from '@shared/utils/theme';
import { useAppStore } from '../stores/app-store';

/**
 * Nguồn DUY NHẤT cho "đang sáng hay tối" — App dùng để bật lớp 'light' của <html>, thanh trên dùng cho nhãn/công tắc
 * Sáng/Tối. Đợt 5 mục 10: thanh trên từng đọc lớp DOM lúc vẽ, mà lớp đó chỉ được bật trong effect của App (chạy SAU) →
 * nhãn ghi giao diện cũ tới lần vẽ lại kế tiếp; Windows đổi sáng/tối khi chọn "Theo giao diện Windows" thì có khi không
 * đổi theo. Hook theo dõi cả cài đặt lẫn Windows (matchMedia change) nên mọi nơi dùng nó vẽ lại cùng lúc.
 */
export function useIsLightTheme(): boolean {
  const theme = useAppStore((state) => state.settings?.theme);
  const [windowsLight, setWindowsLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = (): void => setWindowsLight(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isLightTheme(theme, windowsLight);
}
