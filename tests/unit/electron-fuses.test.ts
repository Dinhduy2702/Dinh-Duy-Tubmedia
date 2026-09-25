import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDevelopmentEnvironment } from '../../src/main/runtime/development-environment.js';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

interface PackageJson {
  build: { asar?: boolean; electronFuses?: Record<string, unknown> };
}

describe('Electron Fuses cho bản đóng gói', () => {
  const pkg = JSON.parse(read('package.json')) as PackageJson;

  it('tắt RunAsNode, NODE_OPTIONS, --inspect và chỉ nạp ứng dụng từ asar', () => {
    expect(pkg.build.electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true
    });
  });

  it('onlyLoadAppFromAsar chỉ hợp lệ khi ứng dụng thật sự được đóng vào asar', () => {
    expect(pkg.build.asar).toBe(true);
  });

  it('mọi khóa fuse đều là tùy chọn electron-builder hỗ trợ', () => {
    const schemaPath = resolve(process.cwd(), 'node_modules/app-builder-lib/scheme.json');
    if (!existsSync(schemaPath)) return;
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
      definitions: { FuseOptionsV1: { properties: Record<string, unknown> } };
    };
    const supported = Object.keys(schema.definitions.FuseOptionsV1.properties);
    for (const key of Object.keys(pkg.build.electronFuses ?? {})) {
      expect(supported).toContain(key);
    }
  });

  it('ứng dụng không phụ thuộc vào RunAsNode/NODE_OPTIONS/--inspect của chính nó', () => {
    for (const file of [
      'src/main/index.ts',
      'src/main/processes/process-manager.ts',
      'src/main/tools/tool-manager.ts',
      'src/main/system/system-cleanup-service.ts'
    ]) {
      const text = read(file);
      expect(text, file).not.toContain('ELECTRON_RUN_AS_NODE');
      expect(text, file).not.toMatch(/NODE_OPTIONS|--inspect/);
    }
  });
});

describe('biến môi trường chỉ dành cho phát triển', () => {
  const env = {
    ELECTRON_RENDERER_URL: 'http://localhost:5173/',
    TUBMEDIA_E2E: '1',
    TUBMEDIA_E2E_USER_DATA: 'C:\\e2e-data',
    TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON: '{"state":"available"}'
  } as NodeJS.ProcessEnv;

  it('bản đóng gói bỏ qua hoàn toàn ELECTRON_RENDERER_URL và TUBMEDIA_E2E', () => {
    expect(readDevelopmentEnvironment(env, true)).toEqual({
      rendererUrl: undefined,
      e2e: false,
      e2eUserData: undefined,
      fakeUpdateStatusJson: undefined
    });
  });

  it('chạy từ mã nguồn vẫn đọc được để dev server và e2e hoạt động', () => {
    expect(readDevelopmentEnvironment(env, false)).toEqual({
      rendererUrl: 'http://localhost:5173/',
      e2e: true,
      e2eUserData: 'C:\\e2e-data',
      fakeUpdateStatusJson: '{"state":"available"}'
    });
  });

  it('giá trị rỗng hoặc khác "1" không bật chế độ e2e', () => {
    expect(readDevelopmentEnvironment({}, false)).toEqual({
      rendererUrl: undefined,
      e2e: false,
      e2eUserData: undefined,
      fakeUpdateStatusJson: undefined
    });
    expect(readDevelopmentEnvironment({ TUBMEDIA_E2E: 'true', ELECTRON_RENDERER_URL: '' }, false)).toEqual({
      rendererUrl: undefined,
      e2e: false,
      e2eUserData: undefined,
      fakeUpdateStatusJson: undefined
    });
  });

  it('cửa sổ chính và tiến trình main chỉ đọc các biến này qua readDevelopmentEnvironment', () => {
    const windowSource = read('src/main/windows/main-window.ts');
    const indexSource = read('src/main/index.ts');
    expect(windowSource).toContain('readDevelopmentEnvironment(process.env, app.isPackaged)');
    expect(indexSource).toContain('readDevelopmentEnvironment(process.env, app.isPackaged)');
    for (const source of [windowSource, indexSource]) {
      expect(source).not.toContain('process.env.ELECTRON_RENDERER_URL');
      expect(source).not.toContain('process.env.TUBMEDIA_E2E');
    }
  });
});
