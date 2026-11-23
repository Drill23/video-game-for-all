import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  BluetoothGamepadAdapter,
  CONTROLLER_PROFILES,
  RemotePadHost,
  createEmptyPadState,
  keyboardBitFor,
  type ConnectedPadInfo,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';
import {
  CONSOLE_MAP,
  EjsInputBridge,
  VgfaBuiltinArcadeEngine,
  buildEmulatorJsSrcDoc,
  fetchRomAsFile,
  registerPs2Disc,
  type BuiltinVariant,
  type DownloadProgress,
} from '@vgfa/runtime';
import type { VgfaSaveStore } from '@vgfa/storage';
import type { Dictionary } from '../i18n/translations.js';
import { Cover } from '../components/Cover.js';
import { Icon } from '../components/Icon.js';
import { padKindLabel } from '../components/padKind.js';
import { Ps2LabPanel } from '../components/Ps2LabPanel.js';
import { QrConnectModal } from '../components/QrConnectModal.js';
import { MobileInlinePad } from '../components/MobileInlinePad.js';
import { ControllerSetupModal } from '../components/ControllerSetupModal.js';
import { ResumePrompt } from '../components/ResumePrompt.js';
import { notifyDownloadStarted } from '../components/DownloadExplainer.js';
import {
  attachEjsAutosave,
  getLatestSave,
  loadSaveInto,
  recordPlayTime,
  type EjsAutosaveHandle,
  type EjsSave,
} from '../services/ejs-saves.js';
import { VgfaCastHost } from '../services/vgfa-cast.js';
import '../styles/player.css';

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
  // GitHub Pages (e outros sites estáticos) não têm servidor /ws: vai direto para o VGFA Link sem servidor
  if (/\.github\.io$/i.test(window.location.hostname)) return 'serverless';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Usa /ws na mesma origem/porta — funciona em localhost, LAN e qualquer link HTTPS público (4G/5G)!
  return `${proto}//${window.location.host}/ws`;
}

/** Junta dois controles no mesmo jogador (botões somados, maior inclinação do analógico vence). */
function mergePadStates(a: PadState | null | undefined, b: PadState | null | undefined): PadState | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const pick = (x: number, y: number) => (Math.abs(y) > Math.abs(x) ? y : x);
  return {
    ...a,
    buttons: a.buttons | b.buttons,
    lx: pick(a.lx, b.lx),
    ly: pick(a.ly, b.ly),
    rx: pick(a.rx, b.rx),
    ry: pick(a.ry, b.ry),
    l2Pressure: Math.max(a.l2Pressure, b.l2Pressure),
    r2Pressure: Math.max(a.r2Pressure, b.r2Pressure),
    crossPressure: Math.max(a.crossPressure, b.crossPressure),
    squarePressure: Math.max(a.squarePressure, b.squarePressure),
  };
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

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ps2IframeRef = useRef<HTMLIFrameElement | null>(null);
  const castHostRef = useRef<VgfaCastHost | null>(null);
  const builtinRef = useRef<VgfaBuiltinArcadeEngine | null>(null);
  const hostRef = useRef<RemotePadHost | null>(null);
  const btAdapterRef = useRef(new BluetoothGamepadAdapter());
  const ejsBridgeRef = useRef<EjsInputBridge | null>(null);
  if (!ejsBridgeRef.current) ejsBridgeRef.current = new EjsInputBridge(session.consoleId);
  const castPadStateRef = useRef<PadState | null>(null);
  const castPadAtRef = useRef(0);
  const livePadKeyRef = useRef('');
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
  const [showPadSetup, setShowPadSetup] = useState(false);
  // Download antecipado: a ROM baixa enquanto a pessoa conecta o controle
  const [romPrep, setRomPrep] = useState<{ percent: number; done: boolean; fromCache?: boolean; error?: string } | null>(null);
  const romPromiseRef = useRef<Promise<File> | null>(null);
  const romAbortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  startedRef.current = started;

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

  /**
   * Envia o estado de TODOS os jogadores para o EmulatorJS (nível, não evento):
   * P1 = celular P1 + controle de toque desta tela + amigo do VGFA-Cast; P2..P4 = demais celulares.
   */
  const pumpEjsInput = useCallback(() => {
    const isEjs = session.mode === 'emulatorjs-rom';
    const isPs2 = session.mode === 'ps2-webgpu-lab';
    if (!isEjs && !isPs2) return;
    const host = hostRef.current;
    // Controles Bluetooth/USB (8BitDo, Xbox, DualSense…): P1 = o primeiro que apertou um botão
    const bt = btAdapterRef.current.pollAll();
    const states: Array<PadState | null> = [null, null, null, null];
    for (let s = 0; s < 4; s++) states[s] = mergePadStates(host?.getLatestState(s) ?? null, bt.get(s) ?? null);
    let p1 = mergePadStates(states[0], inlinePadStateRef.current);
    if (keyboardMaskRef.current) {
      const kb = createEmptyPadState(0);
      kb.buttons = keyboardMaskRef.current;
      p1 = mergePadStates(p1, kb);
    }
    if (castPadStateRef.current && Date.now() - castPadAtRef.current < 2500) {
      p1 = mergePadStates(p1, castPadStateRef.current);
    }
    states[0] = p1;
    if (isEjs) ejsBridgeRef.current?.sync(states, iframeRef.current);
    else publishLivePadRef.current(p1 ?? createEmptyPadState(0));
  }, [session.mode]);
  const pumpEjsInputRef = useRef(pumpEjsInput);
  pumpEjsInputRef.current = pumpEjsInput;

  /** Só o PS2 precisa do estado em React; e só re-renderiza quando algo muda de verdade. */
  const publishLivePad = useCallback(
    (state: PadState) => {
      if (session.mode !== 'ps2-webgpu-lab') return;
      const key = `${state.buttons}|${state.lx.toFixed(2)}|${state.ly.toFixed(2)}|${state.rx.toFixed(2)}|${state.ry.toFixed(2)}|${state.l2Pressure.toFixed(2)}|${state.r2Pressure.toFixed(2)}`;
      if (key === livePadKeyRef.current) return;
      livePadKeyRef.current = key;
      setLivePhonePad(state);
    },
    [session.mode],
  );
  const publishLivePadRef = useRef(publishLivePad);
  publishLivePadRef.current = publishLivePad;

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
      pumpEjsInputRef.current();
    },
    [],
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
          const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
          const full = `${base}${basePath}/#/watch/${code}`;
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
        castPadStateRef.current = state;
        castPadAtRef.current = Date.now();
        pumpEjsInputRef.current();
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
    const cast = castPadStateRef.current;
    if (cast && Date.now() - castPadAtRef.current < 2500) {
      merged.buttons |= cast.buttons;
      if (Math.abs(cast.lx) > Math.abs(merged.lx)) merged.lx = cast.lx;
      if (Math.abs(cast.ly) > Math.abs(merged.ly)) merged.ly = cast.ly;
    }

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
        pumpEjsInputRef.current();
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
      const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const full = `${base}${basePath}/#/pad/${roomCode}`;
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
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const bit = keyboardBitFor(e);
      if (!bit) return;
      // Em jogo, as setas/espaço não rolam a página
      if (started) e.preventDefault();
      keyboardMaskRef.current |= bit;
      pumpEjsInputRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const bit = keyboardBitFor(e);
      if (!bit) return;
      keyboardMaskRef.current &= ~bit;
      pumpEjsInputRef.current();
    };
    // O foco foi para dentro do jogo (iframe) ou para outro app: solta as teclas
    const onBlur = () => {
      keyboardMaskRef.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let lastBtKey = '';
    const timer = setInterval(() => {
      const list = btAdapterRef.current.listConnected();
      const key = list.map((p) => `${p.id}:${p.label}`).join('|');
      if (key !== lastBtKey) {
        lastBtKey = key;
        setBtPads(list);
      }
    }, 500);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearInterval(timer);
    };
  }, [session.mode, started]);

  // Bomba de entrada: 60x/s junta celular + Bluetooth + teclado + toque e envia ao motor (só posta quando muda)
  useEffect(() => {
    const active = session.mode === 'ps2-webgpu-lab' || (started && session.mode === 'emulatorjs-rom');
    if (!active) return;
    const timer = setInterval(() => pumpEjsInputRef.current(), 16);
    return () => {
      clearInterval(timer);
      ejsBridgeRef.current?.releaseAll(iframeRef.current);
    };
  }, [started, session.mode]);

  /** Baixa (ou lê do aparelho) a ROM uma única vez, compartilhado entre a tela pré-jogo e o motor. */
  const ensureRom = useCallback((): Promise<File> => {
    if (session.localFile) return Promise.resolve(session.localFile);
    if (romPromiseRef.current) return romPromiseRef.current;
    if (!session.remoteUrl) return Promise.reject(new Error('Jogo sem endereço.'));
    const controller = new AbortController();
    romAbortRef.current = controller;
    const name =
      session.romFilename ||
      decodeURIComponent(
        session.remoteUrl.split('/').pop()?.split('?')[0] || `game${consoleDef.extensions[0] || '.rom'}`,
      );
    setRomPrep({ percent: 0, done: false });
    const promise = fetchRomAsFile(
      session.remoteUrl,
      name,
      (p) => {
        setRomPrep({ percent: p.percent, done: p.percent >= 100, fromCache: p.fromCache });
        if (startedRef.current) {
          setProgress(p);
          if (p.fromCache) setBootStatus('Carregado do aparelho! Iniciando...');
        }
      },
      controller.signal,
      {
        gameId: session.id,
        title: session.title,
        consoleId: session.consoleId,
        coverUrl: session.coverUrl,
      },
    ).then(
      (file) => {
        setRomPrep({ percent: 100, done: true });
        return file;
      },
      (err: unknown) => {
        romPromiseRef.current = null; // permite tentar de novo
        setRomPrep({
          percent: 0,
          done: false,
          error: err instanceof Error ? err.message : 'Falha ao preparar o jogo.',
        });
        throw err;
      },
    );
    romPromiseRef.current = promise;
    return promise;
  }, [session, consoleDef]);

  // Começa a preparar o jogo assim que a tela pré-jogo abre (o clique em "Jogar" fica instantâneo)
  useEffect(() => {
    if (session.mode !== 'emulatorjs-rom' || !session.remoteUrl || session.localFile) return;
    void ensureRom().catch(() => {});
    return () => {
      romAbortRef.current?.abort();
      romAbortRef.current = null;
      romPromiseRef.current = null;
    };
  }, [session.mode, session.remoteUrl, session.localFile, ensureRom]);

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
          // Evita re-renderizar a tela inteira 60x/s: só atualiza o HUD quando algo muda
          onHudUpdate: (h) =>
            setHud((prev) =>
              prev.score === h.score && prev.lives === h.lives && prev.stage === h.stage && prev.fps === h.fps && prev.extra === h.extra
                ? prev
                : h,
            ),
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

      const bootEmulator = async () => {
        try {
          const sys = consoleDef.emulatorJsSystem || 'snes';
          let romFile: File;
          if (session.localFile) {
            romFile = session.localFile;
          } else {
            setBootStatus(`Preparando ${session.title}...`);
            romFile = await ensureRom();
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
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
  }, [started, session, consoleDef, readMergedInput, ensureRom]);

  // Saves automáticos + "Continuar de onde parou" (EmulatorJS)
  const autosaveRef = useRef<EjsAutosaveHandle | null>(null);
  const [resumeSave, setResumeSave] = useState<EjsSave | null>(null);
  useEffect(() => {
    if (session.mode !== 'emulatorjs-rom' || !ejsSrcDoc) return;
    let alive = true;
    const iframe = iframeRef.current;
    if (iframe) {
      autosaveRef.current = attachEjsAutosave(iframe, {
        gameKey: session.id,
        title: session.title,
        consoleId: session.consoleId,
        coverUrl: session.coverUrl,
      });
    }
    void getLatestSave(session.id)
      .then((save) => {
        if (alive && save) setResumeSave(save);
      })
      .catch(() => {});
    return () => {
      alive = false;
      const handle = autosaveRef.current;
      autosaveRef.current = null;
      void handle?.dispose();
      setResumeSave(null);
    };
  }, [ejsSrcDoc, session.mode, session.id, session.title, session.consoleId, session.coverUrl]);

  // PS2: registra o disco na Minha Central (reabre sem baixar) e conta o tempo de jogo
  useEffect(() => {
    if (session.mode !== 'ps2-webgpu-lab') return;
    const startedAt = Date.now();
    if (session.remoteUrl) {
      void registerPs2Disc({
        url: session.remoteUrl,
        fileName: session.romFilename,
        gameId: session.id,
        title: session.title,
        coverUrl: session.coverUrl,
        serial: session.serial,
      })
        .then(({ alreadyOnDevice }) => {
          if (!alreadyOnDevice) {
            notifyDownloadStarted({ kind: 'ps2-disc', title: session.title, consoleId: 'ps2', coverUrl: session.coverUrl });
          }
        })
        .catch(() => {});
    }
    return () => {
      const ms = Date.now() - startedAt;
      if (ms > 15_000) {
        void recordPlayTime(session.id, ms, { title: session.title, consoleId: session.consoleId, coverUrl: session.coverUrl });
      }
    };
  }, [session.mode, session.remoteUrl, session.romFilename, session.id, session.title, session.coverUrl, session.serial, session.consoleId]);

  /** Voltar: salva o progresso antes de sair (no máximo 1,5 s de espera). */
  const handleBack = async () => {
    try {
      await Promise.race([
        autosaveRef.current?.saveNow('back') ?? Promise.resolve(false),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {
      // segue saindo
    }
    onBack();
  };

  const resumeOverlay = resumeSave ? (
    <ResumePrompt
      title={session.title}
      savedAt={resumeSave.savedAt}
      onResume={() => {
        const save = resumeSave;
        setResumeSave(null);
        if (save && iframeRef.current) void loadSaveInto(iframeRef.current, save);
      }}
      onFresh={() => setResumeSave(null)}
    />
  ) : null;

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
      <div className="pg">
        <div className="pg-bg" aria-hidden="true">
          {session.coverUrl && (
            <img
              src={session.coverUrl}
              alt=""
              crossOrigin="anonymous"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
          )}
          <div className="pg-tint" style={{ ['--ph' as string]: consoleDef.accent }} />
          <div className="pg-scrim" />
        </div>

        <div className="vgfa-shell pg-shell">
          <div className="pg-top">
            <button className="btn btn-sm" onClick={() => void handleBack()}>
              <Icon name="chevL" size={16} /> Voltar à Loja
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                const next = !isMobile;
                setIsMobile(next);
                setShowMobileTouchPad(next);
              }}
            >
              {isMobile ? 'Usar QR Code (PC/TV)' : 'Modo Tela de Celular'}
            </button>
          </div>

          <div className="pg-grid">
            <div className="pg-hero">
              <div className="pg-cover">
                <Cover src={session.coverUrl} title={session.title} accent={consoleDef.accent} eager />
                <span className="pg-gloss" />
              </div>
              <div className="pg-meta">
                <span className="chip">
                  <i className="dot" style={{ background: consoleDef.accent }} />
                  {consoleDef.name}
                </span>
                <h1 className="pg-title">{session.title}</h1>
                <p className="pg-sub">
                  {isMobile
                    ? `O VGFA adaptou automaticamente o controle virtual ${padProfile.title} para a tela do seu celular sem cobrir o jogo. Se preferir, conecte um controle Bluetooth.`
                    : `Escaneie o QR Code para transformar seu celular no controle ${padProfile.title}, ou aperte qualquer botão no seu controle Bluetooth.`}
                </p>
              </div>
            </div>

            <div className="pg-side">
              <h2 className="pg-kicker">
                {isMobile ? 'Celular detectado, pronto para jogar' : 'Antes de iniciar: conecte seu controle'}
              </h2>

              {isMobile ? (
                <>
                  <div className={`pg-card glass ${showMobileTouchPad ? 'is-ok' : ''}`}>
                    <div className="pg-card-head">
                      <span className="pg-ico">
                        <Icon name="gamepad" size={20} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3>Controle virtual na tela ({padProfile.title})</h3>
                        <p>
                          Em pé: tela do jogo em cima e controle embaixo. Deitado: controles laterais translúcidos estilo PSP/Switch.
                        </p>
                      </div>
                    </div>
                    <label className="pg-switch">
                      <input
                        type="checkbox"
                        checked={showMobileTouchPad}
                        onChange={(e) => setShowMobileTouchPad(e.target.checked)}
                      />
                      Ativo
                    </label>
                  </div>

                  <div className={`pg-card glass ${btPads.length > 0 ? 'is-ok' : ''}`}>
                    <div className="pg-card-head">
                      <span className="pg-ico">
                        <Icon name="gamepad" size={20} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3>Controle Bluetooth no celular</h3>
                        <p>
                          {btPads.length > 0
                            ? `✓ Conectado: ${btPads[0].label}. Pode desmarcar o controle na tela acima para usar a tela 100% cheia.`
                            : 'Se tiver controle Bluetooth pareado no celular, aperte qualquer botão para ativar automaticamente.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="pg-cards">
                  {/* Card 1: Celular como Controle (QR Code direto na tela!) */}
                  <div className={`pg-card glass ${remotePads.length > 0 ? 'is-ok' : ''}`}>
                    <div className="pg-card-head">
                      <span className="pg-ico">
                        <Icon name="phone" size={20} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3>Celular como controle</h3>
                        <p>Aponte a câmera (mesmo Wi-Fi) para o QR Code.</p>
                      </div>
                    </div>

                    <div className="pg-qr-row">
                      <div className="pg-qr">
                        {qrDataUrl ? (
                          <img src={qrDataUrl} alt="QR Code Celular Controle" width={176} height={176} />
                        ) : (
                          <div className="pg-qr-wait">Gerando QR Code...</div>
                        )}
                      </div>
                      <div className="pg-code">
                        <span className="pg-code-label">Código da sala</span>
                        <span className="pg-code-val mono">{roomCode ?? '...'}</span>
                        <a
                          className="pg-link"
                          href={
                            roomCode
                              ? `${import.meta.env.BASE_URL}#/pad/${roomCode}`
                              : `${import.meta.env.BASE_URL}#/pad`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ou testar controle em outra aba ↗
                        </a>
                      </div>
                    </div>

                    {remotePads.length > 0 ? (
                      <div className="pg-status-list">
                        {remotePads.map((p) => (
                          <div key={p.id} className="pg-status is-ok">
                            <i className="pulse-dot" />
                            <span>
                              ✓ {p.label} conectado · P{p.slot + 1} · {padKindLabel(p.kind)}
                              {p.latencyMs ? ` · ${p.latencyMs} ms` : ''}
                            </span>
                          </div>
                        ))}
                        <div className="pg-hint">Controle {padProfile.title} ativo.</div>
                      </div>
                    ) : (
                      <div className="pg-status">
                        <i className="pulse-dot" />
                        <span>Aguardando celular…</span>
                      </div>
                    )}
                    {padUrl && <div className="mono pg-url">{padUrl}</div>}
                  </div>

                  {/* Card 2: Controle Bluetooth / USB */}
                  <div className={`pg-card glass ${btPads.length > 0 ? 'is-ok' : ''}`}>
                    <div className="pg-card-head">
                      <span className="pg-ico">
                        <Icon name="gamepad" size={20} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3>Controle Bluetooth / USB</h3>
                        <p>
                          PS4, PS5 DualSense, Xbox, 8BitDo e genéricos pareados no seu Mac, PC ou celular.
                        </p>
                      </div>
                    </div>
                    {btPads.length > 0 ? (
                      <div className="pg-status is-ok">
                        <i className="pulse-dot" />
                        <span>
                          ✓ {btPads.map((p) => `${p.label} (P${p.slot + 1})`).join(' · ')}
                        </span>
                      </div>
                    ) : (
                      <div className="pg-status">
                        <i className="pulse-dot" />
                        <span>Aperte qualquer botão no controle para conectar…</span>
                      </div>
                    )}
                    <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowPadSetup(true)}>
                      🎮 Testar / configurar controle
                    </button>
                  </div>

                  <div className="pg-keys">
                    ⌨️ Sem controle agora? Jogue já com o teclado: Setas + Z / X / A / S + Enter.
                  </div>
                </div>
              )}

              {showPadSetup && (
                <ControllerSetupModal
                  adapter={btAdapterRef.current}
                  consoleId={session.consoleId}
                  onClose={() => setShowPadSetup(false)}
                />
              )}
              {/* Botão Principal de Iniciar */}
              <button className="btn btn-primary btn-lg pg-cta" onClick={() => setStarted(true)}>
                <Icon name="play" size={18} /> {hasAnyController ? 'Jogar com controle' : 'Jogar agora'}
              </button>
              {romPrep && (
                <div className={`pg-prep ${romPrep.done ? 'is-ready' : ''} ${romPrep.error ? 'is-error' : ''}`}>
                  {romPrep.error ? (
                    <span>⚠️ {romPrep.error} — tente “Jogar” para tentar de novo.</span>
                  ) : romPrep.done ? (
                    <span>⚡ Jogo pronto neste aparelho — abre na hora.</span>
                  ) : (
                    <>
                      <span>Preparando o jogo enquanto você conecta o controle… {romPrep.percent}%</span>
                      <i style={{ width: `${Math.max(4, romPrep.percent)}%` }} />
                    </>
                  )}
                </div>
              )}
            </div>
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
          <button className="btn btn-sm" onClick={() => void handleBack()}>
            ← Sair
          </button>
          <strong className="mobile-title">{session.title}</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                const el = stageWrapRef.current;
                if (!el) return;
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
                else void el.requestFullscreen?.().catch(() => {});
              }}
            >
              ⛶
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setShowMobileTouchPad((v) => !v)}
            >
              {showMobileTouchPad ? '🎮 Ocultar' : '🎮 Pad'}
            </button>
          </div>
        </div>

        <div className="mobile-screen-area" ref={stageWrapRef}>
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

          {resumeOverlay}

          {bootStatus && (
            <div className="boot-overlay">
              <div className="glass-spinner" />
              <strong>{bootStatus}</strong>
              {progress && (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                </div>
              )}
            </div>
          )}

          {bootError && (
            <div className="boot-overlay">
              <div className="boot-error">
                <strong>Não foi possível iniciar</strong>
                <span>{bootError}</span>
                <button className="btn btn-sm btn-primary" onClick={() => void handleBack()}>
                  ← Voltar
                </button>
              </div>
            </div>
          )}
        </div>

        {showMobileTouchPad && (
          <MobileInlinePad consoleId={session.consoleId} onStateChange={handleInlineMobilePad} />
        )}
      </div>
    );
  }

  const toggleFullscreen = () => {
    const el = stageWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  };

  // ==================== TELA DE JOGO LIMPA EM 60 FPS (DESKTOP / TV) ====================
  return (
    <div className="vgfa-shell player-shell" style={{ maxWidth: showAdvanced ? 1360 : 1080 }}>
      <div style={{ marginTop: 18 }}>
        <div className="stage-box" ref={stageWrapRef}>
          <div className="stage-bar">
            <div className="sb-left">
              <button className="btn btn-sm" onClick={() => void handleBack()}>
                ← {t.backHome}
              </button>
              <div className="sb-title">
                <div className="sb-name">{session.title}</div>
                <div className="sb-sub">
                  <i className={`sb-dot ${hasAnyController ? 'is-ok' : ''}`} />
                  {consoleDef.name} •{' '}
                  {remotePads.length > 0
                    ? `📱 ${remotePads.length} Celular conectado`
                    : btPads.length > 0
                      ? `🎮 ${btPads[0].label}`
                      : '⌨️ Teclado ativo'}
                </div>
              </div>
            </div>

            <div className="sb-actions">
              <button className="btn btn-sm btn-primary" onClick={() => setShowQrModal(true)}>
                <Icon name="phone" size={15} /> QR Controle {roomCode ? `(${roomCode})` : ''}
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
              <button className="btn btn-sm" onClick={toggleFullscreen}>
                ⛶ Tela Cheia
              </button>
              {session.mode === 'builtin-arcade' && (
                <button className="btn btn-sm btn-cyan" onClick={() => void handleSaveBuiltin()}>
                  <Icon name="save" size={15} /> Salvar
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setShowPadSetup(true)}>
                🎮 Controle Bluetooth
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowAdvanced((v) => !v)}>
                ⚙️ {showAdvanced ? 'Ocultar Painel' : 'Controles'}
              </button>
            </div>
          </div>

          {toast && <div className="stage-toast">{toast}</div>}

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

              {resumeOverlay}

              {bootStatus && (
                <div className="boot-overlay">
                  <div className="glass-spinner" />
                  <strong style={{ fontSize: 16 }}>{bootStatus}</strong>
                  {progress && (
                    <>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        {progress.percent}%
                      </span>
                    </>
                  )}
                </div>
              )}

              {bootError && (
                <div className="boot-overlay">
                  <div className="boot-error">
                    <strong>Não foi possível iniciar este arquivo</strong>
                    <span>{bootError}</span>
                    <button className="btn btn-primary" onClick={() => void handleBack()}>
                      ← Voltar para a Loja
                    </button>
                  </div>
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
          <div className="panel player-info">
            <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
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

      {showPadSetup && (
        <ControllerSetupModal
          adapter={btAdapterRef.current}
          consoleId={session.consoleId}
          onClose={() => setShowPadSetup(false)}
        />
      )}

      {showCastModal && (
        <div className="modal-backdrop" onClick={() => setShowCastModal(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: 480 }}
            role="dialog"
            aria-modal="true"
            aria-label="VGFA-Cast"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grabber" />
            <div className="modal-head">
              <h3>📡 VGFA-Cast · Jogo por streaming</h3>
              <button
                className="icon-btn modal-close"
                onClick={() => setShowCastModal(false)}
                aria-label="Fechar"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <p className="lead">
              Envie o link abaixo para qualquer amigo (mesmo em um celular simples ou Safari). O jogo roda na sua GPU aqui e transmite vídeo <strong>60 FPS via WebRTC</strong> com <strong>0 MB baixados</strong> para ele jogar pelo controle virtual.
            </p>
            {castError && <div className="notice notice-warn">{castError}</div>}
            {castCode && (
              <div className="qr-box">
                <span className="live-pill">
                  <i className="pulse-dot" /> Ao vivo · {castViewers} conectado(s)
                </span>
                {castQr && (
                  <img className="qr-img" src={castQr} alt="QR VGFA-Cast" width={175} height={175} />
                )}
                <div className="copy-row">
                  <input
                    className="field mono"
                    readOnly
                    value={castUrl || `/watch/${castCode}`}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Link do amigo"
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      void navigator.clipboard?.writeText(castUrl || `${window.location.origin}/watch/${castCode}`);
                      showToast('Link VGFA-Cast copiado!');
                    }}
                  >
                    Copiar link
                  </button>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    stopVgfaCast();
                    setShowCastModal(false);
                  }}
                >
                  Encerrar transmissão
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
