import React, { useEffect, useRef, useState } from 'react';
import {
  deleteLibraryEntry,
  downloadToLibrary,
  formatBytes,
  type DownloadProgress,
  type LibraryMeta,
} from '@vgfa/runtime';
import { useLibraryEntry } from '../services/useLibrary';
import '../styles/library.css';

interface Props {
  url: string;
  filename?: string;
  meta?: LibraryMeta;
  compact?: boolean;
}

function guessFilename(url: string): string {
  try {
    const last = url.split('?')[0].split('#')[0].split('/').pop() || '';
    return decodeURIComponent(last) || 'jogo.rom';
  } catch {
    return 'jogo.rom';
  }
}

function friendlyError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  const msg = err instanceof Error ? err.message : '';
  if (name === 'LibraryStorageError') return msg;
  if (name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Não deu para baixar agora. Confira sua conexão e tente de novo.';
  }
  if (/^Erro HTTP 404/.test(msg)) return 'Este arquivo não está mais disponível no servidor.';
  return msg || 'Algo deu errado no download. Tente de novo.';
}

export const DownloadButton: React.FC<Props> = ({ url, filename, meta, compact = false }) => {
  const entry = useLibraryEntry(url);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    setConfirmDelete(false);
    setError(null);
  }, [url]);

  const start = async () => {
    if (downloading) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setProgress({ loadedBytes: 0, totalBytes: 0, percent: 0 });
    setDownloading(true);
    try {
      await downloadToLibrary(url, filename || guessFilename(url), {
        onProgress: setProgress,
        signal: controller.signal,
        meta,
      });
    } catch (err) {
      if (!controller.signal.aborted && (err as { name?: string } | null)?.name !== 'AbortError') {
        setError(friendlyError(err));
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setDownloading(false);
      setProgress(null);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  const remove = async () => {
    setConfirmDelete(false);
    await deleteLibraryEntry(url);
  };

  const cls = `lib-dl${compact ? ' lib-dl--compact' : ''}`;

  if (downloading) {
    const known = (progress?.totalBytes ?? 0) > 0;
    const pct = known ? progress?.percent ?? 0 : 0;
    const R = 15;
    const C = 2 * Math.PI * R;
    return (
      <div className={cls} role="status" aria-live="polite">
        <svg className={`lib-ring${known ? '' : ' lib-ring--spin'}`} viewBox="0 0 36 36" aria-hidden="true">
          <circle className="lib-ring__track" cx="18" cy="18" r={R} />
          <circle
            className="lib-ring__bar"
            cx="18"
            cy="18"
            r={R}
            strokeDasharray={`${known ? (C * pct) / 100 : C * 0.28} ${C}`}
            transform="rotate(-90 18 18)"
          />
        </svg>
        <div className="lib-dl__text">
          <strong>{known ? `${pct}%` : 'Baixando…'}</strong>
          {!compact && (
            <span>
              {formatBytes(progress?.loadedBytes ?? 0)}
              {known ? ` de ${formatBytes(progress?.totalBytes ?? 0)}` : ''}
            </span>
          )}
        </div>
        <button type="button" className="btn btn-ghost lib-btn-sm" onClick={cancel}>
          Cancelar
        </button>
      </div>
    );
  }

  if (entry) {
    return (
      <div className={cls}>
        <span className="lib-dl__ok">
          <span aria-hidden="true">✓</span> No aparelho · {formatBytes(entry.sizeBytes)}
        </span>
        {confirmDelete ? (
          <span className="lib-confirm" role="group" aria-label="Confirmar apagar">
            <span>Apagar?</span>
            <button type="button" className="lib-link lib-link--danger" onClick={() => void remove()}>
              Sim
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="lib-link" onClick={() => setConfirmDelete(false)}>
              Não
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost lib-btn-sm" onClick={() => setConfirmDelete(true)}>
            Apagar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cls}>
      <button type="button" className="btn btn-primary lib-btn-sm" onClick={() => void start()}>
        {compact ? 'Baixar' : 'Baixar para jogar offline'}
      </button>
      {error && (
        <p className="lib-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
