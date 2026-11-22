import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RemotePadClient,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';
import { GamepadPhoneView } from '../components/GamepadPhoneView.js';

function getSignalingUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || '127.0.0.1';
  const port = import.meta.env.VITE_SIGNALING_PORT || '8787';
  return `${proto}//${host}:${port}`;
}

interface Props {
  initialRoomCode?: string;
}

export const ControllerPage: React.FC<Props> = ({ initialRoomCode }) => {
  const [roomInput, setRoomInput] = useState(initialRoomCode ?? '');
  const [connected, setConnected] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [slot, setSlot] = useState(0);
  const [consoleId, setConsoleId] = useState<ConsoleId>('ps2');
  const [gameTitle, setGameTitle] = useState('VGFA Controller');
  const [transport, setTransport] = useState<'webrtc' | 'ws' | 'preview'>('ws');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [rumbleActive, setRumbleActive] = useState(false);

  const clientRef = useRef<RemotePadClient | null>(null);

  const connectToRoom = useCallback((code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setStatusError(null);
    clientRef.current?.dispose();

    const ua = navigator.userAgent || '';
    const deviceLabel = /iPhone|iPad/i.test(ua)
      ? 'iPhone VGFA'
      : /Android/i.test(ua)
        ? 'Android VGFA'
        : 'Celular/Navegador VGFA';

    const client = new RemotePadClient(getSignalingUrl(), clean, deviceLabel, {
      onConnected: (info) => {
        setConnected(true);
        setSlot(info.slot);
        setConsoleId(info.consoleId);
        setGameTitle(info.gameTitle);
      },
      onConsoleChanged: (nextConsole, nextTitle) => {
        setConsoleId(nextConsole);
        setGameTitle(nextTitle);
      },
      onTransportChanged: (t) => setTransport(t),
      onRumble: (cmd) => {
        setRumbleActive(true);
        setTimeout(() => setRumbleActive(false), Math.min(350, cmd.durationMs || 120));
      },
      onDisconnected: (reason) => {
        setConnected(false);
        setStatusError(reason ?? 'Desconectado da sala.');
      },
    });
    clientRef.current = client;
    client.connect();
  }, []);

  useEffect(() => {
    if (initialRoomCode) {
      connectToRoom(initialRoomCode);
    }
    return () => {
      clientRef.current?.dispose();
    };
  }, [initialRoomCode, connectToRoom]);

  const handleStateChange = useCallback((state: Omit<PadState, 'slot' | 'seq'>) => {
    clientRef.current?.sendState(state);
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
      />
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div className="modal-card" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div className="vgfa-logo">VGFA</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>VGFA Remote Pad</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Celular como Controle Adaptativo (Atari → PS2)
            </div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 16 }}>
          Digite o <strong>Código da Sala</strong> exibido na tela do jogo (ou escaneie o QR Code) para parear instantaneamente.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            connectToRoom(roomInput);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <input
            className="field mono"
            placeholder="Ex.: VGFA-7K3M"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
            style={{ textAlign: 'center', fontSize: 18, letterSpacing: '0.1em' }}
          />
          {statusError && (
            <div style={{ color: '#fb7185', fontSize: 12, textAlign: 'center' }}>{statusError}</div>
          )}
          <button className="btn btn-primary" type="submit">
            Conectar à Tela Principal
          </button>
        </form>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn btn-cyan"
            onClick={() => {
              setPreviewMode(true);
              setTransport('preview');
              setGameTitle('Modo Visualização de Controles');
            }}
          >
            Visualizar Layouts (Atari → DualShock 2)
          </button>
          <a className="btn btn-ghost" href="/">
            Voltar ao Portal VGFA
          </a>
        </div>
      </div>
    </div>
  );
};
