import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  onClose: () => void;
}

export const ShareLinkModal: React.FC<Props> = ({ onClose }) => {
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string>('');
  const [copied, setCopied] = useState(false);

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
      <div className="modal-card" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🌐 Link Público Fixo (Sem Precisar do Mac Ligado!)</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>
          Envie o link permanente abaixo para qualquer pessoa (iPad, tablet Android, celular ou PC). Ele roda <strong>24h grátis para sempre no GitHub Pages</strong> — mesmo com o seu Mac completamente desligado!
        </p>

        <div
          className="panel"
          style={{
            background: 'var(--bg-0)',
            borderColor: 'var(--emerald)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            textAlign: 'center',
            marginBottom: 14,
          }}
        >
          <span className="badge" style={{ background: '#10b981', color: '#042f2e', borderColor: 'transparent' }}>
            ● {status === 'running' && publicUrl ? 'Túnel Cloudflare Ativo' : 'Link Permanente 24/7 • Grátis para Sempre'}
          </span>

          {qrPng && (
            <img
              src={qrPng}
              alt="QR Code Link Público VGFA"
              style={{ width: 185, height: 185, borderRadius: 12, background: '#fff', padding: 4 }}
            />
          )}

          <div className="mono" style={{ fontSize: 13, color: 'var(--amber)', wordBreak: 'break-all', fontWeight: 700 }}>
            {shareTargetUrl}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(shareTargetUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? '✓ Link Copiado!' : '📋 Copiar Link'}
            </button>
            <a className="btn btn-cyan" href={shareTargetUrl} target="_blank" rel="noreferrer">
              Abrir Link ↗
            </a>
            {status === 'running' && publicUrl && (
              <button className="btn btn-ghost" style={{ color: '#fb7185' }} onClick={() => void handleStop()}>
                Desligar Túnel Mac
              </button>
            )}
          </div>
        </div>

        {!isAlreadyPublic && status !== 'running' && (
          <div className="panel" style={{ background: 'var(--bg-0)', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
              Quer também compartilhar o <strong>servidor Hyper-Stream do seu Mac</strong> agora (para streaming instantâneo de 4 GB)?
            </div>
            {error && <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button
              className="btn btn-sm btn-ghost"
              disabled={status === 'starting'}
              onClick={() => void handleStart()}
            >
              {status === 'starting' ? '⏳ Criando túnel Cloudflare...' : '⚡ Criar Túnel Temporário do Mac (Cloudflare)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
