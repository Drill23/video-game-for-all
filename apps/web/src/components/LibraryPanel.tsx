import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONSOLE_MAP,
  clearLibrary,
  deleteLibraryEntry,
  deleteOpfsDisc,
  formatBytes,
  getStorageInfo,
  listOpfsDiscs,
  onLibraryChange,
  requestPersistentStorage,
  type LibraryEntry,
  type OpfsDiscInfo,
  type StoreGame,
} from '@vgfa/runtime';
import { useLibraryEntries } from '../services/useLibrary';
import '../styles/library.css';

interface Props {
  games: StoreGame[];
  onPlay: (entry: LibraryEntry, game?: StoreGame) => void;
}

interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const w = Math.floor(d / 7);
  if (d < 30) return `há ${w} ${w === 1 ? 'semana' : 'semanas'}`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

function discLabel(d: OpfsDiscInfo): string {
  const short = d.name.length > 14 ? `${d.name.slice(0, 8)}…${d.name.slice(-4)}` : d.name;
  return d.dir === 'vgfa-opfs-discs' ? `Disco PS2 instalado · ${short}` : `Cache de disco PS2 · ${short}`;
}

export const LibraryPanel: React.FC<Props> = ({ games, onPlay }) => {
  const entries = useLibraryEntries();
  const [info, setInfo] = useState<StorageInfo>({ usage: 0, quota: 0, persisted: false });
  const [discs, setDiscs] = useState<OpfsDiscInfo[]>([]);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmDisc, setConfirmDisc] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [protectMsg, setProtectMsg] = useState<string | null>(null);

  const refreshExtras = useCallback(async () => {
    const [i, d] = await Promise.all([getStorageInfo(), listOpfsDiscs()]);
    setInfo(i);
    setDiscs(d);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void refreshExtras();
    };
    run();
    const off = onLibraryChange(run);
    return () => {
      alive = false;
      off();
    };
  }, [refreshExtras]);

  // Também recalcula quando a lista de jogos muda (cobre trocas de aba sem evento).
  useEffect(() => {
    void refreshExtras();
  }, [entries, refreshExtras]);

  const gameFor = useMemo(() => {
    const byId = new Map(games.map((g) => [g.id, g]));
    const byUrl = new Map(games.filter((g) => g.freeRomUrl).map((g) => [g.freeRomUrl!.replace(/\s+/g, ''), g]));
    return (e: LibraryEntry): StoreGame | undefined => (e.gameId ? byId.get(e.gameId) : undefined) ?? byUrl.get(e.key);
  }, [games]);

  const libraryBytes = entries.reduce((s, e) => s + e.sizeBytes, 0);
  const discBytes = discs.reduce((s, d) => s + d.sizeBytes, 0);
  const vgfaBytes = Math.max(info.usage, libraryBytes + discBytes);
  const free = info.quota > 0 ? Math.max(0, info.quota - info.usage) : 0;
  const pct = info.quota > 0 ? Math.min(100, (vgfaBytes / info.quota) * 100) : 0;
  const nothing = entries.length === 0 && discs.length === 0;

  const protect = async () => {
    const ok = await requestPersistentStorage();
    setProtectMsg(ok ? null : 'Este navegador não quis proteger agora. Instalar o site na tela inicial ajuda.');
    await refreshExtras();
  };

  const removeGame = async (key: string) => {
    setConfirmKey(null);
    setBusy(true);
    await deleteLibraryEntry(key);
    setBusy(false);
  };

  const removeDisc = async (d: OpfsDiscInfo) => {
    setConfirmDisc(null);
    setBusy(true);
    await deleteOpfsDisc(d.dir, d.name);
    await refreshExtras();
    setBusy(false);
  };

  const removeAll = async () => {
    setConfirmAll(false);
    setBusy(true);
    await clearLibrary();
    for (const d of discs) await deleteOpfsDisc(d.dir, d.name);
    await refreshExtras();
    setBusy(false);
  };

  return (
    <section className="lib-panel" aria-labelledby="lib-title">
      <header className="lib-head">
        <div>
          <h2 id="lib-title" className="lib-title">
            Minha Central
          </h2>
          <p className="lib-sub">Jogos guardados neste aparelho. Abra de novo sem baixar.</p>
        </div>
        {info.persisted ? (
          <span className="lib-badge lib-badge--ok">Protegidos ✓</span>
        ) : (
          <button type="button" className="btn lib-btn-sm" onClick={() => void protect()}>
            Proteger meus jogos
          </button>
        )}
      </header>
      {protectMsg && <p className="lib-note">{protectMsg}</p>}

      <div className="lib-meter glass">
        <div className="lib-meter__row">
          <span>
            <strong>{formatBytes(vgfaBytes)}</strong> usados pelo VGFA
          </span>
          <span>{info.quota > 0 ? `${formatBytes(free)} livres no aparelho` : 'Espaço livre indisponível'}</span>
        </div>
        <div
          className="lib-meter__track"
          role="progressbar"
          aria-label="Espaço usado pelo VGFA"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className="lib-meter__bar" style={{ width: `${vgfaBytes > 0 ? Math.max(pct, 2) : 0}%` }} />
        </div>
        <div className="lib-meter__row lib-meter__row--small">
          <span>
            Jogos: {formatBytes(libraryBytes)}
            {discs.length > 0 ? ` · Discos PS2: ${formatBytes(discBytes)}` : ''}
          </span>
          {!nothing && (
            <span className="lib-clear">
              {confirmAll ? (
                <span className="lib-confirm" role="group" aria-label="Confirmar liberar tudo">
                  <span>Apagar tudo?</span>
                  <button type="button" className="lib-link lib-link--danger" onClick={() => void removeAll()}>
                    Sim
                  </button>
                  <span aria-hidden="true">·</span>
                  <button type="button" className="lib-link" onClick={() => setConfirmAll(false)}>
                    Não
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-danger lib-btn-sm" disabled={busy} onClick={() => setConfirmAll(true)}>
                  Liberar tudo
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="lib-empty glass">
          <div className="lib-empty__art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h3>Nada baixado ainda</h3>
          <p>Jogos que você abrir ficam aqui para jogar sem baixar de novo.</p>
        </div>
      ) : (
        <ul className="lib-grid">
          {entries.map((e) => {
            const game = gameFor(e);
            const title = e.title || game?.title || e.filename;
            const consoleId = e.consoleId || game?.consoleId;
            const consoleName = consoleId ? (CONSOLE_MAP as Record<string, { name: string } | undefined>)[consoleId]?.name ?? consoleId : '';
            const cover = e.coverUrl || game?.coverUrl;
            const played = e.lastPlayedAt > e.savedAt + 1000;
            return (
              <li key={e.key} className="lib-card glass">
                <div className="lib-card__cover">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      onError={(ev) => {
                        (ev.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  <span className="lib-card__initial" aria-hidden="true">
                    {title.trim().charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="lib-card__body">
                  <h3 className="lib-card__title" title={title}>
                    {title}
                  </h3>
                  <p className="lib-card__meta">
                    {consoleName && <span className="chip lib-chip">{consoleName}</span>}
                    <span>{formatBytes(e.sizeBytes)}</span>
                  </p>
                  <p className="lib-card__when">
                    {played ? `jogado ${timeAgo(e.lastPlayedAt)}` : `baixado ${timeAgo(e.savedAt)}`}
                  </p>
                  <div className="lib-card__actions">
                    {confirmKey === e.key ? (
                      <span className="lib-confirm" role="group" aria-label={`Confirmar apagar ${title}`}>
                        <span>Apagar?</span>
                        <button type="button" className="lib-link lib-link--danger" onClick={() => void removeGame(e.key)}>
                          Sim
                        </button>
                        <span aria-hidden="true">·</span>
                        <button type="button" className="lib-link" onClick={() => setConfirmKey(null)}>
                          Não
                        </button>
                      </span>
                    ) : (
                      <>
                        <button type="button" className="btn btn-primary lib-btn-sm" onClick={() => onPlay(e, game)}>
                          Jogar
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost lib-btn-sm"
                          disabled={busy}
                          onClick={() => setConfirmKey(e.key)}
                        >
                          Apagar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {discs.length > 0 && (
        <div className="lib-discs">
          <h3 className="lib-discs__title">Discos PS2 em cache</h3>
          <ul className="lib-discs__list">
            {discs.map((d) => {
              const id = `${d.dir}/${d.name}`;
              return (
                <li key={id} className="lib-disc glass">
                  <span className="lib-disc__name">{discLabel(d)}</span>
                  <span className="lib-disc__size">{formatBytes(d.sizeBytes)}</span>
                  {confirmDisc === id ? (
                    <span className="lib-confirm" role="group" aria-label="Confirmar apagar disco">
                      <span>Apagar?</span>
                      <button type="button" className="lib-link lib-link--danger" onClick={() => void removeDisc(d)}>
                        Sim
                      </button>
                      <span aria-hidden="true">·</span>
                      <button type="button" className="lib-link" onClick={() => setConfirmDisc(null)}>
                        Não
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-ghost lib-btn-sm" disabled={busy} onClick={() => setConfirmDisc(id)}>
                      Apagar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};
