import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BluetoothGamepadAdapter,
  CONTROLLER_PROFILES,
  PAD_BIT,
  detectPressedSource,
  saveCustomBinding,
  type ConsoleId,
  type GamepadBinding,
  type GamepadDescriptor,
  type PadButtonName,
  type PadInputSource,
  type PadState,
} from '@vgfa/pad';
import '../styles/controller-setup.css';

interface Props {
  adapter: BluetoothGamepadAdapter;
  consoleId: ConsoleId;
  onClose: () => void;
}

interface Step {
  name: PadButtonName;
  label: string;
}

const KIND_LABEL: Record<GamepadDescriptor['mapping'], string> = {
  standard: 'Reconhecido (padrão)',
  profile: 'Perfil automático',
  custom: 'Mapeamento seu',
  generic: 'Genérico (automático)',
};

function stepsFor(consoleId: ConsoleId): Step[] {
  const p = CONTROLLER_PROFILES[consoleId];
  const steps: Step[] = [
    { name: 'UP', label: '▲ Cima' },
    { name: 'DOWN', label: '▼ Baixo' },
    { name: 'LEFT', label: '◀ Esquerda' },
    { name: 'RIGHT', label: '▶ Direita' },
  ];
  for (const b of p.faceButtons) steps.push({ name: b.name, label: `Botão ${b.label}` });
  for (const b of p.shoulders) steps.push({ name: b.name, label: `Gatilho ${b.label}` });
  for (const b of p.centerButtons) steps.push({ name: b.name, label: b.label });
  return steps;
}

function describeSource(src: PadInputSource): string {
  if (src.type === 'button') return `botão ${src.index}`;
  if (src.type === 'hat') return `direcional (eixo ${src.index})`;
  return `eixo ${src.index} ${src.dir > 0 ? '+' : '−'}`;
}

/**
 * Testar e configurar controles Bluetooth/USB: mostra ao vivo o que o jogo está recebendo
 * e permite mapear botão por botão qualquer controle (fica salvo neste aparelho).
 */
export const ControllerSetupModal: React.FC<Props> = ({ adapter, consoleId, onClose }) => {
  const profile = CONTROLLER_PROFILES[consoleId];
  const [pads, setPads] = useState<GamepadDescriptor[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [live, setLive] = useState<PadState | null>(null);
  const [wizard, setWizard] = useState<{ step: number; captured: Partial<Record<PadButtonName, PadInputSource>>; waitRelease: boolean } | null>(null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const baselineRef = useRef<{ buttons: number[]; axes: number[] } | null>(null);
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  const steps = stepsFor(consoleId);

  const selected = pads.find((p) => p.key === selectedKey) ?? pads.find((p) => p.slot === 0) ?? pads[0];

  // Laço de leitura ao vivo (só enquanto a janela está aberta)
  useEffect(() => {
    let raf = 0;
    let lastList = '';
    let lastLive = '';
    const loop = () => {
      const list = adapter.describe();
      const key = list.map((p) => `${p.key}|${p.slot}|${p.mapping}`).join(',');
      if (key !== lastList) {
        lastList = key;
        setPads(list);
      }
      const target = list.find((p) => p.key === selectedKey) ?? list.find((p) => p.slot === 0) ?? list[0];
      const w = wizardRef.current;
      if (target && w) {
        const now = adapter.rawSnapshot(target.key);
        if (now) {
          const anyDown = now.buttons.some((v) => v > 0.5) || now.axes.some((v, i) => i < 8 && Math.abs(v) > 0.6 && Math.abs(v) <= 1.01);
          if (w.waitRelease) {
            if (!anyDown) {
              baselineRef.current = now;
              setWizard({ ...w, waitRelease: false });
            }
          } else {
            const base = baselineRef.current ?? now;
            const src = detectPressedSource(base, now);
            if (src) {
              const step = steps[w.step];
              const captured = { ...w.captured, [step.name]: src };
              setLastCapture(`${step.label} → ${describeSource(src)}`);
              if (w.step + 1 >= steps.length) {
                finish(target, captured);
              } else {
                setWizard({ step: w.step + 1, captured, waitRelease: true });
              }
            }
          }
        }
      } else if (target) {
        const states = adapter.pollAll();
        const st = target.slot >= 0 ? states.get(target.slot) ?? null : null;
        const lk = st ? `${st.buttons}|${st.lx.toFixed(2)}|${st.ly.toFixed(2)}|${st.rx.toFixed(2)}|${st.ry.toFixed(2)}` : '';
        if (lk !== lastLive) {
          lastLive = lk;
          setLive(st);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, selectedKey, consoleId]);

  const finish = useCallback(
    (target: GamepadDescriptor, captured: Partial<Record<PadButtonName, PadInputSource>>) => {
      const binding: GamepadBinding = {
        buttons: captured,
        axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: target.id.match(/2dc8|054c/i) ? 5 : 3 } },
        autoDpad: !captured.UP,
      };
      saveCustomBinding(target.id, binding);
      adapter.invalidateBindings();
      setWizard(null);
      setSaved(`Pronto! "${target.name}" ficou mapeado neste aparelho.`);
    },
    [adapter],
  );

  const startWizard = () => {
    if (!selected) return;
    setSaved(null);
    setLastCapture(null);
    baselineRef.current = adapter.rawSnapshot(selected.key);
    setWizard({ step: 0, captured: {}, waitRelease: true });
  };

  const skipStep = () => {
    const w = wizardRef.current;
    if (!w || !selected) return;
    if (w.step + 1 >= steps.length) finish(selected, w.captured);
    else setWizard({ ...w, step: w.step + 1, waitRelease: true });
  };

  const resetMapping = () => {
    if (!selected) return;
    saveCustomBinding(selected.id, null);
    adapter.invalidateBindings();
    setSaved('Voltou para o reconhecimento automático.');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const on = (bit: number) => !!live && (live.buttons & bit) !== 0;
  const face = (name: PadButtonName) => profile.faceButtons.find((b) => b.name === name);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card cs-card" role="dialog" aria-modal="true" aria-label="Controles" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🎮 Controles Bluetooth / USB</h3>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {pads.length === 0 ? (
          <div className="cs-empty">
            <div className="cs-pulse" />
            <p>
              <b>Aperte qualquer botão do controle.</b> Por segurança, o navegador só mostra o controle depois do
              primeiro aperto com esta página aberta.
            </p>
            <ul>
              <li>Pareie antes no Bluetooth do aparelho (iPhone/iPad, Android, Windows, Mac, Fire TV).</li>
              <li>
                <b>8BitDo:</b> no iPhone/iPad/Mac use o modo <b>Switch</b> (geralmente START+Y ao ligar) ou <b>macOS</b>{' '}
                (START+A); no Windows/Android/Fire TV, o modo <b>X-input</b> (START+X). Qualquer modo funciona aqui —
                se algum botão vier trocado, use “Mapear botões”.
              </li>
              <li>Controles USB funcionam direto no computador.</li>
            </ul>
          </div>
        ) : (
          <>
            <div className="cs-list">
              {pads.map((p) => (
                <button
                  key={p.key}
                  className={`cs-pad ${selected?.key === p.key ? 'is-sel' : ''}`}
                  onClick={() => setSelectedKey(p.key)}
                >
                  <span className="cs-slot">{p.slot >= 0 ? `P${p.slot + 1}` : '—'}</span>
                  <span className="cs-name">
                    <b>{p.name}</b>
                    <small>
                      {KIND_LABEL[p.mapping]} · {p.profileName}
                      {p.slot < 0 ? ' · aperte um botão para ativar' : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>

            {wizard ? (
              <div className="cs-wizard">
                <div className="cs-progress">
                  <i style={{ width: `${(wizard.step / steps.length) * 100}%` }} />
                </div>
                <p className="cs-ask">
                  {wizard.waitRelease ? 'Solte os botões…' : <>Aperte <b>{steps[wizard.step].label}</b> no controle</>}
                </p>
                <small className="cs-step">
                  Passo {wizard.step + 1} de {steps.length}
                  {lastCapture ? ` · último: ${lastCapture}` : ''}
                </small>
                <div className="cs-row">
                  <button className="btn btn-ghost" onClick={skipStep}>
                    Pular este
                  </button>
                  <button className="btn btn-ghost" onClick={() => setWizard(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="cs-hint">Aperte os botões: o que acende aqui é exatamente o que o jogo recebe.</p>
                <div className="cs-live">
                  <div className="cs-dpad">
                    <i className={`u ${on(PAD_BIT.UP) ? 'on' : ''}`} />
                    <i className={`l ${on(PAD_BIT.LEFT) ? 'on' : ''}`} />
                    <i className={`r ${on(PAD_BIT.RIGHT) ? 'on' : ''}`} />
                    <i className={`d ${on(PAD_BIT.DOWN) ? 'on' : ''}`} />
                  </div>
                  <div className="cs-mid">
                    <div className="cs-shoulders">
                      {profile.shoulders.map((b) => (
                        <span key={b.name} className={on(b.bit) ? 'on' : ''}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                    <div className="cs-sticks">
                      <span className="cs-stick">
                        <i style={{ transform: `translate(${(live?.lx ?? 0) * 14}px, ${(live?.ly ?? 0) * 14}px)` }} />
                      </span>
                      <span className="cs-stick">
                        <i style={{ transform: `translate(${(live?.rx ?? 0) * 14}px, ${(live?.ry ?? 0) * 14}px)` }} />
                      </span>
                    </div>
                    <div className="cs-center">
                      {profile.centerButtons.map((b) => (
                        <span key={b.name} className={on(b.bit) ? 'on' : ''}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="cs-face">
                    {(['NORTH', 'WEST', 'EAST', 'SOUTH'] as PadButtonName[]).map((n) => {
                      const b = face(n);
                      return (
                        <span key={n} className={`f-${n.toLowerCase()} ${b ? '' : 'ghost'} ${b && on(b.bit) ? 'on' : ''}`}>
                          {b?.label ?? ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {saved && <div className="cs-saved">{saved}</div>}
                <div className="cs-row">
                  <button className="btn btn-primary" onClick={startWizard} disabled={!selected || selected.slot < 0}>
                    Mapear botões
                  </button>
                  {selected?.mapping === 'custom' && (
                    <button className="btn btn-ghost" onClick={resetMapping}>
                      Restaurar automático
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
