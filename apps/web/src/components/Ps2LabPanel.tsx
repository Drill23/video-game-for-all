import React, { useEffect, useState } from 'react';
import {
  mountPs2DiscSession,
  probePs2WebCapabilities,
  type Ps2MountedSession,
  type WebGpuCapabilities,
} from '@vgfa/runtime';
import type { DiscMetrics, Iso9660Metadata } from '@vgfa/disc';

interface Props {
  gameTitle?: string;
  expectedSerial?: string;
  initialFile?: File | null;
  initialUrl?: string | null;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const Ps2LabPanel: React.FC<Props> = ({
  gameTitle = 'PlayStation 2',
  expectedSerial,
  initialFile,
  initialUrl,
}) => {
  const [caps, setCaps] = useState<WebGpuCapabilities | null>(null);
  const [engineMode, setEngineMode] = useState<'playjs' | 'pcsx2-webgpu' | 'disc'>('playjs');
  const [session, setSession] = useState<Ps2MountedSession | null>(null);
  const [metrics, setMetrics] = useState<DiscMetrics | null>(null);
  const [isoMeta, setIsoMeta] = useState<Iso9660Metadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void probePs2WebCapabilities().then(setCaps);
  }, []);

  useEffect(() => {
    if (initialFile) {
      void mountLocalIso(initialFile);
    } else if (initialUrl) {
      void mountRemoteUrl(initialUrl);
    }
    return () => {
      void session?.dispose();
    };
  }, [initialFile, initialUrl]);

  const mountLocalIso = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      await session?.dispose();
      const s = await mountPs2DiscSession({ kind: 'file', file }, setMetrics);
      setSession(s);
      setIsoMeta(s.metadata);
      setMetrics(await s.disc.getMetrics());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler esta ISO.');
    } finally {
      setLoading(false);
    }
  };

  const mountRemoteUrl = async (url: string) => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await session?.dispose();
      const s = await mountPs2DiscSession({ kind: 'url', url: url.trim() }, setMetrics);
      setSession(s);
      setIsoMeta(s.metadata);
      setMetrics(await s.disc.getMetrics());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível abrir o link remoto. Baixe a ISO no seu dispositivo e carregue localmente.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Seletor Simples de Motor PS2 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${engineMode === 'playjs' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('playjs')}
          >
            🚀 Jogar PS2 Agora (Sem BIOS)
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'pcsx2-webgpu' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('pcsx2-webgpu')}
          >
            ⚡ Motor 60 FPS (PCSX2 WebGPU)
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'disc' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('disc')}
          >
            💿 Verificar ISO ({expectedSerial || 'PS2'})
          </button>
        </div>

        <label className="btn btn-sm btn-cyan" style={{ cursor: 'pointer' }}>
          📂 Escolher ISO Local
          <input
            type="file"
            accept=".iso,.bin,.chd,.cso,.zso,.elf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void mountLocalIso(f);
            }}
          />
        </label>
      </div>

      {/* Status limpo da ISO validada */}
      {loading && (
        <div style={{ fontSize: 13, color: 'var(--cyan)' }}>
          ⏳ Validando disco PS2 em streaming (lendo apenas o cabeçalho)...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(251, 113, 133, 0.12)',
            border: '1px solid rgba(251, 113, 133, 0.35)',
            color: '#fda4af',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {isoMeta && metrics && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.4)',
            color: '#a7f3d0',
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            ✓ Disco PS2 Validado: <strong>{isoMeta.serial || isoMeta.volumeId || gameTitle}</strong> ({isoMeta.region || 'AUTO'})
          </span>
          <span className="mono" style={{ fontSize: 12 }}>
            {fmtSize(metrics.discSizeBytes)} • Lido: {fmtSize(metrics.bytesFromSource)}
          </span>
        </div>
      )}

      {/* Modo Play!.js (Sem BIOS, direto na tela) */}
      {engineMode === 'playjs' && (
        <div className="panel" style={{ background: 'var(--bg-0)', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              <strong>Emulador PS2 no Navegador (Sem precisar de BIOS)</strong> — clique em <em>Select File</em> abaixo e escolha sua ISO de <strong>{gameTitle}</strong>.
            </div>
            <a className="btn btn-sm btn-cyan" href="https://playjs.purei.org/" target="_blank" rel="noreferrer">
              Tela Cheia ↗
            </a>
          </div>
          <iframe
            title="Play!.js PS2 WebAssembly"
            src="https://playjs.purei.org/"
            style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 12, background: '#000' }}
            allow="gamepad *; fullscreen *; autoplay *"
          />
        </div>
      )}

      {/* Modo PCSX2 WebGPU (60 FPS para GTA SA & DBZ BT3) */}
      {engineMode === 'pcsx2-webgpu' && (
        <div className="panel" style={{ background: 'var(--bg-0)' }}>
          <strong style={{ display: 'block', fontSize: 16, marginBottom: 8, color: 'var(--amber)' }}>
            Motor PS2 60 FPS (PCSX2 WebGPU) — Melhor para {gameTitle}
          </strong>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-1)', lineHeight: 1.55 }}>
            Para rodar jogos pesados como <strong>GTA: San Andreas</strong> e{' '}
            <strong>Dragon Ball Z: Budokai Tenkaichi 3</strong> em velocidade máxima (60 FPS) direto no navegador:
          </p>
          <ol style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: 13, color: 'var(--text-1)', lineHeight: 1.7 }}>
            <li>Clique no botão abaixo para abrir o runtime WebGPU isolado;</li>
            <li>Selecione a sua <strong>BIOS do PS2 (.bin)</strong> e a sua <strong>ISO do jogo</strong> (nada é enviado para a internet);</li>
            <li>Jogue com seu controle Bluetooth ou teclado em 60 FPS!</li>
          </ol>
          <a
            className="btn btn-primary"
            style={{ padding: '12px 18px', fontSize: 14 }}
            href="https://tabstationtoo.github.io/TabStationToo/"
            target="_blank"
            rel="noreferrer"
          >
            ▶ Iniciar Motor PS2 60 FPS (WebGPU) ↗
          </a>
        </div>
      )}

      {/* Modo Verificador Técnico */}
      {engineMode === 'disc' && caps && (
        <div className="panel" style={{ background: 'var(--bg-0)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
            <div className="stat-card">
              <strong>WebGPU</strong>
              <span style={{ color: caps.webgpuSupported ? '#34d399' : '#fb7185' }}>
                {caps.webgpuSupported ? `Ativo (${caps.adapterName})` : 'Indisponível'}
              </span>
            </div>
            <div className="stat-card">
              <strong>Multi-Thread (SAB)</strong>
              <span style={{ color: caps.sharedArrayBuffer && caps.crossOriginIsolated ? '#34d399' : '#fbbf24' }}>
                {caps.sharedArrayBuffer && caps.crossOriginIsolated ? 'Ativo' : 'Indisponível'}
              </span>
            </div>
            <div className="stat-card">
              <strong>Cache OPFS</strong>
              <span style={{ color: caps.opfsSupported ? '#34d399' : '#fbbf24' }}>
                {caps.opfsSupported ? 'Ativo' : 'RAM'}
              </span>
            </div>
            <div className="stat-card">
              <strong>WASM SIMD128</strong>
              <span style={{ color: caps.wasmSimdSupported ? '#34d399' : '#fbbf24' }}>
                {caps.wasmSimdSupported ? 'Ativo' : 'Indisponível'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
