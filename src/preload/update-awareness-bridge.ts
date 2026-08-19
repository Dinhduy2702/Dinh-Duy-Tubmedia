import { contextBridge, ipcRenderer } from 'electron';

const STATE_CHANNEL = 'tubmedia:update-awareness:state';
const GET_STATE_CHANNEL = 'tubmedia:update-awareness:get-state';
const CHECK_CHANNEL = 'tubmedia:update-awareness:check';
const DOWNLOAD_CHANNEL = 'tubmedia:update-awareness:download';
const INSTALL_CHANNEL = 'tubmedia:update-awareness:install';

const updateAwarenessApi = {
  getState: (): Promise<unknown> => ipcRenderer.invoke(GET_STATE_CHANNEL),
  checkNow: (): Promise<unknown> => ipcRenderer.invoke(CHECK_CHANNEL),
  downloadNow: (): Promise<unknown> => ipcRenderer.invoke(DOWNLOAD_CHANNEL),
  installNow: (): Promise<unknown> => ipcRenderer.invoke(INSTALL_CHANNEL),
  onState: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, nextState: unknown): void => {
      listener(nextState);
    };

    ipcRenderer.on(STATE_CHANNEL, handler);

    return () => {
      ipcRenderer.removeListener(STATE_CHANNEL, handler);
    };
  }
};

contextBridge.exposeInMainWorld('tubmediaUpdateAwareness', updateAwarenessApi);
