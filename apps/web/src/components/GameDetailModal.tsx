import React, { useEffect, useState } from 'react';
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

interface Props {
  game: StoreGame;
  lang: SupportedLang;
  onClose: () => void;
  onLaunchLocal: (game: StoreGame, file: File) => void;
  onLaunchUrl: (game: StoreGame, url: string, filename?: string) => void;
  onOpenPs2Runtime: (game: StoreGame) => void;
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
}) => {
  const consoleDef = CONSOLE_MAP[game.consoleId];
  const padProfile = CONTROLLER_PROFILES[game.consoleId];
  const synopsis =
    lang === 'en' ? game.synopsisEn : lang === 'es' ? game.synopsisEs : game.synopsisPt;

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
            crossOrigin="anonymous"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>{game.title}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {game.developer} • {game.year} • {game.genre} • {game.players}
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-1)', lineHeight: 1.55 }}>
              {synopsis}
            </p>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              🎮 Controle adaptativo no celular: <strong style={{ color: 'var(--text-0)' }}>{padProfile.title}</strong>
            </div>

            {/* Ação Principal 1-Clique se for jogo livre pronto */}
            {game.availability === 'free-playable' && game.freeRomUrl && (
              <button
                className="btn btn-primary"
                style={{ padding: '13px 18px', fontSize: 15, marginTop: 4 }}
                onClick={() => onLaunchUrl(game, game.freeRomUrl!, game.freeRomFilename)}
              >
                ▶ Conectar Controle &amp; Jogar Agora
              </button>
            )}

            {/* Ação Principal 1-Clique se o usuário já vinculou sua fonte */}
            {savedSource && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '12px 16px', fontSize: 14 }}
                  onClick={() => onLaunchUrl(game, savedSource.url, savedSource.filename)}
                >
                  ▶ Conectar Controle &amp; Jogar (Minha Fonte)
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    removeUserSourceForGame(game.id);
                    setSavedSource(null);
                    setCustomUrl('');
                  }}
                >
                  Trocar Fonte
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bloco Simples de Escolha do Arquivo / Melhor Opção para jogos de Biblioteca */}
        {game.availability !== 'free-playable' && (
          <div className="panel" style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Como deseja iniciar {game.title}?</div>

            {/* Opções verificadas abertas encontradas automaticamente (zero bloqueados!) */}
            {finding && (
              <div style={{ fontSize: 13, color: 'var(--cyan)' }}>
                🔍 Procurando automaticamente a melhor opção aberta disponível...
              </div>
            )}

            {!finding && smartOptions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {smartOptions.slice(0, 3).map((opt) => (
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
                        {opt.itemTitle} • {fmtBytes(opt.size)} • Verificado e pronto para rodar
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => onLaunchUrl(game, opt.proxyUrl, opt.filename)}
                    >
                      ▶ Jogar Agora
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!finding && smartOptions.length === 0 && smartNote && (
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45 }}>
                {smartNote}
              </div>
            )}

            {/* Botões Grandes e Simples */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label className="btn btn-primary" style={{ flex: 1, padding: '12px 16px', cursor: 'pointer' }}>
                📂 Escolher Arquivo no Meu PC / Celular ({consoleDef.extensions.slice(0, 3).join(', ')})
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
                <button className="btn btn-cyan" onClick={() => onOpenPs2Runtime(game)}>
                  🎮 Abrir Emulador PS2
                </button>
              )}

              <button
                className="btn btn-ghost"
                onClick={() => setShowLinkInput((v) => !v)}
              >
                🌐 Usar Link Próprio
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
                  ▶ Salvar &amp; Jogar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
