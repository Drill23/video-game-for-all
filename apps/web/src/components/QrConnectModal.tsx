import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { ConnectedPadInfo } from '@vgfa/pad';
import type { Dictionary } from '../i18n/translations.js';

interface Props {
  t: Dictionary;
  roomCode: string | null;
  connectedPads: ConnectedPadInfo[];
  bluetoothPads: ConnectedPadInfo[];
  onClose: () => void;
}

export const QrConnectModal: React.FC<Props> = ({
  t,
  roomCode,
  connectedPads,
  bluetoothPads,
  onClose,
}) => {
  const [padUrl, setPadUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const resolveUrl = async () => {
      let base = window.location.origin;
      // Quando rodando em localhost no PC/Mac, descobre o IP real da rede Wi-Fi
      // para que o celular escaneie o QR Code e conecte direto na LAN!
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
          const res = await fetch('/api/network-info');
          if (res.ok) {
            const info = (await res.json()) as { lanIp?: string };
            if (info.lanIp && info.lanIp !== '127.0.0.1') {
              base = `${window.location.protocol}//${info.lanIp}:${window.location.port || 5173}`;
            }
          }
        } catch {
          // mantém origin atual
        }
      }

      const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const full = roomCode
        ? `${base}${basePath}/#/pad/${roomCode}`
        : `${base}${basePath}/#/pad`;
      if (!active) return;
      setPadUrl(full);

      try {
        const png = await QRCode.toDataURL(full, {
          width: 240,
          margin: 2,
          color: { dark: '#07080D', light: '#FFFFFF' },
        });
        if (active) setQrDataUrl(png);
      } catch {
        // ignora
      }
    };
    void resolveUrl();
    return () => {
      active = false;
    };
  }, [roomCode]);

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const localTestUrl = roomCode
    ? `${window.location.origin}${basePath}/#/pad/${roomCode}`
    : `${window.location.origin}${basePath}/#/pad`;

  const allPads = [...connectedPads, ...bluetoothPads];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t.qrTitle}</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {t.qrHint}
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: 18,
            borderRadius: 14,
            background: 'var(--bg-0)',
            border: '1px solid var(--border)',
          }}
        >
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR Code VGFA Controller"
              style={{ width: 204, height: 204, borderRadius: 12 }}
            />
          ) : (
            <div style={{ width: 204, height: 204, display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
              Gerando QR...
            </div>
          )}

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase' }}>
              {t.roomCode}
            </div>
            <div
              className="mono"
              style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)', letterSpacing: '0.08em' }}
            >
              {roomCode ?? 'CONECTANDO...'}
            </div>
          </div>

          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text-2)',
              wordBreak: 'break-all',
              textAlign: 'center',
            }}
          >
            {padUrl}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              className="btn btn-sm btn-cyan"
              onClick={() => {
                void navigator.clipboard?.writeText(padUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? 'Link Copiado!' : 'Copiar Link'}
            </button>
            <a
              className="btn btn-sm btn-primary"
              href={localTestUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t.openPadTab}
            </a>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
            {t.connectedPads} ({allPads.length}/4)
          </div>
          {allPads.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Aguardando celular via QR Code ou controle Bluetooth...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allPads.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-0)',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                  }}
                >
                  <span>
                    <strong style={{ color: 'var(--amber)' }}>P{p.slot + 1}</strong> • {p.label}
                  </span>
                  <span className="badge">{p.kind}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
