/// <reference types="vite/client" />
import type { DesktopApi } from '../../preload/api-types';
declare global { interface Window { desktop: DesktopApi; } }
export {};
