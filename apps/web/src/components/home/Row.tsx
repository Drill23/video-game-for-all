import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.js';

interface Props {
  title: string;
  subtitle?: string;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  leftLabel: string;
  rightLabel: string;
  /** top10 = números grandes atrás das capas. */
  variant?: 'poster' | 'top10';
  children: React.ReactNode;
}

/** Linha horizontal com scroll-snap e setas de vidro (aparecem só com mouse; no controle o foco rola sozinho). */
export const Row: React.FC<Props> = ({
  title,
  subtitle,
  seeAllLabel,
  onSeeAll,
  leftLabel,
  rightLabel,
  variant = 'poster',
  children,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className={`row ${variant === 'top10' ? 'row-top' : ''}`}>
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
        <button className="row-arrow row-arrow-l glass" tabIndex={-1} aria-label={leftLabel} onClick={() => scrollBy(-1)}>
          <Icon name="chevL" size={20} />
        </button>
        <div className="row-scroller" ref={ref}>
          {children}
        </div>
        <button className="row-arrow row-arrow-r glass" tabIndex={-1} aria-label={rightLabel} onClick={() => scrollBy(1)}>
          <Icon name="chevR" size={20} />
        </button>
      </div>
    </section>
  );
};

/** Item do Top 10: número gigante atrás da capa. */
export const TopItem: React.FC<{ rank: number; children: React.ReactNode }> = ({ rank, children }) => (
  <div className={`top-item ${rank >= 10 ? 'is-wide' : ''}`}>
    <span className="top-num" aria-hidden="true">
      {rank}
    </span>
    {children}
  </div>
);

interface LazyProps {
  /** Renderiza já (as primeiras fileiras). */
  eager?: boolean;
  title: string;
  children: React.ReactNode;
}

/**
 * Só monta a fileira quando ela chega perto da tela (IntersectionObserver) e nunca desmonta depois.
 * Mantém a home rápida com 200 jogos: o que está longe fica só como um esqueleto com o título.
 */
export const LazyRow: React.FC<LazyProps> = ({ eager, title, children }) => {
  const [show, setShow] = useState(Boolean(eager));
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (show) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShow(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: '900px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);

  if (show) return <>{children}</>;
  return (
    <section ref={ref} className="row row-ph" aria-hidden="true">
      <div className="row-head">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="row-ph-strip" />
    </section>
  );
};
