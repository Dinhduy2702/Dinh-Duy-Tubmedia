import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { ClipboardPaste, FileInput, Link2, Trash2, Upload, X } from 'lucide-react';
import type { AudioMode, ParsedInputLine } from '@shared/types/domain';
import { StatusBadge } from '../../components/StatusBadge';
import { useAppStore } from '../../stores/app-store';

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(): void;
}

function sourceUrl(line: ParsedInputLine): string {
  const raw = line.normalizedUrl ?? line.url ?? '';
  try {
    const url = new URL(raw);
    for (const key of ['t', 'start', 'end']) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

function serialize(lines: ParsedInputLine[]): string {
  return lines
    .filter((line) => line.url || line.normalizedUrl)
    .map((line) => {
      const time = [
        line.timestampStartSeconds !== null ? `start=${line.timestampStartSeconds}` : '',
        line.timestampEndSeconds !== null ? `end=${line.timestampEndSeconds}` : ''
      ].filter(Boolean).join(' ');
      const cleanNote = line.note.replace(/\b(?:bỏ âm thanh|bỏ âm|tắt âm|mute|giữ âm gốc|giữ âm|keep audio)\b/gi, '').trim();
      const audio = line.audioMode === 'mute' ? 'bỏ âm thanh' : line.audioMode === 'keep' ? 'giữ âm gốc' : '';
      return [sourceUrl(line), time, cleanNote, audio].filter(Boolean).join(' ').trim();
    })
    .join('\n');
}

export function ImportLinksDialog({ projectId, open, onOpenChange, onImported }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedInputLine[]>([]);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [busy, setBusy] = useState(false);
  const setError = useAppStore((state) => state.setError);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim()) void window.desktop.input.parse(text).then(setPreview).catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)));
      else setPreview([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [setError, text]);

  const counts = useMemo(() => ({
    valid: preview.filter((line) => line.validity === 'valid').length,
    warning: preview.filter((line) => line.validity === 'warning').length,
    invalid: preview.filter((line) => line.validity === 'invalid').length
  }), [preview]);

  const choose = async (): Promise<void> => {
    const file = await window.desktop.dialogs.chooseTextFile();
    if (file) setText(file.text);
  };

  const pasteClipboard = async (): Promise<void> => {
    try { setText(await navigator.clipboard.readText()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Không đọc được clipboard.'); }
  };

  const onDrop = async (event: DragEvent<HTMLTextAreaElement>): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) { setError('Chỉ hỗ trợ kéo thả tệp TXT.'); return; }
    setText(await file.text());
  };

  const patchLine = <K extends keyof ParsedInputLine>(id: string, key: K, value: ParsedInputLine[K]): void => {
    setPreview((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const editedText = serialize(preview);
      const checked = await window.desktop.input.parse(editedText);
      if (!checked.some((line) => line.validity !== 'invalid')) throw new Error('Không còn dòng hợp lệ để nhập.');
      await window.desktop.input.importText(projectId, editedText, mode);
      onImported();
      onOpenChange(false);
      setText('');
      setPreview([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content max-w-[1180px]">
        <div className="flex justify-between">
          <div>
            <Dialog.Title className="text-xl font-black">Nhập danh sách liên kết</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Sửa trực tiếp địa chỉ, mốc thời gian, ghi chú và âm thanh trước khi xác nhận.</Dialog.Description>
          </div>
          <Dialog.Close className="btn btn-ghost p-2"><X size={18} /></Dialog.Close>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => void choose()}><FileInput size={17} />Chọn TXT</button>
          <button className="btn" onClick={() => void pasteClipboard()}><ClipboardPaste size={17} />Dán từ bộ nhớ tạm</button>
          <select className="select max-w-48" value={mode} onChange={(event) => setMode(event.target.value as 'append' | 'replace')}>
            <option value="append">Thêm vào dự án</option><option value="replace">Thay thế toàn bộ</option>
          </select>
          <div className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>{counts.valid} hợp lệ · {counts.warning} cảnh báo · {counts.invalid} lỗi</div>
        </div>
        <textarea
          className="textarea mt-3 min-h-32 font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onDragOver={(event: DragEvent<HTMLTextAreaElement>) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLTextAreaElement>) => void onDrop(event)}
          placeholder={'Dán liên kết hoặc kéo TXT vào đây\nhttps://youtu.be/abc?t=83 giữ âm gốc'}
        />
        <div className="scroll mt-3 max-h-[420px] overflow-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="table">
            <thead><tr><th>#</th><th>Địa chỉ</th><th>Bắt đầu</th><th>Kết thúc</th><th>Ghi chú</th><th>Âm thanh</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{preview.map((line) => <tr key={line.id}>
              <td>{line.lineNumber}</td>
              <td><input className="input min-w-72 font-mono text-xs" value={line.normalizedUrl ?? line.url ?? ''} onChange={(event) => { patchLine(line.id, 'url', event.target.value); patchLine(line.id, 'normalizedUrl', event.target.value); }} /></td>
              <td><input className="input w-24" type="number" min={0} value={line.timestampStartSeconds ?? ''} onChange={(event) => patchLine(line.id, 'timestampStartSeconds', event.target.value === '' ? null : Number(event.target.value))} /></td>
              <td><input className="input w-24" type="number" min={0} value={line.timestampEndSeconds ?? ''} onChange={(event) => patchLine(line.id, 'timestampEndSeconds', event.target.value === '' ? null : Number(event.target.value))} /></td>
              <td><input className="input min-w-52" value={line.note} onChange={(event) => patchLine(line.id, 'note', event.target.value)} /></td>
              <td><select className="select min-w-28" value={line.audioMode} onChange={(event) => patchLine(line.id, 'audioMode', event.target.value as AudioMode)}><option value="default">Mặc định</option><option value="keep">Giữ âm</option><option value="mute">Tắt âm</option></select></td>
              <td><StatusBadge status={line.validity} /></td>
              <td><button className="btn btn-danger p-1.5" onClick={() => setPreview((current) => current.filter((item) => item.id !== line.id))}><Trash2 size={14} /></button></td>
            </tr>)}</tbody>
          </table>
          {!preview.length && <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}><Link2 className="mx-auto mb-2" />Dán liên kết để xem trước.</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Dialog.Close className="btn">Hủy</Dialog.Close>
          <button className="btn btn-primary" disabled={busy || !preview.some((line) => Boolean(line.url || line.normalizedUrl))} onClick={() => void submit()}><Upload size={17} />{busy ? 'Đang nhập...' : 'Xác nhận nhập'}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
