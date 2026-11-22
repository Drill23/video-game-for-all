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

  const loadStatus = async () => {
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

  useEffect(() => {
    if (!publicUrl) {
      setQrPng('');
      return;
    }
    void QRCode.toDataURL(publicUrl, {
      width: 210,
      margin: 2,
      color: { dark: '#07080D', light: '#FFFFFF' },
    }).then(setQrPng);
  }, [publicUrl]);

  const handleStart = async () => {
    setStatus('starting');
    setError(null);
    try {
      const res = await globalThis.fetch('/api/tunnel/start', { method: 'POST' });
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
      setError(err instanceof Error ? err.message : 'Falha ao iniciar link público.');
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
      <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🌐 Compartilhar Link Público Mundial</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>
          Gere um link <strong>HTTPS seguro</strong> (via Cloudflare Tunnel) para enviar no WhatsApp para qualquer pessoa no mundo. Quem abrir no celular, PC ou Smart TV pode jogar na hora — inclusive usando o celular como controle pelo 4G/5G!
        </p>

        {status === 'running' && publicUrl ? (
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
            }}
          >
            <span className="badge" style={{ background: '#10b981', color: '#042f2e', borderColor: 'transparent' }}>
              ● Link Público Ativo
            </span>

            {qrPng && (
              <img
                src={qrPng}
                alt="QR Code Link Público VGFA"
                style={{ width: 185, height: 185, borderRadius: 12, background: '#fff', padding: 4 }}
              />
            )}

            <div className="mono" style={{ fontSize: 13, color: 'var(--amber)', wordBreak: 'break-all', fontWeight: 700 }}>
              {publicUrl}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(publicUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? '✓ Link Copiado!' : '📋 Copiar Link'}
              </button>
              <a className="btn btn-cyan" href={publicUrl} target="_blank" rel="noreferrer">
                Abrir Link ↗
              </a>
              <button className="btn btn-ghost" style={{ color: '#fb7185' }} onClick={() => void handleStop()}>
                Desligar Link
              </button>
            </div>
          </div>
        ) : (
          <div className="panel" style={{ background: 'var(--bg-0)', textAlign: 'center' }}>
            {error && (
              <div style={{ color: '#fb7185', fontSize: 12, marginBottom: 12 }}>{error}</div>
            )}
            <button
              className="btn btn-primary"
              style={{ padding: '13px 24px', fontSize: 14, width: '100%' }}
              disabled={status === 'starting'}
              onClick={() => void handleStart()}
            >
              {status === 'starting'
                ? '⏳ Criando túnel HTTPS na Cloudflare...'
                : '🚀 Gerar Link Público Agora (Grátis • HTTPS)'}
            </button>
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
          <strong>Para deixar no ar 24h (mesmo com seu Mac desligado):</strong> o repositório{' '}
          <code>Drill23/video-game-for-all</code> já está pronto para subir em 1 clique no{' '}
          <strong>Render</strong>, <strong>Fly.io</strong> ou <strong>Railway</strong> com{' '}
          <code className="mono">pnpm build &amp;&amp; pnpm start:prod</code> (porta única com HTTPS, WebSocket <code>/ws</code> e headers <code>COOP/COEP</code>).
        </div>
      </div>
    </div>
  );
};
