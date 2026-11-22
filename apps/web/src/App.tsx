import React, { useMemo, useState } from 'react';
import type { ConsoleId } from '@vgfa/pad';
import {
  BUILTIN_CATALOG,
  CONSOLES,
  detectConsoleFromFilename,
  listArchiveFiles,
  searchInternetArchive,
  type ArchivePlayableFile,
  type ArchiveSearchResult,
  type CatalogGame,
} from '@vgfa/runtime';
import {
  VgfaAuthStore,
  VgfaSaveStore,
  type SupportedLang,
  type UserProfile,
} from '@vgfa/storage';
import { TRANSLATIONS } from './i18n/translations.js';
import { AuthModal } from './components/AuthModal.js';
import { SaveManagerModal } from './components/SaveManagerModal.js';
import { ControllerPage } from './pages/ControllerPage.js';
import { PlayerView, type ActiveSession } from './pages/PlayerView.js';

export const App: React.FC = () => {
  // Roteamento direto para a página do Celular como Controle (/pad ou /pad/VGFA-XXXX)
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
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSaves, setShowSaves] = useState(false);

  // BYOD / Streaming remoto
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [remoteConsole, setRemoteConsole] = useState<ConsoleId>('ps2');

  // Pesquisa ao vivo no Internet Archive
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ArchiveSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, ArchivePlayableFile[]>>({});

  const t = TRANSLATIONS[lang];
  const effectiveUserId = user?.id ?? 'guest';

  const handleLangChange = (next: SupportedLang) => {
    setLang(next);
    auth.setLanguage(next);
  };

  const launchGame = (game: CatalogGame, localFile?: File | null, remoteUrl?: string | null) => {
    auth.recordPlay(game.id, game.title, game.consoleId);
    setActiveSession({ game, localFile, remoteUrl });
  };

  const handleLocalFilePick = (file: File) => {
    const detected = detectConsoleFromFilename(
      file.name,
      selectedConsole === 'all' ? 'ps2' : selectedConsole,
    );
    const isDiscHeavy = detected === 'ps2' || detected === 'psp';
    const customGame: CatalogGame = {
      id: `local-${file.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
      title: file.name,
      consoleId: detected,
      year: new Date().getFullYear(),
      genre: isDiscHeavy ? 'ISO Streaming (VGFA-Disc)' : 'ROM Local (RetroArch WASM)',
      players: '1P–4P',
      mode: isDiscHeavy ? 'ps2-webgpu-lab' : 'libretro-rom',
      taglinePt: 'Arquivo local carregado direto no navegador (zero upload).',
      taglineEn: 'Local file mounted directly in browser (zero upload).',
      taglineEs: 'Archivo local cargado directamente en el navegador.',
      gradient: ['#38BDF8', '#1E3A8A'],
      badge: 'Local',
      sizeLabel: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    };
    launchGame(customGame, file, null);
  };

  const handleMountRemoteUrl = () => {
    const url = remoteUrlInput.trim();
    if (!url) return;
    const isHeavy = remoteConsole === 'ps2' || remoteConsole === 'psp';
    const customGame: CatalogGame = {
      id: `stream-${Date.now()}`,
      title: url.split('/').pop() || 'Remote Stream',
      consoleId: remoteConsole,
      year: 2026,
      genre: 'HTTP Range / WebSeed Stream',
      players: '1P–4P',
      mode: isHeavy ? 'ps2-webgpu-lab' : 'libretro-rom',
      taglinePt: 'Streaming sob demanda via VGFA-Disc.',
      taglineEn: 'On-demand streaming via VGFA-Disc.',
      taglineEs: 'Streaming bajo demanda vía VGFA-Disc.',
      gradient: ['#0EA5E9', '#1E1B4B'],
      badge: 'Streaming',
      sizeLabel: 'Range 206',
      romUrl: url,
    };
    launchGame(customGame, null, url);
  };

  const handleArchiveSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchInternetArchive(
        searchQuery,
        selectedConsole === 'all' ? undefined : selectedConsole,
        9,
      );
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro ao pesquisar no Internet Archive.');
    } finally {
      setSearching(false);
    }
  };

  const inspectArchiveItem = async (item: ArchiveSearchResult) => {
    const files = await listArchiveFiles(item.identifier);
    setExpandedFiles((prev) => ({ ...prev, [item.identifier]: files }));
  };

  const filteredCatalog =
    selectedConsole === 'all'
      ? BUILTIN_CATALOG
      : BUILTIN_CATALOG.filter((g) => g.consoleId === selectedConsole);

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
          {/* Hero */}
          <section className="hero">
            <div>
              <div className="hero-kicker">{t.heroKicker}</div>
              <h1>{t.heroTitle}</h1>
              <p>{t.heroDesc}</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => launchGame(BUILTIN_CATALOG[5])}
                >
                  ▶ {t.playNow} (DualShock 2 Arena)
                </button>
                <button
                  className="btn btn-cyan"
                  onClick={() => launchGame(BUILTIN_CATALOG[6])}
                >
                  ⚡ {t.openPs2Lab}
                </button>
              </div>
            </div>

            <div className="hero-pills">
              <div className="stat-card">
                <strong>Atari 2600 → PS2</strong>
                <span>9 plataformas unificadas num único player WebAssembly + WebGPU</span>
              </div>
              <div className="stat-card">
                <strong>Celular = Controle</strong>
                <span>QR Code via WebRTC/WS com 16 bytes por pacote e skins adaptativas</span>
              </div>
              <div className="stat-card">
                <strong>VGFA-Disc Streaming</strong>
                <span>Chunks de 256 KiB via HTTP Range / P2P WebTorrent + Cache OPFS Sharded</span>
              </div>
              <div className="stat-card">
                <strong>Bluetooth + Saves</strong>
                <span>Gamepad API nativo + IndexedDB para Save States e Memory Cards .ps2</span>
              </div>
            </div>
          </section>

          {/* Barra de Consoles */}
          <div className="console-strip">
            <button
              className={`console-chip ${selectedConsole === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedConsole('all')}
            >
              {t.allConsoles}
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

          {/* Catálogo Embutido */}
          <div className="section-head">
            <h2>{t.builtinTitle}</h2>
            <p>{t.builtinSub}</p>
          </div>

          <div className="game-grid">
            {filteredCatalog.map((game) => {
              const tagline =
                lang === 'en' ? game.taglineEn : lang === 'es' ? game.taglineEs : game.taglinePt;
              return (
                <article key={game.id} className="game-card">
                  <div
                    className="game-cover"
                    style={{
                      background: `linear-gradient(135deg, ${game.gradient[0]}, ${game.gradient[1]})`,
                    }}
                  >
                    <div className="game-cover-top">
                      <span className="badge">{game.consoleId.toUpperCase()}</span>
                      <span className="badge">{game.sizeLabel}</span>
                    </div>
                    <span className="badge" style={{ alignSelf: 'flex-start' }}>
                      {game.badge}
                    </span>
                  </div>
                  <div className="game-body">
                    <h3 className="game-title">{game.title}</h3>
                    <div className="game-meta">
                      {game.genre} • {game.year} • {game.players}
                    </div>
                    <p className="game-desc">{tagline}</p>
                    <div className="game-actions">
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => launchGame(game)}
                      >
                        ▶ {t.playGame}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* BYOD Local + Streaming + Pesquisa Internet Archive */}
          <div className="split-grid">
            <section className="panel">
              <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{t.byodTitle}</h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.45 }}>
                {t.byodSub}
              </p>

              <label
                className="btn btn-cyan"
                style={{ width: '100%', padding: '14px', marginBottom: 14, cursor: 'pointer' }}
              >
                📂 {t.dropRomLabel}
                <input
                  type="file"
                  accept=".a26,.nes,.sfc,.smc,.md,.gen,.gb,.gbc,.gba,.z64,.n64,.v64,.cue,.chd,.cso,.zso,.iso,.bin"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLocalFilePick(file);
                  }}
                />
              </label>

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
                {t.archiveSub}
              </p>

              <form className="input-row" onSubmit={(e) => void handleArchiveSearch(e)}>
                <input
                  className="field"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={searching}>
                  {searching ? '...' : t.searchBtn}
                </button>
              </form>

              {searchError && (
                <div style={{ marginTop: 10, color: '#fb7185', fontSize: 12 }}>{searchError}</div>
              )}

              {searchResults.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {searchResults.map((item) => (
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

                      {expandedFiles[item.identifier] && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {expandedFiles[item.identifier].length === 0 ? (
                            <span style={{ color: 'var(--text-2)' }}>Nenhuma ROM direta encontrada.</span>
                          ) : (
                            expandedFiles[item.identifier].slice(0, 4).map((f) => (
                              <button
                                key={f.url}
                                className="btn btn-sm btn-primary"
                                onClick={() => {
                                  const cid = detectConsoleFromFilename(f.name, item.consoleHint);
                                  const isHeavy = cid === 'ps2' || cid === 'psp';
                                  launchGame(
                                    {
                                      id: `ia-${item.identifier}`,
                                      title: `${item.title} (${f.name})`,
                                      consoleId: cid,
                                      year: Number(item.year) || 1990,
                                      genre: 'Internet Archive',
                                      players: '1P',
                                      mode: isHeavy ? 'ps2-webgpu-lab' : 'libretro-rom',
                                      taglinePt: 'Stream direto do Internet Archive.',
                                      taglineEn: 'Streamed from Internet Archive.',
                                      taglineEs: 'Transmitido desde Internet Archive.',
                                      gradient: ['#6366F1', '#1E1B4B'],
                                      badge: 'Archive.org',
                                      sizeLabel: `${(f.size / 1024).toFixed(0)} KB`,
                                      romUrl: f.url,
                                    },
                                    null,
                                    f.url,
                                  );
                                }}
                              >
                                ▶ {f.name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
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
