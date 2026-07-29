import { useState, type ChangeEvent } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

interface FolderFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function FolderField({ label, value, onChange, disabled = false }: FolderFieldProps): React.JSX.Element {
  const [choosing, setChoosing] = useState(false);
  const choose = async (): Promise<void> => {
    if (disabled || choosing) return;
    setChoosing(true);
    try {
      const result = await window.desktop.dialogs.chooseFolder(value.trim() || undefined);
      if (result) onChange(result.path);
    } catch (error) {
      useAppStore.getState().setError(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  };

  return <label>
    <span className="label">{label}</span>
    <div className="flex gap-2">
      <input
        className="input"
        value={value}
        disabled={disabled || choosing}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <button type="button" className="btn" disabled={disabled || choosing} onClick={() => void choose()}>
        {choosing ? <LoaderCircle className="animate-spin" size={17}/> : <FolderOpen size={17}/>}
        {choosing ? 'Đang mở...' : 'Chọn'}
      </button>
    </div>
  </label>;
}
