import { useEffect } from 'react';

/**
 * Navegação espacial para TV (Fire Stick / Android TV / controle): as setas do teclado ou do controle remoto
 * movem o foco para o elemento focável mais próximo naquela direção. Enter abre (nativo de botões/links; os cards
 * tratam o próprio Enter). Escape/Backspace fecham modais (useDialog).
 *
 * - Com um modal aberto (`.modal-backdrop` ou `[data-nav-scope]`), só os elementos dele entram na disputa.
 * - Sem foco nenhum, a primeira seta leva ao elemento `[data-nav-primary]` (botão Jogar do destaque).
 * - Sem candidato para baixo/cima, rola a página (para as fileiras preguiçosas aparecerem).
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  'summary',
]
  .map((q) => `${q}:not([tabindex="-1"])`)
  .join(',');

type Dir = 'left' | 'right' | 'up' | 'down';

const KEY_DIR: Record<string, Dir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'submit', 'range', 'file', 'color', 'reset'].includes(
    (el as HTMLInputElement).type,
  );
}

function usable(el: HTMLElement): DOMRect | null {
  if (el.closest('[inert],[aria-hidden="true"],[data-nav-skip]')) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return r;
}

function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope], .modal-backdrop');
  return scopes.length ? scopes[scopes.length - 1] : document;
}

function pick(from: DOMRect, dir: Dir, cands: Array<{ el: HTMLElement; r: DOMRect }>, origin: Element | null) {
  const fcx = from.left + from.width / 2;
  const fcy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r } of cands) {
    if (el === origin || (origin && (el.contains(origin) || origin.contains(el)))) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let along: number;
    let across: number;
    let overlap: boolean;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? cx <= fcx + 1 : cx >= fcx - 1) continue;
      along = dir === 'right' ? Math.max(0, r.left - from.right) : Math.max(0, from.left - r.right);
      across = Math.abs(cy - fcy);
      overlap = r.top < from.bottom && r.bottom > from.top;
      // elementos sobrepostos na horizontal contam pela distância entre os centros
      if (along === 0) along = Math.abs(cx - fcx) * 0.5;
    } else {
      if (dir === 'down' ? cy <= fcy + 1 : cy >= fcy - 1) continue;
      along = dir === 'down' ? Math.max(0, r.top - from.bottom) : Math.max(0, from.top - r.bottom);
      across = Math.abs(cx - fcx);
      overlap = r.left < from.right && r.right > from.left;
      if (along === 0) along = Math.abs(cy - fcy) * 0.5;
    }
    // Estilo Android (FocusFinder): a distância "para frente" pesa bem mais que o desvio para o lado
    const side = overlap ? across * 0.5 : across;
    const score = 13 * along * along + side * side;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  const inStrip = el.closest('.row-scroller, .cf-scroller, .hx-thumbs');
  try {
    el.scrollIntoView({ block: 'nearest', inline: inStrip ? 'center' : 'nearest', behavior: 'smooth' });
  } catch {
    el.scrollIntoView();
  }
}

export function useSpatialNav(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;

    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (!dir) {
        if (e.key === 'Tab') root.classList.add('kbd-nav');
        return;
      }
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = document.activeElement;
      // Dentro de um campo de texto, esquerda/direita movem o cursor
      if (isTextField(target) && (dir === 'left' || dir === 'right')) return;

      root.classList.add('kbd-nav');
      const scope = scopeRoot();
      const all = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE));
      const cands: Array<{ el: HTMLElement; r: DOMRect }> = [];
      for (const el of all) {
        const r = usable(el);
        if (r) cands.push({ el, r });
      }

      const origin = target instanceof HTMLElement && target !== document.body && scope.contains(target) ? target : null;
      if (!origin) {
        // Sem foco: entra pelo botão principal do destaque (ou pelo primeiro item visível)
        const primary = scope.querySelector<HTMLElement>('[data-nav-primary]');
        const first =
          (primary && usable(primary) ? primary : null) ??
          cands.find((c) => c.r.top >= 0 && c.r.top < window.innerHeight)?.el ??
          cands[0]?.el;
        if (first) {
          e.preventDefault();
          focusEl(first);
        }
        return;
      }

      const from = origin.getBoundingClientRect();
      const next = pick(from, dir, cands, origin);
      if (next) {
        e.preventDefault();
        focusEl(next);
        return;
      }
      if ((dir === 'down' || dir === 'up') && scope === document) {
        // Nada nessa direção: rola a página para as fileiras preguiçosas aparecerem
        e.preventDefault();
        window.scrollBy({ top: (dir === 'down' ? 1 : -1) * Math.round(window.innerHeight * 0.6), behavior: 'smooth' });
      } else if (origin.tagName === 'SELECT') {
        e.preventDefault();
      }
    };

    const onPointer = () => root.classList.remove('kbd-nav');

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [enabled]);
}
