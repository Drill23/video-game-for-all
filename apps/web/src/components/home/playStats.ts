import { GAME_BY_ID } from './homeData.js';

/**
 * Estatísticas de tempo de jogo. Vêm de `getPlayStats()` (services/ejs-saves, feito por outra pessoa) e são
 * lidas de forma opcional: se não existir ou falhar, a folha do perfil só mostra o que já sabe (jogos no aparelho).
 */
export interface PlayStatsView {
  totalMs: number;
  top: Array<{ id: string; title: string; ms: number }>;
}

export async function loadPlayStats(): Promise<PlayStatsView | null> {
  try {
    const mod = await import('../../services/ejs-saves.js');
    const stats = await mod.getPlayStats();
    const top = Object.entries(stats.perGame)
      .filter(([, v]) => v && v.ms > 0)
      .map(([id, v]) => ({ id, title: v.title ?? GAME_BY_ID.get(id)?.title ?? id, ms: v.ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);
    return { totalMs: stats.totalMs, top };
  } catch {
    return null;
  }
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
