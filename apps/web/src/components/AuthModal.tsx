import React, { useState } from 'react';
import type { UserProfile, VgfaAuthStore } from '@vgfa/storage';

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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{mode === 'login' ? 'Entrar no VGFA' : 'Criar Conta VGFA'}</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'register' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setMode('register')}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <input
              className="field"
              placeholder="Nome de Jogador (ex.: Adriano)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          )}
          <input
            className="field"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <div style={{ color: '#fb7185', fontSize: 13, fontWeight: 600 }}>{error}</div>
          )}

          <button className="btn btn-primary" type="submit">
            {mode === 'login' ? 'Entrar' : 'Criar e Entrar'}
          </button>
        </form>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-ghost"
            style={{ width: '100%' }}
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
