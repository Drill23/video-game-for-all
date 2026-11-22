import React, { useMemo, useState } from 'react';
import type { ConsoleId } from '@vgfa/pad';
import {
  ALL_STORE_GAMES,
  CONSOLES,
  CONSOLE_MAP,
  FREE_PLAYABLE_ROMS,
  STORE_CATALOG,
  detectConsoleFromFilename,
  getUserSourceForGame,
  importUserSourcesJson,
  listArchiveFiles,
  searchInternetArchive,
  type ArchivePlayableFile,
  type ArchiveSearchResult,
  type StoreGame,
} from '@vgfa/runtime';
import {
  VgfaAuthStore,
  VgfaSaveStore,
  type SupportedLang,
  type UserProfile,
} from '@vgfa/storage';
import { TRANSLATIONS } from './i18n/translations.js';
import { AuthModal } from './components/AuthModal.js';
import { GameDetailModal } from './components/GameDetailModal.js';
import { SaveManagerModal } from './components/SaveManagerModal.js';
import { ControllerPage } from './pages/ControllerPage.js';
import { PlayerView, type ActiveSession, type PlayerMode } from './pages/PlayerView.js';

function resolveMode(consoleId: ConsoleId): PlayerMode {
  const def = CONSOLE_MAP[consoleId];
  if (def.engineTier === 'vgfa-ps2-webgpu') return 'ps2-webgpu-lab';
  if (def.engineTier === 'emulatorjs-wasm') return 'emulatorjs-rom';
  return 'libretro-rom';
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const App: React.FC = () => {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (pathname === '/pad' || pathname.startsWith('/pad/')) {
    const code = pathname.startsWith('/pad/') ? decodeURIComponent(pathname.slice(5)) : undefined;
    return <ControllerPage initialRoomCode={code} />;
  }

  const auth = useMemo(() => new VgfaAuthStore(), []);
  const saveStore = useMemo(() => new VgfaSaveStore(), []);

  const [lang, setLang] = useState<SupportedLang>(() => auth.getLanguage());
  const [user, setUser] = useState<UserProfile | null>(() => auth.getCurrentUser());
  const [selectedConsole, setSelectedConsole] = useState<ConsoleId | 'all'>('all');
  const [storeQuery, setStoreQuery] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'year'>('popular');
  const [detailGame, setDetailGame] = useState<StoreGame | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSaves, setShowSaves] = useState(false);

  // BYOD / Streaming remoto + Manifesto JSON de Fontes
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [remoteConsole, setRemoteConsole] = useState<ConsoleId>('ps2');
  const [sourceImportStatus, setSourceImportStatus] = useState<string | null>(null);

  // Pesquisa ao vivo no Internet Archive (CORS-Free)
  const [archiveQuery, setArchiveQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ArchiveSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<
    Record<string, { restricted: boolean; files: ArchivePlayableFile[] }>
  >({});

  const t = TRANSLATIONS[lang];
  const effectiveUserId = user?.id ?? 'guest';

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

  const handleMountRemoteUrl = () => {
    const url = remoteUrlInput.trim();
    if (!url) return;
    const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'remote-game');
    setActiveSession({
      id: `stream-${Date.now()}`,
      title: filename,
      consoleId: remoteConsole,
      mode: resolveMode(remoteConsole),
      remoteUrl: url,
      romFilename: filename,
    });
  };

  const handleImportSourcesJson = async (file: File) => {
    try {
      const text = await file.text();
      const count = importUserSourcesJson(text);
      setSourceImportStatus(`✓ ${count} fonte(s) vinculadas com sucesso na sua biblioteca!`);
    } catch {
      setSourceImportStatus('JSON inválido. Use o formato {"ps2-dbz-bt3": "https://..."}');
    }
  };

  const handleArchiveSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archiveQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchInternetArchive(
        archiveQuery,
        selectedConsole === 'all' ? undefined : selectedConsole,
        10,
      );
      setSearchResults(results);
      if (results.length === 0) {
        setSearchError('Nenhum item público encontrado com esse termo.');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro ao pesquisar no Internet Archive.');
    } finally {
      setSearching(false);
    }
  };

  const inspectArchiveItem = async (item: ArchiveSearchResult) => {
    try {
      const data = await listArchiveFiles(item.identifier);
      setExpandedFiles((prev) => ({ ...prev, [item.identifier]: data }));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Falha ao ler arquivos do item.');
    }
  };

  // Filtragem e ordenação da Loja
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

  const filteredFreeGames = FREE_PLAYABLE_ROMS.filter(matchesFilter);

  const filteredStoreGames = useMemo(() => {
    const list = STORE_CATALOG.filter(matchesFilter);
    return [...list].sort((a, b) => {
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'year') return b.year - a.year;
      return (a.featuredRank ?? 999) - (b.featuredRank ?? 999) || b.rating - a.rating;
    });
  }, [selectedConsole, normalizedQuery, sortBy]);

  const topFeatured = useMemo(
    () =>
      STORE_CATALOG.filter((g) => g.featuredRank !== undefined)
        .sort((a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99))
        .slice(0, 8),
    [],
  );

  return (
    <>
      <header className="vgfa-nav">
        <div className="vgfa-nav-inner">
          <div className="vgfa-brand" onClick={() => setActiveSession(null)}>
            <div className="vgfa-logo">VGFA</div>
            <div>
              <div className="vgfa-brand-title">VIDEO GAME FOR ALL</div>
              <div className="vgfa-brand-sub">{t.appSubtitle}</div>
            </div>
          </div>

          <div className="vgfa-nav-actions">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                setActiveSession({
                  id: 'dualshock2-tester',
                  title: 'Teste DualShock 2 (Analógicos + Pressão + Vibração)',
                  consoleId: 'ps2',
                  mode: 'builtin-arcade',
                  builtinVariant: 'neon-arena',
                })
              }
            >
              🎮 Testar DualShock 2
            </button>
            <a className="btn btn-sm btn-cyan" href="/pad" target="_blank" rel="noreferrer">
              📱 {t.phonePadMode}
            </a>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSaves(true)}>
              💾 {t.saves}
            </button>
            <select
              className="lang-select"
              value={lang}
              aria-label="Language"
              onChange={(e) => handleLangChange(e.target.value as SupportedLang)}
            >
              <option value="pt-BR">🇧🇷 PT-BR</option>
              <option value="en">🇺🇸 EN</option>
              <option value="es">🇪🇸 ES</option>
            </select>

            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="badge"
                  style={{
                    background: 'var(--bg-2)',
                    borderColor: user.avatarColor,
                    color: 'var(--text-0)',
                  }}
                >
                  ● {user.username}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    auth.logout();
                    setUser(null);
                  }}
                >
                  {t.signOut}
                </button>
              </div>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => setShowAuth(true)}>
                {t.signIn}
              </button>
            )}
          </div>
        </div>
      </header>

      {activeSession ? (
        <PlayerView
          t={t}
          session={activeSession}
          userId={effectiveUserId}
          saveStore={saveStore}
          onBack={() => setActiveSession(null)}
        />
      ) : (
        <main className="vgfa-shell">
          {/* Hero + Busca Instantânea na Loja */}
          <section className="hero">
            <div>
              <div className="hero-kicker">{t.heroKicker}</div>
              <h1>{t.heroTitle}</h1>
              <p>{t.heroDesc}</p>

              <div className="input-row" style={{ marginBottom: 14 }}>
                <input
                  className="field"
                  placeholder="Buscar na loja: Dragon Ball Z, GTA San Andreas, Mario, Sonic, PS2, SLUS-21678..."
                  value={storeQuery}
                  onChange={(e) => setStoreQuery(e.target.value)}
                />
                {storeQuery && (
                  <button className="btn btn-ghost" onClick={() => setStoreQuery('')}>
                    Limpar
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    launchStoreUrl(
                      FREE_PLAYABLE_ROMS[0],
                      FREE_PLAYABLE_ROMS[0].freeRomUrl!,
                      FREE_PLAYABLE_ROMS[0].freeRomFilename,
                    )
                  }
                >
                  ▶ Jogar SNES Real Agora (1 Clique)
                </button>
                <button
                  className="btn btn-cyan"
                  onClick={() => setDetailGame(STORE_CATALOG[0])}
                >
                  🐉 Abrir Dragon Ball Z: BT3 (PS2)
                </button>
              </div>
            </div>

            <div className="hero-pills">
              <div className="stat-card">
                <strong>Loja com {ALL_STORE_GAMES.length} Títulos</strong>
                <span>Capas reais do Atari 2600 ao PlayStation 2 com sinopse, notas e serial</span>
              </div>
              <div className="stat-card">
                <strong>Emuladores Reais WASM</strong>
                <span>Snes9x, FCEUmm, mGBA, Genesis, Stella, Mupen64, PCSX, PPSSPP e PS2 WebGPU</span>
              </div>
              <div className="stat-card">
                <strong>Celular = Controle QR</strong>
                <span>Adapta automaticamente de Atari CX40 até PS2 DualShock 2 + Bluetooth</span>
              </div>
              <div className="stat-card">
                <strong>Proxy CORS-Free + OPFS</strong>
                <span>Streaming sob demanda sem erro de CORS e saves em IndexedDB (.ps2 / state)</span>
              </div>
            </div>
          </section>

          {/* Barra de Consoles + Ordenação */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="console-strip" style={{ flex: 1 }}>
              <button
                className={`console-chip ${selectedConsole === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedConsole('all')}
              >
                {t.allConsoles} ({ALL_STORE_GAMES.length})
              </button>
              {CONSOLES.map((c) => (
                <button
                  key={c.id}
                  className={`console-chip ${selectedConsole === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedConsole(c.id)}
                >
                  <span className="dot" style={{ background: c.accent }} />
                  {c.shortName}
                </button>
              ))}
            </div>

            <select
              className="lang-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'popular' | 'rating' | 'year')}
            >
              <option value="popular">Ordenar: Mais Jogados</option>
              <option value="rating">Ordenar: Maior Nota ★</option>
              <option value="year">Ordenar: Mais Recentes</option>
            </select>
          </div>

          {/* Seção 1: Top Mais Jogados (quando sem filtro/busca) */}
          {selectedConsole === 'all' && !normalizedQuery && (
            <>
              <div className="section-head">
                <h2>🔥 Top Mais Jogados — Destaques PlayStation 2 &amp; Clássicos</h2>
                <p>Clique em qualquer título para ver ficha completa, sinopse, serial e carregar/rodar no navegador</p>
              </div>
              <div className="store-grid">
                {topFeatured.map((game) => {
                  const def = CONSOLE_MAP[game.consoleId];
                  const hasCustomSource = Boolean(getUserSourceForGame(game.id));
                  return (
                    <article
                      key={`top-${game.id}`}
                      className="store-card"
                      onClick={() => setDetailGame(game)}
                    >
                      <div className="store-art-wrap">
                        <img className="store-art-img" src={game.coverUrl} alt={game.title} loading="lazy" />
                        <div className="store-art-overlay" />
                        <div className="store-badges-top">
                          <span
                            className="badge"
                            style={{ background: def.accent, color: '#07080d', borderColor: 'transparent' }}
                          >
                            #{game.featuredRank} • {def.shortName}
                          </span>
                          <span className="rating-pill">★ {game.rating.toFixed(1)}</span>
                        </div>
                      </div>
                      <div className="store-card-body">
                        <h3 className="store-card-title">{game.title}</h3>
                        <div className="store-card-meta">
                          {game.year} • {game.genre}
                        </div>
                        <div className="store-card-foot">
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                            {game.serial || game.sizeEstimate}
                          </span>
                          <span className="badge" style={{ color: hasCustomSource ? '#34d399' : '#bae6fd' }}>
                            {hasCustomSource ? '✓ Fonte Pronta' : 'Ver / Jogar'}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {/* Seção 2: Jogáveis em 1 Clique — ROMs Reais em Emuladores WASM */}
          {filteredFreeGames.length > 0 && (
            <>
              <div className="section-head">
                <h2>⚡ Jogar Agora em 1 Clique — ROMs Reais (Emuladores WASM Grátis &amp; Open-Source)</h2>
                <p>Cartuchos reais de SNES, NES, GBA, Mega Drive e Atari 2600 rodando nos cores Snes9x, FCEUmm, mGBA, Genesis e Stella</p>
              </div>

              <div className="store-grid">
                {filteredFreeGames.map((game) => {
                  const def = CONSOLE_MAP[game.consoleId];
                  return (
                    <article
                      key={game.id}
                      className="store-card"
                      onClick={() => setDetailGame(game)}
                    >
                      <div className="store-art-wrap landscape">
                        <img className="store-art-img" src={game.coverUrl} alt={game.title} loading="lazy" />
                        <div className="store-art-overlay" />
                        <div className="store-badges-top">
                          <span
                            className="badge"
                            style={{ background: def.accent, color: '#07080d', borderColor: 'transparent' }}
                          >
                            {def.shortName}
                          </span>
                          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.9)', color: '#042f2e' }}>
                            1-Clique Grátis
                          </span>
                        </div>
                      </div>
                      <div className="store-card-body">
                        <h3 className="store-card-title">{game.title}</h3>
                        <div className="store-card-meta">
                          {game.genre} • {game.sizeEstimate}
                        </div>
                        <div className="store-card-foot">
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ width: '100%' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              launchStoreUrl(game, game.freeRomUrl!, game.freeRomFilename);
                            }}
                          >
                            ▶ Baixar &amp; Jogar ({def.libretroCore || def.emulatorJsSystem})
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {/* Seção 3: Loja Completa */}
          <div className="section-head">
            <h2>
              🎮 Catálogo da Loja ({filteredStoreGames.length}{' '}
              {selectedConsole === 'all' ? 'Clássicos Reais' : CONSOLE_MAP[selectedConsole].name})
            </h2>
            <p>Clique em qualquer jogo para ver informações completas, pesquisar no acervo ou carregar sua ROM/ISO</p>
          </div>

          {filteredStoreGames.length === 0 ? (
            <div className="panel" style={{ textAlign: 'center', color: 'var(--text-2)', padding: 32 }}>
              Nenhum título encontrado para &ldquo;{storeQuery}&rdquo; neste filtro. Tente limpar a busca ou usar a pesquisa ao vivo no Internet Archive abaixo.
            </div>
          ) : (
            <div className="store-grid">
              {filteredStoreGames.map((game) => {
                const def = CONSOLE_MAP[game.consoleId];
                const hasCustomSource = Boolean(getUserSourceForGame(game.id));
                return (
                  <article
                    key={game.id}
                    className="store-card"
                    onClick={() => setDetailGame(game)}
                  >
                    <div className="store-art-wrap">
                      <img className="store-art-img" src={game.coverUrl} alt={game.title} loading="lazy" />
                      <div className="store-art-overlay" />
                      <div className="store-badges-top">
                        <span
                          className="badge"
                          style={{ background: def.accent, color: '#07080d', borderColor: 'transparent' }}
                        >
                          {def.shortName}
                        </span>
                        <span className="rating-pill">★ {game.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="store-card-body">
                      <h3 className="store-card-title">{game.title}</h3>
                      <div className="store-card-meta">
                        {game.developer} • {game.year}
                      </div>
                      <div className="store-card-foot">
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{game.sizeEstimate}</span>
                        <span className="badge" style={{ color: hasCustomSource ? '#34d399' : '#f8fafc' }}>
                          {hasCustomSource ? '▶ Jogar' : 'Detalhes'}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Seção 4: Carregar Local / Fontes JSON / Busca Geral no Internet Archive */}
          <div className="split-grid">
            <section className="panel">
              <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{t.byodTitle}</h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.45 }}>
                {t.byodSub}
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <label className="btn btn-cyan" style={{ flex: 1, padding: '12px', cursor: 'pointer' }}>
                  📂 {t.dropRomLabel}
                  <input
                    type="file"
                    accept=".a26,.nes,.sfc,.smc,.md,.gen,.gb,.gbc,.gba,.z64,.n64,.v64,.cue,.chd,.cso,.zso,.iso,.bin,.pbp,.elf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleLocalFilePick(file);
                    }}
                  />
                </label>

                <label className="btn btn-ghost" style={{ padding: '12px', cursor: 'pointer' }}>
                  📋 Importar Fontes (.json)
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImportSourcesJson(file);
                    }}
                  />
                </label>
              </div>

              {sourceImportStatus && (
                <div style={{ fontSize: 12, color: '#34d399', marginBottom: 10 }}>{sourceImportStatus}</div>
              )}

              <div className="input-row">
                <select
                  className="lang-select"
                  value={remoteConsole}
                  onChange={(e) => setRemoteConsole(e.target.value as ConsoleId)}
                >
                  {CONSOLES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName}
                    </option>
                  ))}
                </select>
                <input
                  className="field"
                  placeholder={t.streamUrlPlaceholder}
                  value={remoteUrlInput}
                  onChange={(e) => setRemoteUrlInput(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleMountRemoteUrl}>
                  {t.mountStreamBtn}
                </button>
              </div>
            </section>

            <section className="panel">
              <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{t.archiveTitle}</h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.45 }}>
                Busca via proxy CORS-Free local — identifica automaticamente arquivos diretos jogáveis vs compactados (.zip/.7z) ou bloqueados.
              </p>

              <form className="input-row" onSubmit={(e) => void handleArchiveSearch(e)}>
                <input
                  className="field"
                  placeholder="Ex.: homebrew nes, snes, gba, dragon ball, atari..."
                  value={archiveQuery}
                  onChange={(e) => setArchiveQuery(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={searching}>
                  {searching ? 'Buscando...' : t.searchBtn}
                </button>
              </form>

              {searchError && (
                <div style={{ marginTop: 10, color: '#fbbf24', fontSize: 12 }}>{searchError}</div>
              )}

              {searchResults.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                  {searchResults.map((item) => {
                    const inspected = expandedFiles[item.identifier];
                    return (
                      <div
                        key={item.identifier}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'var(--bg-0)',
                          border: '1px solid var(--border)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div>
                            <strong>{item.title}</strong>
                            <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                              {item.collection} {item.year ? `• ${item.year}` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-sm btn-cyan"
                              onClick={() => void inspectArchiveItem(item)}
                            >
                              Ver Arquivos
                            </button>
                            <a
                              className="btn btn-sm btn-ghost"
                              href={item.detailsUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              ↗
                            </a>
                          </div>
                        </div>

                        {inspected && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {inspected.files.length === 0 ? (
                              <span style={{ color: 'var(--text-2)' }}>Nenhuma ROM/ISO encontrada neste item.</span>
                            ) : (
                              inspected.files.slice(0, 5).map((f) => (
                                <div
                                  key={f.name}
                                  style={{
                                    padding: '6px 8px',
                                    borderRadius: 8,
                                    background: 'var(--bg-1)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 8,
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <div>
                                    <span className="mono" style={{ fontSize: 11 }}>
                                      {f.name} ({fmtSize(f.size)})
                                    </span>
                                    {f.warning && (
                                      <div style={{ fontSize: 11, color: '#fbbf24' }}>⚠ {f.warning}</div>
                                    )}
                                  </div>
                                  {f.playableDirectly ? (
                                    <button
                                      className="btn btn-sm btn-primary"
                                      onClick={() => {
                                        const cid = detectConsoleFromFilename(
                                          f.name,
                                          selectedConsole === 'all' ? item.consoleHint : selectedConsole,
                                        );
                                        setActiveSession({
                                          id: `ia-${item.identifier}`,
                                          title: `${item.title} (${f.name})`,
                                          consoleId: cid,
                                          mode: resolveMode(cid),
                                          remoteUrl: f.proxyUrl,
                                          romFilename: f.name,
                                        });
                                      }}
                                    >
                                      ▶ Rodar Agora
                                    </button>
                                  ) : !f.isPrivate ? (
                                    <a
                                      className="btn btn-sm btn-ghost"
                                      href={f.url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      ⬇ Baixar
                                    </a>
                                  ) : (
                                    <span className="badge" style={{ color: '#fb7185' }}>
                                      🔒 Privado
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <footer className="vgfa-footer">
            <span>{t.footerCredit}</span>
            <span>Atari 2600 • NES • Mega Drive • SNES • GBA • N64 • PS1 • PSP • PS2</span>
          </footer>
        </main>
      )}

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
    </>
  );
};
