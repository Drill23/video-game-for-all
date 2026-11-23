import React, { useEffect, useMemo, useState } from 'react';
import { CONTROLLER_PROFILES } from '@vgfa/pad';
import {
  CONSOLE_MAP,
  getUserSourceForGame,
  removeUserSourceForGame,
  setUserSourceForGame,
  smartFindGameOptions,
  type SmartFindOption,
  type StoreGame,
} from '@vgfa/runtime';
import type { SupportedLang } from '@vgfa/storage';
import { Cover } from './Cover.js';
import { DownloadButton } from './DownloadButton.js';
import { Icon } from './Icon.js';
import { useDialog } from './useDialog.js';
import { GameCard } from './home/GameCard.js';
import {
  ageValue,
  cleanTitle,
  consoleBadge,
  factLine,
  franchiseOf,
  highlightsOf,
  modesOf,
  playersText,
  playtimeOf,
  publisherOf,
  sizeText,
  synopsisOf,
  topRankOf,
} from './home/gameMeta.js';
import { similarGames } from './home/homeData.js';
import { HOME_STRINGS } from './home/strings.js';

interface Props {
  game: StoreGame;
  lang: SupportedLang;
  onClose: () => void;
  onLaunchLocal: (game: StoreGame, file: File) => void;
  onLaunchUrl: (game: StoreGame, url: string, filename?: string) => void;
  onOpenPs2Runtime: (game: StoreGame) => void;
  /** Abre a ficha de outro jogo ("Mais como este"). */
  onOpenGame?: (game: StoreGame) => void;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Ficha simples e direta do jogo:
 * - Para jogos livres embutidos: 1 clique já vai para Conectar Controle → Jogar!
 * - Para clássicos comerciais: busca automaticamente APENAS fontes abertas verificadas (zero bloqueados!),
 *   destaca a ⭐ Melhor Opção se existir, ou oferece 1 clique para escolher o arquivo local / link pessoal.
 */
export const GameDetailModal: React.FC<Props> = ({
  game,
  lang,
  onClose,
  onLaunchLocal,
  onLaunchUrl,
  onOpenPs2Runtime,
  onOpenGame,
}) => {
  const consoleDef = CONSOLE_MAP[game.consoleId];
  const padProfile = CONTROLLER_PROFILES[game.consoleId];
  const s = HOME_STRINGS[lang];
  const synopsis = synopsisOf(game, lang);
  const facts = factLine(game, s).filter((f) => ['rating', 'year', 'console', 'genre'].includes(f.id));
  const highlights = highlightsOf(game);
  const rank = topRankOf(game);
  const similar = useMemo(() => (onOpenGame ? similarGames(game, 12) : []), [game, onOpenGame]);
  const title = cleanTitle(game.title);

  useDialog(onClose);

  const [savedSource, setSavedSource] = useState(() => getUserSourceForGame(game.id));
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [customUrl, setCustomUrl] = useState(savedSource?.url ?? '');

  // Busca inteligente automática (apenas para títulos que ainda não têm ROM livre embutida)
  const [finding, setFinding] = useState(false);
  const [smartOptions, setSmartOptions] = useState<SmartFindOption[]>([]);
  const [smartNote, setSmartNote] = useState<string | null>(null);

  useEffect(() => {
    if (game.availability === 'free-playable' || savedSource) return;
    let active = true;
    setFinding(true);
    setSmartNote(null);
    void smartFindGameOptions(game.searchHint, game.consoleId, game.serial)
      .then((res) => {
        if (!active) return;
        setSmartOptions(res.options);
        setSmartNote(res.note ?? null);
      })
      .finally(() => {
        if (active) setFinding(false);
      });
    return () => {
      active = false;
    };
  }, [game, savedSource]);

  const handleSaveAndPlayUrl = () => {
    if (!customUrl.trim()) return;
    const saved = setUserSourceForGame(game.id, customUrl.trim());
    setSavedSource(saved);
    onLaunchUrl(game, saved.url);
  };

  // Fonte jogável conhecida (ROM livre do catálogo ou fonte salva pelo usuário) → permite baixar para a Minha Central
  const playableUrl = game.freeRomUrl ?? savedSource?.url;
  const playableFilename = game.freeRomFilename ?? savedSource?.filename;

  const factRows: Array<[string, string | undefined]> = [
    [s.factDeveloper, game.developer],
    [s.factPublisher, publisherOf(game)],
    [s.factYear, game.year ? String(game.year) : undefined],
    [s.factGenre, game.genre],
    [s.factPlayers, game.players ? playersText(game.players, s) : undefined],
    [s.factModes, modesOf(game).join(' · ') || undefined],
    [s.factTime, playtimeOf(game)],
    [s.factSize, game.sizeEstimate ? sizeText(game.sizeEstimate) : undefined],
    [s.factRating, ageValue(game, s)],
    [s.factSeries, franchiseOf(game)],
    [s.factConsole, consoleDef.name],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card detail-modal dx"
        role="dialog"
        aria-modal="true"
        aria-label={game.title}
        style={{ ['--ph' as string]: consoleDef.accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grabber" />
        <header className="dx-art">
          <div className="dx-bg" aria-hidden="true">
            <img
              src={game.coverUrl}
              alt=""
              crossOrigin="anonymous"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          <div className="dx-top">
            <span className="chip" style={{ background: 'var(--glass-bg-strong)' }}>
              <i className="dot" style={{ background: consoleDef.accent }} />
              {consoleDef.name}
              {rank && (game.consoleId === 'ps1' || game.consoleId === 'ps2') && rank <= 10 ? ` · Top ${rank}` : ''}
            </span>
            <button className="icon-btn modal-close" onClick={onClose} aria-label={s.close}>
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="dx-hero">
            <div className="dx-cover">
              <Cover src={game.coverUrl} title={title} accent={consoleDef.accent} eager />
            </div>
            <div className="dx-title-wrap">
              <h2 className="dx-title">{title}</h2>
              <ul className="hx-facts">
                {facts.map((f) => (
                  <li key={f.id} className={f.id === 'rating' ? 'is-rating' : undefined}>
                    {f.text}
                  </li>
                ))}
                {game.serial && <li className="mono">{game.serial}</li>}
              </ul>
              {highlights.length > 0 && (
                <ul className="hx-hl" aria-label={s.highlightsTitle}>
                  {highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </header>

        <div className="dx-body">
          <div className="dm-actions">
            {/* Ação principal 1-clique se for jogo livre pronto */}
            {game.availability === 'free-playable' && game.freeRomUrl && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => onLaunchUrl(game, game.freeRomUrl!, game.freeRomFilename)}
              >
                <Icon name="play" size={18} /> Conectar Controle &amp; Jogar
              </button>
            )}

            {/* Ação principal 1-clique se o usuário já vinculou sua fonte */}
            {savedSource && (
              <>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => onLaunchUrl(game, savedSource.url, savedSource.filename)}
                >
                  <Icon name="play" size={18} /> Jogar (Minha Fonte)
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    removeUserSourceForGame(game.id);
                    setSavedSource(null);
                    setCustomUrl('');
                  }}
                >
                  Trocar Fonte
                </button>
              </>
            )}
          </div>

          <section className="dx-sec">
            <h3 className="dx-h">{s.synopsisTitle}</h3>
            <p className="dm-syn">{synopsis}</p>
            <p className="dm-pad">
              Controle adaptativo no celular: <strong>{padProfile.title}</strong>
            </p>
          </section>

          <section className="dx-sec">
            <dl className="dx-facts-grid">
              {factRows
                .filter((r): r is [string, string] => Boolean(r[1]))
                .map(([k, v]) => (
                  <div className="dx-fact" key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {playableUrl && (
            <section className="dx-sec dx-device">
              <h3 className="dx-h">
                <Icon name="disk" size={18} /> {s.thisDevice}
              </h3>
              <p className="dx-hint">{s.thisDeviceHint}</p>
              <DownloadButton
                url={playableUrl}
                filename={playableFilename}
                meta={{
                  gameId: game.id,
                  title: game.title,
                  consoleId: game.consoleId,
                  coverUrl: game.coverUrl,
                }}
              />
            </section>
          )}
        </div>

        {/* Escolha do arquivo / melhor opção para jogos de biblioteca */}
        {game.availability !== 'free-playable' && (
          <div className="dm-body">
            <div className="panel stack">
              <div style={{ fontWeight: 700, fontSize: 15 }}>Como deseja iniciar {game.title}?</div>

              {/* Opções verificadas abertas encontradas automaticamente */}
              {finding && (
                <div style={{ fontSize: 13, color: 'var(--cyan)' }}>
                  Procurando automaticamente a melhor opção aberta disponível...
                </div>
              )}

              {!finding && smartOptions.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  {smartOptions.slice(0, 3).map((opt) => (
                    <div
                      key={`${opt.identifier}-${opt.filename}`}
                      className={`list-item ${opt.bestChoice ? 'is-best' : ''}`}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="item-title">
                          {opt.bestChoice ? '★ Melhor opção • ' : ''}
                          {opt.filename}
                        </div>
                        <div className="item-sub">
                          {opt.itemTitle} • {fmtBytes(opt.size)} • Verificado e pronto para rodar
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onLaunchUrl(game, opt.proxyUrl, opt.filename)}
                      >
                        <Icon name="play" size={14} /> Jogar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!finding && smartOptions.length === 0 && smartNote && (
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45 }}>{smartNote}</div>
              )}

              <div className="hstack" style={{ gap: 10 }}>
                <label className="btn btn-primary" style={{ flex: '1 1 220px', cursor: 'pointer', whiteSpace: 'normal', textAlign: 'center', padding: '10px 18px' }}>
                  <Icon name="folder" size={18} />
                  Escolher arquivo ({consoleDef.extensions.slice(0, 3).join(', ')})
                  <input
                    type="file"
                    accept={consoleDef.extensions.join(',')}
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onLaunchLocal(game, file);
                    }}
                  />
                </label>

                {game.consoleId === 'ps2' && (
                  <button className="btn btn-cyan" onClick={() => onOpenPs2Runtime(game)}>
                    <Icon name="gamepad" size={18} /> Abrir emulador PS2
                  </button>
                )}

                <button className="btn" onClick={() => setShowLinkInput((v) => !v)}>
                  <Icon name="globe" size={18} /> Usar link próprio
                </button>
              </div>

              {showLinkInput && (
                <div className="input-row">
                  <input
                    className="field"
                    placeholder={`https://seu-servidor/${game.serial || game.id}${consoleDef.extensions[0] || '.iso'}`}
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!customUrl.trim()}
                    onClick={handleSaveAndPlayUrl}
                  >
                    Salvar &amp; Jogar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="dx-body dx-after">
          <section className="dx-sec">
            <h3 className="dx-h">
              <Icon name="gamepad" size={18} /> {s.howToPlay}
            </h3>
            <ul className="dx-how">
              <li>
                <Icon name="phone" size={20} />
                <div>
                  <strong>{s.how1t}</strong>
                  <span>{s.how1}</span>
                </div>
              </li>
              <li>
                <Icon name="gamepad" size={20} />
                <div>
                  <strong>{s.how2t}</strong>
                  <span>{s.how2}</span>
                </div>
              </li>
              <li>
                <Icon name="keyboard" size={20} />
                <div>
                  <strong>{s.how3t}</strong>
                  <span>{s.how3}</span>
                </div>
              </li>
            </ul>
          </section>

          {similar.length > 0 && (
            <section className="dx-sec">
              <h3 className="dx-h">{s.moreLike}</h3>
              <div className="dx-more">
                {similar.map((g) => {
                  const def = CONSOLE_MAP[g.consoleId];
                  return (
                    <GameCard
                      key={g.id}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      accent={def.accent}
                      consoleLabel={consoleBadge(g)}
                      rating={g.rating}
                      year={g.year}
                      onOpen={() => onOpenGame?.(g)}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
