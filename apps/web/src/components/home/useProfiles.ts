import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Profile {
  id: string;
  name: string;
  /** Emoji do avatar (nada de personagens com direitos autorais). */
  avatar: string;
  /** Cor base do gradiente do avatar. */
  color: string;
}

export const MAX_PROFILES = 6;
export const AVATARS = ['🎮', '🕹️', '🚀', '🦊', '🐲', '👾', '🦄', '🐙', '🐼', '🦉', '🔥', '⚡', '🌈', '🛸', '🌵', '🍕'];
export const AVATAR_COLORS = ['#ff7eb6', '#b79cff', '#7cc8ff', '#5be3b0', '#ffb38a', '#ffd166', '#ff6b7a', '#9be15d'];

const KEY_PROFILES = 'vgfa:profiles';
const KEY_ACTIVE = 'vgfa:active-profile';
const KEY_GATE_SEEN = 'vgfa:profile-gate-seen';
const keyList = (id: string) => `vgfa:list:${id}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // armazenamento indisponível: segue sem salvar
  }
}

function readProfiles(): Profile[] {
  const raw = readJson<unknown>(KEY_PROFILES, []);
  if (!Array.isArray(raw)) return [];
  const out: Profile[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' && typeof (p as Profile).id === 'string' && typeof (p as Profile).name === 'string') {
      const q = p as Profile;
      out.push({
        id: q.id,
        name: q.name.slice(0, 20),
        avatar: typeof q.avatar === 'string' && q.avatar ? q.avatar : AVATARS[0],
        color: typeof q.color === 'string' && q.color ? q.color : AVATAR_COLORS[0],
      });
    }
  }
  return out.slice(0, MAX_PROFILES);
}

function readActive(profiles: Profile[]): string | null {
  try {
    const id = localStorage.getItem(KEY_ACTIVE);
    return id && profiles.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

function readList(profileId: string | null): string[] {
  const raw = readJson<unknown>(keyList(profileId ?? 'guest'), []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function gateAlreadySeen(): boolean {
  try {
    return localStorage.getItem(KEY_GATE_SEEN) === '1';
  } catch {
    return true;
  }
}

export function markGateSeen(): void {
  try {
    localStorage.setItem(KEY_GATE_SEEN, '1');
  } catch {
    // ignora
  }
}

export interface ProfilesApi {
  profiles: Profile[];
  active: Profile | null;
  /** Ids dos jogos da "Minha lista" do perfil ativo (ou do convidado). */
  list: string[];
  select: (id: string | null) => void;
  create: (name: string, avatar: string, color: string) => Profile | null;
  update: (id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>) => void;
  remove: (id: string) => void;
  toggleInList: (gameId: string) => void;
  isInList: (gameId: string) => boolean;
}

/** Perfis locais (sem servidor): até 6 em localStorage, com "Minha lista" separada por perfil. */
export function useProfiles(): ProfilesApi {
  const [profiles, setProfiles] = useState<Profile[]>(readProfiles);
  const [activeId, setActiveId] = useState<string | null>(() => readActive(readProfiles()));
  const [list, setList] = useState<string[]>(() => readList(readActive(readProfiles())));

  // Mantém várias abas em sincronia
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith('vgfa:')) return;
      const ps = readProfiles();
      setProfiles(ps);
      const act = readActive(ps);
      setActiveId(act);
      setList(readList(act));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    setList(readList(id));
    try {
      if (id) localStorage.setItem(KEY_ACTIVE, id);
      else localStorage.removeItem(KEY_ACTIVE);
    } catch {
      // ignora
    }
  }, []);

  const create = useCallback(
    (name: string, avatar: string, color: string): Profile | null => {
      const clean = name.trim().slice(0, 20);
      if (!clean || profiles.length >= MAX_PROFILES) return null;
      const next: Profile = {
        id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: clean,
        avatar,
        color,
      };
      const all = [...profiles, next];
      setProfiles(all);
      writeJson(KEY_PROFILES, all);
      return next;
    },
    [profiles],
  );

  const update = useCallback(
    (id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>) => {
      const all = profiles.map((p) => {
        if (p.id !== id) return p;
        const name = (patch.name ?? p.name).trim().slice(0, 20) || p.name;
        return { ...p, ...patch, name };
      });
      setProfiles(all);
      writeJson(KEY_PROFILES, all);
    },
    [profiles],
  );

  const remove = useCallback(
    (id: string) => {
      const all = profiles.filter((p) => p.id !== id);
      setProfiles(all);
      writeJson(KEY_PROFILES, all);
      try {
        localStorage.removeItem(keyList(id));
      } catch {
        // ignora
      }
      if (activeId === id) select(null);
    },
    [profiles, activeId, select],
  );

  const toggleInList = useCallback(
    (gameId: string) => {
      const next = list.includes(gameId) ? list.filter((x) => x !== gameId) : [gameId, ...list];
      setList(next);
      writeJson(keyList(activeId ?? 'guest'), next);
    },
    [list, activeId],
  );

  const isInList = useCallback((gameId: string) => list.includes(gameId), [list]);

  const active = useMemo(() => profiles.find((p) => p.id === activeId) ?? null, [profiles, activeId]);

  return { profiles, active, list, select, create, update, remove, toggleInList, isInList };
}
