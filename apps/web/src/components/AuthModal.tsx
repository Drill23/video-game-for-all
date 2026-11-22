import React, { useState } from 'react';
import type { UserProfile, VgfaAuthStore } from '@vgfa/storage';
import { Icon } from './Icon.js';
import { useDialog } from './useDialog.js';

interface Props {
  auth: VgfaAuthStore;
  onAuthenticated: (user: UserProfile) => void;
  onClose: () => void;
}

export const AuthModal: React.FC<Props> = ({ auth, onAuthenticated, onClose }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useDialog(onClose);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const user =
        mode === 'register'
          ? auth.register(username, email, password)
          : auth.login(email, password);
      onAuthenticated(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? 'Entrar no VGFA' : 'Criar Conta VGFA'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grabber" />
        <div className="modal-head">
          <h3>{mode === 'login' ? 'Entrar no VGFA' : 'Criar Conta VGFA'}</h3>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="seg2">
          <button
            type="button"
            className={mode === 'login' ? 'is-active' : ''}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'is-active' : ''}
            onClick={() => setMode('register')}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack">
          {mode === 'register' && (
            <input
              className="field"
              placeholder="Nome de Jogador (ex.: Adriano)"
              autoComplete="nickname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          )}
          <input
            className="field"
            type="email"
            placeholder="E-mail"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            placeholder="Senha"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="notice notice-err">{error}</div>}

          <button className="btn btn-primary btn-lg" type="submit">
            {mode === 'login' ? 'Entrar' : 'Criar e Entrar'}
          </button>
        </form>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', whiteSpace: 'normal', textAlign: 'center', padding: '10px 18px' }}
            onClick={() => {
              onAuthenticated(auth.loginAsGuest());
              onClose();
            }}
          >
            Continuar como Convidado (Saves Locais no Navegador)
          </button>
        </div>
      </div>
    </div>
  );
};
