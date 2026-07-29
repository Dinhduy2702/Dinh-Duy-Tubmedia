import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { AppError } from '@shared/errors/app-errors.js';
export class SenderValidator {
  private webContents: WebContents | null = null;
  public setWebContents(contents: WebContents): void { this.webContents = contents; }
  public assert(event: IpcMainInvokeEvent): void {
    if (!this.webContents || event.sender.id !== this.webContents.id) throw new AppError('INVALID_IPC_SENDER', 'IPC sender không hợp lệ.');
    const url = event.senderFrame?.url ?? event.sender.getURL();
    if (!url.startsWith('file://') && !url.startsWith('http://localhost:')) throw new AppError('INVALID_IPC_ORIGIN', 'IPC origin không hợp lệ.');
  }
}
