import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONTROLLER_PROFILES,
  PAD_BIT,
  type ButtonSpec,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';
import '../styles/pad.css';

type PadInput = Omit<PadState, 'slot' | 'seq'>;

interface Props {
  consoleId: ConsoleId;
  gameTitle: string;
  slot: number;
  transport: 'webrtc' | 'ws' | 'relay' | 'preview';
  rumbleActive: boolean;
  onStateChange: (state: PadInput) => void;
  onConsolePreviewChange?: (consoleId: ConsoleId) => void;
  onExit?: () => void;
  /** aviso de conexão (ex.: aguardando a tela do jogo voltar) */
  notice?: string | null;
}

type PointerRole =
  | { kind: 'btn'; bit: number }
  | { kind: 'dpad'; el: HTMLElement }
  | { kind: 'stick'; which: 'l' | 'r'; el: HTMLElement };

const TRANSPORT_LABEL: Record<Props['transport'], { text: string; tone: string }> = {
  webrtc: { text: 'Direto · WebRTC', tone: 'good' },
  ws: { text: 'Wi-Fi local', tone: 'good' },
  relay: { text: 'Pela internet', tone: 'warn' },
  preview: { text: 'Pré-visualização', tone: 'idle' },
};

function dpadBitsFrom(el: HTMLElement, x: number, y: number): number {
  const r = el.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height / 2);
  const radius = Math.min(r.width, r.height) / 2;
  if (Math.hypot(dx, dy) < radius * 0.18) return 0;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = direita, 90 = baixo
  let bits = 0;
  if (angle > -67.5 && angle < 67.5) bits |= PAD_BIT.RIGHT;
  if (angle > 22.5 && angle < 157.5) bits |= PAD_BIT.DOWN;
  if (angle > 112.5 || angle < -112.5) bits |= PAD_BIT.LEFT;
  if (angle > -157.5 && angle < -22.5) bits |= PAD_BIT.UP;
  return bits;
}

function stickFrom(el: HTMLElement, x: number, y: number): { nx: number; ny: number; px: number; py: number } {
  const r = el.getBoundingClientRect();
  const maxR = r.width * 0.34;
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height / 2);
  const dist = Math.hypot(dx, dy) || 1;
  const k = dist > maxR ? maxR / dist : 1;
  return { nx: (dx * k) / maxR, ny: (dy * k) / maxR, px: dx * k, py: dy * k };
}

/**
 * Controle do celular VGFA (v0.7).
 * - Um único "motor de toque" na tela inteira: o dedo pode DESLIZAR de um botão para outro
 *   (B→A no Mario), vários dedos ao mesmo tempo, direcional com diagonais.
 * - O layout muda sozinho conforme o console que está rodando na tela principal.
 */
export const GamepadPhoneView: React.FC<Props> = ({
  consoleId,
  gameTitle,
  slot,
  transport,
  rumbleActive,
  onStateChange,
  onConsolePreviewChange,
  onExit,
  notice,
}) => {
  const profile = CONTROLLER_PROFILES[consoleId];
  const rootRef = useRef<HTMLDivElement | null>(null);
  const knobL = useRef<HTMLDivElement | null>(null);
  const knobR = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, PointerRole>());
  const dpadBits = useRef(new Map<number, number>());
  const sticks = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const lastSent = useRef('');
  const lastMask = useRef(0);
  const [pressedMask, setPressedMask] = useState(0);
  const [pressureLevel, setPressureLevel] = useState(1);
  const pressureRef = useRef(1);
  pressureRef.current = pressureLevel;
  const [haptics, setHaptics] = useState(() => {
    try {
      return localStorage.getItem('vgfa:pad-haptics') !== 'off';
    } catch {
      return true;
    }
  });
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [canFullscreen] = useState(
    () => typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function',
  );

  // Aviso "controle sincronizado" quando o console da tela principal muda
  const firstConsole = useRef(true);
  useEffect(() => {
    if (firstConsole.current) {
      firstConsole.current = false;
      setSyncToast(`Controle ${profile.title} pronto`);
    } else {
      setSyncToast(`Controle trocado para ${profile.title}`);
    }
    const t = setTimeout(() => setSyncToast(null), 2600);
    return () => clearTimeout(t);
  }, [profile.title]);

  // Mantém a tela do celular acesa enquanto joga
  useEffect(() => {
    if (transport === 'preview') return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    const acquire = async () => {
      try {
        if (nav.wakeLock && document.visibilityState === 'visible') lock = await nav.wakeLock.request('screen');
      } catch {
        // sem suporte ou negado
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, [transport]);

  const publish = useCallback(() => {
    let mask = 0;
    for (const role of pointers.current.values()) if (role.kind === 'btn') mask |= role.bit;
    for (const bits of dpadBits.current.values()) mask |= bits;
    const p = pressureRef.current;
    const s = sticks.current;
    const state: PadInput = {
      buttons: mask,
      lx: s.lx,
      ly: s.ly,
      rx: s.rx,
      ry: s.ry,
      l2Pressure: mask & PAD_BIT.L2 ? p : 0,
      r2Pressure: mask & PAD_BIT.R2 ? p : 0,
      crossPressure: mask & PAD_BIT.SOUTH ? p : 0,
      squarePressure: mask & PAD_BIT.WEST ? p : 0,
    };
    const key = `${mask}|${s.lx.toFixed(2)}|${s.ly.toFixed(2)}|${s.rx.toFixed(2)}|${s.ry.toFixed(2)}|${p}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    const gained = mask & ~lastMask.current;
    if (gained && hapticsRef.current && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(9);
      } catch {}
    }
    if (mask !== lastMask.current) {
      lastMask.current = mask;
      setPressedMask(mask);
    }
    onStateChange(state);
  }, [onStateChange]);

  const setKnob = (which: 'l' | 'r', px: number, py: number) => {
    const el = which === 'l' ? knobL.current : knobR.current;
    if (el) el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
  };

  const hitTest = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest('[data-bit],[data-zone]') as HTMLElement | null) ?? null;
  };

  const applyPointer = (id: number, role: PointerRole, x: number, y: number) => {
    if (role.kind === 'dpad') {
      dpadBits.current.set(id, dpadBitsFrom(role.el, x, y));
    } else if (role.kind === 'stick') {
      const v = stickFrom(role.el, x, y);
      if (role.which === 'l') {
        sticks.current.lx = v.nx;
        sticks.current.ly = v.ny;
      } else {
        sticks.current.rx = v.nx;
        sticks.current.ry = v.ny;
      }
      setKnob(role.which, v.px, v.py);
    }
  };

  const releasePointer = (id: number) => {
    const role = pointers.current.get(id);
    pointers.current.delete(id);
    dpadBits.current.delete(id);
    if (role?.kind === 'stick') {
      if (role.which === 'l') {
        sticks.current.lx = 0;
        sticks.current.ly = 0;
      } else {
        sticks.current.rx = 0;
        sticks.current.ry = 0;
      }
      setKnob(role.which, 0, 0);
    }
  };

  const releaseEverything = useCallback(() => {
    for (const id of Array.from(pointers.current.keys())) releasePointer(id);
    publish();
  }, [publish]);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = hitTest(e.clientX, e.clientY);
    if (!target) return;
    if (target.dataset.noPad !== undefined) return; // controles da barra superior
    e.preventDefault();
    let role: PointerRole | null = null;
    if (target.dataset.zone === 'dpad') role = { kind: 'dpad', el: target };
    else if (target.dataset.zone === 'stick-l') role = { kind: 'stick', which: 'l', el: target };
    else if (target.dataset.zone === 'stick-r') role = { kind: 'stick', which: 'r', el: target };
    else if (target.dataset.bit) role = { kind: 'btn', bit: Number(target.dataset.bit) };
    if (!role) return;
    pointers.current.set(e.pointerId, role);
    try {
      rootRef.current?.setPointerCapture(e.pointerId);
    } catch {}
    applyPointer(e.pointerId, role, e.clientX, e.clientY);
    publish();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const role = pointers.current.get(e.pointerId);
    if (!role) return;
    e.preventDefault();
    if (role.kind === 'btn') {
      // Deslizar: troca de botão ao passar o dedo por cima de outro
      const target = hitTest(e.clientX, e.clientY);
      const bit = target?.dataset.bit ? Number(target.dataset.bit) : 0;
      if (bit !== role.bit) {
        if (bit) pointers.current.set(e.pointerId, { kind: 'btn', bit });
        else pointers.current.set(e.pointerId, { kind: 'btn', bit: 0 });
      }
    } else {
      applyPointer(e.pointerId, role, e.clientX, e.clientY);
    }
    publish();
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    releasePointer(e.pointerId);
    publish();
  };

  // Celular bloqueou / app em segundo plano / janela perdeu foco: solta tudo
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') releaseEverything();
    };
    window.addEventListener('blur', releaseEverything);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', releaseEverything);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [releaseEverything]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await orientation.lock?.('landscape').catch(() => {});
      }
    } catch {
      // iPhone não permite tela cheia fora de vídeo: use "Adicionar à Tela de Início"
    }
  };

  const toggleHaptics = () => {
    const next = !haptics;
    setHaptics(next);
    try {
      localStorage.setItem('vgfa:pad-haptics', next ? 'on' : 'off');
    } catch {}
  };

  const isOn = (bit: number) => (pressedMask & bit) !== 0;
  const leftShoulders = profile.shoulders.filter((s) => s.name === 'L1' || s.name === 'L2');
  const rightShoulders = profile.shoulders.filter((s) => s.name === 'R1' || s.name === 'R2');
  const face = (name: ButtonSpec['name']) => profile.faceButtons.find((b) => b.name === name);
  const faceBtn = (b: ButtonSpec | undefined, cls = '') =>
    b ? (
      <div
        key={b.name}
        data-bit={b.bit}
        className={`vp-face ${cls} ${isOn(b.bit) ? 'is-on' : ''}`}
        style={{ '--btn': b.color, '--btn-text': b.textColor ?? '#fff' } as React.CSSProperties}
      >
        <span>{b.label}</span>
      </div>
    ) : (
      <div className={`vp-face-gap ${cls}`} />
    );

  const tone = TRANSPORT_LABEL[transport];
  const showDpad = profile.dpadStyle !== 'joystick';

  return (
    <div
      ref={rootRef}
      className={`vp-root ${rumbleActive ? 'is-rumble' : ''}`}
      style={{ '--shell': profile.shellAccent } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="vp-ambient" aria-hidden />

      <header className="vp-top">
        <div className="vp-id">
          <span className="vp-slot">P{slot + 1}</span>
          <div className="vp-titles">
            <strong>{profile.title}</strong>
            <span>{gameTitle}</span>
          </div>
        </div>
        <div className="vp-actions">
          {onConsolePreviewChange && (
            <select
              data-no-pad
              className="vp-select"
              value={consoleId}
              onChange={(e) => onConsolePreviewChange(e.target.value as ConsoleId)}
            >
              {(Object.keys(CONTROLLER_PROFILES) as ConsoleId[]).map((id) => (
                <option key={id} value={id}>
                  {CONTROLLER_PROFILES[id].title}
                </option>
              ))}
            </select>
          )}
          <span className={`vp-link tone-${tone.tone}`}>
            <i />
            {tone.text}
          </span>
          <button data-no-pad className="vp-icon" onClick={toggleHaptics} aria-label="Vibração">
            {haptics ? '📳' : '🔕'}
          </button>
          {canFullscreen && (
            <button data-no-pad className="vp-icon" onClick={() => void toggleFullscreen()} aria-label="Tela cheia">
              ⛶
            </button>
          )}
          {onExit && (
            <button data-no-pad className="vp-icon" onClick={onExit} aria-label="Sair">
              ✕
            </button>
          )}
        </div>
      </header>

      {notice ? (
        <div className="vp-toast is-notice">
          <span className="vp-dot" /> {notice}
        </div>
      ) : (
        syncToast && <div className="vp-toast">{syncToast}</div>
      )}

      {profile.shoulders.length > 0 && (
        <div className="vp-shoulders">
          <div className="vp-shoulder-group">
            {leftShoulders.map((s) => (
              <div key={s.name} data-bit={s.bit} className={`vp-shoulder ${isOn(s.bit) ? 'is-on' : ''}`}>
                {s.label}
              </div>
            ))}
          </div>
          <div className="vp-shoulder-group">
            {rightShoulders.map((s) => (
              <div key={s.name} data-bit={s.bit} className={`vp-shoulder ${isOn(s.bit) ? 'is-on' : ''}`}>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <main className="vp-deck">
        <section className="vp-side vp-left">
          {showDpad && (
            <div data-zone="dpad" className="vp-dpad">
              <div className={`vp-arm up ${isOn(PAD_BIT.UP) ? 'is-on' : ''}`}>▲</div>
              <div className={`vp-arm left ${isOn(PAD_BIT.LEFT) ? 'is-on' : ''}`}>◀</div>
              <div className="vp-hub" />
              <div className={`vp-arm right ${isOn(PAD_BIT.RIGHT) ? 'is-on' : ''}`}>▶</div>
              <div className={`vp-arm down ${isOn(PAD_BIT.DOWN) ? 'is-on' : ''}`}>▼</div>
            </div>
          )}
          {profile.hasLeftStick && (
            <div data-zone="stick-l" className={`vp-stick ${showDpad ? 'is-small' : ''}`}>
              <div ref={knobL} className="vp-knob" />
              <span className="vp-stick-label">{showDpad ? 'L' : 'JOYSTICK'}</span>
            </div>
          )}
        </section>

        <section className="vp-center">
          <div className="vp-center-row">
            {profile.centerButtons.map((b) => (
              <div key={b.name} data-bit={b.bit} className={`vp-pill ${isOn(b.bit) ? 'is-on' : ''}`}>
                {b.label}
              </div>
            ))}
          </div>
          {profile.hasPressureButtons && (
            <label className="vp-pressure" data-no-pad>
              <span>Pressão {Math.round(pressureLevel * 100)}%</span>
              <input
                data-no-pad
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={pressureLevel}
                onChange={(e) => setPressureLevel(Number(e.target.value))}
              />
            </label>
          )}
        </section>

        <section className="vp-side vp-right">
          {profile.faceButtons.length === 1 ? (
            <div className="vp-face-solo">{faceBtn(profile.faceButtons[0], 'is-big')}</div>
          ) : profile.faceButtons.length === 2 ? (
            <div className="vp-face-duo">
              {faceBtn(face('SOUTH'), 'pos-low')}
              {faceBtn(face('EAST'), 'pos-high')}
            </div>
          ) : (
            <div className="vp-face-diamond">
              {faceBtn(face('NORTH'), 'pos-n')}
              {faceBtn(face('WEST'), 'pos-w')}
              {faceBtn(face('EAST'), 'pos-e')}
              {faceBtn(face('SOUTH'), 'pos-s')}
            </div>
          )}
          {profile.hasRightStick && (
            <div data-zone="stick-r" className="vp-stick is-small">
              <div ref={knobR} className="vp-knob" />
              <span className="vp-stick-label">R</span>
            </div>
          )}
        </section>
      </main>

      <div className="vp-rotate-hint">Gire o celular para jogar deitado ↻</div>
    </div>
  );
};
