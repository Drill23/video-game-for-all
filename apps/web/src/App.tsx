import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import './styles/theme.css';
import './styles/home.css';
import type { ConsoleId } from '@vgfa/pad';
import {
  ALL_STORE_GAMES,
  CONSOLES,
  CONSOLE_MAP,
  FREE_PLAYABLE_ROMS,
  STORE_CATALOG,
  detectConsoleFromFilename,
  detectVgfaBackend,
  getUserSourceForGame,
  smartFindGameOptions,
  type LibraryEntry,
  type SmartFindOption,
  type StoreGame,
} from '@vgfa/runtime';
import {
  VgfaAuthStore,
  VgfaSaveStore,
  type SupportedLang,
  type UserProfile,
} from '@vgfa/storage';
import { TRANSLATIONS } from './i18n/translations.js';
import { GameDetailModal } from './components/GameDetailModal.js';
import { NexusOptimizerModal, loadNexusProfile, type NexusProfile } from './components/NexusOptimizerModal.js';
import { LibraryPanel } from './components/LibraryPanel.js';
import { useLibraryEntries } from './services/useLibrary.js';
import { Icon } from './components/Icon.js';
import { GameCard } from './components/home/GameCard.js';
import { Hero } from './components/home/Hero.js';
import { Row } from './components/home/Row.js';
import { Splash } from './components/home/Splash.js';
import { Tabs, type TabId } from './components/home/Tabs.js';
import { TopBar } from './components/home/TopBar.js';
import { HOME_STRINGS } from './components/home/strings.js';
import { useTheme, type ThemePref } from './components/home/useTheme.js';
import type { ActiveSession, PlayerMode } from './pages/PlayerView.js';

const PlayerView = lazy(() => import('./pages/PlayerView.js').then((m) => ({ default: m.PlayerView })));
const WatchPage = lazy(() => import('./pages/WatchPage.js').then((m) => ({ default: m.WatchPage })));
const ControllerPage = lazy(() => import('./pages/ControllerPage.js').then((m) => ({ default: m.ControllerPage })));
const AuthModal = lazy(() => import('./components/AuthModal.js').then((m) => ({ default: m.AuthModal })));
const SaveManagerModal = lazy(() =>
  import('./components/SaveManagerModal.js').then((m) => ({ default: m.SaveManagerModal })),
);
const ShareLinkModal = lazy(() => import('./components/ShareLinkModal.js').then((m) => ({ default: m.ShareLinkModal })));

const SpinnerFallback: React.FC = () => (
  <div className="glass-spinner-wrap" role="status" aria-label="Carregando">
    <div className="glass-spinner" />
  </div>
);

const ROM_ACCEPT =
  '.a26,.nes,.sfc,.smc,.md,.gen,.gb,.gbc,.gba,.z64,.n64,.v64,.cue,.chd,.cso,.zso,.iso,.bin,.pbp,.elf';

function resolveMode(consoleId: ConsoleId): PlayerMode {
  const def = CONSOLE_MAP[consoleId];
  return def.engineTier === 'vgfa-ps2-webgpu' ? 'ps2-webgpu-lab' : 'emulatorjs-rom';
}

/** Rótulo curto para selos de capa. */
function badgeLabel(def: { id: string; shortName: string }): string {
  return def.id === 'ps2' ? 'PS2' : def.shortName;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(ts: number, lang: SupportedLang): string {
  const min = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (min < 60) return rtf.format(-Math.max(1, min), 'minute');
  const h = Math.floor(min / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  return rtf.format(-Math.floor(h / 24), 'day');
}

function resolveSubRoute(): { kind: 'home' | 'pad' | 'watch'; code?: string } {
  if (typeof window === 'undefined') return { kind: 'home' };
  const hash = window.location.hash.replace(/^#/, '');
  const path = window.location.pathname;
  const candidates = [hash, path];
  for (const c of candidates) {
    const padMatch = /(?:^|\/)pad(?:\/([^/?#]+))?$/i.exec(c);
    if (padMatch) {
      return { kind: 'pad', code: padMatch[1] ? decodeURIComponent(padMatch[1]) : undefined };
    }
    const watchMatch = /(?:^|\/)watch(?:\/([^/?#]+))?$/i.exec(c);
    if (watchMatch) {
      return { kind: 'watch', code: watchMatch[1] ? decodeURIComponent(watchMatch[1]) : undefined };
    }
  }
  return { kind: 'home' };
}

const CATALOG_SORTED = [...STORE_CATALOG].sort(
  (a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99) || b.rating - a.rating,
);

/** Destaques: intercala jogos 1-clique com os mais bem colocados do catálogo. */
function buildFeatured(): StoreGame[] {
  const free = [...FREE_PLAYABLE_ROMS].sort((a, b) => b.rating - a.rating).slice(0, 4);
  const top = CATALOG_SORTED.slice(0, 4);
  const out: StoreGame[] = [];
  for (let i = 0; i < Math.max(free.length, top.length); i++) {
    if (free[i]) out.push(free[i]);
    if (top[i]) out.push(top[i]);
  }
  return out;
}

const FEATURED = buildFeatured();

/** Roteador: mantém os hooks da home fora das rotas /pad e /watch. */
export const App: React.FC = () => {
  // O tema (data-theme) e o modo leve valem para todas as rotas, inclusive /pad e /watch.
  const [themePref, setThemePref] = useTheme();
  // Troca de rota pelo #hash (ex.: abrir #/pad ou #/watch na mesma aba) sem precisar recarregar
  const [, setRouteTick] = useState(0);
  useEffect(() => {
    const onHash = () => setRouteTick((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const subRoute = resolveSubRoute();
  if (subRoute.kind === 'pad') {
    return (
      <Suspense fallback={<SpinnerFallback />}>
        <ControllerPage initialRoomCode={subRoute.code} />
      </Suspense>
    );
  }
  if (subRoute.kind === 'watch') {
    return (
      <Suspense fallback={<SpinnerFallback />}>
        <WatchPage initialCastCode={subRoute.code} />
      </Suspense>
    );
  }
  return <HomeApp themePref={themePref} onTheme={setThemePref} />;
};

const HomeApp: React.FC<{ themePref: ThemePref; onTheme: (t: ThemePref) => void }> = ({ themePref, onTheme }) => {
  const auth = useMemo(() => new VgfaAuthStore(), []);
  const saveStore = useMemo(() => new VgfaSaveStore(), []);

  const [lang, setLang] = useState<SupportedLang>(() => auth.getLanguage());
  const [user, setUser] = useState<UserProfile | null>(() => auth.getCurrentUser());
  const [selectedConsole, setSelectedConsole] = useState<ConsoleId | 'all'>('all');
  const [storeQuery, setStoreQuery] = useState('');
  const [tab, setTab] = useState<TabId>('home');
  const [detailGame, setDetailGame] = useState<StoreGame | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [nexusProfile, setNexusProfile] = useState<NexusProfile | null>(() => loadNexusProfile());
  const [bannerHidden, setBannerHidden] = useState(() => {
    try {
      return sessionStorage.getItem('vgfa:nexus_banner_hidden') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void detectVgfaBackend();
  }, []);

  // Busca inteligente livre na web (somente fontes abertas verificadas HTTP 200!)
  const [webFinding, setWebFinding] = useState(false);
  const [webOptions, setWebOptions] = useState<SmartFindOption[]>([]);
  const [webNote, setWebNote] = useState<string | null>(null);

  const libraryEntries = useLibraryEntries();

  const t = TRANSLATIONS[lang];
  const s = HOME_STRINGS[lang];
  const effectiveUserId = user?.id ?? 'guest';
  const padHref = `${import.meta.env.BASE_URL}#/pad`;

  const handleLangChange = (next: SupportedLang) => {
    setLang(next);
    auth.setLanguage(next);
  };

  const launchStoreLocal = (game: StoreGame, file: File) => {
    setDetailGame(null);
    auth.recordPlay(game.id, game.title, game.consoleId);
    setActiveSession({
      id: game.id,
      title: game.title,
      consoleId: game.consoleId,
      serial: game.serial,
      coverUrl: game.coverUrl,
      mode: resolveMode(game.consoleId),
      localFile: file,
      romFilename: file.name,
    });
  };

  const launchStoreUrl = (game: StoreGame, url: string, filename?: string) => {
    setDetailGame(null);
    auth.recordPlay(game.id, game.title, game.consoleId);
    setActiveSession({
      id: game.id,
      title: game.title,
      consoleId: game.consoleId,
      serial: game.serial,
      coverUrl: game.coverUrl,
      mode: resolveMode(game.consoleId),
      remoteUrl: url,
      romFilename: filename,
    });
  };

  const openPs2RuntimeForGame = (game: StoreGame) => {
    setDetailGame(null);
    auth.recordPlay(game.id, game.title, 'ps2');
    setActiveSession({
      id: game.id,
      title: game.title,
      consoleId: 'ps2',
      serial: game.serial,
      coverUrl: game.coverUrl,
      mode: 'ps2-webgpu-lab',
    });
  };

  const handleLocalFilePick = (file: File) => {
    const detected = detectConsoleFromFilename(
      file.name,
      selectedConsole === 'all' ? 'ps2' : selectedConsole,
    );
    auth.recordPlay(`local-${file.name}`, file.name, detected);
    setActiveSession({
      id: `local-${file.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
      title: file.name,
      consoleId: detected,
      mode: resolveMode(detected),
      localFile: file,
      romFilename: file.name,
    });
  };

  const runSmartWebSearch = async (term?: string) => {
    const q = (term ?? storeQuery).trim();
    if (!q) return;
    setWebFinding(true);
    setWebNote(null);
    try {
      const res = await smartFindGameOptions(
        q,
        selectedConsole === 'all' ? undefined : selectedConsole,
      );
      setWebOptions(res.options);
      setWebNote(res.note ?? null);
    } finally {
      setWebFinding(false);
    }
  };

  /** "Jogar": 1 clique se tiver ROM livre ou fonte do usuário; senão abre a ficha do jogo. */
  const playGame = (game: StoreGame) => {
    if (game.freeRomUrl) {
      launchStoreUrl(game, game.freeRomUrl, game.freeRomFilename);
      return;
    }
    const src = getUserSourceForGame(game.id);
    if (src) {
      launchStoreUrl(game, src.url, src.filename);
      return;
    }
    setDetailGame(game);
  };

  const findGameForEntry = (entry: LibraryEntry): StoreGame | undefined =>
    ALL_STORE_GAMES.find((g) => (entry.gameId && g.id === entry.gameId) || g.freeRomUrl === entry.url);

  const consoleOfEntry = (entry: LibraryEntry, game?: StoreGame): ConsoleId =>
    (entry.consoleId && entry.consoleId in CONSOLE_MAP
      ? entry.consoleId
      : (game?.consoleId ?? detectConsoleFromFilename(entry.filename, 'snes'))) as ConsoleId;

  const playLibraryEntry = (entry: LibraryEntry, game?: StoreGame) => {
    const found = game ?? findGameForEntry(entry);
    if (found) {
      launchStoreUrl(found, entry.url, entry.filename);
      return;
    }
    const cid = consoleOfEntry(entry);
    const title = entry.title ?? entry.filename;
    auth.recordPlay(entry.gameId ?? `lib-${entry.filename}`, title, cid);
    setActiveSession({
      id: entry.gameId ?? `lib-${entry.filename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
      title,
      consoleId: cid,
      coverUrl: entry.coverUrl,
      mode: resolveMode(cid),
      remoteUrl: entry.url,
      romFilename: entry.filename,
    });
  };

  const normalizedQuery = storeQuery.trim().toLowerCase();

  const matchesFilter = (g: StoreGame) => {
    if (selectedConsole !== 'all' && g.consoleId !== selectedConsole) return false;
    if (!normalizedQuery) return true;
    const consoleName = CONSOLE_MAP[g.consoleId].name.toLowerCase();
    return (
      g.title.toLowerCase().includes(normalizedQuery) ||
      g.genre.toLowerCase().includes(normalizedQuery) ||
      g.developer.toLowerCase().includes(normalizedQuery) ||
      consoleName.includes(normalizedQuery) ||
      g.consoleId.includes(normalizedQuery) ||
      (g.serial?.toLowerCase().includes(normalizedQuery) ?? false)
    );
  };

  const filteredPlayable = FREE_PLAYABLE_ROMS.filter(matchesFilter);
  const filteredLibrary = CATALOG_SORTED.filter(matchesFilter);

  const consoleCounts = useMemo(() => {
    const map = new Map<ConsoleId, number>();
    for (const g of ALL_STORE_GAMES) map.set(g.consoleId, (map.get(g.consoleId) ?? 0) + 1);
    return map;
  }, []);

  const consoleRows = useMemo(
    () =>
      CONSOLES.filter((c) => c.id !== 'ps2' && (consoleCounts.get(c.id) ?? 0) > 0).map((c) => ({
        def: c,
        games: ALL_STORE_GAMES.filter((g) => g.consoleId === c.id),
      })),
    [consoleCounts],
  );

  const goTab = (next: TabId) => {
    setActiveSession(null);
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  const handleQuery = (q: string) => {
    setStoreQuery(q);
    if (q.trim() && tab !== 'store') setTab('store');
    if (!q.trim()) {
      setWebOptions([]);
      setWebNote(null);
    }
  };

  const hideBanner = () => {
    setBannerHidden(true);
    try {
      sessionStorage.setItem('vgfa:nexus_banner_hidden', '1');
    } catch {
      // ignora
    }
  };

  const renderStoreCard = (game: StoreGame) => {
    const def = CONSOLE_MAP[game.consoleId];
    const ready = Boolean(game.freeRomUrl);
    const hasSource = !ready && Boolean(getUserSourceForGame(game.id));
    return (
      <GameCard
        key={game.id}
        title={game.title}
        coverUrl={game.coverUrl}
        accent={def.accent}
        consoleLabel={badgeLabel(def)}
        rating={game.rating}
        meta={`${game.developer} · ${game.year}`}
        tag={ready ? `▶ ${s.ready}` : hasSource ? `▶ ${s.play}` : undefined}
        onOpen={() => (ready ? playGame(game) : setDetailGame(game))}
      />
    );
  };

  const seeAllConsole = (id: ConsoleId | 'all') => {
    setSelectedConsole(id);
    goTab('store');
  };

  return (
    <>
      <Splash subtitle={s.brandSub} />

      <TopBar
        s={s}
        compact={Boolean(activeSession)}
        tab={tab}
        onTab={goTab}
        query={storeQuery}
        onQuery={handleQuery}
        onSubmitSearch={() => goTab('store')}
        lang={lang}
        onLang={handleLangChange}
        themePref={themePref}
        onTheme={onTheme}
        nexusActive={Boolean(nexusProfile)}
        onOptimize={() => setShowOptimizer(true)}
        user={user}
        signOutLabel={t.signOut}
        onSignIn={() => setShowAuth(true)}
        onSignOut={() => {
          auth.logout();
          setUser(null);
        }}
        onSaves={() => setShowSaves(true)}
        onShare={() => setShowShare(true)}
        onPickFile={handleLocalFilePick}
        onBrand={() => goTab('home')}
        padHref={padHref}
      />

      {activeSession ? (
        <Suspense fallback={<SpinnerFallback />}>
          <PlayerView
            t={t}
            session={activeSession}
            userId={effectiveUserId}
            saveStore={saveStore}
            onBack={() => setActiveSession(null)}
          />
        </Suspense>
      ) : (
        <main className="vgfa-shell page">
          {tab === 'home' && (
            <>
              <Hero games={FEATURED} lang={lang} s={s} onPlay={playGame} onDetails={setDetailGame} />

              {!nexusProfile && !bannerHidden && (
                <div className="nexus-banner glass">
                  <span className="nexus-banner-ico">
                    <Icon name="bolt" size={20} />
                  </span>
                  <p>{s.nexusBanner}</p>
                  <button className="btn btn-sm btn-primary" onClick={() => setShowOptimizer(true)}>
                    {s.nexusBannerCta}
                  </button>
                  <button className="icon-btn banner-x" aria-label={s.dismiss} onClick={hideBanner}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}

              {libraryEntries.length > 0 && (
                <Row
                  title={s.continuePlaying}
                  subtitle={s.continueSub}
                  leftLabel={s.scrollLeft}
                  rightLabel={s.scrollRight}
                  seeAllLabel={s.seeAll}
                  onSeeAll={() => goTab('library')}
                >
                  {libraryEntries.slice(0, 14).map((entry) => {
                    const game = findGameForEntry(entry);
                    const def = CONSOLE_MAP[consoleOfEntry(entry, game)];
                    return (
                      <GameCard
                        key={entry.key}
                        title={entry.title ?? game?.title ?? entry.filename}
                        coverUrl={entry.coverUrl ?? game?.coverUrl}
                        accent={def.accent}
                        consoleLabel={badgeLabel(def)}
                        meta={`${s.resume} · ${timeAgo(entry.lastPlayedAt, lang)}`}
                        tag={fmtSize(entry.sizeBytes) || undefined}
                        onOpen={() => playLibraryEntry(entry, game)}
                      />
                    );
                  })}
                </Row>
              )}

              <Row
                title={s.freeNow}
                subtitle={s.freeNowSub}
                leftLabel={s.scrollLeft}
                rightLabel={s.scrollRight}
                seeAllLabel={s.seeAll}
                onSeeAll={() => seeAllConsole('all')}
              >
                {FREE_PLAYABLE_ROMS.map(renderStoreCard)}
              </Row>

              <Row
                title={s.topPs2}
                leftLabel={s.scrollLeft}
                rightLabel={s.scrollRight}
                seeAllLabel={s.seeAll}
                onSeeAll={() => seeAllConsole('ps2')}
              >
                {CATALOG_SORTED.filter((g) => g.consoleId === 'ps2')
                  .slice(0, 16)
                  .map(renderStoreCard)}
              </Row>

              {consoleRows.map(({ def, games }) => (
                <Row
                  key={def.id}
                  title={def.name}
                  subtitle={def.generation}
                  leftLabel={s.scrollLeft}
                  rightLabel={s.scrollRight}
                  seeAllLabel={s.seeAll}
                  onSeeAll={() => seeAllConsole(def.id)}
                >
                  {games.map(renderStoreCard)}
                </Row>
              ))}
            </>
          )}

          {tab === 'store' && (
            <div className="store-view">
              <div className="page-head">
                <div>
                  <h1>{s.storeTitle}</h1>
                  <p>{s.storeSub}</p>
                </div>
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  <Icon name="folder" size={16} />
                  {s.openMyGame}
                  <input
                    type="file"
                    hidden
                    accept={ROM_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleLocalFilePick(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              <form
                className="store-search glass"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSmartWebSearch();
                }}
              >
                <Icon name="search" size={18} />
                <input
                  type="search"
                  placeholder={s.searchPlaceholder}
                  aria-label={s.searchPlaceholder}
                  value={storeQuery}
                  onChange={(e) => handleQuery(e.target.value)}
                />
                <button className="btn btn-sm btn-primary" type="submit" disabled={webFinding || !storeQuery.trim()}>
                  {webFinding ? s.webSearching : s.webSearch}
                </button>
              </form>

              <div className="chip-row" role="tablist">
                <button
                  className={`chip ${selectedConsole === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedConsole('all')}
                >
                  {s.allConsoles} ({ALL_STORE_GAMES.length})
                </button>
                {CONSOLES.filter((c) => (consoleCounts.get(c.id) ?? 0) > 0).map((c) => (
                  <button
                    key={c.id}
                    className={`chip ${selectedConsole === c.id ? 'active' : ''}`}
                    style={{ ['--chip-accent' as string]: c.accent }}
                    onClick={() => setSelectedConsole(c.id)}
                  >
                    <i className="dot" style={{ background: c.accent }} />
                    {c.shortName}
                  </button>
                ))}
              </div>

              {(webOptions.length > 0 || webNote) && (
                <div className="web-results glass">
                  <div className="web-results-head">
                    <strong>
                      {s.webResults}: &ldquo;{storeQuery}&rdquo;
                    </strong>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setWebOptions([]);
                        setWebNote(null);
                      }}
                    >
                      {s.clear}
                    </button>
                  </div>
                  {webOptions.length > 0 ? (
                    <div className="web-list">
                      {webOptions.slice(0, 4).map((opt) => (
                        <div
                          key={`${opt.identifier}-${opt.filename}`}
                          className={`web-item ${opt.bestChoice ? 'is-best' : ''}`}
                        >
                          <div className="web-item-text">
                            <div className="web-item-name">
                              {opt.bestChoice ? `★ ${s.bestOption} · ` : ''}
                              {opt.filename}
                            </div>
                            <div className="web-item-sub">
                              {opt.itemTitle} · {fmtSize(opt.size)}
                            </div>
                          </div>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              const cid = detectConsoleFromFilename(
                                opt.filename,
                                selectedConsole === 'all' ? 'snes' : selectedConsole,
                              );
                              setActiveSession({
                                id: `web-${opt.identifier}`,
                                title: opt.itemTitle,
                                consoleId: cid,
                                mode: resolveMode(cid),
                                remoteUrl: opt.proxyUrl,
                                romFilename: opt.filename,
                              });
                            }}
                          >
                            <Icon name="play" size={14} /> {s.play}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="web-note">{webNote}</p>
                  )}
                </div>
              )}

              {filteredPlayable.length > 0 && (
                <>
                  {filteredLibrary.length > 0 && (
                    <h2 className="group-title">
                      {s.readyGroup} <span>{filteredPlayable.length}</span>
                    </h2>
                  )}
                  <div className="store-grid2">{filteredPlayable.map(renderStoreCard)}</div>
                </>
              )}

              {filteredLibrary.length > 0 && (
                <>
                  {filteredPlayable.length > 0 && (
                    <h2 className="group-title">
                      {s.classicsGroup} <span>{filteredLibrary.length}</span>
                    </h2>
                  )}
                  <div className="store-grid2">{filteredLibrary.map(renderStoreCard)}</div>
                </>
              )}

              {filteredPlayable.length === 0 && filteredLibrary.length === 0 && (
                <div className="empty glass">{s.noResults}</div>
              )}
            </div>
          )}

          {tab === 'library' && (
            <div className="store-view">
              <LibraryPanel games={ALL_STORE_GAMES} onPlay={playLibraryEntry} />
            </div>
          )}

          {tab === 'pad' && (
            <div className="store-view">
              <section className="pad-hero glass">
                <div className="pad-hero-copy">
                  <h1>{s.padTitle}</h1>
                  <p>{s.padLead}</p>
                  <a className="btn btn-primary btn-lg" href={padHref} target="_blank" rel="noreferrer">
                    <Icon name="phone" size={18} /> {s.padTest}
                  </a>
                  <p className="pad-tip">{s.padTip}</p>
                </div>
                <ol className="pad-steps">
                  {[
                    [s.padStep1, s.padStep1d],
                    [s.padStep2, s.padStep2d],
                    [s.padStep3, s.padStep3d],
                  ].map(([title, desc], i) => (
                    <li key={title} className="pad-step">
                      <span className="pad-step-n">{i + 1}</span>
                      <div>
                        <strong>{title}</strong>
                        <span>{desc}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}

          <footer className="vgfa-footer">
            <span>{t.footerCredit}</span>
            <span>Atari 2600 · NES · Mega Drive · SNES · GBA · N64 · PS1 · PSP · PS2</span>
          </footer>
        </main>
      )}

      {!activeSession && <Tabs s={s} tab={tab} onTab={goTab} variant="bar" />}

      {detailGame && (
        <GameDetailModal
          game={detailGame}
          lang={lang}
          onClose={() => setDetailGame(null)}
          onLaunchLocal={launchStoreLocal}
          onLaunchUrl={launchStoreUrl}
          onOpenPs2Runtime={openPs2RuntimeForGame}
        />
      )}

      <Suspense fallback={null}>
        {showAuth && (
          <AuthModal
            auth={auth}
            onAuthenticated={(u) => setUser(u)}
            onClose={() => setShowAuth(false)}
          />
        )}

        {showSaves && (
          <SaveManagerModal
            saveStore={saveStore}
            userId={effectiveUserId}
            onClose={() => setShowSaves(false)}
          />
        )}

        {showShare && <ShareLinkModal onClose={() => setShowShare(false)} />}
      </Suspense>

      {showOptimizer && (
        <NexusOptimizerModal
          onClose={() => setShowOptimizer(false)}
          onActivated={(p) => setNexusProfile(p)}
        />
      )}
    </>
  );
};
