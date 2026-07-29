import {
  BadgeCheck,
  Code2,
  Cpu,
  Database,
  DownloadCloud,
  Film,
  ShieldCheck,
  Sparkles,
  Workflow
} from 'lucide-react';
import { APP_NAME, APP_VERSION_LABEL } from '@shared/constants/app';
import { DeveloperSignature, TubmediaMark } from '../components/TubmediaBrand';

export function AboutPage(): React.JSX.Element {
  return <div className="page-shell about-page">
    <section className="about-hero tubmedia-about-hero">
      <div className="about-hero-orb about-orb-one"/>
      <div className="about-hero-orb about-orb-two"/>
      <div className="about-app-icon"><TubmediaMark size={58}/></div>
      <div className="about-hero-copy">
        <span className="eyebrow">QUY TRÌNH SÁNG TẠO TUBMEDIA</span>
        <h1>{APP_NAME}</h1>
        <p>Tải nhiều danh sách, kiểm tra toàn vẹn, chuẩn hóa có chọn lọc và ghép video chất lượng cao trong một ứng dụng Windows duy nhất.</p>
        <div className="about-badges">
          <span><BadgeCheck size={15}/>{APP_VERSION_LABEL}</span>
          <span><ShieldCheck size={15}/>Hoạt động cục bộ trên máy tính</span>
          <span><Workflow size={15}/>1–4 quy trình độc lập</span>
        </div>
      </div>
      <div className="about-brand-signature"><DeveloperSignature/></div>
    </section>

    <section className="developer-profile tubmedia-developer-profile">
      <div className="developer-avatar"><TubmediaMark size={42}/></div>
      <div><span>THIẾT KẾ VÀ PHÁT TRIỂN BỞI</span><h2>Đình Duy <strong>Tubmedia</strong></h2><p>Tập trung vào quy trình tải, kiểm tra, quản lý và ghép video dành cho người dùng Windows.</p></div>
      <div className="developer-signature"><Sparkles size={18}/>Dành riêng cho Tubmedia</div>
    </section>

    <div className="about-feature-grid">
      <Feature icon={DownloadCloud} title="Tải đa danh sách" text="Tối đa 4 danh sách độc lập, số luồng tải riêng, nhật ký riêng và giới hạn tổng theo cấu hình máy."/>
      <Feature icon={Film} title="Tải và ghép nhiều quy trình" text="Tối đa 4 quy trình riêng, hỗ trợ chất lượng từ nhẹ đến cao nhất theo nguồn và chỉ mã hóa lại khi cần."/>
      <Feature icon={Cpu} title="Tối ưu theo phần cứng" text="Đọc bộ xử lý, bộ nhớ, bộ xử lý đồ họa và ổ đĩa để đề xuất số luồng tải, số luồng FFmpeg và mức tải phù hợp."/>
      <Feature icon={Database} title="Lưu trạng thái an toàn" text="SQLite lưu hàng đợi, tiến trình, lịch sử và hỗ trợ phục hồi khi ứng dụng bị đóng giữa chừng."/>
      <Feature icon={Code2} title="Ứng dụng máy tính thực thụ" text="Giao diện React giao tiếp với phần xử lý Electron qua cầu nối an toàn; bản phát hành không phụ thuộc máy chủ web."/>
      <Feature icon={ShieldCheck} title="Kiểm tra và cách ly tệp lỗi" text="ffprobe và FFmpeg xác minh tệp tải về; tệp lỗi được đưa vào khu cách ly thay vì báo hoàn tất sai."/>
    </div>

    <section className="responsibility-card">
      <div><ShieldCheck size={21}/></div>
      <div><h3>Sử dụng có trách nhiệm</h3><p>Chỉ tải và xử lý nội dung bạn sở hữu hoặc có quyền sử dụng. Nội dung cookies không được ghi vào nhật ký hay gói chẩn đoán; ứng dụng chỉ lưu trạng thái đã cấu hình.</p></div>
    </section>
  </div>;
}

function Feature({ icon: Icon, title, text }: { icon: typeof Workflow; title: string; text: string }): React.JSX.Element {
  return <article className="about-feature-card"><div><Icon size={22}/></div><h3>{title}</h3><p>{text}</p></article>;
}
