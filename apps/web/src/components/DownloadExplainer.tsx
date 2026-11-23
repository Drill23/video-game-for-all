import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  VGFA_DOWNLOAD_STARTED_EVENT,
  emitDownloadStarted,
  getStorageInfo,
  requestPersistentStorage,
  type DownloadStartedInfo,
} from '@vgfa/runtime';
import '../styles/library.css';

const HIDE_KEY = 'vgfa:hide-download-explainer';
const SEEN_KEY = 'vgfa:download-explained';

/**
 * Avisa a interface que um jogo NOVO começou a ser guardado neste aparelho.
 * Para ROMs o `downloadToLibrary` já chama isto sozinho; para discos PS2 o PlayerView chama
 * (quando `registerPs2Disc` disser `alreadyOnDevice: false`).
 */
export function notifyDownloadStarted(info: DownloadStartedInfo): void {
  emitDownloadStarted(info);
}

// ==================== Aparelho / navegador ====================

/** "neste iPad · Safari", "neste Fire TV", "neste Windows · Chrome"... */
export function describeDevice(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  platform: string = typeof navigator !== 'undefined' ? navigator.platform || '' : '',
  touchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
): string {
  let browser = '';
  if (/Silk\//.test(ua)) browser = 'Silk';
  else if (/EdgA?\/|Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  if (/\bAFT[A-Z0-9]+\b/.test(ua)) return 'neste Fire TV';
  if (/Tizen|Web0S|WebOS|SMART-TV|SmartTV|HbbTV|BRAVIA|Android TV|GoogleTV/i.test(ua)) {
    return browser ? `nesta TV · ${browser}` : 'nesta TV';
  }
  const withBrowser = (device: string) => (browser ? `${device} · ${browser}` : device);
  if (/iPad/.test(ua) || (/Macintosh|MacIntel/.test(ua + platform) && touchPoints > 1)) return withBrowser('neste iPad');
  if (/iPhone|iPod/.test(ua)) return withBrowser('neste iPhone');
  if (/Android/.test(ua)) return withBrowser(/Mobile/.test(ua) ? 'neste celular' : 'neste tablet');
  if (/CrOS/.test(ua)) return withBrowser('neste Chromebook');
  if (/Windows/.test(ua)) return withBrowser('neste Windows');
  if (/Macintosh|Mac OS X/.test(ua)) return withBrowser('neste Mac');
  if (/Linux|X11/.test(ua)) return withBrowser('neste Linux');
  return browser ? `neste aparelho · ${browser}` : 'neste aparelho';
}

function isSafariLike(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Safari\//.test(ua) && !/Chrome\/|Chromium|Edg\/|OPR\/|Android/.test(ua);
}

// ==================== Memória do que já foi mostrado ====================

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(list: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // sem localStorage: pode repetir, não é grave
  }
}

function isHiddenForever(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function seenKey(info: DownloadStartedInfo): string {
  return `${info.kind}:${info.title.trim().toLowerCase()}`;
}

// ==================== Host ====================

/** Monte UMA vez no App. Mostra o aviso do primeiro download (no máximo 1x por jogo por aparelho). */
export const DownloadExplainerHost: React.FC = () => {
  const [queue, setQueue] = useState<DownloadStartedInfo[]>([]);
  const [dontShow, setDontShow] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [protectMsg, setProtectMsg] = useState<string | null>(null);
  const device = useRef<string>('');
  const okRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onStarted = (ev: Event) => {
      const info = (ev as CustomEvent<DownloadStartedInfo>).detail;
      if (!info || typeof info.title !== 'string' || isHiddenForever()) return;
      const key = seenKey(info);
      const seen = readSeen();
      if (seen.includes(key)) return;
      writeSeen([...seen, key]);
      setQueue((q) => [...q, info]);
    };
    window.addEventListener(VGFA_DOWNLOAD_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(VGFA_DOWNLOAD_STARTED_EVENT, onStarted);
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) return undefined;
    device.current = describeDevice();
    setDontShow(false);
    setProtectMsg(null);
    let alive = true;
    void getStorageInfo().then((i) => {
      if (alive) setPersisted(i.persisted);
    });
    okRef.current?.focus();
    return () => {
      alive = false;
    };
  }, [current]);

  const close = useCallback(() => {
    if (dontShow) {
      try {
        localStorage.setItem(HIDE_KEY, '1');
      } catch {
        // ignora
      }
      setQueue([]);
    } else {
      setQueue((q) => q.slice(1));
    }
  }, [dontShow]);

  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, close]);

  if (!current) return null;

  const where = device.current || 'neste aparelho';
  const what = current.kind === 'ps2-disc' ? 'O disco' : 'O jogo';

  const openLibrary = () => {
    window.dispatchEvent(new CustomEvent('vgfa:navigate', { detail: { tab: 'library' } }));
    close();
  };

  const protect = async () => {
    const ok = await requestPersistentStorage();
    setPersisted(ok);
    setProtectMsg(ok ? null : 'Este navegador não quis proteger agora. Instalar o site na tela inicial ajuda.');
  };

  return (
    <div className="dlx-wrap" role="presentation">
      <div className="dlx-card" role="dialog" aria-modal="false" aria-labelledby="dlx-title" aria-describedby="dlx-body">
        <button type="button" className="dlx-x" aria-label="Fechar aviso" onClick={close}>
          ×
        </button>
        <h2 id="dlx-title" className="dlx-title">
          <span aria-hidden="true">📦</span> Baixando uma vez só
        </h2>
        <div id="dlx-body" className="dlx-body">
          <p>
            <strong>{current.title}</strong> fica guardado {where}. {what} não precisa ser baixado de novo: pode fechar o link, na
            próxima vez ele abre na hora.
          </p>
          <p>
            <span aria-hidden="true">🗑️</span> Quer liberar espaço depois? Vá em <strong>Minha Central</strong> → toque no jogo →{' '}
            <strong>Apagar</strong>.
          </p>
          {persisted === false && (
            <p>
              <span aria-hidden="true">🛡️</span> Toque em <strong>Proteger meus jogos</strong> para o navegador não apagar sozinho
              quando faltar espaço.
            </p>
          )}
          {persisted === true && (
            <p className="dlx-ok">
              <span aria-hidden="true">🛡️</span> Seus jogos já estão protegidos neste navegador ✓
            </p>
          )}
          {protectMsg && <p className="dlx-note">{protectMsg}</p>}
          <p className="dlx-note">
            Limpar os dados do navegador também apaga os jogos e saves.
            {isSafariLike() ? ' No Safari, adicionar o site à Tela de Início ajuda a manter os jogos.' : ''}
          </p>
        </div>
        <div className="dlx-actions">
          <button type="button" className="btn btn-primary lib-btn-sm" onClick={openLibrary}>
            Abrir Minha Central
          </button>
          {persisted === false && (
            <button type="button" className="btn lib-btn-sm" onClick={() => void protect()}>
              Proteger meus jogos
            </button>
          )}
          <button ref={okRef} type="button" className="btn btn-ghost lib-btn-sm" onClick={close}>
            Entendi
          </button>
        </div>
        <label className="dlx-check">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          Não mostrar de novo
        </label>
      </div>
    </div>
  );
};
