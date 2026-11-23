import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.js';
import { GameCard } from './GameCard.js';
import type { HomeStrings } from './strings.js';

export interface ContinueItem {
  key: string;
  title: string;
  coverUrl?: string;
  accent: string;
  consoleLabel: string;
  rating?: number;
  year?: number;
  /** "Retomar · há 2 h" */
  meta: string;
  /** "3,2 GB" */
  sizeLabel: string;
  onPlay: () => void;
  onDelete: () => Promise<unknown> | void;
}

interface Props {
  s: HomeStrings;
  items: ContinueItem[];
  title: string;
  subtitle: string;
  seeAllLabel: string;
  onSeeAll: () => void;
}

/**
 * "Continuar jogando" em coverflow: o cartaz do centro fica maior; os do lado inclinam e encolhem conforme a
 * distância. Cada cartaz tem um botão ⋯ (sempre visível) com "Apagar do aparelho" em 2 passos.
 * Só o cartaz se transforma; o texto da legenda fica parado.
 */
export const ContinueRow: React.FC<Props> = ({ s, items, title, subtitle, seeAllLabel, onSeeAll }) => {
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const [panel, setPanel] = useState<{ key: string; step: 'menu' | 'confirm' } | null>(null);
  const [busy, setBusy] = useState(false);
  const moreRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const update = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    const mid = sc.scrollLeft + sc.clientWidth / 2;
    const nodes = sc.querySelectorAll<HTMLElement>('.cf-item');
    nodes.forEach((el) => {
      const w = el.offsetWidth || 1;
      const d = (el.offsetLeft + w / 2 - mid) / w;
      const a = Math.min(Math.abs(d), 2);
      const rot = (d === 0 ? 0 : d > 0 ? -1 : 1) * Math.min(a, 1) * 32;
      el.style.setProperty('--cf-rot', `${rot.toFixed(1)}deg`);
      el.style.setProperty('--cf-sc', (1.06 - Math.min(a, 1.5) * 0.12).toFixed(3));
      el.style.setProperty('--cf-op', (1 - Math.min(a, 2) * 0.16).toFixed(2));
      el.dataset.center = a < 0.45 ? '1' : '0';
    });
  }, []);

  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = window.requestAnimationFrame(() => {
      raf.current = 0;
      update();
    });
  }, [update]);

  useLayoutEffect(() => {
    update();
  }, [update, items.length]);

  useEffect(() => {
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      if (raf.current) window.cancelAnimationFrame(raf.current);
    };
  }, [schedule]);

  // Ao abrir o painel (ou passar para a confirmação), leva o foco para o botão certo
  useEffect(() => {
    if (!panel) return;
    scroller.current?.querySelector<HTMLElement>('.gc-sheet [data-autofocus]')?.focus({ preventScroll: true });
  }, [panel]);

  const centerOn = (el: HTMLElement) => {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };

  const closePanel = (key: string) => {
    setPanel(null);
    window.requestAnimationFrame(() => moreRefs.current.get(key)?.focus({ preventScroll: true }));
  };

  const confirmDelete = async (item: ContinueItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await item.onDelete();
    } finally {
      setBusy(false);
      setPanel(null);
    }
  };

  return (
    <section className="row row-continue">
      <div className="row-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button className="row-all" onClick={onSeeAll}>
          {seeAllLabel}
          <Icon name="chevR" size={16} />
        </button>
      </div>
      <div className="cf-wrap">
        <div className="cf-scroller" ref={scroller} onScroll={schedule}>
          {items.map((item) => {
            const open = panel?.key === item.key ? panel : null;
            return (
              <div
                className="cf-item"
                key={item.key}
                data-key={item.key}
                onFocusCapture={(e) => {
                  if (!open) centerOn(e.currentTarget);
                }}
              >
                <GameCard
                  title={item.title}
                  coverUrl={item.coverUrl}
                  accent={item.accent}
                  consoleLabel={item.consoleLabel}
                  rating={item.rating}
                  year={item.year}
                  meta={item.meta}
                  tag={item.sizeLabel}
                  onOpen={() => {
                    const el = scroller.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(item.key)}"]`);
                    if (el && el.dataset.center === '0') {
                      centerOn(el);
                      return;
                    }
                    item.onPlay();
                  }}
                  extra={
                    <button
                      type="button"
                      className="gc-more"
                      aria-label={`${s.cardOptions}: ${item.title}`}
                      title={s.cardOptions}
                      aria-haspopup="dialog"
                      aria-expanded={Boolean(open)}
                      ref={(el) => {
                        if (el) moreRefs.current.set(item.key, el);
                        else moreRefs.current.delete(item.key);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        centerOn(e.currentTarget.closest('.cf-item') as HTMLElement);
                        setPanel(open ? null : { key: item.key, step: 'menu' });
                      }}
                    >
                      <Icon name="more" size={20} />
                    </button>
                  }
                  overlay={
                    open ? (
                      <div
                        className="gc-sheet"
                        role="group"
                        aria-label={s.cardOptions}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
                            e.preventDefault();
                            e.stopPropagation();
                            closePanel(item.key);
                          }
                        }}
                      >
                        {open.step === 'menu' ? (
                          <>
                            <strong className="gc-sheet-title">{item.title}</strong>
                            <button
                              type="button"
                              className="btn btn-danger"
                              data-autofocus
                              onClick={() => setPanel({ key: item.key, step: 'confirm' })}
                            >
                              <Icon name="trash" size={16} /> {s.deleteFromDevice}
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={() => closePanel(item.key)}>
                              {s.close}
                            </button>
                          </>
                        ) : (
                          <>
                            <strong className="gc-sheet-title">{s.deleteConfirmTitle}</strong>
                            <p className="gc-sheet-text">{s.deleteConfirmBody.replace('{size}', item.sizeLabel)}</p>
                            <button
                              type="button"
                              className="btn btn-danger gc-sheet-yes"
                              disabled={busy}
                              onClick={() => void confirmDelete(item)}
                            >
                              {s.deleteYes}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              data-autofocus
                              onClick={() => closePanel(item.key)}
                            >
                              {s.cancel}
                            </button>
                          </>
                        )}
                      </div>
                    ) : null
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
