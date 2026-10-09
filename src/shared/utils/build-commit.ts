/**
 * Mã commit của bản build (Đợt 5, rà soát bản cài 2026-10-02 mục 17: bản cài cùng số hiệu 1.5.0 nhưng thiếu một commit —
 * không cách nào biết bản đang chạy build từ mã nào ngoài giải nén asar). electron.vite.config.ts gọi hàm này lúc build
 * và nhúng kết quả vào cả tiến trình chính lẫn giao diện (__TUBMEDIA_BUILD_COMMIT__). Bộ cài chính thức chỉ build khi
 * cây mã đã commit sạch (BUILD_INSTALLER_CHINH_THUC.ps1) nên mã này đúng là mã nguồn của bản cài.
 */
export function resolveBuildCommit(source: {
  git: () => string;
  env: Readonly<Record<string, string | undefined>>;
}): string {
  const valid = (value: string | undefined): string => {
    const trimmed = value?.trim().toLowerCase() ?? '';
    return /^[0-9a-f]{7,40}$/.test(trimmed) ? trimmed.slice(0, 7) : '';
  };
  let fromGit = '';
  try {
    fromGit = valid(source.git());
  } catch {
    fromGit = '';
  }
  return fromGit || valid(source.env.GITHUB_SHA);
}

export function buildCommitLabel(commit: string): string {
  return commit || 'Không xác định';
}
