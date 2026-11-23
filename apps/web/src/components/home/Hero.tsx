import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONSOLE_MAP, type LibraryEntry, type StoreGame } from '@vgfa/runtime';
import type { SupportedLang } from '@vgfa/storage';
import { Cover } from '../Cover.js';
import { Icon } from '../Icon.js';
import { cleanTitle, factLine, highlightsOf, synopsisOf, topRankOf } from './gameMeta.js';
import type { HomeStrings } from './strings.js';

interface Props {
  games: StoreGame[];
  lang: SupportedLang;
  s: HomeStrings;
  /** Entrada do jogo na biblioteca do aparelho (vira "Continuar"). */
  libraryFor: (game: StoreGame) => LibraryEntry | undefined;
  inList: (gameId: string) => boolean;
  onPlay: (game: StoreGame) => void;
  onResume: (game: StoreGame, entry: LibraryEntry) => void;
  onDetails: (game: StoreGame) => void;
  onToggleList: (game: StoreGame) => void;
}

/** Depois de a pessoa mexer (seta, miniatura, deslizar), a troca automática espera esse tempo. */
const HOLD_MS = 14000;

/**
 * Destaque em tela cheia (sem caixa): a capa desfocada vira o ambiente, com Ken Burns lento e crossfade entre
 * destaques. Setas ‹ › de vidro nas laterais, teclas ←/→ (sem foco em nada), deslizar no celular e faixa de
 * miniaturas. A troca automática continua, mas pausa enquanto a pessoa interage.
 */
export const Hero: React.FC<Props> = ({
  games,
  lang,
  s,
  libraryFor,
  inList,
  onPlay,
  onResume,
  onDetails,
  onToggleList,
}) => {
  const n = games.length;
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);
  const holdTimer = useRef<number>(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const hold = useCallback(() => {
    setHeld(true);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setHeld(false), HOLD_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const goTo = useCallback(
    (next: number, manual: boolean) => {
      if (n === 0) return;
      const to = ((next % n) + n) % n;
      if (manual) hold();
      setIdx((cur) => {
        if (cur === to) return cur;
        setPrev(cur);
        return to;
      });
    },
    [n, hold],
  );

  // Só anima enquanto o destaque está na tela
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Teclas ←/→ trocam o destaque quando nada está focado (com foco, as setas movem o foco)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (document.querySelector('.modal-backdrop,[data-nav-scope]')) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== rootRef.current) return;
      if (!visible) return;
      e.preventDefault();
      goTo(idx + (e.key === 'ArrowRight' ? 1 : -1), true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [goTo, idx, visible]);

  // Pré-carrega a capa do próximo destaque
  useEffect(() => {
    if (n < 2) return;
    const url = games[(idx + 1) % n]?.coverUrl;
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
  }, [games, idx, n]);

  const rendered = useMemo(() => {
    const set = new Set<number>([idx, (idx + 1) % Math.max(n, 1)]);
    if (prev !== null) set.add(prev);
    return Array.from(set).filter((i) => i < n);
  }, [idx, prev, n]);

  if (n === 0) return null;
  const game = games[idx % n];
  const def = CONSOLE_MAP[game.consoleId];
  const entry = libraryFor(game);
  const facts = factLine(game, s);
  const highlights = highlightsOf(game);
  const rank = topRankOf(game);
  const kicker =
    rank && (game.consoleId === 'ps1' || game.consoleId === 'ps2') && rank <= 10
      ? s.rankKicker.replace('{n}', String(rank)).replace('{c}', game.consoleId === 'ps2' ? 'PS2' : 'PS1')
      : s.featured;
  const listed = inList(game.id);
  const paused = hover || focusIn || held || !visible;

  return (
    <section
      ref={rootRef}
      className={`hx ${paused ? 'is-paused' : ''} ${visible ? '' : 'is-off'}`}
      aria-roledescription="carousel"
      aria-label={s.featured}
      style={{ ['--ph' as string]: def.accent }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocusIn(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
        hold();
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) goTo(idx + (dx < 0 ? 1 : -1), true);
      }}
    >
      <div className="hx-bg" aria-hidden="true">
        {rendered.map((i) => {
          const g = games[i];
          return (
            <div key={g.id} className={`hx-slide ${i === idx ? 'is-active' : ''}`}>
              <img
                className="hx-bgimg"
                src={g.coverUrl}
                alt=""
                crossOrigin="anonymous"
                decoding="async"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
            </div>
          );
        })}
        <div className="hx-tint" />
        <div className="hx-scrim" />
      </div>

      {n > 1 && (
        <>
          <button
            type="button"
            className="hx-arrow hx-arrow-l"
            aria-label={s.prevSlide}
            onClick={() => goTo(idx - 1, true)}
          >
            <span className="hx-arrow-ico glass">
              <Icon name="chevL" size={26} />
            </span>
          </button>
          <button
            type="button"
            className="hx-arrow hx-arrow-r"
            aria-label={s.nextSlide}
            onClick={() => goTo(idx + 1, true)}
          >
            <span className="hx-arrow-ico glass">
              <Icon name="chevR" size={26} />
            </span>
          </button>
        </>
      )}

      <div className="hx-inner">
        <div className="hx-copy" key={`copy-${game.id}`} aria-live="polite">
          <div className="hx-kicker">
            <Icon name="star" size={14} /> {kicker}
          </div>
          <h1 className="hx-title">{cleanTitle(game.title)}</h1>
          <ul className="hx-facts">
            {facts.map((f) => (
              <li key={f.id} className={f.id === 'rating' ? 'is-rating' : f.id === 'console' ? 'is-console' : undefined}>
                {f.id === 'console' && <i className="dot" style={{ background: def.accent }} />}
                {f.text}
              </li>
            ))}
          </ul>
          {highlights.length > 0 && (
            <ul className="hx-hl">
              {highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <p className="hx-syn">{synopsisOf(game, lang)}</p>
          <div className="hx-actions">
            <button
              className="btn btn-primary btn-lg"
              data-nav-primary
              onClick={() => (entry ? onResume(game, entry) : onPlay(game))}
            >
              <Icon name="play" size={18} /> {entry ? s.resumeBtn : s.play}
            </button>
            <button className="btn btn-lg hx-btn-glass" onClick={() => onDetails(game)}>
              <Icon name="info" size={18} /> {s.details}
            </button>
            <button
              className={`btn btn-lg hx-btn-glass ${listed ? 'is-on' : ''}`}
              aria-pressed={listed}
              onClick={() => onToggleList(game)}
            >
              <Icon name={listed ? 'check' : 'plus'} size={18} /> {listed ? s.inList : s.addList}
            </button>
          </div>
        </div>

        <div className="hx-art" key={`art-${game.id}`}>
          <div className="hx-poster">
            <Cover src={game.coverUrl} title={cleanTitle(game.title)} accent={def.accent} priority />
          </div>
        </div>
      </div>

      {n > 1 && (
        <div className="hx-thumbs" role="tablist" aria-label={s.featured}>
          {games.map((g, i) => (
            <button
              key={g.id}
              role="tab"
              type="button"
              aria-selected={i === idx}
              aria-label={cleanTitle(g.title)}
              title={cleanTitle(g.title)}
              className={`hx-thumb ${i === idx ? 'is-active' : ''}`}
              style={{ ['--ph' as string]: CONSOLE_MAP[g.consoleId].accent }}
              onClick={() => goTo(i, true)}
            >
              <img src={g.coverUrl} alt="" crossOrigin="anonymous" loading="lazy" decoding="async" draggable={false} />
              {i === idx && <i className="hx-fill" key={`f-${g.id}`} onAnimationEnd={() => goTo(idx + 1, false)} />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
