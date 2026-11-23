import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RemotePadClient, type ConsoleId, type PadState, type PadTransport } from '@vgfa/pad';
import { GamepadPhoneView } from '../components/GamepadPhoneView.js';
import '../styles/pad.css';

function getSignalingUrl(): string {
  if (/\.github\.io$/i.test(window.location.hostname)) return 'serverless';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function normalizeCode(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return '';
  return clean.startsWith('VGFA-') ? clean : `VGFA-${clean.replace(/^VGFA/, '')}`;
}

interface Props {
  initialRoomCode?: string;
}

export const ControllerPage: React.FC<Props> = ({ initialRoomCode }) => {
  const [roomInput, setRoomInput] = useState(initialRoomCode ?? '');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [slot, setSlot] = useState(0);
  const [consoleId, setConsoleId] = useState<ConsoleId>('snes');
  const [gameTitle, setGameTitle] = useState('VGFA');
  const [transport, setTransport] = useState<PadTransport | 'preview'>('relay');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [rumbleActive, setRumbleActive] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const clientRef = useRef<RemotePadClient | null>(null);

  const connectToRoom = useCallback((code: string) => {
    const clean = normalizeCode(code);
    if (!clean) return;
    setStatusError(null);
    setConnecting(true);
    setStatusText('Conectando…');
    clientRef.current?.dispose();

    const ua = navigator.userAgent || '';
    const deviceLabel = /iPhone/i.test(ua)
      ? 'iPhone'
      : /iPad/i.test(ua)
        ? 'iPad'
        : /Android/i.test(ua)
          ? 'Android'
          : 'Navegador';

    const client = new RemotePadClient(getSignalingUrl(), clean, deviceLabel, {
      onConnected: (info) => {
        setConnected(true);
        setConnecting(false);
        setStatusText(null);
        setSlot(info.slot);
        setConsoleId(info.consoleId);
        setGameTitle(info.gameTitle);
      },
      onConsoleChanged: (nextConsole, nextTitle) => {
        setConsoleId(nextConsole);
        setGameTitle(nextTitle);
      },
      onTransportChanged: (t) => setTransport(t),
      onStatus: (text) => setStatusText(text),
      onLatency: (ms) => setLatencyMs(ms),
      onRumble: (cmd) => {
        setRumbleActive(true);
        setTimeout(() => setRumbleActive(false), Math.min(350, cmd.durationMs || 120));
      },
      onDisconnected: (reason) => {
        setConnected(false);
        setConnecting(false);
        setStatusText(null);
        setStatusError(reason ?? 'Desconectado da sala.');
      },
    });
    clientRef.current = client;
    client.connect();
    try {
      localStorage.setItem('vgfa:last-pad-room', clean);
    } catch {}
  }, []);

  useEffect(() => {
    if (initialRoomCode) connectToRoom(initialRoomCode);
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [initialRoomCode, connectToRoom]);

  const handleStateChange = useCallback((state: Omit<PadState, 'slot' | 'seq'>) => {
    clientRef.current?.sendState(state);
  }, []);

  const leave = useCallback(() => {
    clientRef.current?.dispose();
    clientRef.current = null;
    setConnected(false);
    setConnecting(false);
    setPreviewMode(false);
  }, []);

  if (connected || previewMode) {
    return (
      <GamepadPhoneView
        consoleId={consoleId}
        gameTitle={gameTitle}
        slot={slot}
        transport={previewMode ? 'preview' : transport}
        rumbleActive={rumbleActive}
        onStateChange={handleStateChange}
        onConsolePreviewChange={previewMode ? setConsoleId : undefined}
        onExit={leave}
        notice={previewMode ? null : statusText}
        latencyMs={previewMode ? null : latencyMs}
      />
    );
  }

  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  let lastRoom = '';
  try {
    lastRoom = localStorage.getItem('vgfa:last-pad-room') || '';
  } catch {}

  return (
    <div className="vc-screen">
      <div className="vp-ambient" aria-hidden />
      <div className="vc-card">
        <div className="vc-brand">
          <img src={`${basePath}/icons/icon.svg`} alt="" width={48} height={48} onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div>
            <strong>Controle VGFA</strong>
            <span>Seu celular vira o controle do jogo</span>
          </div>
        </div>

        {connecting ? (
          <div className="vc-wait">
            <div className="vc-spinner" />
            <p>{statusText ?? 'Conectando…'}</p>
            <small>Código {normalizeCode(roomInput) || roomInput}</small>
            <button className="vc-btn ghost" onClick={leave}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <p className="vc-help">
              Digite o <b>código da sala</b> que aparece na tela do jogo — ou escaneie o QR Code com a câmera.
            </p>
            <form
              className="vc-form"
              onSubmit={(e) => {
                e.preventDefault();
                connectToRoom(roomInput);
              }}
            >
              <input
                className="vc-input"
                placeholder="VGFA-7K3M"
                value={roomInput}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              />
              {statusError && <div className="vc-error">{statusError}</div>}
              <button className="vc-btn primary" type="submit" disabled={!roomInput.trim()}>
                Conectar
              </button>
              {lastRoom && lastRoom !== normalizeCode(roomInput) && (
                <button type="button" className="vc-btn ghost" onClick={() => {
                  setRoomInput(lastRoom);
                  connectToRoom(lastRoom);
                }}>
                  Reconectar em {lastRoom}
                </button>
              )}
            </form>
          </>
        )}

        <div className="vc-foot">
          <button
            className="vc-btn ghost"
            onClick={() => {
              setPreviewMode(true);
              setTransport('preview');
              setGameTitle('Teste os controles');
            }}
          >
            Testar layouts dos controles
          </button>
          <a className="vc-link" href={`${basePath}/`}>
            Voltar para a Central
          </a>
        </div>
      </div>
    </div>
  );
};
