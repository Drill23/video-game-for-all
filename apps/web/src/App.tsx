import React, { useEffect, useMemo, useState } from 'react';
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
import { AuthModal } from './components/AuthModal.js';
import { GameDetailModal } from './components/GameDetailModal.js';
import { NexusOptimizerModal, loadNexusProfile, type NexusProfile } from './components/NexusOptimizerModal.js';
import { SaveManagerModal } from './components/SaveManagerModal.js';
import { ShareLinkModal } from './components/ShareLinkModal.js';
import { ControllerPage } from './pages/ControllerPage.js';
import { PlayerView, type ActiveSession, type PlayerMode } from './pages/PlayerView.js';
import { WatchPage } from './pages/WatchPage.js';

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

export const App: React.FC = () => {
  const subRoute = resolveSubRoute();
  if (subRoute.kind === 'pad') {
    return <ControllerPage initialRoomCode={subRoute.code} />;
  }
  if (subRoute.kind === 'watch') {
    return <WatchPage initialCastCode={subRoute.code} />;
  }

  const auth = useMemo(() => new VgfaAuthStore(), []);
  const saveStore = useMemo(() => new VgfaSaveStore(), []);

  const [lang, setLang] = useState<SupportedLang>(() => auth.getLanguage());
  const [user, setUser] = useState<UserProfile | null>(() => auth.getCurrentUser());
  const [selectedConsole, setSelectedConsole] = useState<ConsoleId | 'all'>('all');
  const [storeQuery, setStoreQuery] = useState('');
  const [viewTab, setViewTab] = useState<'playable' | 'library'>('playable');
  const [detailGame, setDetailGame] = useState<StoreGame | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [nexusProfile, setNexusProfile] = useState<NexusProfile | null>(() => loadNexusProfile());

  useEffect(() => {
    void detectVgfaBackend();
  }, []);

  // Busca inteligente livre na web (somente fontes abertas verificadas HTTP 200!)
  const [webFinding, setWebFinding] = useState(false);
  const [webOptions, setWebOptions] = useState<SmartFindOption[]>([]);
  const [webNote, setWebNote] = useState<string | null>(null);

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
  const filteredLibrary = STORE_CATALOG.filter(matchesFilter);

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
            <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
              📂 Abrir Meu Jogo
              <input
                type="file"
                accept=".a26,.nes,.sfc,.smc,.md,.gen,.gb,.gbc,.gba,.z64,.n64,.v64,.cue,.chd,.cso,.zso,.iso,.bin,.pbp,.elf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLocalFilePick(f);
                }}
              />
            </label>
            <button
              className={`btn btn-sm ${nexusProfile ? 'btn-ghost' : 'btn-primary'}`}
              style={nexusProfile ? { borderColor: 'var(--emerald)', color: '#6ee7b7' } : undefined}
              onClick={() => setShowOptimizer(true)}
            >
              {nexusProfile ? '⚡ Nexus Ativo' : '⚡ Otimizar'}
            </button>
            <button className="btn btn-sm btn-cyan" onClick={() => setShowShare(true)}>
              🌐 Link Público
            </button>
            <a className="btn btn-sm btn-ghost" href={`${import.meta.env.BASE_URL}#/pad`} target="_blank" rel="noreferrer">
              📱 {t.phonePadMode}
            </a>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSaves(true)}>
              💾 Saves
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
                <span className="badge" style={{ borderColor: user.avatarColor }}>
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
              <button className="btn btn-sm btn-ghost" onClick={() => setShowAuth(true)}>
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
          {/* Banner inteligente: pergunta para ativar os Otimizadores Leves do navegador (1 única vez!) */}
          {!nexusProfile && (
            <div
              className="panel"
              style={{
                marginTop: 14,
                padding: '12px 16px',
                background: 'linear-gradient(135deg, rgba(255, 181, 71, 0.12), rgba(56, 189, 248, 0.1))',
                borderColor: 'rgba(255, 181, 71, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                <strong style={{ color: 'var(--amber)' }}>⚡ Destrave o Modo Ultra no Navegador (Recomendado):</strong>{' '}
                instale os otimizadores leves em cache local + Disco Virtual SSD OPFS para cortar travamentos e usar 75% menos RAM em jogos de PS2!
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowOptimizer(true)}>
                ⚡ Sim, Otimizar Agora (1 clique)
              </button>
            </div>
          )}

          {/* Hero Simples e Direto */}
          <section className="hero" style={{ gridTemplateColumns: '1fr', gap: 18 }}>
            <div style={{ maxWidth: 820 }}>
              <div className="hero-kicker">🎮 Atari 2600 ao PlayStation 2 • Celular = Controle via QR Code</div>
              <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)' }}>
                Escolha o jogo, escaneie o QR Code no celular e comece a jogar.
              </h1>

              {/* Barra de Busca Universal */}
              <form
                className="input-row"
                style={{ marginTop: 14, marginBottom: 14 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSmartWebSearch();
                }}
              >
                <input
                  className="field"
                  style={{ fontSize: 15, padding: '13px 16px' }}
                  placeholder="Qual jogo você quer jogar? Ex.: Super Boss, Dragon Ball, GTA, Mario, Sonic..."
                  value={storeQuery}
                  onChange={(e) => {
                    setStoreQuery(e.target.value);
                    if (e.target.value.trim()) setViewTab('library');
                  }}
                />
                <button className="btn btn-primary" type="submit" disabled={webFinding || !storeQuery.trim()}>
                  {webFinding ? 'Buscando...' : '🔍 Buscar na Internet'}
                </button>
                {storeQuery && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setStoreQuery('');
                      setWebOptions([]);
                      setWebNote(null);
                    }}
                  >
                    Limpar
                  </button>
                )}
              </form>

              {/* Resultados Abertos Verificados da Busca Livre */}
              {(webOptions.length > 0 || webNote) && (
                <div className="panel" style={{ background: 'var(--bg-0)', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    Resultados Abertos Verificados para &ldquo;{storeQuery}&rdquo;
                  </div>
                  {webOptions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {webOptions.slice(0, 4).map((opt) => (
                        <div
                          key={`${opt.identifier}-${opt.filename}`}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'var(--bg-1)',
                            border: opt.bestChoice ? '1px solid var(--amber)' : '1px solid var(--border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>
                              {opt.bestChoice ? '⭐ Melhor Opção • ' : ''}
                              {opt.filename}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                              {opt.itemTitle} • {fmtSize(opt.size)}
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
                            ▶ Jogar Agora
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{webNote}</div>
                  )}
                </div>
              )}

              {/* Abas Principais Ultra-Claras */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className={`btn ${viewTab === 'playable' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setViewTab('playable')}
                >
                  ⚡ Prontos para Jogar Agora ({FREE_PLAYABLE_ROMS.length} Jogos 1-Clique)
                </button>
                <button
                  className={`btn ${viewTab === 'library' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setViewTab('library')}
                >
                  🏆 Clássicos &amp; Minha Biblioteca ({STORE_CATALOG.length} Títulos)
                </button>
                <button
                  className="btn btn-cyan"
                  onClick={() =>
                    launchStoreUrl(
                      FREE_PLAYABLE_ROMS[0],
                      FREE_PLAYABLE_ROMS[0].freeRomUrl!,
                      FREE_PLAYABLE_ROMS[0].freeRomFilename,
                    )
                  }
                >
                  ▶ Testar SNES 60 FPS Agora
                </button>
              </div>
            </div>
          </section>

          {/* Filtro por Console */}
          <div className="console-strip">
            <button
              className={`console-chip ${selectedConsole === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedConsole('all')}
            >
              Todos ({ALL_STORE_GAMES.length})
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

          {/* ABA 1: 100% JOGÁVEIS AGORA EM 1 CLIQUE (SEM CADEADO!) */}
          {(viewTab === 'playable' || normalizedQuery) && filteredPlayable.length > 0 && (
            <>
              <div className="section-head">
                <h2>⚡ Prontos para Jogar Agora (1 Clique • Sem Cadeado • 60 FPS)</h2>
                <p>Jogos reais completos de SNES, NES, GBA, Mega Drive e Atari — clique, conecte seu celular/Bluetooth e jogue!</p>
              </div>
              <div className="store-grid">
                {filteredPlayable.map((game) => {
                  const def = CONSOLE_MAP[game.consoleId];
                  return (
                    <article
                      key={game.id}
                      className="store-card"
                      onClick={() => launchStoreUrl(game, game.freeRomUrl!, game.freeRomFilename)}
                    >
                      <div className="store-art-wrap landscape">
                        <img
                          className="store-art-img"
                          src={game.coverUrl}
                          alt={game.title}
                          crossOrigin="anonymous"
                          loading="lazy"
                        />
                        <div className="store-art-overlay" />
                        <div className="store-badges-top">
                          <span
                            className="badge"
                            style={{ background: def.accent, color: '#07080d', borderColor: 'transparent' }}
                          >
                            {def.shortName}
                          </span>
                          <span className="badge" style={{ background: '#10b981', color: '#042f2e', borderColor: 'transparent' }}>
                            ✓ Pronto
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
                            ▶ Jogar Agora
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {/* ABA 2: CLÁSSICOS & MINHA BIBLIOTECA (TOP PS2 → ATARI) */}
          {(viewTab === 'library' || normalizedQuery) && (
            <>
              <div className="section-head">
                <h2>🏆 Top Clássicos &amp; Minha Biblioteca ({filteredLibrary.length} Títulos)</h2>
                <p>Clique em qualquer clássico para usar sua ROM/ISO local, vincular sua fonte ou buscar cópias abertas verificadas</p>
              </div>
              <div className="store-grid">
                {filteredLibrary.map((game) => {
                  const def = CONSOLE_MAP[game.consoleId];
                  const hasCustomSource = Boolean(getUserSourceForGame(game.id));
                  return (
                    <article
                      key={game.id}
                      className="store-card"
                      onClick={() => setDetailGame(game)}
                    >
                      <div className="store-art-wrap">
                        <img
                          className="store-art-img"
                          src={game.coverUrl}
                          alt={game.title}
                          crossOrigin="anonymous"
                          loading="lazy"
                        />
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
                          <span className="badge" style={{ color: hasCustomSource ? '#34d399' : '#bae6fd' }}>
                            {hasCustomSource ? '▶ Jogar' : 'Abrir'}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

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

      {showShare && <ShareLinkModal onClose={() => setShowShare(false)} />}

      {showOptimizer && (
        <NexusOptimizerModal
          onClose={() => setShowOptimizer(false)}
          onActivated={(p) => setNexusProfile(p)}
        />
      )}
    </>
  );
};
