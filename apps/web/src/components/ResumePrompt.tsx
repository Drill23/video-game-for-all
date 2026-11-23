import React, { useEffect, useRef } from 'react';
import { timeAgo } from '../services/format';
import '../styles/library.css';

interface Props {
  title: string;
  /** Quando o save automático foi feito (ms desde 1970). */
  savedAt: number;
  onResume: () => void;
  onFresh: () => void;
}

/** "Continuar de onde parou?" — vidro por cima do jogo, "Continuar" já vem com o foco. */
export const ResumePrompt: React.FC<Props> = ({ title, savedAt, onResume, onFresh }) => {
  const resumeRef = useRef<HTMLButtonElement | null>(null);
  const freshRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, []);

  // Setas alternam entre os dois botões (controle remoto de TV / gamepad que emula setas)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const active = document.activeElement;
    (active === resumeRef.current ? freshRef.current : resumeRef.current)?.focus();
  };

  return (
    <div className="rsm-overlay" role="presentation">
      <div
        className="rsm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rsm-title"
        aria-describedby="rsm-sub"
        onKeyDown={onKeyDown}
      >
        <h2 id="rsm-title" className="rsm-title">
          Continuar de onde parou?
        </h2>
        <p id="rsm-sub" className="rsm-sub">
          <strong>{title}</strong> · salvo {timeAgo(savedAt)}
        </p>
        <div className="rsm-actions">
          <button ref={resumeRef} type="button" className="btn btn-primary rsm-btn" onClick={onResume}>
            <span aria-hidden="true">▶</span> Continuar
          </button>
          <button ref={freshRef} type="button" className="btn btn-ghost rsm-btn" onClick={onFresh}>
            Começar do início
          </button>
        </div>
      </div>
    </div>
  );
};
