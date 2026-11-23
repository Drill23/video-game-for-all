import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import './styles/theme.css';
import './styles/home.css';
import './styles/prisma-tv.css';
import type { ConsoleId } from '@vgfa/pad';
import {
  ALL_STORE_GAMES,
  CONSOLES,
  CONSOLE_MAP,
  FREE_PLAYABLE_ROMS,
  deleteLibraryEntry,
  removeLibraryEntry,
  formatBytes,
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
import { NexusOptimizerModal, loadNexusProfile, type NexusProfile } from './components/NexusOptimizerModal.js';
import { DownloadExplainerHost } from './components/DownloadExplainer.js';
import { useLibraryEntries } from './services/useLibrary.js';
import { Icon } from './components/Icon.js';
import { ContinueRow, type ContinueItem } from './components/home/ContinueRow.js';
import { GameCard } from './components/home/GameCard.js';
import { Hero } from './components/home/Hero.js';
import { Row, LazyRow, TopItem } from './components/home/Row.js';
import { Splash } from './components/home/Splash.js';
import { gateAlreadySeen, markGateSeen, useProfiles } from './components/home/useProfiles.js';
import { useSpatialNav } from './components/home/useSpatialNav.js';
import {
  CATALOG_SORTED,
  CONSOLE_ROWS,
  FEATURED,
  GAME_BY_ID,
  GENRE_ROWS,
  TOP_PS1,
  TOP_PS2,
} from './components/home/homeData.js';
import { GENRE_LABEL, consoleBadge } from './components/home/gameMeta.js';
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
// Janelas que só abrem com um clique: carregam sob demanda (a home abre mais rápido)
const loadDetail = () => import('./components/GameDetailModal.js');
const loadLibrary = () => import('./components/LibraryPanel.js');
const loadProfiles = () => import('./components/home/Profiles.js');
const GameDetailModal = lazy(() => loadDetail().then((m) => ({ default: m.GameDetailModal })));
const LibraryPanel = lazy(() => loadLibrary().then((m) => ({ default: m.LibraryPanel })));
const ProfileGate = lazy(() => loadProfiles().then((m) => ({ default: m.ProfileGate })));
const ProfileSheet = lazy(() => loadProfiles().then((m) => ({ default: m.ProfileSheet })));

/** Depois que a home aparece, pré-carrega em segundo plano as janelas mais usadas. */
function prefetchSecondaryChunks(): void {
  const run = () => {
    void loadDetail().catch(() => {});
    void loadLibrary().catch(() => {});
    void loadProfiles().catch(() => {});
  };
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}

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
    prefetchSecondaryChunks();
  }, []);

  // Busca inteligente livre na web (somente fontes abertas verificadas HTTP 200!)
  const [webFinding, setWebFinding] = useState(false);
  const [webOptions, setWebOptions] = useState<SmartFindOption[]>([]);
  const [webNote, setWebNote] = useState<string | null>(null);

  const libraryEntries = useLibraryEntries();

  // Perfis locais, navegação por controle e eventos de outras telas
  const profiles = useProfiles();
  const [gate, setGate] = useState<null | 'first' | 'switch'>(null);
  const [showProfile, setShowProfile] = useState(false);
  useSpatialNav(!activeSession && !gate);

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const tabId = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tabId === 'home' || tabId === 'store' || tabId === 'library' || tabId === 'pad') {
        setActiveSession(null);
        setTab(tabId);
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('vgfa:navigate', onNavigate);
    return () => window.removeEventListener('vgfa:navigate', onNavigate);
  }, []);

  const libraryByGame = useMemo(() => {
    const byId = new Map<string, LibraryEntry>();
    const byUrl = new Map<string, LibraryEntry>();
    for (const e of libraryEntries) {
      if (e.gameId) byId.set(e.gameId, e);
      byUrl.set(e.url, e);
    }
    return (g: StoreGame): LibraryEntry | undefined =>
      byId.get(g.id) ?? (g.freeRomUrl ? byUrl.get(g.freeRomUrl) : undefined);
  }, [libraryEntries]);

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
    if (entry.kind === 'ps2-disc') {
      // Disco PS2 já guardado no aparelho: o runner reaproveita, sem baixar de novo
      const title = entry.title ?? found?.title ?? entry.filename;
      auth.recordPlay(entry.gameId ?? found?.id ?? `lib-${entry.filename}`, title, 'ps2');
      setActiveSession({
        id: found?.id ?? entry.gameId ?? `lib-${entry.filename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
        title,
        consoleId: 'ps2',
        serial: found?.serial,
        coverUrl: entry.coverUrl ?? found?.coverUrl,
        mode: 'ps2-webgpu-lab',
        remoteUrl: entry.url,
        romFilename: entry.filename,
      });
      return;
    }
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
    const onDevice = Boolean(libraryByGame(game));
    return (
      <GameCard
        key={game.id}
        title={game.title}
        coverUrl={game.coverUrl}
        accent={def.accent}
        consoleLabel={consoleBadge(game)}
        rating={game.rating}
        year={game.year}
        tag={onDevice ? `✓ ${s.onDevice}` : ready ? `▶ ${s.ready}` : hasSource ? `▶ ${s.play}` : undefined}
        onOpen={() => (ready ? playGame(game) : setDetailGame(game))}
      />
    );
  };

  const consoleNames = (id: ConsoleId) => (id === 'ps2' ? 'PlayStation 2' : CONSOLE_MAP[id].name);

  const myListGames = profiles.list.map((id) => GAME_BY_ID.get(id)).filter((g): g is StoreGame => Boolean(g));

  const continueItems: ContinueItem[] = libraryEntries.slice(0, 14).map((entry) => {
    const game = findGameForEntry(entry);
    const def = CONSOLE_MAP[consoleOfEntry(entry, game)];
    return {
      key: entry.key,
      title: entry.title ?? game?.title ?? entry.filename,
      coverUrl: entry.coverUrl ?? game?.coverUrl,
      accent: def.accent,
      consoleLabel: def.id === 'ps2' ? 'PS2' : def.shortName,
      rating: game?.rating,
      year: game?.year,
      meta: `${s.resume} · ${timeAgo(entry.lastPlayedAt, lang)}`,
      sizeLabel: formatBytes(entry.sizeBytes),
      onPlay: () => playLibraryEntry(entry, game),
      onDelete: () => (entry.kind === 'ps2-disc' ? removeLibraryEntry(entry.url) : deleteLibraryEntry(entry.url)),
    };
  });

  const closeGate = () => {
    markGateSeen();
    setGate(null);
  };

  const seeAllConsole = (id: ConsoleId | 'all') => {
    setSelectedConsole(id);
    goTab('store');
  };

  return (
    <>
      <Splash
        subtitle={s.brandSub}
        onDone={() => {
          if (!gateAlreadySeen() && !profiles.active) setGate('first');
        }}
      />

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
        profile={profiles.active}
        onProfileSheet={() => setShowProfile(true)}
        onProfileSwitch={() => setGate('switch')}
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
        <main className="page">
          {tab === 'home' && (
            <Hero
              games={FEATURED}
              lang={lang}
              s={s}
              libraryFor={libraryByGame}
              inList={profiles.isInList}
              onPlay={playGame}
              onResume={(g, entry) => playLibraryEntry(entry, g)}
              onDetails={setDetailGame}
              onToggleList={(g) => profiles.toggleInList(g.id)}
            />
          )}
          <div className="vgfa-shell">
          {tab === 'home' && (
            <>
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

              {continueItems.length > 0 && (
                <ContinueRow
                  s={s}
                  items={continueItems}
                  title={s.continuePlaying}
                  subtitle={s.continueSub}
                  seeAllLabel={s.seeAll}
                  onSeeAll={() => goTab('library')}
                />
              )}

              {myListGames.length > 0 && (
                <Row
                  title={s.myList}
                  subtitle={s.myListSub}
                  leftLabel={s.scrollLeft}
                  rightLabel={s.scrollRight}
                >
                  {myListGames.map(renderStoreCard)}
                </Row>
              )}

              <LazyRow eager title={s.topPs2}>
                <Row
                  title={s.topPs2}
                  variant="top10"
                  leftLabel={s.scrollLeft}
                  rightLabel={s.scrollRight}
                  seeAllLabel={s.seeAll}
                  onSeeAll={() => seeAllConsole('ps2')}
                >
                  {TOP_PS2.map((g, i) => (
                    <TopItem key={g.id} rank={i + 1}>
                      {renderStoreCard(g)}
                    </TopItem>
                  ))}
                </Row>
              </LazyRow>

              <LazyRow eager title={s.freeNow}>
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
              </LazyRow>

              {TOP_PS1.length > 0 && (
                <LazyRow title={s.topPs1}>
                  <Row
                    title={s.topPs1}
                    variant="top10"
                    leftLabel={s.scrollLeft}
                    rightLabel={s.scrollRight}
                    seeAllLabel={s.seeAll}
                    onSeeAll={() => seeAllConsole('ps1')}
                  >
                    {TOP_PS1.map((g, i) => (
                      <TopItem key={g.id} rank={i + 1}>
                        {renderStoreCard(g)}
                      </TopItem>
                    ))}
                  </Row>
                </LazyRow>
              )}

              {GENRE_ROWS.map(({ id, games }) => (
                <LazyRow key={`g-${id}`} title={GENRE_LABEL[lang][id]}>
                  <Row
                    title={GENRE_LABEL[lang][id]}
                    leftLabel={s.scrollLeft}
                    rightLabel={s.scrollRight}
                  >
                    {games.map(renderStoreCard)}
                  </Row>
                </LazyRow>
              ))}

              {CONSOLE_ROWS.map(({ id, games }) => {
                const def = CONSOLE_MAP[id];
                const title = id === 'ps2' || id === 'ps1' ? s.moreOf.replace('{c}', consoleNames(id)) : def.name;
                return (
                  <LazyRow key={`c-${id}`} title={title}>
                    <Row
                      title={title}
                      subtitle={def.generation}
                      leftLabel={s.scrollLeft}
                      rightLabel={s.scrollRight}
                      seeAllLabel={s.seeAll}
                      onSeeAll={() => seeAllConsole(id)}
                    >
                      {games.map(renderStoreCard)}
                    </Row>
                  </LazyRow>
                );
              })}
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
              <Suspense fallback={<SpinnerFallback />}>
                <LibraryPanel games={ALL_STORE_GAMES} onPlay={playLibraryEntry} />
              </Suspense>
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
            <span className="tv-hint">{s.tvHint}</span>
            <span>Atari 2600 · NES · Mega Drive · SNES · GBA · N64 · PS1 · PSP · PS2</span>
          </footer>
          </div>
        </main>
      )}

      {!activeSession && <Tabs s={s} tab={tab} onTab={goTab} variant="bar" />}

      <Suspense fallback={null}>
      {detailGame && (
        <GameDetailModal
          key={detailGame.id}
          game={detailGame}
          lang={lang}
          onClose={() => setDetailGame(null)}
          onLaunchLocal={launchStoreLocal}
          onLaunchUrl={launchStoreUrl}
          onOpenPs2Runtime={openPs2RuntimeForGame}
          onOpenGame={setDetailGame}
        />
      )}
      </Suspense>

      <DownloadExplainerHost />

      <Suspense fallback={null}>
      {gate && (
        <ProfileGate
          s={s}
          mode={gate}
          profiles={profiles.profiles}
          activeId={profiles.active?.id ?? null}
          ambient={FEATURED[0]?.coverUrl}
          onPick={(id) => {
            profiles.select(id);
            closeGate();
          }}
          onCreate={profiles.create}
          onUpdate={profiles.update}
          onDelete={profiles.remove}
          onClose={closeGate}
        />
      )}

      {showProfile && (
        <ProfileSheet
          s={s}
          profile={profiles.active}
          entries={libraryEntries}
          listCount={profiles.list.length}
          onClose={() => setShowProfile(false)}
          onEdit={() => {
            setShowProfile(false);
            setGate('switch');
          }}
          onSwitch={() => {
            setShowProfile(false);
            setGate('switch');
          }}
        />
      )}
      </Suspense>

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
