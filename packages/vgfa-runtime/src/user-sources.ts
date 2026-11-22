/**
 * Gerenciador de Fontes Personalizadas do Usuário (persistido em localStorage).
 *
 * Permite ao usuário vincular suas próprias URLs (HTTP Range / WebSeed / servidor pessoal)
 * ou importar um manifesto JSON próprio de biblioteca para qualquer título da loja VGFA
 * sem embutir links comerciais protegidos no código-fonte do repositório.
 */

export interface UserSourceBinding {
  gameId: string;
  url: string;
  filename?: string;
  addedAt: number;
}

const SOURCES_KEY = 'vgfa.user_sources.v1';

function readStorage(): Record<string, UserSourceBinding> {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
    return {};
  }
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserSourceBinding>) : {};
  } catch {
    return {};
  }
}

function writeStorage(map: Record<string, UserSourceBinding>): void {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
  localStorage.setItem(SOURCES_KEY, JSON.stringify(map));
}

export function getUserSourceForGame(gameId: string): UserSourceBinding | null {
  const map = readStorage();
  return map[gameId] ?? null;
}

export function listUserSources(): UserSourceBinding[] {
  return Object.values(readStorage()).sort((a, b) => b.addedAt - a.addedAt);
}

export function setUserSourceForGame(gameId: string, url: string, filename?: string): UserSourceBinding {
  const map = readStorage();
  const entry: UserSourceBinding = {
    gameId,
    url: url.trim(),
    filename,
    addedAt: Date.now(),
  };
  map[gameId] = entry;
  writeStorage(map);
  return entry;
}

export function removeUserSourceForGame(gameId: string): void {
  const map = readStorage();
  delete map[gameId];
  writeStorage(map);
}

/**
 * Importa um manifesto JSON pessoal no formato:
 * { "ps2-dbz-bt3": "https://meu-servidor/dbz-bt3.iso", "snes-smw": "https://meu-servidor/smw.sfc" }
 */
export function importUserSourcesJson(rawJson: string): number {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const map = readStorage();
  let imported = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
      map[key] = {
        gameId: key,
        url: value.trim(),
        addedAt: Date.now(),
      };
      imported++;
    }
  }
  writeStorage(map);
  return imported;
}
