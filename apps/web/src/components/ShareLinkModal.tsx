import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon } from './Icon.js';
import { useDialog } from './useDialog.js';

interface Props {
  onClose: () => void;
}

export const ShareLinkModal: React.FC<Props> = ({ onClose }) => {
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useDialog(onClose);

  const PERMANENT_GH_PAGES_URL = 'https://drill23.github.io/video-game-for-all/';
  const isAlreadyPublic =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !/^192\.168\.|^10\.|^172\./.test(window.location.hostname);

  const loadStatus = async () => {
    if (isAlreadyPublic) return;
    try {
      const res = await globalThis.fetch('/api/tunnel/status');
      if (res.ok) {
        const data = (await res.json()) as {
          status: 'stopped' | 'starting' | 'running' | 'error';
          url: string | null;
          error?: string | null;
        };
        setStatus(data.status);
        setPublicUrl(data.url);
        setError(data.error ?? null);
      }
    } catch {
      // ignora
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const shareTargetUrl = publicUrl || (isAlreadyPublic ? window.location.origin + window.location.pathname : PERMANENT_GH_PAGES_URL);

  useEffect(() => {
    void QRCode.toDataURL(shareTargetUrl, {
      width: 210,
      margin: 2,
      color: { dark: '#07080D', light: '#FFFFFF' },
    }).then(setQrPng);
  }, [shareTargetUrl]);

  const handleStart = async () => {
    setStatus('starting');
    setError(null);
    try {
      const res = await globalThis.fetch('/api/tunnel/start', { method: 'POST' });
      if (!res.ok) throw new Error('Túnel local disponível apenas quando rodando no Mac/PC.');
      const data = (await res.json()) as {
        status: 'stopped' | 'starting' | 'running' | 'error';
        url: string | null;
        error?: string;
      };
      setStatus(data.status);
      setPublicUrl(data.url);
      setError(data.error ?? null);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Falha ao iniciar túnel.');
    }
  };

  const handleStop = async () => {
    await globalThis.fetch('/api/tunnel/stop', { method: 'POST' }).catch(() => {});
    setStatus('stopped');
    setPublicUrl(null);
    setError(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 540 }}
        role="dialog"
        aria-modal="true"
        aria-label="Link público"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grabber" />
        <div className="modal-head">
          <h3>Link Público Fixo</h3>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={16} />
          </button>
        </div>

        <p className="lead">
          Envie o link permanente abaixo para qualquer pessoa (iPad, tablet Android, celular ou PC). Ele roda <strong>24h grátis para sempre no GitHub Pages</strong>, mesmo com o seu Mac completamente desligado.
        </p>

        <div className="qr-box" style={{ marginBottom: 14 }}>
          <span className="badge pill-ok">
            ● {status === 'running' && publicUrl ? 'Túnel Cloudflare Ativo' : 'Link permanente 24/7 • Grátis'}
          </span>

          {qrPng && (
            <img
              className="qr-img"
              src={qrPng}
              alt="QR Code Link Público VGFA"
              width={185}
              height={185}
            />
          )}

          <div className="mono" style={{ fontSize: 13, color: 'var(--accent)', wordBreak: 'break-all', fontWeight: 700 }}>
            {shareTargetUrl}
          </div>

          <div className="hstack" style={{ justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(shareTargetUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
            <a className="btn btn-cyan" href={shareTargetUrl} target="_blank" rel="noreferrer">
              Abrir link ↗
            </a>
            {status === 'running' && publicUrl && (
              <button className="btn btn-danger" onClick={() => void handleStop()}>
                Desligar túnel do Mac
              </button>
            )}
          </div>
        </div>

        {!isAlreadyPublic && status !== 'running' && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 10, lineHeight: 1.5 }}>
              Quer também compartilhar o <strong>servidor Hyper-Stream do seu Mac</strong> agora (para streaming instantâneo de 4 GB)?
            </div>
            {error && <div className="notice notice-err">{error}</div>}
            <button
              className="btn btn-sm"
              disabled={status === 'starting'}
              onClick={() => void handleStart()}
            >
              {status === 'starting' ? 'Criando túnel Cloudflare...' : 'Criar túnel temporário do Mac (Cloudflare)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
