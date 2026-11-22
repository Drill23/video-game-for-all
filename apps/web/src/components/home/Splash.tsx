import React, { useEffect, useState } from 'react';

const KEY = 'vgfa:splash';

function shouldShow(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Abertura curta (1x por sessão, até 1,2 s, pulável com um clique). */
export const Splash: React.FC<{ subtitle: string }> = ({ subtitle }) => {
  const [phase, setPhase] = useState<'show' | 'out' | 'gone'>(() => (shouldShow() ? 'show' : 'gone'));

  useEffect(() => {
    if (phase !== 'show') return undefined;
    const t1 = window.setTimeout(() => setPhase('out'), 900);
    return () => window.clearTimeout(t1);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'out') return undefined;
    const t2 = window.setTimeout(() => setPhase('gone'), 300);
    return () => window.clearTimeout(t2);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div
      className={`splash ${phase === 'out' ? 'is-out' : ''}`}
      onClick={() => setPhase('out')}
      role="presentation"
    >
      <div className="splash-logo">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width={112} height={112} />
        <span className="splash-sweep" />
      </div>
      <div className="splash-word">VGFA</div>
      <div className="splash-sub">{subtitle}</div>
    </div>
  );
};
