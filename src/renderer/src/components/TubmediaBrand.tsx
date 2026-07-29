interface TubmediaMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function TubmediaMark({ size = 44, className, title = 'Tubmedia' }: TubmediaMarkProps): React.JSX.Element {
  return <svg
    aria-label={title}
    className={`tubmedia-mark-image${className ? ` ${className}` : ''}`}
    height={size}
    role="img"
    style={{ width: size, height: size }}
    viewBox="0 0 120 120"
    width={size}
  >
    <rect className="tubmedia-mark-shadow" x="7" y="9" width="106" height="106" rx="29"/>
    <rect className="tubmedia-mark-surface" x="5" y="5" width="106" height="106" rx="29"/>
    <path className="tubmedia-mark-highlight" d="M25 16c20-8 61-8 79 0-6 5-12 8-20 9H43c-7 0-13-3-18-9Z"/>
    <path className="tubmedia-mark-play-shadow" d="M49 37c0-5 6-8 10-5l35 24c4 3 4 9 0 12L59 92c-4 3-10 0-10-5Z"/>
    <path className="tubmedia-mark-play" d="M45 34c0-5 6-8 10-5l35 24c4 3 4 9 0 12L55 89c-4 3-10 0-10-5Z"/>
  </svg>;
}

export function TubmediaWordmark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return <div className={`tubmedia-wordmark ${compact ? 'is-compact' : ''}`} aria-label="Tubmedia">
    <TubmediaMark className="tubmedia-wordmark-mark" size={compact ? 42 : 54}/>
    <span className="tubmedia-wordmark-copy" aria-hidden="true">
      <b>TUB</b>
      <strong>MEDIA</strong>
    </span>
  </div>;
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
