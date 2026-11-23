import { CONSOLE_MAP, getSynopsis, type StoreGame } from '@vgfa/runtime';
import type { SupportedLang } from '@vgfa/storage';
import type { HomeStrings } from './strings.js';

/**
 * Campos novos (todos opcionais) que o catálogo está ganhando. Lidos de forma defensiva:
 * se o tipo ainda não os tiver, a tela funciona do mesmo jeito.
 */
interface GameExt {
  publisher?: unknown;
  tags?: unknown;
  modesPt?: unknown;
  playtimeHours?: unknown;
  highlightsPt?: unknown;
  ageRating?: unknown;
  franchise?: unknown;
  topRank?: unknown;
}

const ext = (g: StoreGame): GameExt => g as unknown as GameExt;

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (typeof v === 'string' && v.trim()) return v.split(/[;,·]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

export const publisherOf = (g: StoreGame): string | undefined =>
  typeof ext(g).publisher === 'string' && (ext(g).publisher as string).trim() ? (ext(g).publisher as string) : undefined;

export const franchiseOf = (g: StoreGame): string | undefined =>
  typeof ext(g).franchise === 'string' && (ext(g).franchise as string).trim() ? (ext(g).franchise as string) : undefined;

export const tagsOf = (g: StoreGame): string[] => strList(ext(g).tags);
export const modesOf = (g: StoreGame): string[] => strList(ext(g).modesPt);
export const highlightsOf = (g: StoreGame): string[] => strList(ext(g).highlightsPt).slice(0, 3);

export const topRankOf = (g: StoreGame): number | undefined => {
  const v = ext(g).topRank;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
};

export function playtimeOf(g: StoreGame): string | undefined {
  const v = ext(g).playtimeHours;
  if (typeof v === 'number' && v > 0) return `~${v} h`;
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return `${v[0]}–${v[1]} h`;
  if (typeof v === 'string' && v.trim()) return /h/i.test(v) ? v : `${v} h`;
  return undefined;
}

export function ageRatingOf(g: StoreGame): string | undefined {
  const v = ext(g).ageRating;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

const SERIES_SUFFIX = /\s*\((SNES|NES|GBA|Mega Drive|Atari 2600|MD)\)\s*$/i;

/** Título sem o sufixo de console (já aparece no selo). */
/** Valor da classificação indicativa ("L" vira "Livre"). */
export function ageValue(g: StoreGame, s: HomeStrings): string | undefined {
  const a = ageRatingOf(g);
  return a === 'L' ? s.ageFree : a;
}

export const cleanTitle = (title: string): string => title.replace(SERIES_SUFFIX, '');

export const synopsisOf = (g: StoreGame, lang: SupportedLang): string => getSynopsis(g, lang);

export const badgeLabel = (id: string, shortName: string): string => (id === 'ps2' ? 'PS2' : shortName);

export const consoleBadge = (g: StoreGame): string => {
  const def = CONSOLE_MAP[g.consoleId];
  return badgeLabel(def.id, def.shortName);
};

/** "1P–2P" -> "1–2 jogadores". */
export function playersText(raw: string, s: HomeStrings): string {
  const m = /^(\d)\s*P?\s*(?:[–-]\s*(\d)\s*P?)?$/i.exec(raw.trim());
  if (!m) return raw;
  if (!m[2] || m[2] === m[1]) return m[1] === '1' ? `1 ${s.onePlayer}` : `${m[1]} ${s.playersWord}`;
  return `${m[1]}–${m[2]} ${s.playersWord}`;
}

/** "3.2 GB ISO" -> "3.2 GB". */
export function sizeText(raw: string): string {
  const m = /^([\d.,]+)\s*(KB|MB|GB)/i.exec(raw.trim());
  return m ? `${m[1]} ${m[2].toUpperCase()}` : raw;
}

export const genreShort = (g: StoreGame): string => g.genre.split('/')[0].trim();

export interface Fact {
  id: string;
  text: string;
}

/** Linha de fatos do destaque: ★ 9.6 · 2007 · PS2 · Luta 3D · 1–2 jogadores · ~4 GB · Classificação 12 */
export function factLine(g: StoreGame, s: HomeStrings): Fact[] {
  const facts: Fact[] = [];
  facts.push({ id: 'rating', text: `★ ${g.rating.toFixed(1)}` });
  if (g.year) facts.push({ id: 'year', text: String(g.year) });
  facts.push({ id: 'console', text: consoleBadge(g) });
  if (g.genre) facts.push({ id: 'genre', text: genreShort(g) });
  if (g.players) facts.push({ id: 'players', text: playersText(g.players, s) });
  if (g.sizeEstimate) facts.push({ id: 'size', text: `~${sizeText(g.sizeEstimate)}` });
  const age = ageValue(g, s);
  if (age) facts.push({ id: 'age', text: `${s.ageRating} ${age}` });
  return facts;
}

/* ---------- Gêneros (para as fileiras) ---------- */

export type GenreId =
  | 'fight'
  | 'racing'
  | 'rpg'
  | 'platform'
  | 'action'
  | 'sports'
  | 'shooter'
  | 'puzzle'
  | 'strategy'
  | 'rhythm'
  | 'arcade';

const GENRE_RULES: Array<[GenreId, RegExp]> = [
  ['fight', /luta|fight|beat|arena|versus/i],
  ['racing', /corrida|racing|kart|rally|drift|tuning/i],
  ['rpg', /rpg|jrpg/i],
  ['platform', /plataforma|platform|metroidvania/i],
  ['shooter', /tiro|shooter|fps|run and gun|gun/i],
  ['sports', /esporte|futebol|basquete|sport|soccer|football|wrestling|skate|golf|t[eê]nis|surf|snowboard/i],
  ['puzzle', /puzzle|quebra|l[oó]gica/i],
  ['strategy', /estrat[eé]gia|strategy|t[aá]tic|tower/i],
  ['rhythm', /ritmo|m[uú]sica|rhythm|dan[cç]a|karaok/i],
  ['action', /a[cç][aã]o|aventura|action|adventure|stealth|furtiv|survival|terror|horror|mundo aberto|open world|hack/i],
  ['arcade', /arcade|labirinto/i],
];

export function genreOf(g: StoreGame): GenreId | undefined {
  const segs = g.genre.split('/').map((x) => x.trim());
  for (const seg of segs) {
    for (const [id, re] of GENRE_RULES) if (re.test(seg)) return id;
  }
  for (const tag of tagsOf(g)) {
    for (const [id, re] of GENRE_RULES) if (re.test(tag)) return id;
  }
  return undefined;
}

export const GENRE_ORDER: GenreId[] = [
  'fight',
  'racing',
  'rpg',
  'platform',
  'action',
  'sports',
  'shooter',
  'puzzle',
  'strategy',
  'rhythm',
  'arcade',
];

export const GENRE_LABEL: Record<SupportedLang, Record<GenreId, string>> = {
  'pt-BR': {
    fight: 'Luta',
    racing: 'Corrida',
    rpg: 'RPG',
    platform: 'Plataforma',
    action: 'Ação e aventura',
    sports: 'Esporte',
    shooter: 'Tiro e FPS',
    puzzle: 'Quebra-cabeça',
    strategy: 'Estratégia',
    rhythm: 'Música e ritmo',
    arcade: 'Arcade',
  },
  en: {
    fight: 'Fighting',
    racing: 'Racing',
    rpg: 'RPG',
    platform: 'Platformers',
    action: 'Action & adventure',
    sports: 'Sports',
    shooter: 'Shooters',
    puzzle: 'Puzzle',
    strategy: 'Strategy',
    rhythm: 'Music & rhythm',
    arcade: 'Arcade',
  },
  es: {
    fight: 'Lucha',
    racing: 'Carreras',
    rpg: 'RPG',
    platform: 'Plataformas',
    action: 'Acción y aventura',
    sports: 'Deportes',
    shooter: 'Disparos y FPS',
    puzzle: 'Rompecabezas',
    strategy: 'Estrategia',
    rhythm: 'Música y ritmo',
    arcade: 'Arcade',
  },
};
