import { LOGO_BADGE_PATH, LOGO_GLYPHS, LOGO_LAYOUTS, LOGO_PLAY_PATH, type LogoVariant } from '../brand/logo-data';

/**
 * Logo chuẩn Tubmedia (vẽ lại từ logo-tubmedia.png, SVG thuần, chữ là đường vẽ).
 * Màu chữ/thanh do CSS quyết định (brand.css):
 *  - auto: theo giao diện (nền tối → trắng, nền sáng → đen); dùng khi không chắc nền.
 *  - on-dark: chữ trắng, CHỈ đặt trên nền tối (thanh bên đen than, thẻ tối).
 *  - on-light: chữ đen, dùng trên nền sáng.
 *  - mono-white / mono-charcoal: một màu, dành cho nền xám hoặc nơi đỏ không đủ tương phản.
 */
export type LogoTone = 'auto' | 'on-dark' | 'on-light' | 'mono-white' | 'mono-charcoal';

interface TubmediaLogoProps {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Chiều cao hiển thị (px); chiều rộng tự tính theo tỉ lệ. */
  height?: number;
  /** Chiều rộng hiển thị (px); dùng khi không đưa height. */
  width?: number;
  className?: string;
  title?: string;
  /** Logo chỉ để trang trí (cạnh chữ "Tubmedia" đã có) → ẩn khỏi trình đọc màn hình. */
  decorative?: boolean;
}

const DEFAULT_HEIGHT: Record<LogoVariant, number> = { mark: 40, horizontal: 64, vertical: 120 };

export function TubmediaLogo({
  variant = 'horizontal',
  tone = 'auto',
  height,
  width,
  className,
  title = 'Tubmedia',
  decorative = false
}: TubmediaLogoProps): React.JSX.Element {
  const layout = LOGO_LAYOUTS[variant];
  const [minX, minY, boxWidth, boxHeight] = layout.viewBox;
  const ratio = boxWidth / boxHeight;
  const shownHeight = height ?? (width !== undefined ? width / ratio : DEFAULT_HEIGHT[variant]);
  const shownWidth = shownHeight * ratio;
  const mono = tone === 'mono-white' || tone === 'mono-charcoal';
  const [shiftX, shiftY] = layout.badgeShift;
  const bar = 'bar' in layout ? layout.bar : null;

  const badge = mono
    ? <path className="tm-logo-mono" d={LOGO_BADGE_PATH + LOGO_PLAY_PATH} fillRule="evenodd"/>
    : <>
      <path className="tm-logo-badge" d={LOGO_BADGE_PATH}/>
      <path className="tm-logo-play" d={LOGO_PLAY_PATH}/>
    </>;

  return <svg
    className={`tm-logo tm-logo--${variant} tm-logo--${tone}${className ? ` ${className}` : ''}`}
    width={Number(shownWidth.toFixed(2))}
    height={Number(shownHeight.toFixed(2))}
    viewBox={`${minX} ${minY} ${boxWidth} ${boxHeight}`}
    {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    focusable="false"
  >
    {shiftX || shiftY ? <g transform={`translate(${shiftX} ${shiftY})`}>{badge}</g> : badge}
    {bar && LOGO_GLYPHS.map((glyph, index) => <path
      key={index}
      className={mono ? 'tm-logo-mono' : 'tm-logo-text'}
      d={glyph.d}
      fillRule="evenodd"
      transform={glyph.dx ? `translate(${glyph.dx} 0)` : undefined}
    />)}
    {bar && <rect className={mono ? 'tm-logo-mono' : 'tm-logo-bar'} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={bar.rx}/>}
  </svg>;
}

interface TubmediaMarkProps {
  /** Chiều rộng biểu tượng (px). Huy hiệu rộng hơn cao (≈1,27:1). */
  size?: number;
  className?: string;
  title?: string;
}

export function TubmediaMark({ size = 44, className, title = 'Tubmedia' }: TubmediaMarkProps): React.JSX.Element {
  return <TubmediaLogo variant="mark" width={size} title={title} {...(className ? { className } : {})}/>;
}

/**
 * Logo ở thanh bên. Từ 2026-09-23, thanh bên đổi theo đúng chế độ sáng/tối của toàn bộ giao diện (ĐẢO LẠI
 * quyết định "luôn nền đen than" của GĐ1) — dùng tone="auto" để logo tự đổi chữ trắng/đen than theo đúng
 * nền thanh bên hiện tại (xem :root.light trong brand.css), thay vì ép cứng "on-dark".
 */
export function TubmediaWordmark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return <span className={`tm-brand-lockup ${compact ? 'is-compact' : ''}`} role="img" aria-label="Tubmedia">
    <TubmediaLogo variant="horizontal" tone="auto" height={compact ? 48 : 60} className="tm-brand-full" decorative/>
    <TubmediaLogo variant="mark" tone="auto" width={44} className="tm-brand-compact" decorative/>
  </span>;
}

/**
 * Thẻ "Phát triển bởi" (cuối thanh bên và trang Thông tin): không đỏ; nền/chữ theo đúng chế độ sáng/tối
 * hiện tại (đen than ở chế độ tối, sáng ở chế độ sáng — dùng chung token --sidebar-bg/--sidebar-text, xem
 * brand.css và tokens.css; đổi cùng lúc với thanh bên từ 2026-09-23).
 * Vệt sáng chỉ chạy MỘT lần khi mở app (intro, chỉ thẻ ở thanh bên) hoặc mỗi lần trỏ chuột vào thẻ;
 * chỉ dùng transform + opacity; tắt hẳn khi người dùng chọn giảm chuyển động (xem brand.css).
 */
export function DeveloperSignature({ intro = false }: { intro?: boolean }): React.JSX.Element {
  return <div className={`dev-card${intro ? ' dev-card--intro' : ''}`} role="group" aria-label="Tubmedia phát triển bởi Đình Duy">
    <span className="dev-card-glint" aria-hidden="true"/>
    <span className="dev-card-mark" aria-hidden="true"><TubmediaMark size={60}/></span>
    <span className="dev-card-copy">
      <span className="dev-card-eyebrow">PHÁT TRIỂN BỞI</span>
      <b className="dev-card-name">Đình Duy</b>
      <span className="dev-card-product">TUBMEDIA</span>
    </span>
  </div>;
}
