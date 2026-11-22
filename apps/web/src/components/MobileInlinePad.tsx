import React, { useCallback, useRef, useState } from 'react';
import {
  CONTROLLER_PROFILES,
  PAD_BIT,
  type ConsoleId,
  type PadState,
} from '@vgfa/pad';

interface Props {
  consoleId: ConsoleId;
  onStateChange: (state: PadState) => void;
}

/**
 * Controle Virtual Embutido para quando o usuário abre o VGFA diretamente no celular.
 * - Em modo Retrato (em pé): ocupa a metade inferior dedicada (ZERO sobreposição na tela do jogo!).
 * - Em modo Paisagem (deitado): zonas ergonômicas laterais estilo PSP / Switch com safe-area para iPhone!
 * - Adapta automaticamente os botões ao console rodando (Atari, NES, SNES, Mega Drive, GBA, N64, PS1, PSP, PS2).
 */
export const MobileInlinePad: React.FC<Props> = ({ consoleId, onStateChange }) => {
  const profile = CONTROLLER_PROFILES[consoleId];
  const stateRef = useRef<PadState>({
    slot: 0,
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    l2Pressure: 0,
    r2Pressure: 0,
    crossPressure: 0,
    squarePressure: 0,
    seq: 0,
  });
  const [pressedMask, setPressedMask] = useState(0);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const stickBaseRef = useRef<HTMLDivElement | null>(null);
  const stickPointerRef = useRef<number | null>(null);

  const emit = useCallback(() => {
    stateRef.current.seq++;
    onStateChange({ ...stateRef.current });
  }, [onStateChange]);

  const setBit = useCallback(
    (bit: number, down: boolean) => {
      const next = down
        ? stateRef.current.buttons | bit
        : stateRef.current.buttons & ~bit;
      stateRef.current.buttons = next;
      if (bit === PAD_BIT.L2) stateRef.current.l2Pressure = down ? 1 : 0;
      if (bit === PAD_BIT.R2) stateRef.current.r2Pressure = down ? 1 : 0;
      if (bit === PAD_BIT.SOUTH) stateRef.current.crossPressure = down ? 1 : 0;
      if (bit === PAD_BIT.WEST) stateRef.current.squarePressure = down ? 1 : 0;
      setPressedMask(next);
      if (down && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
      emit();
    },
    [emit],
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

  const updateStick = (clientX: number, clientY: number) => {
    const el = stickBaseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const maxR = r.width * 0.36;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const d = Math.hypot(dx, dy);
    const s = d > maxR ? maxR / d : 1;
    setStickPos({ x: dx * s, y: dy * s });
    stateRef.current.lx = (dx * s) / maxR;
    stateRef.current.ly = (dy * s) / maxR;
    emit();
  };

  const releaseStick = () => {
    stickPointerRef.current = null;
    setStickPos({ x: 0, y: 0 });
    stateRef.current.lx = 0;
    stateRef.current.ly = 0;
    emit();
  };

  const leftShoulders = profile.shoulders.filter((s) => s.name === 'L1' || s.name === 'L2');
  const rightShoulders = profile.shoulders.filter((s) => s.name === 'R1' || s.name === 'R2');

  const faceByPos = {
    north: profile.faceButtons.find((b) => b.name === 'NORTH'),
    west: profile.faceButtons.find((b) => b.name === 'WEST'),
    east: profile.faceButtons.find((b) => b.name === 'EAST'),
    south: profile.faceButtons.find((b) => b.name === 'SOUTH'),
  };

  return (
    <div className="mobile-deck">
      {/* Ombros (L1/L2 & R1/R2) */}
      {profile.shoulders.length > 0 && (
        <div className="mobile-deck-shoulders">
          <div style={{ display: 'flex', gap: 6 }}>
            {leftShoulders.map((s) => (
              <button
                key={s.name}
                className={`mobile-shoulder ${pressedMask & s.bit ? 'pressed' : ''}`}
                {...bindTouch(s.bit)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-2)', fontWeight: 700, alignSelf: 'center' }}>
            {profile.title}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {rightShoulders.map((s) => (
              <button
                key={s.name}
                className={`mobile-shoulder ${pressedMask & s.bit ? 'pressed' : ''}`}
                {...bindTouch(s.bit)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Zona Principal Esquerda + Centro + Direita */}
      <div className="mobile-deck-main">
        {/* Esquerda: D-Pad ou Joystick */}
        <div className="mobile-zone-left">
          {profile.dpadStyle === 'joystick' ? (
            <div
              ref={stickBaseRef}
              className="mobile-stick"
              onPointerDown={(e) => {
                e.preventDefault();
                stickPointerRef.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateStick(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (stickPointerRef.current !== e.pointerId) return;
                e.preventDefault();
                updateStick(e.clientX, e.clientY);
              }}
              onPointerUp={releaseStick}
              onPointerCancel={releaseStick}
            >
              <div
                className="mobile-stick-knob"
                style={{ transform: `translate(calc(-50% + ${stickPos.x}px), calc(-50% + ${stickPos.y}px))` }}
              />
            </div>
          ) : (
            <div className="mobile-dpad">
              <div />
              <button className={`mobile-dkey ${pressedMask & PAD_BIT.UP ? 'pressed' : ''}`} {...bindTouch(PAD_BIT.UP)}>
                ▲
              </button>
              <div />
              <button className={`mobile-dkey ${pressedMask & PAD_BIT.LEFT ? 'pressed' : ''}`} {...bindTouch(PAD_BIT.LEFT)}>
                ◀
              </button>
              <div className="mobile-dcenter" />
              <button className={`mobile-dkey ${pressedMask & PAD_BIT.RIGHT ? 'pressed' : ''}`} {...bindTouch(PAD_BIT.RIGHT)}>
                ▶
              </button>
              <div />
              <button className={`mobile-dkey ${pressedMask & PAD_BIT.DOWN ? 'pressed' : ''}`} {...bindTouch(PAD_BIT.DOWN)}>
                ▼
              </button>
              <div />
            </div>
          )}
        </div>

        {/* Centro: SELECT / START */}
        <div className="mobile-zone-center">
          {profile.centerButtons
            .filter((b) => b.name === 'SELECT' || b.name === 'START')
            .map((b) => (
              <button
                key={b.name}
                className={`mobile-center-btn ${pressedMask & b.bit ? 'pressed' : ''}`}
                {...bindTouch(b.bit)}
              >
                {b.label}
              </button>
            ))}
        </div>

        {/* Direita: Botões de Ação */}
        <div className="mobile-zone-right">
          {profile.faceButtons.length === 1 ? (
            <button
              className={`mobile-face-lg ${pressedMask & profile.faceButtons[0].bit ? 'pressed' : ''}`}
              style={{
                background: profile.faceButtons[0].color,
                color: profile.faceButtons[0].textColor ?? '#FFF',
              }}
              {...bindTouch(profile.faceButtons[0].bit)}
            >
              {profile.faceButtons[0].label}
            </button>
          ) : profile.faceButtons.length === 2 ? (
            <div style={{ display: 'flex', gap: 12 }}>
              {profile.faceButtons.map((b) => (
                <button
                  key={b.name}
                  className={`mobile-face-md ${pressedMask & b.bit ? 'pressed' : ''}`}
                  style={{ background: b.color, color: b.textColor ?? '#FFF' }}
                  {...bindTouch(b.bit)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mobile-diamond">
              <div />
              {faceByPos.north ? (
                <button
                  className={`mobile-face-sm ${pressedMask & faceByPos.north.bit ? 'pressed' : ''}`}
                  style={{ background: faceByPos.north.color, color: faceByPos.north.textColor ?? '#FFF' }}
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
                  className={`mobile-face-sm ${pressedMask & faceByPos.west.bit ? 'pressed' : ''}`}
                  style={{ background: faceByPos.west.color, color: faceByPos.west.textColor ?? '#FFF' }}
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
                  className={`mobile-face-sm ${pressedMask & faceByPos.east.bit ? 'pressed' : ''}`}
                  style={{ background: faceByPos.east.color, color: faceByPos.east.textColor ?? '#FFF' }}
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
                  className={`mobile-face-sm ${pressedMask & faceByPos.south.bit ? 'pressed' : ''}`}
                  style={{ background: faceByPos.south.color, color: faceByPos.south.textColor ?? '#FFF' }}
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
        </div>
      </div>
    </div>
  );
};
