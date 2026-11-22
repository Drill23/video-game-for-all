import React, { useState } from 'react';
import { CONSOLE_MAP, type StoreGame } from '@vgfa/runtime';
import type { SupportedLang } from '@vgfa/storage';
import { Cover } from '../Cover.js';
import { Icon } from '../Icon.js';
import type { HomeStrings } from './strings.js';

interface Props {
  games: StoreGame[];
  lang: SupportedLang;
  s: HomeStrings;
  onPlay: (game: StoreGame) => void;
  onDetails: (game: StoreGame) => void;
}

function synopsisOf(g: StoreGame, lang: SupportedLang): string {
  return lang === 'en' ? g.synopsisEn : lang === 'es' ? g.synopsisEs : g.synopsisPt;
}

/** Destaque cinematográfico: capa desfocada como ambiente, capa nítida inclinada, troca a cada 7 s. */
export const Hero: React.FC<Props> = ({ games, lang, s, onPlay, onDetails }) => {
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const goTo = (next: number) => {
    if (next === idx) return;
    setPrev(idx);
    setIdx(next);
  };

  if (games.length === 0) return null;
  const game = games[idx % games.length];
  const prevGame = prev !== null && prev !== idx ? games[prev % games.length] : null;
  const def = CONSOLE_MAP[game.consoleId];

  return (
    <section
      className={`hero2 ${paused ? 'is-paused' : ''}`}
      aria-roledescription="carousel"
      aria-label={s.featured}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="hero2-bg" aria-hidden="true">
        {prevGame && (
          <img
            key={`p-${prevGame.id}`}
            className="hero2-bgimg is-out"
            src={prevGame.coverUrl}
            alt=""
            crossOrigin="anonymous"
            decoding="async"
            onAnimationEnd={() => setPrev(null)}
          />
        )}
        <img
          key={`c-${game.id}`}
          className="hero2-bgimg is-in"
          src={game.coverUrl}
          alt=""
          crossOrigin="anonymous"
          decoding="async"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <div className="hero2-tint" style={{ ['--ph' as string]: def.accent }} />
        <div className="hero2-scrim" />
      </div>

      <div className="hero2-inner">
        <div className="hero2-copy" key={`copy-${game.id}`}>
          <div className="hero2-kicker">
            <Icon name="star" size={14} /> {s.featured}
          </div>
          <h1 className="hero2-title">{game.title.replace(/\s*\((SNES|NES|GBA|Mega Drive|Atari 2600|MD)\)\s*$/i, '')}</h1>
          <div className="hero2-chips">
            <span className="chip">
              <i className="dot" style={{ background: def.accent }} />
              {def.name}
            </span>
            <span className="chip">{game.year}</span>
            <span className="chip">{game.genre.split('/')[0].trim()}</span>
            <span className="chip">★ {game.rating.toFixed(1)}</span>
          </div>
          <p className="hero2-syn">{synopsisOf(game, lang)}</p>
          <div className="hero2-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onPlay(game)}>
              <Icon name="play" size={18} /> {s.play}
            </button>
            <button className="btn btn-lg hero2-details" onClick={() => onDetails(game)}>
              <Icon name="info" size={18} /> {s.details}
            </button>
          </div>
        </div>

        <div className="hero2-art" key={`art-${game.id}`}>
          <div className="hero2-card">
            <Cover src={game.coverUrl} title={game.title} accent={def.accent} className="hero2-cover" eager />
            <span className="hero2-gloss" />
          </div>
        </div>
      </div>

      <div className="hero2-dots" role="tablist">
        {games.map((g, i) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={i === idx}
            aria-label={g.title}
            className={`hero2-dot ${i === idx ? 'is-active' : ''}`}
            onClick={() => goTo(i)}
          >
            <span className="hero2-dot-bar">
              {i === idx && <i className="hero2-dot-fill" onAnimationEnd={() => goTo((idx + 1) % games.length)} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
