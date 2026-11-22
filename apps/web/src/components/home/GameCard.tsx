import React from 'react';
import { Cover } from '../Cover.js';

interface Props {
  title: string;
  coverUrl?: string;
  accent: string;
  consoleLabel: string;
  rating?: number;
  meta?: string;
  /** Selo no canto da legenda (ex.: "Pronto"). */
  tag?: string;
  onOpen: () => void;
}

export const GameCard: React.FC<Props> = ({ title, coverUrl, accent, consoleLabel, rating, meta, tag, onOpen }) => (
  <div
    className="gcard"
    role="button"
    tabIndex={0}
    aria-label={title}
    onClick={onOpen}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    }}
  >
    <div className="gcard-art">
      <Cover src={coverUrl} title={title} accent={accent} className="gcard-cover" />
      <span className="onimg gcard-console">
        <i className="dot" style={{ background: accent }} />
        {consoleLabel}
      </span>
      {typeof rating === 'number' && <span className="onimg gcard-rating">★ {rating.toFixed(1)}</span>}
      <div className="gcard-cap">
        <h3 className="gcard-title">{title.replace(/\s*\((SNES|NES|GBA|Mega Drive|Atari 2600|MD)\)\s*$/i, '')}</h3>
        <div className="gcard-meta">
          <span>{meta}</span>
          {tag && <span className="gcard-tag">{tag}</span>}
        </div>
      </div>
    </div>
  </div>
);
