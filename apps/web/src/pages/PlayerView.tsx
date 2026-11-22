import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BluetoothGamepadAdapter,
  CONTROLLER_PROFILES,
  DEFAULT_KEYBOARD_MAP,
  PAD_BIT,
  RemotePadHost,
  createEmptyPadState,
  type ConnectedPadInfo,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';
import {
  CONSOLE_MAP,
  RetroPadKeyBridge,
  VgfaBuiltinArcadeEngine,
  launchLibretroWasm,
  type CatalogGame,
  type RetroWasmSession,
} from '@vgfa/runtime';
import type { VgfaSaveStore } from '@vgfa/storage';
import type { Dictionary } from '../i18n/translations.js';
import { Ps2LabPanel } from '../components/Ps2LabPanel.js';
import { QrConnectModal } from '../components/QrConnectModal.js';

function getSignalingUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || '127.0.0.1';
  const port = import.meta.env.VITE_SIGNALING_PORT || '8787';
  return `${proto}//${host}:${port}`;
}

export interface ActiveSession {
  game: CatalogGame;
  localFile?: File | null;
  remoteUrl?: string | null;
}

interface Props {
  t: Dictionary;
  session: ActiveSession;
  userId: string;
  saveStore: VgfaSaveStore;
  onBack: () => void;
}

export const PlayerView: React.FC<Props> = ({ t, session, userId, saveStore, onBack }) => {
  const { game, localFile, remoteUrl } = session;
  const consoleDef = CONSOLE_MAP[game.consoleId];
  const padProfile = CONTROLLER_PROFILES[game.consoleId];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const builtinRef = useRef<VgfaBuiltinArcadeEngine | null>(null);
  const retroRef = useRef<RetroWasmSession | null>(null);
  const hostRef = useRef<RemotePadHost | null>(null);
  const btAdapterRef = useRef(new BluetoothGamepadAdapter());
  const keyBridgeRef = useRef(new RetroPadKeyBridge());
  const keyboardMaskRef = useRef(0);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [remotePads, setRemotePads] = useState<ConnectedPadInfo[]>([]);
  const [btPads, setBtPads] = useState<ConnectedPadInfo[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [retroStatus, setRetroStatus] = useState<string | null>(null);
  const [hud, setHud] = useState<{ score: number; lives: number; stage: number; fps: number; extra?: string }>({
    score: 0,
    lives: 3,
    stage: 1,
    fps: 60,
  });
  const [livePad, setLivePad] = useState<PadState>(() => createEmptyPadState(0));

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Combina entrada unificada: Celular QR Code + Controle Bluetooth + Teclado
  const readMergedInput = useCallback((): PadState => {
    const merged = createEmptyPadState(0);
    merged.buttons = keyboardMaskRef.current;

    const btMap = btAdapterRef.current.pollAll();
    const bt0 = btMap.get(0);
    if (bt0) {
      merged.buttons |= bt0.buttons;
      if (Math.abs(bt0.lx) > Math.abs(merged.lx)) merged.lx = bt0.lx;
      if (Math.abs(bt0.ly) > Math.abs(merged.ly)) merged.ly = bt0.ly;
      if (Math.abs(bt0.rx) > Math.abs(merged.rx)) merged.rx = bt0.rx;
      if (Math.abs(bt0.ry) > Math.abs(merged.ry)) merged.ry = bt0.ry;
      merged.l2Pressure = Math.max(merged.l2Pressure, bt0.l2Pressure);
      merged.r2Pressure = Math.max(merged.r2Pressure, bt0.r2Pressure);
      merged.crossPressure = Math.max(merged.crossPressure, bt0.crossPressure);
      merged.squarePressure = Math.max(merged.squarePressure, bt0.squarePressure);
    }

    const phone0 = hostRef.current?.getLatestState(0);
    if (phone0) {
      merged.buttons |= phone0.buttons;
      if (Math.abs(phone0.lx) > Math.abs(merged.lx)) merged.lx = phone0.lx;
      if (Math.abs(phone0.ly) > Math.abs(merged.ly)) merged.ly = phone0.ly;
      if (Math.abs(phone0.rx) > Math.abs(merged.rx)) merged.rx = phone0.rx;
      if (Math.abs(phone0.ry) > Math.abs(merged.ry)) merged.ry = phone0.ry;
      merged.l2Pressure = Math.max(merged.l2Pressure, phone0.l2Pressure);
      merged.r2Pressure = Math.max(merged.r2Pressure, phone0.r2Pressure);
      merged.crossPressure = Math.max(merged.crossPressure, phone0.crossPressure);
      merged.squarePressure = Math.max(merged.squarePressure, phone0.squarePressure);
    }

    return merged;
  }, []);

  // Host do Controle Remoto via QR Code
  useEffect(() => {
    const host = new RemotePadHost(getSignalingUrl(), game.consoleId, game.title, {
      onRoomCreated: (code) => setRoomCode(code),
      onPadsChanged: (pads) => setRemotePads(pads),
      onPadInput: (state) => {
        setLivePad(state);
        if (game.mode === 'libretro-rom') {
          keyBridgeRef.current.push(state, window);
        }
      },
    });
    hostRef.current = host;
    host.connect();
    return () => {
      keyBridgeRef.current.releaseAll(window);
      host.dispose();
      hostRef.current = null;
    };
  }, [game.consoleId, game.title, game.mode]);

  // Monitor de controles Bluetooth + Teclado
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      if (game.mode === 'builtin-arcade') {
        e.preventDefault();
      }
      keyboardMaskRef.current |= bit;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      keyboardMaskRef.current &= ~bit;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const interval = setInterval(() => {
      setBtPads(btAdapterRef.current.listConnected());
      setLivePad(readMergedInput());
    }, 120);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearInterval(interval);
    };
  }, [game.mode, readMergedInput]);

  // Inicializa o motor correto conforme o modo do jogo
  useEffect(() => {
    if (game.mode === 'builtin-arcade' && canvasRef.current) {
      const engine = new VgfaBuiltinArcadeEngine(
        canvasRef.current,
        game.builtinVariant ?? 'star-drift',
        {
          getInput: readMergedInput,
          onHudUpdate: setHud,
          onRumble: (cmd) => {
            btAdapterRef.current.rumble(cmd);
            hostRef.current?.sendRumble(cmd);
          },
        },
      );
      builtinRef.current = engine;
      engine.start();
      return () => {
        engine.stop();
        builtinRef.current = null;
      };
    }

    if (game.mode === 'libretro-rom' && canvasRef.current && (localFile || remoteUrl || game.romUrl)) {
      let cancelled = false;
      setRetroStatus(`Carregando core WebAssembly (${consoleDef.libretroCore})...`);
      void launchLibretroWasm({
        consoleId: game.consoleId,
        rom: localFile ?? remoteUrl ?? game.romUrl!,
        canvas: canvasRef.current,
      })
        .then((s) => {
          if (cancelled) {
            void s.exit();
            return;
          }
          retroRef.current = s;
          setRetroStatus(null);
        })
        .catch((err) => {
          if (!cancelled) {
            setRetroStatus(
              `Erro ao iniciar core WASM: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });

      return () => {
        cancelled = true;
        void retroRef.current?.exit();
        retroRef.current = null;
      };
    }
  }, [game, localFile, remoteUrl, consoleDef.libretroCore, readMergedInput]);

  const handleSaveState = async () => {
    try {
      let bytes: Uint8Array | null = null;
      if (builtinRef.current) {
        bytes = builtinRef.current.exportState();
      } else if (retroRef.current) {
        bytes = await retroRef.current.saveState();
      }
      if (!bytes) {
        showToast('Save state indisponível neste modo.');
        return;
      }
      await saveStore.put({
        userId,
        consoleId: game.consoleId,
        gameId: game.id,
        gameTitle: game.title,
        kind: 'state',
        slot: 1,
        data: bytes,
      });
      showToast(`Estado salvo no IndexedDB (${(bytes.byteLength / 1024).toFixed(1)} KB)!`);
    } catch {
      showToast('Falha ao salvar estado.');
    }
  };

  const handleLoadState = async () => {
    const rec = await saveStore.get(userId, game.consoleId, game.id, 'state', 1);
    if (!rec) {
      showToast('Nenhum save encontrado para este jogo.');
      return;
    }
    if (builtinRef.current) {
      builtinRef.current.importState(rec.data);
      showToast('Save state restaurado!');
    } else if (retroRef.current) {
      await retroRef.current.loadState(rec.data);
      showToast('Save state RetroArch restaurado!');
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    builtinRef.current?.setMuted(next);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    builtinRef.current?.setPaused(next);
    if (retroRef.current) {
      if (next) retroRef.current.pause();
      else retroRef.current.resume();
    }
  };

  const switchConsolePreview = (nextId: ConsoleId) => {
    hostRef.current?.setActiveConsole(nextId, game.title);
    showToast(`Skin do celular alterada ao vivo para ${CONTROLLER_PROFILES[nextId].title}!`);
  };

  return (
    <div className="vgfa-shell">
      <div className="player-layout">
        {/* Stage Principal */}
        <div className="stage-box">
          <div className="stage-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={onBack}>
                ← {t.backHome}
              </button>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{game.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  {consoleDef.name} • {padProfile.title}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => setShowQr(true)}>
                📱 {t.connectPhone} {roomCode ? `(${roomCode})` : ''}
              </button>
              {game.mode !== 'ps2-webgpu-lab' && (
                <>
                  <button className="btn btn-sm btn-cyan" onClick={() => void handleSaveState()}>
                    💾 {t.saveState}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void handleLoadState()}>
                    ↺ {t.loadState}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={togglePause}>
                    {paused ? '▶ Retomar' : '⏸ Pausar'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={toggleMute}>
                    {muted ? '🔇 Mudo' : '🔊 Som'}
                  </button>
                </>
              )}
            </div>
          </div>

          {game.mode === 'ps2-webgpu-lab' ? (
            <Ps2LabPanel initialFile={localFile} initialUrl={remoteUrl} />
          ) : (
            <div className="stage-canvas-wrap">
              <canvas ref={canvasRef} />
              {retroStatus && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(7, 8, 13, 0.85)',
                    display: 'grid',
                    placeItems: 'center',
                    padding: 20,
                    textAlign: 'center',
                    fontSize: 14,
                  }}
                >
                  {retroStatus}
                </div>
              )}
            </div>
          )}

          <div className="hud-strip">
            {game.mode === 'builtin-arcade' ? (
              <>
                <span>
                  SCORE: <strong style={{ color: 'var(--amber)' }}>{hud.score}</strong> • VIDAS:{' '}
                  <strong>{hud.lives}</strong> • FASE: <strong>{hud.stage}</strong>
                  {hud.extra ? ` • ${hud.extra}` : ''}
                </span>
                <span className="mono">{hud.fps} FPS</span>
              </>
            ) : (
              <>
                <span>Motor: {consoleDef.engineTier}</span>
                <span>Teclado: Setas/WASD + Z/X/C/V + Enter</span>
              </>
            )}
          </div>
        </div>

        {/* Sidebar de Controles, QR Code e Telemetria */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {toast && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(52, 211, 153, 0.16)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                color: '#a7f3d0',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {toast}
            </div>
          )}

          <div className="panel">
            <strong style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
              📱 Celular como Controle
            </strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.45 }}>
              Sala ativa:{' '}
              <span className="mono" style={{ color: 'var(--amber)', fontWeight: 700 }}>
                {roomCode ?? 'Conectando...'}
              </span>
              <br />
              Celulares pareados: <strong>{remotePads.length}/4</strong>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setShowQr(true)}>
                Exibir QR Code
              </button>
              {roomCode && (
                <a
                  className="btn btn-sm btn-cyan"
                  href={`/pad/${roomCode}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir Pad ↗
                </a>
              )}
            </div>
          </div>

          <div className="panel">
            <strong style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
              🎮 Controle Bluetooth / USB
            </strong>
            {btPads.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {btPads.map((p) => (
                  <div key={p.id} style={{ fontSize: 12, color: '#34d399' }}>
                    ✓ P{p.slot + 1}: {p.label}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
                {t.noBluetoothYet}
              </div>
            )}
          </div>

          <div className="panel">
            <strong style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
              Telemetria de Input (16-Byte Binário)
            </strong>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.7 }}>
              L-Stick: ({livePad.lx.toFixed(2)}, {livePad.ly.toFixed(2)})
              <br />
              R-Stick: ({livePad.rx.toFixed(2)}, {livePad.ry.toFixed(2)})
              <br />
              Pressão L2/R2: {Math.round(livePad.l2Pressure * 100)}% /{' '}
              {Math.round(livePad.r2Pressure * 100)}%
              <br />
              Mask: 0x{livePad.buttons.toString(16).padStart(4, '0').toUpperCase()}
              {livePad.buttons & PAD_BIT.SOUTH ? ' [×/A]' : ''}
              {livePad.buttons & PAD_BIT.EAST ? ' [○/B]' : ''}
              {livePad.buttons & PAD_BIT.START ? ' [START]' : ''}
            </div>

            {remotePads.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>
                  Testar troca ao vivo de skin no celular:
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['atari2600', 'nes', 'snes', 'ps1', 'ps2'] as ConsoleId[]).map((cid) => (
                    <button
                      key={cid}
                      className="btn btn-sm btn-ghost"
                      onClick={() => switchConsolePreview(cid)}
                    >
                      {cid.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showQr && (
        <QrConnectModal
          t={t}
          roomCode={roomCode}
          connectedPads={remotePads}
          bluetoothPads={btPads}
          onClose={() => setShowQr(false)}
        />
      )}
    </div>
  );
};
