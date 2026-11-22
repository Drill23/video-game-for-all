export type SupportedLang = 'pt-BR' | 'en' | 'es';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  avatarColor: string;
  language: SupportedLang;
  favorites: string[];
  recentGames: Array<{ gameId: string; title: string; consoleId: string; playedAt: number }>;
  createdAt: number;
}

interface StoredAccount {
  profile: UserProfile;
  passwordHash: string;
}

const ACCOUNTS_KEY = 'vgfa.accounts.v1';
const SESSION_KEY = 'vgfa.session.v1';
const LANG_KEY = 'vgfa.lang.v1';

const AVATAR_PALETTE = ['#FFB547', '#38BDF8', '#A78BFA', '#34D399', '#FB7185', '#F97316'];

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `vgfa_${(h >>> 0).toString(16)}`;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class InMemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export class VgfaAuthStore {
  private readonly storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage =
      storage ??
      (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
        ? localStorage
        : new InMemoryStorage());
  }

  private loadAccounts(): Record<string, StoredAccount> {
    try {
      const raw = this.storage.getItem(ACCOUNTS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, StoredAccount>) : {};
    } catch {
      return {};
    }
  }

  private saveAccounts(accounts: Record<string, StoredAccount>): void {
    this.storage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  getLanguage(): SupportedLang {
    const saved = this.storage.getItem(LANG_KEY);
    if (saved === 'pt-BR' || saved === 'en' || saved === 'es') return saved;
    return 'pt-BR';
  }

  setLanguage(lang: SupportedLang): void {
    this.storage.setItem(LANG_KEY, lang);
    const current = this.getCurrentUser();
    if (current) {
      this.updateProfile({ ...current, language: lang });
    }
  }

  getCurrentUser(): UserProfile | null {
    const email = this.storage.getItem(SESSION_KEY);
    if (!email) return null;
    const accounts = this.loadAccounts();
    return accounts[email]?.profile ?? null;
  }

  register(username: string, email: string, password: string): UserProfile {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = username.trim();
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Nome de jogador deve ter ao menos 2 caracteres.');
    }
    if (!normalizedEmail.includes('@')) {
      throw new Error('Informe um e-mail válido.');
    }
    if (password.length < 4) {
      throw new Error('A senha deve ter ao menos 4 caracteres.');
    }

    const accounts = this.loadAccounts();
    if (accounts[normalizedEmail]) {
      throw new Error('Já existe uma conta cadastrada com este e-mail.');
    }

    const profile: UserProfile = {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      username: cleanName,
      email: normalizedEmail,
      avatarColor: AVATAR_PALETTE[Object.keys(accounts).length % AVATAR_PALETTE.length],
      language: this.getLanguage(),
      favorites: [],
      recentGames: [],
      createdAt: Date.now(),
    };

    accounts[normalizedEmail] = {
      profile,
      passwordHash: simpleHash(`${normalizedEmail}::${password}`),
    };
    this.saveAccounts(accounts);
    this.storage.setItem(SESSION_KEY, normalizedEmail);
    return profile;
  }

  login(email: string, password: string): UserProfile {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = this.loadAccounts();
    const acc = accounts[normalizedEmail];
    if (!acc || acc.passwordHash !== simpleHash(`${normalizedEmail}::${password}`)) {
      throw new Error('E-mail ou senha incorretos.');
    }
    this.storage.setItem(SESSION_KEY, normalizedEmail);
    return acc.profile;
  }

  loginAsGuest(): UserProfile {
    const accounts = this.loadAccounts();
    const guestEmail = 'guest@vgfa.local';
    if (!accounts[guestEmail]) {
      const profile: UserProfile = {
        id: 'guest',
        username: 'Convidado',
        email: guestEmail,
        avatarColor: '#FFB547',
        language: this.getLanguage(),
        favorites: [],
        recentGames: [],
        createdAt: Date.now(),
      };
      accounts[guestEmail] = { profile, passwordHash: '' };
      this.saveAccounts(accounts);
    }
    this.storage.setItem(SESSION_KEY, guestEmail);
    return accounts[guestEmail].profile;
  }

  logout(): void {
    this.storage.removeItem(SESSION_KEY);
  }

  updateProfile(profile: UserProfile): UserProfile {
    const accounts = this.loadAccounts();
    const key = profile.email.toLowerCase();
    if (accounts[key]) {
      accounts[key].profile = profile;
      this.saveAccounts(accounts);
    }
    return profile;
  }

  toggleFavorite(gameId: string): UserProfile | null {
    const user = this.getCurrentUser();
    if (!user) return null;
    const exists = user.favorites.includes(gameId);
    const favorites = exists
      ? user.favorites.filter((f) => f !== gameId)
      : [gameId, ...user.favorites];
    return this.updateProfile({ ...user, favorites });
  }

  recordPlay(gameId: string, title: string, consoleId: string): UserProfile | null {
    const user = this.getCurrentUser();
    if (!user) return null;
    const filtered = user.recentGames.filter((g) => g.gameId !== gameId);
    const recentGames = [{ gameId, title, consoleId, playedAt: Date.now() }, ...filtered].slice(0, 12);
    return this.updateProfile({ ...user, recentGames });
  }
}
