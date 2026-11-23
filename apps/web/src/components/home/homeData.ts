import { ALL_STORE_GAMES, CONSOLES, FREE_PLAYABLE_ROMS, STORE_CATALOG, type StoreGame } from '@vgfa/runtime';
import type { ConsoleId } from '@vgfa/pad';
import { GENRE_ORDER, genreOf, highlightsOf, topRankOf, type GenreId } from './gameMeta.js';

/** Dados derivados do catálogo, calculados uma única vez (o catálogo tem ~200 jogos). */

export const CATALOG_SORTED = [...STORE_CATALOG].sort(
  (a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99) || b.rating - a.rating,
);

const byRankThenRating = (a: StoreGame, b: StoreGame) =>
  (topRankOf(a) ?? 999) - (topRankOf(b) ?? 999) || (a.featuredRank ?? 99) - (b.featuredRank ?? 99) || b.rating - a.rating;

export function topOf(consoleId: ConsoleId, limit = 10): StoreGame[] {
  return ALL_STORE_GAMES.filter((g) => g.consoleId === consoleId)
    .sort(byRankThenRating)
    .slice(0, limit);
}

export const TOP_PS2 = topOf('ps2');
export const TOP_PS1 = topOf('ps1');

/** Destaques: mistura 1-clique grátis com os melhores do PS2/PS1 (prefere quem tem destaques curtos). */
function buildFeatured(): StoreGame[] {
  const free = [...FREE_PLAYABLE_ROMS].sort((a, b) => b.rating - a.rating).slice(0, 3);
  const pick = (list: StoreGame[], n: number) => {
    const withHl = list.filter((g) => highlightsOf(g).length > 0);
    return (withHl.length >= n ? withHl : list).slice(0, n);
  };
  const ps2 = pick(TOP_PS2, 3);
  const ps1 = pick(TOP_PS1, 2);
  const out: StoreGame[] = [];
  const seen = new Set<string>();
  const lanes = [ps2, free, ps1];
  for (let i = 0; i < 3; i++) {
    for (const lane of lanes) {
      const g = lane[i];
      if (g && !seen.has(g.id)) {
        seen.add(g.id);
        out.push(g);
      }
    }
  }
  if (out.length < 5) {
    for (const g of CATALOG_SORTED) {
      if (out.length >= 6) break;
      if (!seen.has(g.id)) {
        seen.add(g.id);
        out.push(g);
      }
    }
  }
  return out.slice(0, 8);
}

export const FEATURED = buildFeatured();

export interface GenreRowData {
  id: GenreId;
  games: StoreGame[];
}

function buildGenreRows(): GenreRowData[] {
  const buckets = new Map<GenreId, StoreGame[]>();
  for (const g of ALL_STORE_GAMES) {
    const id = genreOf(g);
    if (!id) continue;
    const list = buckets.get(id) ?? [];
    list.push(g);
    buckets.set(id, list);
  }
  return GENRE_ORDER.map((id) => ({
    id,
    games: (buckets.get(id) ?? []).sort((a, b) => b.rating - a.rating).slice(0, 30),
  })).filter((r) => r.games.length >= 4);
}

export const GENRE_ROWS = buildGenreRows();

export interface ConsoleRowData {
  id: ConsoleId;
  games: StoreGame[];
}

/** Uma fileira por console. PS1/PS2 já têm Top 10, então mostram só o que sobrou. */
function buildConsoleRows(): ConsoleRowData[] {
  const rows: ConsoleRowData[] = [];
  for (const c of CONSOLES) {
    let games = ALL_STORE_GAMES.filter((g) => g.consoleId === c.id).sort((a, b) => b.rating - a.rating);
    if (c.id === 'ps2' || c.id === 'ps1') {
      const top = new Set((c.id === 'ps2' ? TOP_PS2 : TOP_PS1).map((g) => g.id));
      games = games.filter((g) => !top.has(g.id));
    }
    if (games.length >= 3) rows.push({ id: c.id, games: games.slice(0, 30) });
  }
  return rows;
}

export const CONSOLE_ROWS = buildConsoleRows();

export const GAME_BY_ID: Map<string, StoreGame> = new Map(ALL_STORE_GAMES.map((g) => [g.id, g]));

/** "Mais como este": mesmo gênero e/ou console, ordenado por proximidade. */
export function similarGames(game: StoreGame, limit = 12): StoreGame[] {
  const gid = genreOf(game);
  return ALL_STORE_GAMES.filter((g) => g.id !== game.id)
    .map((g) => {
      let score = 0;
      if (gid && genreOf(g) === gid) score += 3;
      if (g.consoleId === game.consoleId) score += 2;
      score += Math.max(0, 1 - Math.abs(g.rating - game.rating) / 5);
      return { g, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.g);
}
