import React, { useEffect, useRef, useState } from 'react';

function initials(title: string): string {
  const clean = title.replace(/\([^)]*\)/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'VG';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface Props {
  src?: string;
  title: string;
  /** Cor do console, usada no gradiente do placeholder e no brilho. */
  accent?: string;
  className?: string;
  /** Carrega já (sem lazy), sem prioridade especial. */
  eager?: boolean;
  /** Só para a imagem de destaque da tela: eager + fetchpriority="high". */
  priority?: boolean;
}

/**
 * Capa com tratamento especial:
 * - o gradiente da cor do console fica por baixo (serve de "carregando") e as iniciais aparecem se a imagem falhar;
 * - capas que não são 3:4 (caixas de Mega Drive, SNES, Atari...) ficam inteiras, centralizadas sobre o próprio
 *   ambiente desfocado (nada de faixas pretas);
 * - brilho especular por cima (CSS ::after).
 * crossOrigin é necessário por causa do COEP.
 */
export const Cover: React.FC<Props> = ({ src, title, accent = '#8b7cff', className, eager, priority }) => {
  const [failed, setFailed] = useState(!src);
  const [loaded, setLoaded] = useState(false);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const ref = useRef<HTMLImageElement | null>(null);

  const measure = (el: HTMLImageElement) => {
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      const ratio = el.naturalWidth / el.naturalHeight;
      setFit(Math.abs(ratio - 0.75) > 0.07 ? 'contain' : 'cover');
      setLoaded(true);
    }
  };

  useEffect(() => {
    setFailed(!src);
    setLoaded(false);
    setFit('cover');
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth > 0) measure(el);
  }, [src]);

  const showImg = !failed && Boolean(src);
  const lazy = !(eager || priority);

  return (
    <div
      className={`cover ${fit === 'contain' ? 'is-contain' : ''} ${loaded ? 'is-ready' : ''} ${className ?? ''}`}
      style={{ ['--ph' as string]: accent }}
    >
      <div className="cover-ph" aria-hidden="true">
        {failed && <span className="cover-ph-text">{initials(title)}</span>}
      </div>
      {showImg && fit === 'contain' && loaded && (
        <img className="cover-amb" src={src} alt="" aria-hidden="true" crossOrigin="anonymous" decoding="async" />
      )}
      {showImg && (
        <img
          ref={ref}
          className={`cover-img ${loaded ? 'is-loaded' : ''}`}
          src={src}
          alt={title}
          crossOrigin="anonymous"
          loading={lazy ? 'lazy' : 'eager'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          draggable={false}
          onLoad={(e) => measure(e.currentTarget)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
};
