import React, { useEffect, useRef, useState } from 'react';
import type { SupportedLang, UserProfile } from '@vgfa/storage';
import { Icon } from '../Icon.js';
import { Avatar } from './Profiles.js';
import { Tabs, type TabId } from './Tabs.js';
import type { Profile } from './useProfiles.js';
import type { HomeStrings } from './strings.js';
import type { ThemePref } from './useTheme.js';

interface Props {
  s: HomeStrings;
  compact: boolean;
  tab: TabId;
  onTab: (t: TabId) => void;
  query: string;
  onQuery: (q: string) => void;
  onSubmitSearch: () => void;
  lang: SupportedLang;
  onLang: (l: SupportedLang) => void;
  themePref: ThemePref;
  onTheme: (t: ThemePref) => void;
  nexusActive: boolean;
  onOptimize: () => void;
  user: UserProfile | null;
  signOutLabel: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onSaves: () => void;
  onShare: () => void;
  onPickFile: (f: File) => void;
  onBrand: () => void;
  padHref: string;
  profile: Profile | null;
  onProfileSheet: () => void;
  onProfileSwitch: () => void;
}

const ROM_ACCEPT =
  '.a26,.nes,.sfc,.smc,.md,.gen,.gb,.gbc,.gba,.z64,.n64,.v64,.cue,.chd,.cso,.zso,.iso,.bin,.pbp,.elf';

export const TopBar: React.FC<Props> = (p) => {
  const { s } = p;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'GoBack') {
        setOpen(false);
        wrapRef.current?.querySelector<HTMLElement>('.avatar-btn')?.focus({ preventScroll: true });
      }
    };
    // Leva o foco para dentro do menu (navegação por controle)
    wrapRef.current?.querySelector<HTMLElement>('.menu .menu-item')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const base = import.meta.env.BASE_URL;

  const langSelect = (cls: string) => (
    <select
      className={`lang-select ${cls}`}
      value={p.lang}
      aria-label={s.language}
      onChange={(e) => p.onLang(e.target.value as SupportedLang)}
    >
      <option value="pt-BR">🇧🇷 PT-BR</option>
      <option value="en">🇺🇸 EN</option>
      <option value="es">🇪🇸 ES</option>
    </select>
  );

  const themeOpts: Array<{ id: ThemePref; icon: 'monitor' | 'moon' | 'sun'; label: string }> = [
    { id: 'system', icon: 'monitor', label: s.themeSystem },
    { id: 'dark', icon: 'moon', label: s.themeDark },
    { id: 'light', icon: 'sun', label: s.themeLight },
  ];

  return (
    <div className="topbar-wrap" ref={wrapRef}>
      <header className="topbar glass">
        <button className="brand" onClick={p.onBrand} aria-label="VGFA">
          <img className="brand-mark" src={`${base}icons/icon.svg`} alt="" width={38} height={38} />
          <span className="brand-text">
            <b>VGFA</b>
            <small>{s.brandSub}</small>
          </span>
        </button>

        {!p.compact && (
          <div className="topbar-tabs">
            <Tabs s={s} tab={p.tab} onTab={p.onTab} variant="seg" />
          </div>
        )}

        <div className="topbar-spacer" />

        {!p.compact && (
          <form
            className="search-pill"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              p.onSubmitSearch();
            }}
          >
            <Icon name="search" size={18} />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              placeholder={s.searchPlaceholder}
              aria-label={s.searchPlaceholder}
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
            />
            {p.query && (
              <button type="button" className="search-clear" aria-label={s.clear} onClick={() => p.onQuery('')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </form>
        )}

        <div className="topbar-actions">
          {langSelect('only-wide')}
          <button
            className={`icon-btn ${p.nexusActive ? 'is-on' : ''}`}
            onClick={p.onOptimize}
            aria-label={p.nexusActive ? s.optimizeActive : s.optimize}
            title={p.nexusActive ? s.optimizeActive : s.optimize}
          >
            <Icon name="bolt" size={19} />
          </button>
          <button
            className="icon-btn avatar-btn"
            onClick={() => setOpen((v) => !v)}
            aria-label={s.menu}
            aria-expanded={open}
            style={p.user && !p.profile ? { ['--av' as string]: p.user.avatarColor } : undefined}
          >
            {p.profile ? (
              <Avatar profile={p.profile} size={34} />
            ) : p.user ? (
              <b>{p.user.username.slice(0, 1).toUpperCase()}</b>
            ) : (
              <Icon name="user" size={19} />
            )}
          </button>
        </div>
      </header>

      {open && (
        <div className="menu glass-strong" role="menu">
          <div className="menu-profile">
            <button
              className="menu-item"
              onClick={() => {
                close();
                p.onProfileSheet();
              }}
            >
              {p.profile ? <Avatar profile={p.profile} size={30} /> : <Icon name="user" size={18} />}
              <span className="menu-grow">{p.profile?.name ?? s.guest}</span>
              <small>{s.myProfile}</small>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                p.onProfileSwitch();
              }}
            >
              <Icon name="users" size={18} />
              {s.switchProfile}
            </button>
          </div>

          <div className="menu-user">
            {p.user ? (
              <>
                <div className="menu-av" style={{ ['--av' as string]: p.user.avatarColor }}>
                  {p.user.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="menu-user-name">{p.user.username}</div>
              </>
            ) : (
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  close();
                  p.onSignIn();
                }}
              >
                {s.signInFull}
              </button>
            )}
          </div>

          <div className="menu-label">{s.theme}</div>
          <div className="menu-theme" role="radiogroup" aria-label={s.theme}>
            {themeOpts.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={p.themePref === o.id}
                className={`menu-theme-btn ${p.themePref === o.id ? 'is-active' : ''}`}
                onClick={() => p.onTheme(o.id)}
              >
                <Icon name={o.icon} size={16} />
                {o.label}
              </button>
            ))}
          </div>

          <div className="menu-lang">{langSelect('')}</div>

          <label
            className="menu-item"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.click();
              }
            }}
          >
            <Icon name="folder" size={18} />
            {s.openMyGame}
            <input
              type="file"
              accept={ROM_ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  close();
                  p.onPickFile(f);
                }
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="menu-item"
            onClick={() => {
              close();
              p.onSaves();
            }}
          >
            <Icon name="save" size={18} />
            {s.saves}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              close();
              p.onShare();
            }}
          >
            <Icon name="globe" size={18} />
            {s.publicLink}
          </button>
          <a className="menu-item" href={p.padHref} target="_blank" rel="noreferrer" onClick={close}>
            <Icon name="phone" size={18} />
            {s.padMode}
          </a>
          {p.user && (
            <button
              className="menu-item is-danger"
              onClick={() => {
                close();
                p.onSignOut();
              }}
            >
              <Icon name="logout" size={18} />
              {p.signOutLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
