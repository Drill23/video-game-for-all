import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  BluetoothGamepadAdapter,
  CONTROLLER_PROFILES,
  DEFAULT_KEYBOARD_MAP,
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
  buildEmulatorJsSrcDoc,
  fetchRomAsFile,
  type BuiltinVariant,
  type DownloadProgress,
} from '@vgfa/runtime';
import type { VgfaSaveStore } from '@vgfa/storage';
import type { Dictionary } from '../i18n/translations.js';
import { Ps2LabPanel } from '../components/Ps2LabPanel.js';
import { QrConnectModal } from '../components/QrConnectModal.js';
import { MobileInlinePad } from '../components/MobileInlinePad.js';
import { VgfaCastHost } from '../services/vgfa-cast.js';

function detectMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const uaMobile = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent || '');
  if (uaMobile) return true;
  // Em desktop/Mac (mesmo com janela reduzida), mantém modo Desktop (QR Code + Bluetooth)
  // e só ativa modo celular automaticamente se houver touch real em tela estreita (<= 560px)
  const hasTouch = (navigator.maxTouchPoints ?? 0) > 0;
  return hasTouch && window.innerWidth <= 560;
}

function getSignalingUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Usa /ws na mesma origem/porta — funciona em localhost, LAN e qualquer link HTTPS público (4G/5G)!
  return `${proto}//${window.location.host}/ws`;
}

export type PlayerMode = 'emulatorjs-rom' | 'ps2-webgpu-lab' | 'builtin-arcade';

export interface ActiveSession {
  id: string;
  title: string;
  consoleId: ConsoleId;
  serial?: string;
  coverUrl?: string;
  mode: PlayerMode;
  builtinVariant?: BuiltinVariant;
  localFile?: File | null;
  remoteUrl?: string | null;
  romFilename?: string;
}

interface Props {
  t: Dictionary;
  session: ActiveSession;
  userId: string;
  saveStore: VgfaSaveStore;
  onBack: () => void;
}

export const PlayerView: React.FC<Props> = ({ t, session, userId, saveStore, onBack }) => {
  const consoleDef = CONSOLE_MAP[session.consoleId];
  const padProfile = CONTROLLER_PROFILES[session.consoleId];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ps2IframeRef = useRef<HTMLIFrameElement | null>(null);
  const castHostRef = useRef<VgfaCastHost | null>(null);
  const builtinRef = useRef<VgfaBuiltinArcadeEngine | null>(null);
  const hostRef = useRef<RemotePadHost | null>(null);
  const btAdapterRef = useRef(new BluetoothGamepadAdapter());
  const keyBridgeRef = useRef(new RetroPadKeyBridge());
  const keyboardMaskRef = useRef(0);

  // ETAPA PRÉ-JOGO: pede para conectar Celular (QR Code) ou Bluetooth ANTES de iniciar!
  const [started, setStarted] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() => detectMobileDevice());
  const [showMobileTouchPad, setShowMobileTouchPad] = useState<boolean>(() => detectMobileDevice());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [padUrl, setPadUrl] = useState<string>('');
  const [remotePads, setRemotePads] = useState<ConnectedPadInfo[]>([]);
  const [btPads, setBtPads] = useState<ConnectedPadInfo[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // VGFA-Cast (Cloud Gaming P2P 60 FPS para amigos via link)
  const [showCastModal, setShowCastModal] = useState(false);
  const [castCode, setCastCode] = useState<string | null>(null);
  const [castUrl, setCastUrl] = useState<string>('');
  const [castQr, setCastQr] = useState<string>('');
  const [castViewers, setCastViewers] = useState(0);
  const [castError, setCastError] = useState<string | null>(null);

  const [bootStatus, setBootStatus] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [ejsSrcDoc, setEjsSrcDoc] = useState<string | null>(null);
  const [livePhonePad, setLivePhonePad] = useState<PadState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hud, setHud] = useState<{ score: number; lives: number; stage: number; fps: number; extra?: string }>({
    score: 0,
    lives: 3,
    stage: 1,
    fps: 60,
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const inlinePadStateRef = useRef<PadState>(createEmptyPadState(0));

  useEffect(() => {
    const onResize = () => {
      const mob = detectMobileDevice();
      setIsMobile(mob);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleInlineMobilePad = useCallback(
    (state: PadState) => {
      inlinePadStateRef.current = state;
      setLivePhonePad(state);
      if (session.mode === 'emulatorjs-rom') {
        keyBridgeRef.current.pushToIframe(state, iframeRef.current);
      }
    },
    [session.mode],
  );

  // Inicia / encerra VGFA-Cast WebRTC 60 FPS para amigo
  const resolveActiveGameCanvas = useCallback((): HTMLCanvasElement | null => {
    if (session.mode === 'builtin-arcade') return canvasRef.current;
    const frame = session.mode === 'ps2-webgpu-lab' ? ps2IframeRef.current : iframeRef.current;
    const win = frame?.contentWindow as (Window & { __vgfaEnableCastMirror?: (on: boolean) => HTMLCanvasElement }) | null;
    if (win && typeof win.__vgfaEnableCastMirror === 'function') {
      return win.__vgfaEnableCastMirror(true);
    }
    try {
      const doc = frame?.contentDocument;
      return (doc?.querySelector('canvas') as HTMLCanvasElement | null) ?? null;
    } catch {
      return null;
    }
  }, [session.mode]);

  const stopVgfaCast = useCallback(() => {
    castHostRef.current?.dispose();
    castHostRef.current = null;
    const win = ps2IframeRef.current?.contentWindow as (Window & { __vgfaEnableCastMirror?: (on: boolean) => void }) | null;
    win?.__vgfaEnableCastMirror?.(false);
    setCastCode(null);
    setCastUrl('');
    setCastQr('');
    setCastViewers(0);
    setCastError(null);
  }, []);

  const startVgfaCast = useCallback(() => {
    stopVgfaCast();
    setCastError(null);
    const castHost = new VgfaCastHost(session.consoleId, session.title, resolveActiveGameCanvas, {
      onCreated: (code) => {
        setCastCode(code);
        void (async () => {
          let base = window.location.origin;
          try {
            const tr = await globalThis.fetch('/api/tunnel/status');
            if (tr.ok) {
              const td = (await tr.json()) as { status?: string; url?: string | null };
              if (td.status === 'running' && td.url) base = td.url;
            }
          } catch {}
          if (base === window.location.origin && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            try {
              const nr = await globalThis.fetch('/api/network-info');
              if (nr.ok) {
                const ni = (await nr.json()) as { lanIp?: string };
                if (ni.lanIp && ni.lanIp !== '127.0.0.1') {
                  base = `${window.location.protocol}//${ni.lanIp}:${window.location.port || 5173}`;
                }
              }
            } catch {}
          }
          const full = `${base}/watch/${code}`;
          setCastUrl(full);
          const png = await QRCode.toDataURL(full, {
            width: 200,
            margin: 2,
            color: { dark: '#07080D', light: '#FFFFFF' },
          });
          setCastQr(png);
        })();
      },
      onViewersChanged: (count) => setCastViewers(count),
      onPadInput: (state) => {
        inlinePadStateRef.current = state;
        setLivePhonePad(state);
        if (session.mode === 'emulatorjs-rom') {
          keyBridgeRef.current.pushToIframe(state, iframeRef.current);
        }
      },
      onError: (msg) => setCastError(msg),
    });
    castHostRef.current = castHost;
    castHost.start();
  }, [resolveActiveGameCanvas, session.consoleId, session.mode, session.title, stopVgfaCast]);

  useEffect(() => () => stopVgfaCast(), [stopVgfaCast]);

  const readMergedInput = useCallback((): PadState => {
    const merged = createEmptyPadState(0);
    merged.buttons = keyboardMaskRef.current | inlinePadStateRef.current.buttons;
    merged.lx = inlinePadStateRef.current.lx;
    merged.ly = inlinePadStateRef.current.ly;

    const bt0 = btAdapterRef.current.pollAll().get(0);
    if (bt0) {
      merged.buttons |= bt0.buttons;
      if (Math.abs(bt0.lx) > Math.abs(merged.lx)) merged.lx = bt0.lx;
      if (Math.abs(bt0.ly) > Math.abs(merged.ly)) merged.ly = bt0.ly;
      if (Math.abs(bt0.rx) > Math.abs(merged.rx)) merged.rx = bt0.rx;
      if (Math.abs(bt0.ry) > Math.abs(merged.ry)) merged.ry = bt0.ry;
      merged.l2Pressure = Math.max(merged.l2Pressure, bt0.l2Pressure);
      merged.r2Pressure = Math.max(merged.r2Pressure, bt0.r2Pressure);
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
    }

    return merged;
  }, []);

  // 1. Mantém a sala QR Code ativa desde a tela pré-jogo até o fim da partida (sem desconectar o celular!)
  useEffect(() => {
    const host = new RemotePadHost(getSignalingUrl(), session.consoleId, session.title, {
      onRoomCreated: (code) => setRoomCode(code),
      onPadsChanged: (pads) => setRemotePads(pads),
      onPadInput: (state) => {
        setLivePhonePad(state);
        if (session.mode === 'emulatorjs-rom') {
          keyBridgeRef.current.pushToIframe(state, iframeRef.current);
        }
      },
    });
    hostRef.current = host;
    host.connect();
    return () => {
      host.dispose();
      hostRef.current = null;
    };
  }, [session.consoleId, session.title, session.mode]);

  // Gera o QR Code instantaneamente assim que a sala é criada (usando IP LAN no localhost!)
  useEffect(() => {
    if (!roomCode) return;
    let active = true;
    const makeQr = async () => {
      let base = window.location.origin;
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        try {
          const res = await globalThis.fetch('/api/network-info');
          if (res.ok) {
            const info = (await res.json()) as { lanIp?: string };
            if (info.lanIp && info.lanIp !== '127.0.0.1') {
              base = `${window.location.protocol}//${info.lanIp}:${window.location.port || 5173}`;
            }
          }
        } catch {
          // fallback
        }
      }
      const full = `${base}/pad/${roomCode}`;
      if (!active) return;
      setPadUrl(full);
      const png = await QRCode.toDataURL(full, {
        width: 220,
        margin: 2,
        color: { dark: '#07080D', light: '#FFFFFF' },
      });
      if (active) setQrDataUrl(png);
    };
    void makeQr();
    return () => {
      active = false;
    };
  }, [roomCode]);

  // Monitor de controles Bluetooth + Teclado
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      if (session.mode === 'builtin-arcade' && started) e.preventDefault();
      keyboardMaskRef.current |= bit;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const bit = DEFAULT_KEYBOARD_MAP[e.code];
      if (!bit) return;
      keyboardMaskRef.current &= ~bit;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const timer = setInterval(() => {
      setBtPads(btAdapterRef.current.listConnected());
    }, 250);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearInterval(timer);
    };
  }, [session.mode, started]);

  // 2. Só inicia o motor de jogo APÓS o clique em "INICIAR JOGO AGORA" (desbloqueia áudio no Safari/Chrome!)
  useEffect(() => {
    if (!started) return;

    setBootStatus(null);
    setBootError(null);
    setProgress(null);
    setEjsSrcDoc(null);

    if (session.mode === 'builtin-arcade' && canvasRef.current) {
      const engine = new VgfaBuiltinArcadeEngine(
        canvasRef.current,
        session.builtinVariant ?? 'neon-arena',
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

    if (session.mode === 'emulatorjs-rom' && (session.localFile || session.remoteUrl)) {
      let cancelled = false;
      let objectUrl: string | null = null;
      const controller = new AbortController();

      const bootEmulator = async () => {
        try {
          const sys = consoleDef.emulatorJsSystem || 'snes';
          let romFile: File;
          if (session.localFile) {
            romFile = session.localFile;
          } else {
            setBootStatus(`Preparando ${session.title}...`);
            const name =
              session.romFilename ||
              decodeURIComponent(
                session.remoteUrl!.split('/').pop()?.split('?')[0] ||
                  `game${consoleDef.extensions[0] || '.rom'}`,
              );
            romFile = await fetchRomAsFile(
              session.remoteUrl!,
              name,
              (p) => {
                if (!cancelled) {
                  setProgress(p);
                  if (p.fromCache) setBootStatus('Carregado do cache rápido! Iniciando...');
                }
              },
              controller.signal,
            );
          }

          if (cancelled) return;
          objectUrl = URL.createObjectURL(romFile);
          setEjsSrcDoc(
            buildEmulatorJsSrcDoc({
              system: sys,
              romBlobUrl: objectUrl,
              gameTitle: session.title,
            }),
          );
          setBootStatus(null);
          setProgress(null);
        } catch (err) {
          if (!cancelled) {
            setBootStatus(null);
            setProgress(null);
            setBootError(
              err instanceof Error
                ? err.message
                : 'Não foi possível carregar este jogo. Tente outro arquivo.',
            );
          }
        }
      };

      void bootEmulator();
      return () => {
        cancelled = true;
        controller.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
  }, [started, session, consoleDef, readMergedInput]);

  const handleSaveBuiltin = async () => {
    if (!builtinRef.current) return;
    const bytes = builtinRef.current.exportState();
    await saveStore.put({
      userId,
      consoleId: session.consoleId,
      gameId: session.id,
      gameTitle: session.title,
      kind: 'state',
      slot: 1,
      data: bytes,
    });
    showToast('Estado salvo no navegador!');
  };

  const hasAnyController = remotePads.length > 0 || btPads.length > 0;

  // ==================== TELA PRÉ-JOGO: CONECTAR CELULAR OU BLUETOOTH ====================
  if (!started) {
    return (
      <div className="vgfa-shell" style={{ maxWidth: 960, paddingTop: 28 }}>
        <div className="panel" style={{ padding: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {session.coverUrl && (
                <img
                  src={session.coverUrl}
                  alt={session.title}
                  crossOrigin="anonymous"
                  style={{ width: 58, height: 76, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                />
              )}
              <div>
                <span
                  className="badge"
                  style={{ background: consoleDef.accent, color: '#07080d', borderColor: 'transparent', marginBottom: 6 }}
                >
                  {consoleDef.name}
                </span>
                <h2 style={{ margin: 0, fontSize: 22 }}>{session.title}</h2>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const next = !isMobile;
                  setIsMobile(next);
                  setShowMobileTouchPad(next);
                }}
              >
                {isMobile ? '🖥️ Usar QR Code (PC/TV)' : '📱 Modo Tela de Celular'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onBack}>
                ← Voltar à Loja
              </button>
            </div>
          </div>

          <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>
            {isMobile ? 'Celular detectado — pronto para jogar!' : 'Antes de iniciar: conecte seu controle'}
          </h3>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-2)' }}>
            {isMobile
              ? `O VGFA adaptou automaticamente o controle virtual ${padProfile.title} para a tela do seu celular sem cobrir o jogo. Se preferir, conecte um controle Bluetooth.`
              : `Escaneie o QR Code para transformar seu celular no controle ${padProfile.title}, ou aperte qualquer botão no seu controle Bluetooth.`}
          </p>

          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                className="panel"
                style={{
                  background: 'var(--bg-0)',
                  borderColor: 'var(--emerald)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong style={{ fontSize: 14, color: '#a7f3d0' }}>
                    ✓ Controle Virtual na Tela ({padProfile.title})
                  </strong>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    Em pé: tela do jogo em cima e controle embaixo. Deitado: controles laterais translúcidos estilo PSP/Switch.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={showMobileTouchPad}
                    onChange={(e) => setShowMobileTouchPad(e.target.checked)}
                  />
                  Ativo
                </label>
              </div>

              <div
                className="panel"
                style={{
                  background: 'var(--bg-0)',
                  borderColor: btPads.length > 0 ? 'var(--emerald)' : 'var(--border)',
                }}
              >
                <strong style={{ fontSize: 14 }}>🎮 Controle Bluetooth no Celular</strong>
                <div style={{ fontSize: 12, color: btPads.length > 0 ? '#a7f3d0' : 'var(--text-2)', marginTop: 4 }}>
                  {btPads.length > 0
                    ? `✓ Conectado: ${btPads[0].label} (pode desmarcar o controle na tela acima para tela 100% cheia!)`
                    : 'Se tiver controle Bluetooth pareado no celular, aperte qualquer botão para ativar automaticamente.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="split-grid" style={{ marginTop: 0 }}>
            {/* Card 1: Celular como Controle (QR Code direto na tela!) */}
            <div
              className="panel"
              style={{
                background: 'var(--bg-0)',
                borderColor: remotePads.length > 0 ? 'var(--emerald)' : 'var(--border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 10,
              }}
            >
              <strong style={{ fontSize: 15 }}>📱 Usar Celular como Controle</strong>

              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR Code Celular Controle"
                  style={{ width: 176, height: 176, borderRadius: 12, background: '#fff', padding: 4 }}
                />
              ) : (
                <div style={{ width: 176, height: 176, display: 'grid', placeItems: 'center', color: 'var(--text-2)', fontSize: 12 }}>
                  Gerando QR Code...
                </div>
              )}

              <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>
                {roomCode ?? '...'}
              </div>

              {remotePads.length > 0 ? (
                <div
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: 'rgba(52, 211, 153, 0.16)',
                    color: '#a7f3d0',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  ✓ {remotePads[0].label} Conectado! ({padProfile.title})
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>
                  Aponte a câmera do celular (no mesmo Wi-Fi) para o QR Code acima.
                  <br />
                  <a
                    href={roomCode ? `/pad/${roomCode}` : '/pad'}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--cyan)', textDecoration: 'underline' }}
                  >
                    Ou testar controle em outra aba ↗
                  </a>
                </div>
              )}
              {padUrl && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-2)', wordBreak: 'break-all' }}>
                  {padUrl}
                </div>
              )}
            </div>

            {/* Card 2: Controle Bluetooth / USB */}
            <div
              className="panel"
              style={{
                background: 'var(--bg-0)',
                borderColor: btPads.length > 0 ? 'var(--emerald)' : 'var(--border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 14,
              }}
            >
              <div>
                <strong style={{ display: 'block', fontSize: 15, marginBottom: 8 }}>
                  🎮 Usar Controle Bluetooth / USB
                </strong>
                <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
                  Compatível com controles de <strong>PS4, PS5 DualSense, Xbox, 8BitDo</strong> e genéricos Bluetooth pareados no seu Mac/PC/Celular.
                </p>

                {btPads.length > 0 ? (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'rgba(52, 211, 153, 0.16)',
                      border: '1px solid rgba(52, 211, 153, 0.45)',
                      color: '#a7f3d0',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    ✓ Controle Detectado: {btPads[0].label}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: 12,
                      background: 'var(--bg-1)',
                      border: '1px dashed var(--border)',
                      fontSize: 13,
                      color: 'var(--text-1)',
                      textAlign: 'center',
                    }}
                  >
                    Aperte qualquer botão no seu controle Bluetooth para conectar automaticamente...
                  </div>
                )}
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--bg-1)',
                  fontSize: 12,
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                ⌨️ <strong>Sem controle agora?</strong> Você também pode jogar imediatamente usando o teclado (Setas + Z / X / A / S + Enter).
              </div>
            </div>
          </div>
          )}

          {/* Botão Principal de Iniciar */}
          <div style={{ marginTop: 22, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '14px 36px', fontSize: 16, minWidth: 280 }}
              onClick={() => setStarted(true)}
            >
              {hasAnyController ? '▶ INICIAR JOGO COM CONTROLE' : '▶ INICIAR JOGO AGORA'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== MODO CELULAR NATIVO (JOGO EM CIMA + CONTROLE VIRTUAL DEDICADO EMBAIXO / LATERAIS) ====================
  if (isMobile && session.mode !== 'ps2-webgpu-lab') {
    return (
      <div className="mobile-player-shell">
        <div className="mobile-stage-bar">
          <button className="btn btn-sm btn-ghost" onClick={onBack}>
            ← Sair
          </button>
          <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </strong>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowMobileTouchPad((v) => !v)}
          >
            {showMobileTouchPad ? '🎮 Ocultar Pad' : '🎮 Mostrar Pad'}
          </button>
        </div>

        <div className="mobile-screen-area">
          {session.mode === 'emulatorjs-rom' ? (
            ejsSrcDoc ? (
              <iframe
                ref={iframeRef}
                title={session.title}
                srcDoc={ejsSrcDoc}
                style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
                allow="gamepad *; fullscreen *; autoplay *"
              />
            ) : null
          ) : (
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          )}

          {bootStatus && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(7, 8, 13, 0.92)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                textAlign: 'center',
              }}
            >
              <strong>{bootStatus}</strong>
              {progress && (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                </div>
              )}
            </div>
          )}

          {bootError && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(7, 8, 13, 0.95)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                gap: 10,
                textAlign: 'center',
              }}
            >
              <div style={{ color: '#fb7185', fontWeight: 700 }}>{bootError}</div>
              <button className="btn btn-sm btn-primary" onClick={onBack}>
                ← Voltar
              </button>
            </div>
          )}
        </div>

        {showMobileTouchPad && (
          <MobileInlinePad consoleId={session.consoleId} onStateChange={handleInlineMobilePad} />
        )}
      </div>
    );
  }

  // ==================== TELA DE JOGO LIMPA EM 60 FPS (DESKTOP / TV) ====================
  return (
    <div className="vgfa-shell" style={{ maxWidth: showAdvanced ? 1360 : 1080 }}>
      <div style={{ marginTop: 18 }}>
        <div className="stage-box">
          <div className="stage-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={onBack}>
                ← {t.backHome}
              </button>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{session.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  {consoleDef.name} •{' '}
                  {remotePads.length > 0
                    ? `📱 ${remotePads.length} Celular conectado`
                    : btPads.length > 0
                      ? `🎮 ${btPads[0].label}`
                      : '⌨️ Teclado ativo'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => setShowQrModal(true)}>
                📱 QR Controle {roomCode ? `(${roomCode})` : ''}
              </button>
              <button
                className={`btn btn-sm ${castCode ? 'btn-primary' : 'btn-cyan'}`}
                onClick={() => {
                  setShowCastModal(true);
                  if (!castCode) startVgfaCast();
                }}
              >
                📡 {castCode ? `Transmitindo (${castViewers})` : 'Transmitir 60 FPS'}
              </button>
              {session.mode === 'builtin-arcade' && (
                <button className="btn btn-sm btn-cyan" onClick={() => void handleSaveBuiltin()}>
                  💾 Salvar
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setShowAdvanced((v) => !v)}>
                ⚙️ {showAdvanced ? 'Ocultar Painel' : 'Controles'}
              </button>
            </div>
          </div>

          {toast && (
            <div style={{ padding: '8px 16px', background: 'rgba(52, 211, 153, 0.16)', color: '#a7f3d0', fontSize: 12 }}>
              {toast}
            </div>
          )}

          {session.mode === 'ps2-webgpu-lab' ? (
            <Ps2LabPanel
              gameTitle={session.title}
              expectedSerial={session.serial}
              initialFile={session.localFile}
              initialUrl={session.remoteUrl}
              romFilename={session.romFilename}
              externalPadState={livePhonePad}
              onIframeChange={(el) => {
                ps2IframeRef.current = el;
              }}
            />
          ) : (
            <div className="stage-canvas-wrap" style={{ minHeight: 460 }}>
              {session.mode === 'emulatorjs-rom' ? (
                ejsSrcDoc ? (
                  <iframe
                    ref={iframeRef}
                    title={session.title}
                    srcDoc={ejsSrcDoc}
                    style={{ width: '100%', height: '100%', minHeight: 520, border: 'none', background: '#000' }}
                    allow="gamepad *; fullscreen *; autoplay *"
                  />
                ) : null
              ) : (
                <canvas ref={canvasRef} />
              )}

              {bootStatus && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(7, 8, 13, 0.92)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                    textAlign: 'center',
                  }}
                >
                  <strong style={{ fontSize: 16 }}>{bootStatus}</strong>
                  {progress && (
                    <>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
                        {progress.percent}%
                      </span>
                    </>
                  )}
                </div>
              )}

              {bootError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(7, 8, 13, 0.95)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                    textAlign: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ color: '#fb7185', fontWeight: 700, fontSize: 15 }}>
                    Não foi possível iniciar este arquivo
                  </div>
                  <div style={{ color: 'var(--text-1)', fontSize: 13, maxWidth: 460 }}>{bootError}</div>
                  <button className="btn btn-primary" onClick={onBack}>
                    ← Voltar para a Loja
                  </button>
                </div>
              )}
            </div>
          )}

          {session.mode === 'builtin-arcade' && (
            <div className="hud-strip">
              <span>
                SCORE: <strong style={{ color: 'var(--amber)' }}>{hud.score}</strong> • VIDAS: <strong>{hud.lives}</strong> • {hud.extra}
              </span>
              <span className="mono">{hud.fps} FPS</span>
            </div>
          )}
        </div>

        {showAdvanced && (
          <div className="panel" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-1)' }}>
              <strong>Sala Celular:</strong> <span className="mono">{roomCode}</span> ({remotePads.length}/4 conectados) •{' '}
              <strong>Bluetooth:</strong> {btPads.length > 0 ? btPads.map((p) => p.label).join(', ') : 'Nenhum'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Teclado: Setas + Z / X / A / S + Q / E + Enter (Start) + V (Select)
            </div>
          </div>
        )}
      </div>

      {showQrModal && (
        <QrConnectModal
          t={t}
          roomCode={roomCode}
          connectedPads={remotePads}
          bluetoothPads={btPads}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {showCastModal && (
        <div className="modal-backdrop" onClick={() => setShowCastModal(false)}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>📡 VGFA-Cast — Cloud Gaming P2P (60 FPS)</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowCastModal(false)}>
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
              Envie o link abaixo para qualquer amigo (mesmo em um celular simples ou Safari). O jogo roda na sua GPU aqui e transmite vídeo <strong>60 FPS via WebRTC</strong> com <strong>0 MB baixados</strong> para ele jogar pelo controle virtual!
            </p>
            {castError && (
              <div style={{ padding: 10, borderRadius: 10, background: 'rgba(251, 113, 133, 0.14)', color: '#fda4af', fontSize: 12, marginBottom: 12 }}>
                {castError}
              </div>
            )}
            {castCode && (
              <div className="panel" style={{ background: 'var(--bg-0)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span className="badge" style={{ background: '#10b981', color: '#042f2e', borderColor: 'transparent' }}>
                  ● Ao Vivo • {castViewers} conectado(s)
                </span>
                {castQr && <img src={castQr} alt="QR VGFA-Cast" style={{ width: 175, height: 175, borderRadius: 12, background: '#fff', padding: 4 }} />}
                <div className="mono" style={{ fontSize: 12, color: 'var(--amber)', wordBreak: 'break-all' }}>
                  {castUrl || `/watch/${castCode}`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      void navigator.clipboard?.writeText(castUrl || `${window.location.origin}/watch/${castCode}`);
                      showToast('Link VGFA-Cast copiado!');
                    }}
                  >
                    📋 Copiar Link do Amigo
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: '#fb7185' }}
                    onClick={() => {
                      stopVgfaCast();
                      setShowCastModal(false);
                    }}
                  >
                    Encerrar Transmissão
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
