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
  /** Cor do console, usada no gradiente do placeholder. */
  accent?: string;
  className?: string;
  eager?: boolean;
}

/**
 * Capa com placeholder elegante: o gradiente fica sempre por baixo (serve de "carregando")
 * e as iniciais aparecem só se a imagem falhar. crossOrigin é necessário por causa do COEP.
 */
export const Cover: React.FC<Props> = ({ src, title, accent = '#8b7cff', className, eager }) => {
  const [failed, setFailed] = useState(!src);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(!src);
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <div className={`cover ${className ?? ''}`} style={{ ['--ph' as string]: accent }}>
      <div className="cover-ph" aria-hidden="true">
        {failed && <span className="cover-ph-text">{initials(title)}</span>}
      </div>
      {!failed && src && (
        <img
          ref={ref}
          className={`cover-img ${loaded ? 'is-loaded' : ''}`}
          src={src}
          alt={title}
          crossOrigin="anonymous"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
};
