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

/** Logo ở thanh bên (luôn nền đen than). Khi thanh bên thu hẹp chỉ còn biểu tượng. */
export function TubmediaWordmark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return <span className={`tm-brand-lockup ${compact ? 'is-compact' : ''}`} role="img" aria-label="Tubmedia">
    <TubmediaLogo variant="horizontal" tone="on-dark" height={compact ? 48 : 60} className="tm-brand-full" decorative/>
    <TubmediaLogo variant="mark" tone="on-dark" width={44} className="tm-brand-compact" decorative/>
  </span>;
}

export function DeveloperSignature(): React.JSX.Element {
  return <div className="developer-signature-card" aria-label="Tubmedia phát triển bởi Đình Duy">
    <div className="developer-signature-ambient" aria-hidden="true"/>
    <div className="developer-signature-identity">
      <div className="developer-signature-icon-shell" aria-hidden="true">
        <TubmediaMark className="developer-signature-logo" size={58}/>
      </div>
      <div className="developer-signature-copy">
        <span className="developer-signature-eyebrow">PHÁT TRIỂN BỞI</span>
        <b className="developer-signature-name">Đình Duy</b>
        <strong className="developer-signature-product">TUBMEDIA</strong>
      </div>
    </div>
    <div className="developer-signature-divider" aria-hidden="true"/>
    <small className="developer-signature-tagline">TẢI · XỬ LÝ · GHÉP VIDEO</small>
  </div>;
}
