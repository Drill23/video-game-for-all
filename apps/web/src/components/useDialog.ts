import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'range', 'file', 'color', 'reset'].includes(type);
}

/**
 * Fecha o modal com Esc / Backspace / botão Voltar do controle, trava a rolagem do fundo, leva o foco para dentro
 * (navegação por controle remoto) e devolve o foco para onde estava quando ele fecha.
 */
export function useDialog(onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const back = e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack';
      if (back || (e.key === 'Backspace' && !isEditable(e.target))) {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Foco inicial dentro do diálogo mais recente (o botão principal, se houver)
    const raf = window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dlg = dialogs[dialogs.length - 1];
      if (!dlg || dlg.contains(document.activeElement)) return;
      const first =
        dlg.querySelector<HTMLElement>('[data-autofocus]') ??
        dlg.querySelector<HTMLElement>('.btn-primary:not([disabled])') ??
        dlg.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
}
