import React from 'react';
import { Icon, type IconName } from '../Icon.js';
import type { HomeStrings } from './strings.js';

export type TabId = 'home' | 'store' | 'library' | 'pad';

const ORDER: Array<{ id: TabId; icon: IconName; label: keyof HomeStrings }> = [
  { id: 'home', icon: 'home', label: 'tabHome' },
  { id: 'store', icon: 'store', label: 'tabStore' },
  { id: 'library', icon: 'library', label: 'tabLibrary' },
  { id: 'pad', icon: 'gamepad', label: 'tabPad' },
];

interface Props {
  s: HomeStrings;
  tab: TabId;
  onTab: (t: TabId) => void;
  /** seg = controle segmentado no topo (desktop); bar = barra flutuante embaixo (celular). */
  variant: 'seg' | 'bar';
}

export const Tabs: React.FC<Props> = ({ s, tab, onTab, variant }) => {
  const index = ORDER.findIndex((t) => t.id === tab);
  return (
    <nav
      className={variant === 'seg' ? 'seg' : 'tabbar glass-strong'}
      role="tablist"
      style={{ ['--i' as string]: index }}
    >
      <span className="seg-thumb" aria-hidden="true" />
      {ORDER.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={`seg-item ${tab === t.id ? 'is-active' : ''}`}
          onClick={() => onTab(t.id)}
        >
          <Icon name={t.icon} size={variant === 'bar' ? 22 : 17} />
          <span>{s[t.label] as string}</span>
        </button>
      ))}
    </nav>
  );
};
