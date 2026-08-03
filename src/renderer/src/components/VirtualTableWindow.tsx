import { useMemo, useState, type UIEvent } from 'react';

interface VirtualTableWindowResult<T> {
  visibleItems: T[];
  startIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  onScroll(event: UIEvent<HTMLElement>): void;
}

export function useVirtualTableWindow<T>(
  items: readonly T[],
  rowHeight = 78,
  viewportHeight = 720,
  overscan = 8,
  enabled = true
): VirtualTableWindowResult<T> {
  const [scrollTop, setScrollTop] = useState(0);

  return useMemo(() => {
    if (!enabled || items.length <= 120) {
      return {
        visibleItems: [...items],
        startIndex: 0,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        onScroll: (event: UIEvent<HTMLElement>) => setScrollTop(event.currentTarget.scrollTop)
      };
    }

    const rawStart = Math.floor(scrollTop / rowHeight);
    const startIndex = Math.max(0, rawStart - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);

    return {
      visibleItems: items.slice(startIndex, endIndex),
      startIndex,
      topSpacerHeight: startIndex * rowHeight,
      bottomSpacerHeight: Math.max(0, (items.length - endIndex) * rowHeight),
      onScroll: (event: UIEvent<HTMLElement>) => setScrollTop(event.currentTarget.scrollTop)
    };
  }, [enabled, items, overscan, rowHeight, scrollTop, viewportHeight]);
}
