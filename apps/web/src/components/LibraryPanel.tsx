import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONSOLE_MAP,
  clearLibrary,
  deleteOpfsDisc,
  formatBytes,
  getStorageInfo,
  listOpfsDiscs,
  onLibraryChange,
  removeLibraryEntry,
  requestPersistentStorage,
  type LibraryEntry,
  type OpfsDiscInfo,
  type Ps2DiscStorage,
  type StoreGame,
} from '@vgfa/runtime';
import { deleteSaves, getPlayStats, listSaves, onSavesChange, type EjsSaveMeta, type PlayStats } from '../services/ejs-saves';
import { formatPlayTime, timeAgo } from '../services/format';
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

const STORAGE_LABEL: Record<Ps2DiscStorage, string> = {
  full: 'Disco completo',
  partial: 'Download incompleto',
  streaming: 'Guardando enquanto joga',
};

/** Chave dos saves/tempo de jogo deste item: o `gameId` (mesmo `session.id` do player) ou a própria chave. */
function saveKeyOf(e: LibraryEntry): string {
  return e.gameId || e.key;
}

const emptyStats: PlayStats = { totalMs: 0, perGame: {} };

interface DeleteChoiceProps {
  title: string;
  sizeBytes: number;
  hasSaves: boolean;
  onAll: () => void;
  onGameOnly: () => void;
  onCancel: () => void;
}

/** Deixa claro o que some antes de apagar. */
const DeleteChoice: React.FC<DeleteChoiceProps> = ({ title, sizeBytes, hasSaves, onAll, onGameOnly, onCancel }) => (
  <div className="lib-del" role="group" aria-label={`Confirmar apagar ${title}`}>
    <p className="lib-del__text">
      {hasSaves ? 'Apaga o jogo E os saves deste aparelho.' : 'Apaga o jogo deste aparelho.'}
      {sizeBytes > 0 ? ` Libera ${formatBytes(sizeBytes)}.` : ''}
    </p>
    <div className="lib-del__actions">
      <button type="button" className="btn btn-danger lib-btn-sm" onClick={onAll}>
        {hasSaves ? 'Apagar jogo e saves' : 'Apagar'}
      </button>
      {hasSaves && (
        <button type="button" className="btn btn-ghost lib-btn-sm" onClick={onGameOnly}>
          Apagar só o jogo, manter saves
        </button>
      )}
      <button type="button" className="btn btn-ghost lib-btn-sm" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  </div>
);

export const LibraryPanel: React.FC<Props> = ({ games, onPlay }) => {
  const entries = useLibraryEntries();
  const [info, setInfo] = useState<StorageInfo>({ usage: 0, quota: 0, persisted: false });
  const [discs, setDiscs] = useState<OpfsDiscInfo[]>([]);
  const [saves, setSaves] = useState<EjsSaveMeta[]>([]);
  const [stats, setStats] = useState<PlayStats>(emptyStats);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmDisc, setConfirmDisc] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [protectMsg, setProtectMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshExtras = useCallback(async () => {
    const [i, d, sv, st] = await Promise.all([getStorageInfo(), listOpfsDiscs(), listSaves(), getPlayStats()]);
    setInfo(i);
    setDiscs(d);
    setSaves(sv);
    setStats(st);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void refreshExtras();
    };
    run();
    const offLib = onLibraryChange(run);
    const offSaves = onSavesChange(run);
    return () => {
      alive = false;
      offLib();
      offSaves();
    };
  }, [refreshExtras]);

  // Também recalcula quando a lista de jogos muda (cobre trocas de aba sem evento).
  useEffect(() => {
    void refreshExtras();
  }, [entries, refreshExtras]);

  const gameFor = useMemo(() => {
    const byId = new Map(games.map((g) => [g.id, g]));
    const byUrl = new Map(games.filter((g) => g.freeRomUrl).map((g) => [g.freeRomUrl!.replace(/\s+/g, ''), g]));
    return (e: { gameId?: string; key?: string }): StoreGame | undefined =>
      (e.gameId ? byId.get(e.gameId) : undefined) ?? (e.key ? byUrl.get(e.key) : undefined);
  }, [games]);

  const latestSave = useMemo(() => {
    const m = new Map<string, EjsSaveMeta>();
    for (const s of saves) if (!m.has(s.gameKey)) m.set(s.gameKey, s); // lista já vem do mais novo
    return m;
  }, [saves]);

  // Discos do OPFS que já viraram cartão (têm metadados) não repetem na lista de baixo.
  const claimed = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.kind === 'ps2-disc' && e.opfsRef) set.add(`${e.opfsRef.dir}/${e.opfsRef.name}`);
    return set;
  }, [entries]);
  const looseDiscs = discs.filter((d) => !claimed.has(d.id));

  const libraryBytes = entries.filter((e) => e.kind !== 'ps2-disc').reduce((s, e) => s + e.sizeBytes, 0);
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

  /** Só roda depois de a pessoa confirmar no cartão. */
  const removeGame = async (e: LibraryEntry, keepSaves: boolean) => {
    setConfirmKey(null);
    setErrorMsg(null);
    setBusy(true);
    const ok = await removeLibraryEntry(e.key);
    if (!ok) {
      setErrorMsg('Não deu para apagar agora (o disco pode estar em uso). Feche o jogo e tente de novo.');
    } else if (!keepSaves) {
      await deleteSaves(saveKeyOf(e));
    }
    await refreshExtras();
    setBusy(false);
  };

  const removeDisc = async (d: OpfsDiscInfo) => {
    setConfirmDisc(null);
    setErrorMsg(null);
    setBusy(true);
    const ok = await deleteOpfsDisc(d.dir, d.name);
    if (!ok) setErrorMsg('Não deu para apagar agora (o disco pode estar em uso). Feche o jogo e tente de novo.');
    await refreshExtras();
    setBusy(false);
  };

  const removeAll = async () => {
    setConfirmAll(false);
    setBusy(true);
    await clearLibrary();
    for (const d of discs) await deleteOpfsDisc(d.dir, d.name);
    for (const s of await listSaves()) await deleteSaves(s.gameKey);
    await refreshExtras();
    setBusy(false);
  };

  const playLoose = (d: OpfsDiscInfo) => {
    if (!d.url) return;
    const now = Date.now();
    const synthetic: LibraryEntry = {
      key: d.url.replace(/\s+/g, ''),
      url: d.url,
      filename: d.fileName ? `${d.fileName}${/\.[a-z0-9]+$/i.test(d.fileName) ? '' : '.iso'}` : 'disco.iso',
      sizeBytes: d.sizeBytes,
      chunkCount: 0,
      savedAt: now,
      lastPlayedAt: now,
      complete: true,
      kind: 'ps2-disc',
      gameId: d.gameId,
      title: d.title,
      consoleId: 'ps2',
      coverUrl: d.coverUrl,
    };
    onPlay(synthetic, gameFor({ gameId: d.gameId }));
  };

  return (
    <section className="lib-panel" aria-labelledby="lib-title">
      <header className="lib-head">
        <div>
          <h2 id="lib-title" className="lib-title">
            Minha Central
          </h2>
          <p className="lib-sub">
            Seus jogos e saves ficam guardados só neste aparelho e neste navegador, e abrem de novo sem baixar. Limpar os dados do
            navegador também apaga tudo.
          </p>
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
      {errorMsg && (
        <p className="lib-error" role="alert">
          {errorMsg}
        </p>
      )}

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
            {stats.totalMs > 0 ? ` · Tempo de jogo: ${formatPlayTime(stats.totalMs)}` : ''}
          </span>
          {!nothing && (
            <span className="lib-clear">
              {confirmAll ? (
                <span className="lib-confirm" role="group" aria-label="Confirmar liberar tudo">
                  <span>Apagar jogos, discos e saves deste aparelho?</span>
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

      {nothing ? (
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
        entries.length > 0 && (
          <ul className="lib-grid">
            {entries.map((e) => {
              const game = gameFor(e);
              const isDisc = e.kind === 'ps2-disc';
              const title = e.title || game?.title || e.filename;
              const consoleId = e.consoleId || game?.consoleId;
              const consoleName = consoleId
                ? ((CONSOLE_MAP as Record<string, { name: string } | undefined>)[consoleId]?.name ?? consoleId)
                : '';
              const cover = e.coverUrl || game?.coverUrl;
              const played = e.lastPlayedAt > e.savedAt + 1000;
              const key = saveKeyOf(e);
              const stat = stats.perGame[key];
              const save = latestSave.get(key);
              const canPlay = !isDisc || !!e.url || !!game;
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
                    {isDisc && e.storage && e.storage !== 'full' && <p className="lib-card__when">{STORAGE_LABEL[e.storage]}</p>}
                    <p className="lib-card__when">
                      {played ? `jogado ${timeAgo(e.lastPlayedAt)}` : `${isDisc ? 'guardado' : 'baixado'} ${timeAgo(e.savedAt)}`}
                    </p>
                    {stat && stat.ms >= 1000 && <p className="lib-card__when">⏱ {formatPlayTime(stat.ms)} de jogo</p>}
                    {save && <p className="lib-card__when">Save automático: {timeAgo(save.savedAt)}</p>}
                    {confirmKey === e.key ? (
                      <DeleteChoice
                        title={title}
                        sizeBytes={e.sizeBytes}
                        hasSaves={!!save}
                        onAll={() => void removeGame(e, false)}
                        onGameOnly={() => void removeGame(e, true)}
                        onCancel={() => setConfirmKey(null)}
                      />
                    ) : (
                      <div className="lib-card__actions">
                        {canPlay ? (
                          <button type="button" className="btn btn-primary lib-btn-sm" onClick={() => onPlay(e, game)}>
                            Jogar
                          </button>
                        ) : (
                          <span className="lib-card__when">Abra pela Loja para jogar</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost lib-btn-sm"
                          disabled={busy}
                          onClick={() => setConfirmKey(e.key)}
                        >
                          Apagar
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      {looseDiscs.length > 0 && (
        <div className="lib-discs">
          <h3 className="lib-discs__title">Discos PS2 guardados neste aparelho</h3>
          <ul className="lib-discs__list">
            {looseDiscs.map((d) => {
              const game = gameFor({ gameId: d.gameId });
              const cache = d.dir === 'vgfa-disc-cache';
              return (
                <li key={d.id} className="lib-disc glass">
                  <span className="lib-disc__name">
                    {d.coverUrl || game?.coverUrl ? (
                      <img className="lib-disc__thumb" src={d.coverUrl || game?.coverUrl} alt="" loading="lazy" />
                    ) : null}
                    <span>
                      {d.title || game?.title ? `${d.title || game?.title}` : d.label.replace(/ · [\d,]+ (B|KB|MB|GB|TB)$/, '')}
                      <small className="lib-disc__sub">{cache ? 'Cache de diagnóstico' : STORAGE_LABEL[d.storage]}</small>
                    </span>
                  </span>
                  <span className="lib-disc__size">{formatBytes(d.sizeBytes)}</span>
                  {confirmDisc === d.id ? (
                    <DeleteChoice
                      title={d.label}
                      sizeBytes={d.sizeBytes}
                      hasSaves={false}
                      onAll={() => void removeDisc(d)}
                      onGameOnly={() => undefined}
                      onCancel={() => setConfirmDisc(null)}
                    />
                  ) : (
                    <>
                      {d.url && !cache && (
                        <button type="button" className="btn btn-primary lib-btn-sm" onClick={() => playLoose(d)}>
                          Jogar
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost lib-btn-sm" disabled={busy} onClick={() => setConfirmDisc(d.id)}>
                        Apagar
                      </button>
                    </>
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
