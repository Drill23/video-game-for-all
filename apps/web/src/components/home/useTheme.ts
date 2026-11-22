import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'dark' | 'light';

const KEY = 'vgfa:theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'system' || v === 'dark' || v === 'light') return v;
  } catch {
    // armazenamento indisponível: segue com o padrão escuro
  }
  return 'dark';
}

/** Liga a classe perf-lite quando o aparelho é modesto (<= 4 núcleos ou <= 4 GB). */
export function applyPerfLite(): void {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const hc = nav.hardwareConcurrency;
    const dm = nav.deviceMemory;
    const lite = (typeof hc === 'number' && hc > 0 && hc <= 4) || (typeof dm === 'number' && dm > 0 && dm <= 4);
    document.documentElement.classList.toggle('perf-lite', lite);
  } catch {
    // ignora
  }
}

export function useTheme(): [ThemePref, (next: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', pref);
  }, [pref]);

  useEffect(() => {
    applyPerfLite();
  }, []);

  const update = useCallback((next: ThemePref) => {
    setPref(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignora
    }
  }, []);

  return [pref, update];
}
