import React, { useEffect, useRef, useState } from 'react';
import {
  BluetoothGamepadAdapter,
  DEFAULT_KEYBOARD_MAP,
  createEmptyPadState,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';
import { MobileInlinePad } from '../components/MobileInlinePad.js';
import { VgfaCastViewer } from '../services/vgfa-cast.js';

interface Props {
  initialCastCode?: string;
}

export const WatchPage: React.FC<Props> = ({ initialCastCode }) => {
  const [codeInput, setCodeInput] = useState(initialCastCode ?? '');
  const [activeCode, setActiveCode] = useState(initialCastCode ?? '');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>(
    initialCastCode ? 'connecting' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [gameTitle, setGameTitle] = useState('VGFA-Cast 60 FPS');
  const [consoleId, setConsoleId] = useState<ConsoleId>('ps2');
  const [showPad, setShowPad] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerRef = useRef<VgfaCastViewer | null>(null);
  const kbMaskRef = useRef(0);
  const btRef = useRef(new BluetoothGamepadAdapter());

  useEffect(() => {
    if (!activeCode) return;
    setStatus('connecting');
    setError(null);

    const viewer = new VgfaCastViewer(activeCode, {
      onJoined: (info) => {
        setConsoleId(info.consoleId);
        setGameTitle(info.gameTitle);
      },
      onStream: (stream) => {
        setStatus('live');
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      },
      onError: (msg) => {
        setStatus('error');
        setError(msg);
      },
    });
    viewerRef.current = viewer;
    viewer.connect();

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [activeCode]);

  // Suporte a teclado e controle Bluetooth também no modo VGFA-Cast!
  useEffect(() => {
    if (status !== 'live') return;
    const onDown = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      e.preventDefault();
      kbMaskRef.current |= bit;
      viewerRef.current?.sendPad({ ...createEmptyPadState(0), buttons: kbMaskRef.current });
    };
    const onUp = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      e.preventDefault();
      kbMaskRef.current &= ~bit;
      viewerRef.current?.sendPad({ ...createEmptyPadState(0), buttons: kbMaskRef.current });
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);

    const btTimer = setInterval(() => {
      const bt0 = btRef.current.pollAll().get(0);
      if (bt0) viewerRef.current?.sendPad(bt0);
    }, 16);

    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      clearInterval(btTimer);
    };
  }, [status]);

  const handleTouchPad = (state: PadState) => {
    viewerRef.current?.sendPad(state);
  };

  if (!activeCode) {
    return (
      <div className="vgfa-shell" style={{ maxWidth: 480, paddingTop: 48 }}>
        <div className="panel" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0 }}>📡 VGFA-Cast — Jogar por Streaming 60 FPS</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-1)' }}>
            Digite o código da transmissão enviado pelo seu amigo (ex: <code>CAST-A7K2</code>) para jogar direto na tela sem baixar nenhum arquivo!
          </p>
          <input
            className="input mono"
            placeholder="CAST-XXXX"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn-primary"
            disabled={!codeInput.trim()}
            onClick={() => setActiveCode(codeInput.trim())}
          >
            ▶ Conectar na Transmissão
          </button>
          <a className="btn btn-ghost" href={import.meta.env.BASE_URL}>
            ← Voltar para a Loja VGFA
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-player-shell">
      <div className="mobile-stage-bar">
        <a className="btn btn-sm btn-ghost" href={import.meta.env.BASE_URL}>
          ← Loja
        </a>
        <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📡 {gameTitle} ({activeCode})
        </strong>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowPad((v) => !v)}>
          {showPad ? '🎮 Ocultar Pad' : '🎮 Mostrar Pad'}
        </button>
      </div>

      <div className="mobile-screen-area">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        />

        {status !== 'live' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(7, 8, 13, 0.92)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 20,
              textAlign: 'center',
            }}
          >
            {status === 'error' ? (
              <>
                <strong style={{ color: '#fb7185' }}>{error || 'Transmissão encerrada.'}</strong>
                <button className="btn btn-sm btn-primary" onClick={() => setActiveCode('')}>
                  Tentar Outro Código
                </button>
              </>
            ) : (
              <>
                <strong>Conectando ao vídeo 60 FPS (WebRTC)...</strong>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  0 MB baixados • Controle 16 bytes pronto
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {showPad && <MobileInlinePad consoleId={consoleId} onStateChange={handleTouchPad} />}
    </div>
  );
};
