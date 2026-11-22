import React, { useEffect, useState } from 'react';
import { CONTROLLER_PROFILES } from '@vgfa/pad';
import {
  CONSOLE_MAP,
  getUserSourceForGame,
  listArchiveFiles,
  removeUserSourceForGame,
  searchInternetArchive,
  setUserSourceForGame,
  type ArchivePlayableFile,
  type ArchiveSearchResult,
  type StoreGame,
} from '@vgfa/runtime';
import type { SupportedLang } from '@vgfa/storage';

interface Props {
  game: StoreGame;
  lang: SupportedLang;
  onClose: () => void;
  onLaunchLocal: (game: StoreGame, file: File) => void;
  onLaunchUrl: (game: StoreGame, url: string, filename?: string) => void;
  onOpenPs2Runtime: (game: StoreGame) => void;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const GameDetailModal: React.FC<Props> = ({
  game,
  lang,
  onClose,
  onLaunchLocal,
  onLaunchUrl,
  onOpenPs2Runtime,
}) => {
  const consoleDef = CONSOLE_MAP[game.consoleId];
  const padProfile = CONTROLLER_PROFILES[game.consoleId];
  const synopsis =
    lang === 'en' ? game.synopsisEn : lang === 'es' ? game.synopsisEs : game.synopsisPt;

  const [tab, setTab] = useState<'play' | 'archive' | 'source'>('play');
  const [savedSource, setSavedSource] = useState(() => getUserSourceForGame(game.id));
  const [customUrl, setCustomUrl] = useState(savedSource?.url ?? '');

  // Busca ao vivo no Internet Archive para este título
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveItems, setArchiveItems] = useState<ArchiveSearchResult[]>([]);
  const [filesMap, setFilesMap] = useState<Record<string, { restricted: boolean; files: ArchivePlayableFile[] }>>({});
  const [loadingFilesId, setLoadingFilesId] = useState<string | null>(null);

  const runArchiveSearch = async () => {
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const results = await searchInternetArchive(game.searchHint, game.consoleId, 8);
      setArchiveItems(results);
      if (results.length === 0) {
        setArchiveError('Nenhum item encontrado no Internet Archive com esse nome.');
      }
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Erro ao consultar o Internet Archive.');
    } finally {
      setArchiveLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'archive' && archiveItems.length === 0 && !archiveLoading && !archiveError) {
      void runArchiveSearch();
    }
  }, [tab]);

  const inspectItemFiles = async (id: string) => {
    setLoadingFilesId(id);
    try {
      const data = await listArchiveFiles(id);
      setFilesMap((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Falha ao listar arquivos.');
    } finally {
      setLoadingFilesId(null);
    }
  };

  const handleSaveCustomUrl = () => {
    if (!customUrl.trim()) return;
    const saved = setUserSourceForGame(game.id, customUrl.trim());
    setSavedSource(saved);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              className="badge"
              style={{ background: consoleDef.accent, color: '#07080d', borderColor: 'transparent' }}
            >
              {consoleDef.name}
            </span>
            <span className="rating-pill">★ {game.rating.toFixed(1)}</span>
            {game.serial && <span className="badge mono">{game.serial}</span>}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="detail-hero">
          <img
            className="detail-cover"
            src={game.coverUrl}
            alt={game.title}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>{game.title}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {game.developer} • {game.year} • {game.genre} • {game.players} • {game.sizeEstimate}
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-1)', lineHeight: 1.55 }}>
              {synopsis}
            </p>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--bg-0)',
                border: '1px solid var(--border)',
                fontSize: 12,
                color: 'var(--text-1)',
              }}
            >
              <strong>Controle no Celular / Bluetooth:</strong> {padProfile.title}
              {padProfile.hasPressureButtons ? ' (Analógicos L/R + Pressão L2/R2 + Vibração)' : ''}
              <br />
              <strong>Motor VGFA:</strong> {consoleDef.engineTier}
              {consoleDef.libretroCore ? ` (${consoleDef.libretroCore})` : consoleDef.emulatorJsSystem ? ` (${consoleDef.emulatorJsSystem})` : ' (WebGPU + VGFA-Disc)'}
            </div>

            {game.availability === 'free-playable' && game.freeRomUrl && (
              <button
                className="btn btn-primary"
                style={{ padding: '12px 18px', fontSize: 14 }}
                onClick={() => onLaunchUrl(game, game.freeRomUrl!, game.freeRomFilename)}
              >
                ▶ Baixar ROM &amp; Jogar Agora no Navegador (1 Clique)
              </button>
            )}

            {savedSource && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => onLaunchUrl(game, savedSource.url, savedSource.filename)}
                >
                  ▶ Jogar pela Minha Fonte Vinculada
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    removeUserSourceForGame(game.id);
                    setSavedSource(null);
                    setCustomUrl('');
                  }}
                >
                  Remover Link
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Abas de Execução / Fonte */}
        <div className="tab-strip">
          <button
            className={`btn btn-sm ${tab === 'play' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('play')}
          >
            📂 Carregar ROM / ISO Local
          </button>
          <button
            className={`btn btn-sm ${tab === 'archive' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('archive')}
          >
            🔍 Buscar no Internet Archive
          </button>
          <button
            className={`btn btn-sm ${tab === 'source' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('source')}
          >
            🌐 Vincular URL / Fonte Pessoal
          </button>
        </div>

        {tab === 'play' && (
          <div className="panel" style={{ background: 'var(--bg-0)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
              Já tem o arquivo de <strong>{game.title}</strong> ({consoleDef.extensions.join(', ')}) no computador ou celular? Selecione abaixo para rodar imediatamente no navegador (zero upload, leitura local em chunks via <code>@vgfa/disc</code>).
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label className="btn btn-cyan" style={{ cursor: 'pointer' }}>
                📂 Escolher Arquivo ({consoleDef.extensions.join(', ')})
                <input
                  type="file"
                  accept={consoleDef.extensions.join(',')}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onLaunchLocal(game, file);
                  }}
                />
              </label>

              {game.consoleId === 'ps2' && (
                <button className="btn btn-primary" onClick={() => onOpenPs2Runtime(game)}>
                  ⚡ Abrir Motor PS2 WebGPU / Play!.js
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'archive' && (
          <div className="panel" style={{ background: 'var(--bg-0)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                Busca CORS-Free via servidor VGFA para: <strong>{game.searchHint}</strong>
              </span>
              <button className="btn btn-sm btn-ghost" disabled={archiveLoading} onClick={() => void runArchiveSearch()}>
                {archiveLoading ? 'Buscando...' : '↻ Atualizar'}
              </button>
            </div>

            {archiveError && (
              <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 10 }}>{archiveError}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {archiveItems.map((item) => {
                const inspected = filesMap[item.identifier];
                return (
                  <div
                    key={item.identifier}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-1)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div>
                        <strong>{item.title}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                          {item.collection} {item.year ? `• ${item.year}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm btn-cyan"
                          disabled={loadingFilesId === item.identifier}
                          onClick={() => void inspectItemFiles(item.identifier)}
                        >
                          {loadingFilesId === item.identifier ? 'Lendo...' : 'Ver Arquivos'}
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
                          <span style={{ color: 'var(--text-2)' }}>
                            Nenhum arquivo de ROM/ISO compatível listado neste item.
                          </span>
                        ) : (
                          inspected.files.slice(0, 6).map((f) => (
                            <div
                              key={f.name}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: 'var(--bg-0)',
                                border: '1px solid var(--border)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 160 }}>
                                <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
                                  {f.name} ({fmtBytes(f.size)})
                                </div>
                                {f.warning && (
                                  <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 2 }}>
                                    ⚠ {f.warning}
                                  </div>
                                )}
                              </div>

                              {f.playableDirectly ? (
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => onLaunchUrl(game, f.proxyUrl, f.name)}
                                >
                                  ▶ Rodar via Stream
                                </button>
                              ) : !f.isPrivate ? (
                                <a
                                  className="btn btn-sm btn-ghost"
                                  href={f.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  ⬇ Baixar Arquivo
                                </a>
                              ) : (
                                <span className="badge" style={{ color: '#fb7185' }}>
                                  🔒 Bloqueado
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
          </div>
        )}

        {tab === 'source' && (
          <div className="panel" style={{ background: 'var(--bg-0)' }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
              Vincule um link direto (HTTP Range / WebSeed / servidor pessoal) para <strong>{game.title}</strong>. O VGFA faz streaming sob demanda pelo proxy CORS-free e lembra sua fonte no navegador.
            </p>
            <div className="input-row">
              <input
                className="field"
                placeholder={`https://seu-servidor/${game.serial || game.id}${consoleDef.extensions[0] || '.iso'}`}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button className="btn btn-cyan" onClick={handleSaveCustomUrl} disabled={!customUrl.trim()}>
                Salvar Fonte
              </button>
              <button
                className="btn btn-primary"
                disabled={!customUrl.trim()}
                onClick={() => {
                  handleSaveCustomUrl();
                  onLaunchUrl(game, customUrl.trim());
                }}
              >
                ▶ Salvar e Jogar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
