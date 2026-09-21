import { Check, X } from 'lucide-react';
import { BRAND_COLORS, ERROR_RED_HEX, LOGO_MIN_SIZE } from '../brand/brand-colors';
import { TubmediaLogo } from './TubmediaBrand';

function Verdict({ ok }: { ok: boolean }): React.JSX.Element {
  return <span className={`brand-kit-verdict ${ok ? 'is-ok' : 'is-no'}`}>
    {ok ? <Check size={13} aria-hidden="true"/> : <X size={13} aria-hidden="true"/>}
    {ok ? 'ĐÚNG' : 'SAI'}
  </span>;
}

function Rule({ ok, title, text, children, stageClass }: {
  ok: boolean;
  title: string;
  text: string;
  children: React.ReactNode;
  stageClass?: string;
}): React.JSX.Element {
  return <article className="brand-kit-rule">
    <div className={`brand-kit-rule-art ${stageClass ?? ''}`}>{children}</div>
    <Verdict ok={ok}/>
    <div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  </article>;
}

/** Mục "Bộ nhận diện" ở trang Thông tin: logo, mã màu và cách dùng đúng/sai. */
export function BrandKit(): React.JSX.Element {
  return <section className="brand-kit" aria-labelledby="brand-kit-title" data-testid="brand-kit">
    <div>
      <h2 id="brand-kit-title">Bộ nhận diện</h2>
      <p className="brand-kit-lead">
        Logo chuẩn của Tubmedia: huy hiệu đỏ có nút play, chữ TUB lớn, MEDIA nhỏ hơn bên dưới và thanh đen phía dưới.
        Mọi màn hình của ứng dụng theo nhận diện này.
      </p>
    </div>

    <div>
      <h3>Các bản logo</h3>
      <div className="brand-kit-stage-grid">
        <div className="brand-kit-stage is-dark">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="horizontal" tone="on-dark" height={78}/></div>
          <small>Bản ngang, nền tối — chữ trắng</small>
        </div>
        <div className="brand-kit-stage is-light">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="horizontal" tone="on-light" height={78}/></div>
          <small>Bản ngang, nền sáng — chữ đen</small>
        </div>
        <div className="brand-kit-stage is-light">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="vertical" tone="on-light" height={132}/></div>
          <small>Bản dọc, nền sáng</small>
        </div>
        <div className="brand-kit-stage is-light">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="mark" width={104}/></div>
          <small>Biểu tượng — biểu tượng ứng dụng, tab, nơi hẹp</small>
        </div>
        <div className="brand-kit-stage is-gray">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="horizontal" tone="mono-charcoal" height={78}/></div>
          <small>Một màu đen than — nền xám</small>
        </div>
        <div className="brand-kit-stage is-dark">
          <div className="brand-kit-stage-art"><TubmediaLogo variant="horizontal" tone="mono-white" height={78}/></div>
          <small>Một màu trắng — nền tối hoặc nền ảnh</small>
        </div>
      </div>
    </div>

    <div>
      <h3>Mã màu</h3>
      <div className="brand-kit-swatches">
        {BRAND_COLORS.map((color) => <div className="brand-kit-swatch" key={color.id} title={color.use}>
          <span className="brand-kit-swatch-chip" style={{ background: `var(${color.cssVar})` }} aria-hidden="true"/>
          <span><b>{color.name}</b><code>#{color.hex}</code></span>
        </div>)}
      </div>
      <ul className="brand-kit-facts" style={{ marginTop: '0.6rem' }}>
        {BRAND_COLORS.map((color) => <li key={color.id}><b>{color.name}</b>: {color.use}</li>)}
        <li>
          Đỏ logo khác <b>đỏ báo lỗi</b> <code>#{ERROR_RED_HEX}</code> của giao diện: đỏ báo lỗi luôn đi kèm biểu tượng ⊗ và nhãn "Lỗi";
          đỏ logo không bao giờ dùng để báo lỗi.
        </li>
      </ul>
    </div>

    <div>
      <h3>Cách dùng đúng và sai</h3>
      <div className="brand-kit-rules">
        <Rule ok title="Chữ trắng chỉ trên nền tối" text="Bản chữ trắng đặt trên thanh bên đen than hoặc thẻ tối." stageClass="is-dark">
          <TubmediaLogo variant="horizontal" tone="on-dark" height={56}/>
        </Rule>
        <Rule ok title="Nền sáng dùng chữ đen" text="Trên nền trắng hoặc nền sáng dùng bản chữ đen của logo." stageClass="is-light">
          <TubmediaLogo variant="horizontal" tone="on-light" height={56}/>
        </Rule>
        <Rule ok title="Nền xám dùng bản một màu" text="Đỏ logo chỉ đạt 2,35:1 trên xám nhạt nên dùng bản một màu đen than hoặc trắng." stageClass="is-gray">
          <TubmediaLogo variant="horizontal" tone="mono-charcoal" height={56}/>
        </Rule>
        <Rule ok title="Chừa vùng trống quanh logo" text="Vùng trống mỗi phía bằng chiều cao chữ MEDIA (khoảng ⅓ chiều cao huy hiệu).">
          <span className="brand-kit-clear-space"><TubmediaLogo variant="horizontal" tone="auto" height={52}/></span>
        </Rule>
        <Rule ok={false} title="Không đặt chữ trắng lên nền sáng" text="Chữ TUB MEDIA trắng biến mất trên nền sáng — dùng bản chữ đen." stageClass="is-light">
          <TubmediaLogo variant="horizontal" tone="on-dark" height={56}/>
        </Rule>
        <Rule ok={false} title="Không kéo giãn hay bóp méo" text="Luôn giữ đúng tỉ lệ; chỉ đổi kích thước." stageClass="is-light">
          <span className="brand-kit-distort"><TubmediaLogo variant="horizontal" tone="on-light" height={40}/></span>
        </Rule>
        <Rule ok={false} title="Không đổi màu logo" text="Đỏ logo và các màu đo từ ảnh gốc được giữ nguyên." stageClass="is-light">
          <span style={{ filter: 'hue-rotate(200deg)' }}><TubmediaLogo variant="horizontal" tone="on-light" height={56}/></span>
        </Rule>
        <Rule ok={false} title="Không dùng nhỏ hơn cỡ tối thiểu" text={`Bản ngang cao tối thiểu ${LOGO_MIN_SIZE.horizontalHeight} px; biểu tượng rộng tối thiểu ${LOGO_MIN_SIZE.markWidth} px; bản dọc cao tối thiểu ${LOGO_MIN_SIZE.verticalHeight} px. Nhỏ hơn thì dùng biểu tượng.`} stageClass="is-light">
          <TubmediaLogo variant="horizontal" tone="on-light" height={18}/>
        </Rule>
      </div>
    </div>
  </section>;
}
