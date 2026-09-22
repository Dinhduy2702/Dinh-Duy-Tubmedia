/** Khung xương thay vòng quay khi đang lấy thông tin (video, tệp…). Chỉ animate opacity (xem motion.css). */
export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: number }): React.JSX.Element {
  return <span className="tm-skeleton" style={{ display: 'block', width, height }} aria-hidden="true"/>;
}
