import React, { useRef } from 'react';
import { Icon } from '../Icon.js';

interface Props {
  title: string;
  subtitle?: string;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  leftLabel: string;
  rightLabel: string;
  children: React.ReactNode;
}

/** Linha horizontal com scroll-snap e setas de vidro (aparecem só em dispositivos com mouse). */
export const Row: React.FC<Props> = ({ title, subtitle, seeAllLabel, onSeeAll, leftLabel, rightLabel, children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className="row">
      <div className="row-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {onSeeAll && (
          <button className="row-all" onClick={onSeeAll}>
            {seeAllLabel}
            <Icon name="chevR" size={16} />
          </button>
        )}
      </div>
      <div className="row-wrap">
        <button className="row-arrow row-arrow-l glass" aria-label={leftLabel} onClick={() => scrollBy(-1)}>
          <Icon name="chevL" size={20} />
        </button>
        <div className="row-scroller" ref={ref}>
          {children}
        </div>
        <button className="row-arrow row-arrow-r glass" aria-label={rightLabel} onClick={() => scrollBy(1)}>
          <Icon name="chevR" size={20} />
        </button>
      </div>
    </section>
  );
};
