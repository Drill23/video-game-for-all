import React, { useEffect, useState } from 'react';
import type { LibraryEntry } from '@vgfa/runtime';
import { formatBytes } from '@vgfa/runtime';
import { Icon } from '../Icon.js';
import { useDialog } from '../useDialog.js';
import { fmtDuration, loadPlayStats, type PlayStatsView } from './playStats.js';
import type { HomeStrings } from './strings.js';
import { AVATARS, AVATAR_COLORS, MAX_PROFILES, type Profile } from './useProfiles.js';

export const avatarStyle = (color: string): React.CSSProperties => ({
  background: `radial-gradient(120% 90% at 25% 10%, rgba(255,255,255,0.45), transparent 55%), linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 38%, #14142a))`,
});

export const Avatar: React.FC<{ profile: Pick<Profile, 'avatar' | 'color'>; size?: number; className?: string }> = ({
  profile,
  size = 40,
  className,
}) => (
  <span
    className={`pav ${className ?? ''}`}
    style={{ ...avatarStyle(profile.color), width: size, height: size, fontSize: Math.round(size * 0.52) }}
    aria-hidden="true"
  >
    {profile.avatar}
  </span>
);

/* ------------------------------------------------------------------ */
/* Seletor "Quem está jogando?"                                        */
/* ------------------------------------------------------------------ */

interface GateProps {
  s: HomeStrings;
  profiles: Profile[];
  activeId: string | null;
  /** Capa usada como ambiente desfocado ao fundo. */
  ambient?: string;
  /** first = primeira visita (mostra "Agora não"); switch = aberto pelo menu. */
  mode: 'first' | 'switch';
  onPick: (id: string | null) => void;
  onCreate: (name: string, avatar: string, color: string) => Profile | null;
  onUpdate: (id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'color'>>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const ProfileGate: React.FC<GateProps> = ({
  s,
  profiles,
  activeId,
  ambient,
  mode,
  onPick,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}) => {
  type View = 'pick' | 'form';
  const [view, setView] = useState<View>(profiles.length === 0 ? 'form' : 'pick');
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [confirmDel, setConfirmDel] = useState(false);

  const back = () => {
    if (view === 'form' && profiles.length > 0) {
      setView('pick');
      setEditing(null);
      setConfirmDel(false);
    } else {
      onClose();
    }
  };
  useDialog(back);

  const openForm = (p: Profile | null) => {
    setEditing(p);
    setName(p?.name ?? '');
    setAvatar(p?.avatar ?? AVATARS[profiles.length % AVATARS.length]);
    setColor(p?.color ?? AVATAR_COLORS[profiles.length % AVATAR_COLORS.length]);
    setConfirmDel(false);
    setView('form');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (editing) {
      onUpdate(editing.id, { name, avatar, color });
      setView('pick');
      setEditing(null);
      setManaging(true);
    } else {
      const created = onCreate(name, avatar, color);
      if (created) onPick(created.id);
    }
  };

  const bgStyle = ambient ? undefined : { display: 'none' };

  return (
    <div className="pg" role="dialog" aria-modal="true" aria-label={s.whoPlaying} data-nav-scope>
      <div className="pg-bg" aria-hidden="true" style={bgStyle}>
        {ambient && <img src={ambient} alt="" crossOrigin="anonymous" decoding="async" />}
      </div>
      {(mode === 'switch' || profiles.length > 0) && view === 'pick' && (
        <button type="button" className="icon-btn pg-close" onClick={onClose} aria-label={s.close}>
          <Icon name="close" size={18} />
        </button>
      )}

      {view === 'pick' ? (
        <div className="pg-main">
          <h2 className="pg-title">{managing ? s.manageProfiles : s.whoPlaying}</h2>
          <div className="pg-tiles" role="list">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="listitem"
                className={`pg-tile ${p.id === activeId ? 'is-current' : ''}`}
                data-autofocus={p.id === activeId || (!activeId && p === profiles[0]) ? '' : undefined}
                onClick={() => (managing ? openForm(p) : onPick(p.id))}
              >
                <span className="pg-av-wrap">
                  <Avatar profile={p} size={112} className="pg-av" />
                  {managing && (
                    <span className="pg-edit">
                      <Icon name="edit" size={26} />
                    </span>
                  )}
                </span>
                <span className="pg-name">{p.name}</span>
              </button>
            ))}
            {profiles.length < MAX_PROFILES ? (
              <button type="button" role="listitem" className="pg-tile is-add" onClick={() => openForm(null)}>
                <span className="pg-av-wrap">
                  <span className="pav pg-av pg-add" style={{ width: 112, height: 112 }} aria-hidden="true">
                    <Icon name="plus" size={40} />
                  </span>
                </span>
                <span className="pg-name">{s.addProfile}</span>
              </button>
            ) : (
              <p className="pg-limit">{s.profileLimit}</p>
            )}
          </div>
          <div className="pg-foot">
            {profiles.length > 0 && (
              <button type="button" className="btn btn-lg hx-btn-glass" onClick={() => setManaging((v) => !v)}>
                <Icon name={managing ? 'check' : 'edit'} size={18} /> {managing ? s.done : s.manageProfiles}
              </button>
            )}
            {mode === 'first' && !managing && (
              <button type="button" className="btn btn-lg btn-ghost" onClick={() => onPick(null)}>
                {s.notNow}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form className="pg-main pg-form" onSubmit={submit}>
          <h2 className="pg-title">{editing ? s.editProfile : profiles.length === 0 ? s.createFirstProfile : s.addProfile}</h2>
          <Avatar profile={{ avatar, color }} size={120} className="pg-av pg-preview" />
          <label className="pg-label" htmlFor="pg-name">
            {s.profileName}
          </label>
          <input
            id="pg-name"
            className="field pg-input"
            value={name}
            maxLength={20}
            autoComplete="off"
            placeholder={s.profileNamePh}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
          />
          <div className="pg-label">{s.chooseAvatar}</div>
          <div className="pg-avatars" role="radiogroup" aria-label={s.chooseAvatar}>
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={avatar === a}
                className={`pg-pick ${avatar === a ? 'is-on' : ''}`}
                onClick={() => setAvatar(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="pg-label">{s.chooseColor}</div>
          <div className="pg-colors" role="radiogroup" aria-label={s.chooseColor}>
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={`pg-color ${color === c ? 'is-on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="pg-foot">
            <button type="submit" className="btn btn-primary btn-lg" disabled={!name.trim()}>
              {s.save}
            </button>
            <button type="button" className="btn btn-lg btn-ghost" onClick={back}>
              {profiles.length === 0 && mode === 'first' ? s.notNow : s.cancel}
            </button>
            {editing &&
              (confirmDel ? (
                <span className="pg-confirm" role="group" aria-label={s.deleteProfile}>
                  <span>{s.deleteProfileConfirm}</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      onDelete(editing.id);
                      setConfirmDel(false);
                      setEditing(null);
                      setView(profiles.length > 1 ? 'pick' : 'form');
                    }}
                  >
                    {s.deleteYes}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(false)}>
                    {s.cancel}
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>
                  <Icon name="trash" size={16} /> {s.deleteProfile}
                </button>
              ))}
          </div>
        </form>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Folha do perfil com estatísticas                                    */
/* ------------------------------------------------------------------ */

interface SheetProps {
  s: HomeStrings;
  profile: Profile | null;
  entries: LibraryEntry[];
  listCount: number;
  onEdit: () => void;
  onSwitch: () => void;
  onClose: () => void;
}

export const ProfileSheet: React.FC<SheetProps> = ({ s, profile, entries, listCount, onEdit, onSwitch, onClose }) => {
  useDialog(onClose);
  const [stats, setStats] = useState<PlayStatsView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPlayStats()
      .then((v) => {
        if (alive) setStats(v);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const bytes = entries.reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
  const display: Pick<Profile, 'avatar' | 'color'> = profile ?? { avatar: '👤', color: '#8b7cff' };
  const maxMs = Math.max(1, ...(stats?.top.map((t) => t.ms) ?? [1]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ps" role="dialog" aria-modal="true" aria-label={s.myProfile} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <div className="modal-head">
          <h3>{s.myProfile}</h3>
          <button className="icon-btn modal-close" onClick={onClose} aria-label={s.close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="ps-who">
          <Avatar profile={display} size={84} />
          <div>
            <div className="ps-name">{profile?.name ?? s.guest}</div>
            <div className="ps-sub">{s.profileLocal}</div>
          </div>
        </div>

        <div className="ps-stats">
          <div className="ps-stat">
            <Icon name="disk" size={18} />
            <strong>{entries.length}</strong>
            <span>{s.statsDevice}</span>
            <small>{entries.length ? formatBytes(bytes) : '—'}</small>
          </div>
          <div className="ps-stat">
            <Icon name="clock" size={18} />
            <strong>{stats ? fmtDuration(stats.totalMs) : '—'}</strong>
            <span>{s.statsTime}</span>
          </div>
          <div className="ps-stat">
            <Icon name="check" size={18} />
            <strong>{listCount}</strong>
            <span>{s.myList}</span>
          </div>
        </div>

        <h4 className="ps-h">{s.statsTop}</h4>
        {stats && stats.top.length > 0 ? (
          <ol className="ps-top">
            {stats.top.slice(0, 5).map((t, i) => (
              <li key={t.id}>
                <span className="ps-top-n">{i + 1}</span>
                <span className="ps-top-t">{t.title}</span>
                <span className="ps-top-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(6, Math.round((t.ms / maxMs) * 100))}%` }} />
                </span>
                <span className="ps-top-ms">{fmtDuration(t.ms)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ps-empty">{loaded ? s.statsNone : '…'}</p>
        )}

        <div className="ps-actions">
          {profile && (
            <button className="btn" onClick={onEdit} data-autofocus>
              <Icon name="edit" size={16} /> {s.editProfile}
            </button>
          )}
          <button className="btn btn-primary" onClick={onSwitch}>
            <Icon name="users" size={16} /> {s.switchProfile}
          </button>
        </div>
      </div>
    </div>
  );
};
