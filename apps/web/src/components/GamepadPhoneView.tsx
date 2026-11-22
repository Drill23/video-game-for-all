import React, { useCallback, useRef, useState } from 'react';
import {
  CONTROLLER_PROFILES,
  PAD_BIT,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';

interface Props {
  consoleId: ConsoleId;
  gameTitle: string;
  slot: number;
  transport: 'webrtc' | 'ws' | 'preview';
  rumbleActive: boolean;
  onStateChange: (state: Omit<PadState, 'slot' | 'seq'>) => void;
  onConsolePreviewChange?: (consoleId: ConsoleId) => void;
}

interface StickProps {
  label: string;
  onMove: (x: number, y: number) => void;
}

const VirtualAnalogStick: React.FC<StickProps> = ({ label, onMove }) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = baseRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = rect.width * 0.36;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const scale = dist > maxR ? maxR / dist : 1;
      const nx = (dx * scale) / maxR;
      const ny = (dy * scale) / maxR;
      setKnob({ x: dx * scale, y: dy * scale });
      onMove(nx, ny);
    },
    [onMove],
  );

  const release = useCallback(() => {
    pointerIdRef.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  }, [onMove]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        ref={baseRef}
        className="stick-base"
        onPointerDown={(e) => {
          e.preventDefault();
          pointerIdRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerIdRef.current !== e.pointerId) return;
          e.preventDefault();
          updateFromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (pointerIdRef.current !== e.pointerId) return;
          release();
        }}
        onPointerCancel={release}
      >
        <div
          className="stick-knob"
          style={{
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-2)', fontWeight: 700 }}>{label}</span>
    </div>
  );
};

/**
 * Interface do Celular como Controle Adaptativo VGFA.
 * Muda automaticamente o layout de botões conforme o console rodando na tela principal
 * (Atari CX40, NES, SNES, Mega Drive, GBA, N64, PS1, PSP e PS2 DualShock 2 com pressão!).
 */
export const GamepadPhoneView: React.FC<Props> = ({
  consoleId,
  gameTitle,
  slot,
  transport,
  rumbleActive,
  onStateChange,
  onConsolePreviewChange,
}) => {
  const profile = CONTROLLER_PROFILES[consoleId];
  const stateRef = useRef<Omit<PadState, 'slot' | 'seq'>>({
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    l2Pressure: 0,
    r2Pressure: 0,
    crossPressure: 0,
    squarePressure: 0,
  });
  const [pressedMask, setPressedMask] = useState(0);
  const [pressureLevel, setPressureLevel] = useState(1);

  const emit = useCallback(() => {
    onStateChange({ ...stateRef.current });
  }, [onStateChange]);

  const setBit = useCallback(
    (bit: number, down: boolean) => {
      const next = down
        ? stateRef.current.buttons | bit
        : stateRef.current.buttons & ~bit;
      stateRef.current.buttons = next;
      if (bit === PAD_BIT.L2) stateRef.current.l2Pressure = down ? pressureLevel : 0;
      if (bit === PAD_BIT.R2) stateRef.current.r2Pressure = down ? pressureLevel : 0;
      if (bit === PAD_BIT.SOUTH) stateRef.current.crossPressure = down ? pressureLevel : 0;
      if (bit === PAD_BIT.WEST) stateRef.current.squarePressure = down ? pressureLevel : 0;
      setPressedMask(next);
      emit();
    },
    [emit, pressureLevel],
  );

  const bindTouch = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setBit(bit, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setBit(bit, false);
    },
    onPointerCancel: () => setBit(bit, false),
  });

  const leftShoulders = profile.shoulders.filter((s) => s.name === 'L1' || s.name === 'L2');
  const rightShoulders = profile.shoulders.filter((s) => s.name === 'R1' || s.name === 'R2');

  const faceByPos = {
    north: profile.faceButtons.find((b) => b.name === 'NORTH'),
    west: profile.faceButtons.find((b) => b.name === 'WEST'),
    east: profile.faceButtons.find((b) => b.name === 'EAST'),
    south: profile.faceButtons.find((b) => b.name === 'SOUTH'),
  };

  return (
    <div
      className="pad-fullscreen"
      style={{
        boxShadow: rumbleActive ? `inset 0 0 42px ${profile.shellAccent}` : undefined,
      }}
    >
      {/* Top Status Bar */}
      <div className="pad-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="badge"
            style={{ background: profile.shellAccent, color: '#07080d', borderColor: 'transparent' }}
          >
            P{slot + 1}
          </span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{profile.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{gameTitle}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onConsolePreviewChange && (
            <select
              className="lang-select"
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
          <span className="badge" style={{ color: transport === 'webrtc' ? '#34d399' : '#38bdf8' }}>
            {transport === 'webrtc' ? 'WebRTC P2P' : transport === 'ws' ? 'WS LAN' : 'Preview'}
          </span>
        </div>
      </div>

      {/* Shoulders L1/L2 & R1/R2 */}
      {profile.shoulders.length > 0 && (
        <div className="pad-shoulders">
          <div style={{ display: 'flex', gap: 8 }}>
            {leftShoulders.map((s) => (
              <button
                key={s.name}
                className={`shoulder-btn ${pressedMask & s.bit ? 'pressed' : ''}`}
                {...bindTouch(s.bit)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {rightShoulders.map((s) => (
              <button
                key={s.name}
                className={`shoulder-btn ${pressedMask & s.bit ? 'pressed' : ''}`}
                {...bindTouch(s.bit)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Controller Deck */}
      <div className="pad-deck">
        {/* Left Side: D-Pad + Optional Left Stick */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {profile.dpadStyle !== 'joystick' && (
            <div className="dpad-grid">
              <div />
              <button
                className={`dpad-key ${pressedMask & PAD_BIT.UP ? 'pressed' : ''}`}
                {...bindTouch(PAD_BIT.UP)}
              >
                ▲
              </button>
              <div />
              <button
                className={`dpad-key ${pressedMask & PAD_BIT.LEFT ? 'pressed' : ''}`}
                {...bindTouch(PAD_BIT.LEFT)}
              >
                ◀
              </button>
              <div
                style={{
                  borderRadius: 10,
                  background: '#0f1626',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              />
              <button
                className={`dpad-key ${pressedMask & PAD_BIT.RIGHT ? 'pressed' : ''}`}
                {...bindTouch(PAD_BIT.RIGHT)}
              >
                ▶
              </button>
              <div />
              <button
                className={`dpad-key ${pressedMask & PAD_BIT.DOWN ? 'pressed' : ''}`}
                {...bindTouch(PAD_BIT.DOWN)}
              >
                ▼
              </button>
              <div />
            </div>
          )}

          {profile.hasLeftStick && (
            <VirtualAnalogStick
              label={profile.dpadStyle === 'joystick' ? 'JOYSTICK CX40' : 'L-STICK'}
              onMove={(x, y) => {
                stateRef.current.lx = x;
                stateRef.current.ly = y;
                emit();
              }}
            />
          )}
        </div>

        {/* Center Buttons (SELECT / START / PS2 Pressure Slider) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {profile.centerButtons.map((b) => (
              <button
                key={b.name}
                className={`shoulder-btn ${pressedMask & b.bit ? 'pressed' : ''}`}
                style={{ minWidth: 64, padding: '8px 12px', fontSize: 11 }}
                {...bindTouch(b.bit)}
              >
                {b.label}
              </button>
            ))}
          </div>

          {profile.hasPressureButtons && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--border)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 4 }}>
                Pressão DualShock 2: {Math.round(pressureLevel * 100)}%
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={pressureLevel}
                onChange={(e) => setPressureLevel(Number(e.target.value))}
                style={{ width: 120 }}
              />
            </div>
          )}
        </div>

        {/* Right Side: Face Buttons + Optional Right Stick */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {profile.faceButtons.length === 1 ? (
            <button
              className={`face-btn ${pressedMask & profile.faceButtons[0].bit ? 'pressed' : ''}`}
              style={{
                width: 96,
                height: 96,
                background: profile.faceButtons[0].color,
                color: profile.faceButtons[0].textColor ?? '#FFF',
                fontSize: 16,
              }}
              {...bindTouch(profile.faceButtons[0].bit)}
            >
              {profile.faceButtons[0].label}
            </button>
          ) : profile.faceButtons.length === 2 ? (
            <div style={{ display: 'flex', gap: 16 }}>
              {profile.faceButtons.map((b) => (
                <button
                  key={b.name}
                  className={`face-btn ${pressedMask & b.bit ? 'pressed' : ''}`}
                  style={{
                    width: 68,
                    height: 68,
                    background: b.color,
                    color: b.textColor ?? '#FFF',
                  }}
                  {...bindTouch(b.bit)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="face-diamond">
              <div />
              {faceByPos.north ? (
                <button
                  className={`face-btn ${pressedMask & faceByPos.north.bit ? 'pressed' : ''}`}
                  style={{
                    background: faceByPos.north.color,
                    color: faceByPos.north.textColor ?? '#FFF',
                  }}
                  {...bindTouch(faceByPos.north.bit)}
                >
                  {faceByPos.north.label}
                </button>
              ) : (
                <div />
              )}
              <div />
              {faceByPos.west ? (
                <button
                  className={`face-btn ${pressedMask & faceByPos.west.bit ? 'pressed' : ''}`}
                  style={{
                    background: faceByPos.west.color,
                    color: faceByPos.west.textColor ?? '#FFF',
                  }}
                  {...bindTouch(faceByPos.west.bit)}
                >
                  {faceByPos.west.label}
                </button>
              ) : (
                <div />
              )}
              <div />
              {faceByPos.east ? (
                <button
                  className={`face-btn ${pressedMask & faceByPos.east.bit ? 'pressed' : ''}`}
                  style={{
                    background: faceByPos.east.color,
                    color: faceByPos.east.textColor ?? '#FFF',
                  }}
                  {...bindTouch(faceByPos.east.bit)}
                >
                  {faceByPos.east.label}
                </button>
              ) : (
                <div />
              )}
              <div />
              {faceByPos.south ? (
                <button
                  className={`face-btn ${pressedMask & faceByPos.south.bit ? 'pressed' : ''}`}
                  style={{
                    background: faceByPos.south.color,
                    color: faceByPos.south.textColor ?? '#FFF',
                  }}
                  {...bindTouch(faceByPos.south.bit)}
                >
                  {faceByPos.south.label}
                </button>
              ) : (
                <div />
              )}
              <div />
            </div>
          )}

          {profile.hasRightStick && (
            <VirtualAnalogStick
              label="R-STICK"
              onMove={(x, y) => {
                stateRef.current.rx = x;
                stateRef.current.ry = y;
                emit();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
