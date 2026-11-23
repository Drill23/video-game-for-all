import React from 'react';
import { Cover } from '../Cover.js';
import { cleanTitle } from './gameMeta.js';

interface Props {
  title: string;
  coverUrl?: string;
  accent: string;
  consoleLabel: string;
  rating?: number;
  year?: number;
  /** Segunda linha da legenda (ex.: gênero ou "Retomar · há 2 h"). Se faltar, usa só "★ nota · ano". */
  meta?: string;
  /** Selo no canto da legenda (ex.: "Pronto", "No aparelho"). */
  tag?: string;
  /** Posição no Top 10 (só muda a legenda para o leitor de tela). */
  rank?: number;
  onOpen: () => void;
  /** Conteúdo extra na linha da legenda (ex.: botão ⋯). */
  extra?: React.ReactNode;
  /** Camada por cima do cartaz (ex.: confirmação de apagar). */
  overlay?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Cartaz de jogo. O cartaz (capa 3:4 com selo do console) é o elemento focável; a legenda fica embaixo e NUNCA se
 * mexe: só o cartaz sobe um pouquinho e ganha o anel de luz (foco estilo Apple TV).
 */
export const GameCard: React.FC<Props> = ({
  title,
  coverUrl,
  accent,
  consoleLabel,
  rating,
  year,
  meta,
  tag,
  rank,
  onOpen,
  extra,
  overlay,
  className,
  style,
}) => {
  const shown = cleanTitle(title);
  const sub = meta ?? [typeof rating === 'number' ? `★ ${rating.toFixed(1)}` : '', year ? String(year) : ''].filter(Boolean).join(' · ');
  return (
    <div className={`gc ${className ?? ''}`} style={{ ['--ph' as string]: accent, ...style }}>
      <div
        className="gcard"
        role="button"
        tabIndex={0}
        aria-label={rank ? `${rank}. ${shown}` : shown}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="gcard-art">
          <Cover src={coverUrl} title={shown} accent={accent} className="gcard-cover" />
          <span className="onimg gcard-console">
            <i className="dot" style={{ background: accent }} />
            {consoleLabel}
          </span>
        </div>
      </div>
      {overlay}
      <div className="gc-cap" onClick={onOpen}>
        <div className="gc-line">
          <h3 className="gc-title">{shown}</h3>
          {extra}
        </div>
        <div className="gc-meta">
          <span>{sub}</span>
          {tag && <span className="gc-tag">{tag}</span>}
        </div>
      </div>
    </div>
  );
};
