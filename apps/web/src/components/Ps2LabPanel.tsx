import React, { useEffect, useState } from 'react';
import {
  MemoryDiscSource,
  VirtualChunkedDisc,
  inspectIso9660,
  type DiscMetrics,
  type Iso9660Metadata,
} from '@vgfa/disc';
import {
  mountPs2DiscSession,
  probePs2WebCapabilities,
  type Ps2MountedSession,
  type WebGpuCapabilities,
} from '@vgfa/runtime';

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
  const [engineMode, setEngineMode] = useState<'vgfa-disc' | 'playjs' | 'pcsx2-webgpu'>('vgfa-disc');
  const [session, setSession] = useState<Ps2MountedSession | null>(null);
  const [metrics, setMetrics] = useState<DiscMetrics | null>(null);
  const [isoMeta, setIsoMeta] = useState<Iso9660Metadata | null>(null);
  const [urlInput, setUrlInput] = useState(initialUrl ?? '');
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
      const s = await mountPs2DiscSession({ kind: 'file', file }, (m) => setMetrics(m));
      setSession(s);
      setIsoMeta(s.metadata);
      setMetrics(await s.disc.getMetrics());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao montar ISO local.');
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
      const s = await mountPs2DiscSession({ kind: 'url', url: url.trim() }, (m) => setMetrics(m));
      setSession(s);
      setIsoMeta(s.metadata);
      setMetrics(await s.disc.getMetrics());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Falha ao abrir streaming HTTP Range (verifique se o link aponta para uma .iso direta e aceita HTTP 206).',
      );
    } finally {
      setLoading(false);
    }
  };

  const runSyntheticBenchmark = async () => {
    setLoading(true);
    setError(null);
    try {
      const SECTOR = 2048;
      const buf = new Uint8Array(SECTOR * 64);
      const dv = new DataView(buf.buffer);
      const pvd = 16 * SECTOR;
      buf[pvd] = 0x01;
      buf.set(new TextEncoder().encode('CD001'), pvd + 1);
      buf.set(new TextEncoder().encode('PLAYSTATION'), pvd + 8);
      buf.set(new TextEncoder().encode('VGFA_PS2_BENCHMARK'), pvd + 40);
      dv.setUint32(pvd + 80, 64, true);
      dv.setUint32(pvd + 156 + 2, 20, true);
      dv.setUint32(pvd + 156 + 10, SECTOR, true);

      const serialCode = (expectedSerial || 'SLUS-21678').replace('-', '_');
      const bootSerial = `${serialCode.slice(0, 8)}.${serialCode.slice(8)}`;
      const cnf = new TextEncoder().encode(
        `BOOT2 = cdrom0:\\${bootSerial};1\r\nVER = 1.00\r\nVMODE = NTSC\r\n`,
      );
      const name = new TextEncoder().encode('SYSTEM.CNF;1');
      const root = 20 * SECTOR;
      buf[root] = 33 + name.length + ((33 + name.length) % 2);
      dv.setUint32(root + 2, 22, true);
      dv.setUint32(root + 10, cnf.length, true);
      buf[root + 32] = name.length;
      buf.set(name, root + 33);
      buf.set(cnf, 22 * SECTOR);

      const disc = new VirtualChunkedDisc(new MemoryDiscSource(buf, 'synthetic_ps2_demo.iso'), {
        chunkSizeBytes: 16384,
        onMetrics: setMetrics,
      });
      const meta = await inspectIso9660(disc);
      await disc.read(32768, 4096);
      await disc.read(49152, 8192);
      await disc.read(32768, 2048);
      setIsoMeta(meta);
      setMetrics(await disc.getMetrics());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Seletor de Motor PS2 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${engineMode === 'vgfa-disc' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('vgfa-disc')}
          >
            ⚡ VGFA-Disc Streaming &amp; WebGPU
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'pcsx2-webgpu' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('pcsx2-webgpu')}
          >
            🎮 PCSX2 WebGPU 60 FPS (TabStationToo)
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'playjs' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('playjs')}
          >
            🚀 Play!.js WASM (Sem BIOS)
          </button>
        </div>

        <span className="badge" style={{ color: (caps?.readinessScore ?? 0) >= 60 ? '#34d399' : '#fbbf24' }}>
          WebGPU Ready: {caps?.readinessScore ?? 0}%
        </span>
      </div>

      {/* Modo 1: Emulador Play!.js Zero-BIOS */}
      {engineMode === 'playjs' && (
        <div className="panel" style={{ background: 'var(--bg-0)', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              <strong>Play!.js (WebAssembly • Zero BIOS)</strong> — arraste sua ISO/CSO/CHD/ELF de PS2 direto no player abaixo.
            </div>
            <a
              className="btn btn-sm btn-cyan"
              href="https://playjs.purei.org/"
              target="_blank"
              rel="noreferrer"
            >
              Abrir em Tela Cheia ↗
            </a>
          </div>
          <iframe
            title="Play!.js PS2 WebAssembly"
            src="https://playjs.purei.org/"
            style={{ width: '100%', height: 540, border: '1px solid var(--border)', borderRadius: 12, background: '#000' }}
            allow="gamepad *; fullscreen *; autoplay *"
          />
        </div>
      )}

      {/* Modo 2: PCSX2 WebGPU (TabStationToo — 60 FPS com DBZ BT3 & GTA SA) */}
      {engineMode === 'pcsx2-webgpu' && (
        <div className="panel" style={{ background: 'var(--bg-0)' }}>
          <strong style={{ display: 'block', fontSize: 15, marginBottom: 8, color: 'var(--amber)' }}>
            PCSX2 WebGPU + WASM JIT (TabStationToo) — Recomendado para {gameTitle}
          </strong>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>
            O motor <strong>PCSX2 WebGPU/WASM</strong> é o que roda títulos pesados de PS2 como{' '}
            <strong>Dragon Ball Z: Budokai Tenkaichi 3</strong>, <strong>GTA: San Andreas</strong> e{' '}
            <strong>Final Fantasy XII</strong> a 50–60 FPS no Chrome/Edge com WebGPU. Ele exige que você selecione sua própria{' '}
            <strong>BIOS do PS2 (.bin de 4 MB)</strong> + a <strong>ISO do jogo</strong> (tudo local no seu navegador, sem upload).
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <a
              className="btn btn-primary"
              href="https://tabstationtoo.github.io/TabStationToo/"
              target="_blank"
              rel="noreferrer"
            >
              ▶ Abrir Runtime PCSX2 WebGPU (TabStationToo) ↗
            </a>
            <button className="btn btn-cyan" onClick={() => setEngineMode('playjs')}>
              Testar Sem BIOS (Play!.js)
            </button>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            <strong>Por que abre em janela dedicada?</strong> O PCSX2 WebGPU exige isolamento total de memória (<code>COOP: same-origin</code> + <code>COEP: require-corp</code>) em origem própria para seus 8–10 pthreads WebAssembly + JIT dinâmico.
            <br />
            <strong>Dica para build AOT 100% nativo no VGFA (sem BIOS):</strong> rode localmente{' '}
            <code className="mono">
              ./scripts/vgfa-ps2-recomp-pipeline.sh {expectedSerial?.toLowerCase() || 'ps2-game'} /caminho/para/disc.iso
            </code>
          </div>
        </div>
      )}

      {/* Modo 3: VGFA-Disc Streaming + Diagnóstico Real */}
      {engineMode === 'vgfa-disc' && (
        <>
          {caps && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
              <div className="stat-card">
                <strong>WebGPU</strong>
                <span style={{ color: caps.webgpuSupported ? '#34d399' : '#fb7185' }}>
                  {caps.webgpuSupported ? `Ativo (${caps.adapterName})` : 'Indisponível'}
                </span>
              </div>
              <div className="stat-card">
                <strong>SharedArrayBuffer</strong>
                <span style={{ color: caps.sharedArrayBuffer && caps.crossOriginIsolated ? '#34d399' : '#fbbf24' }}>
                  {caps.sharedArrayBuffer && caps.crossOriginIsolated ? 'COOP/COEP Ativo' : 'Requer COOP/COEP'}
                </span>
              </div>
              <div className="stat-card">
                <strong>Sharded OPFS Cache</strong>
                <span style={{ color: caps.opfsSupported ? '#34d399' : '#fbbf24' }}>
                  {caps.opfsSupported ? 'Disponível (sem teto 2 GB)' : 'Fallback RAM LRU'}
                </span>
              </div>
              <div className="stat-card">
                <strong>WASM SIMD128 / JSPI</strong>
                <span>
                  SIMD: {caps.wasmSimdSupported ? 'Sim' : 'Não'} • JSPI: {caps.jspiSupported ? 'Sim' : 'Não'}
                </span>
              </div>
            </div>
          )}

          <div className="panel" style={{ background: 'var(--bg-0)' }}>
            <strong style={{ display: 'block', marginBottom: 6, fontSize: 14 }}>
              Montar ISO de PS2 via VGFA-Disc (Streaming por Chunks — Zero Cópia para RAM)
            </strong>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
              Carregue sua ISO local de <strong>{gameTitle}</strong> ou informe uma URL HTTP Range (passa pelo nosso proxy CORS-free <code>/api/proxy/stream</code>). O VGFA identifica <code>SYSTEM.CNF</code> e o Serial lendo apenas ~32 KiB.
            </p>

            <div className="input-row" style={{ marginBottom: 10 }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                📂 Escolher ISO / CHD Local
                <input
                  type="file"
                  accept=".iso,.bin,.chd,.cso,.zso"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void mountLocalIso(file);
                  }}
                />
              </label>
              <button className="btn btn-cyan" onClick={() => void runSyntheticBenchmark()}>
                Testar ISO PS2 Sintética ({expectedSerial || 'SLUS-21678'})
              </button>
            </div>

            <div className="input-row">
              <input
                className="field"
                placeholder="https://seu-servidor/jogo-ps2.iso (HTTP Range 206)"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <button
                className="btn"
                disabled={loading || !urlInput.trim()}
                onClick={() => void mountRemoteUrl(urlInput)}
              >
                {loading ? 'Lendo...' : 'Montar Streaming'}
              </button>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(251, 113, 133, 0.12)',
                  border: '1px solid rgba(251, 113, 133, 0.35)',
                  color: '#fda4af',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {isoMeta && metrics && (
            <div className="panel" style={{ background: 'var(--bg-0)', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
              <strong style={{ display: 'block', marginBottom: 10, fontSize: 14, color: 'var(--cyan)' }}>
                ✓ Disco Validado via VGFA-Disc • {isoMeta.detectedPlatform.toUpperCase()}
              </strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div className="stat-card">
                  <strong>Volume / Serial</strong>
                  <span className="mono">{isoMeta.serial ?? isoMeta.volumeId ?? 'N/A'}</span>
                </div>
                <div className="stat-card">
                  <strong>Região / Vídeo</strong>
                  <span className="mono">
                    {isoMeta.region ?? 'UNKNOWN'} • {isoMeta.videoMode ?? 'AUTO'}
                  </span>
                </div>
                <div className="stat-card">
                  <strong>Tamanho ISO vs Lido</strong>
                  <span className="mono">
                    {fmtSize(metrics.discSizeBytes)} → <strong>{fmtSize(metrics.bytesFromSource)}</strong>
                  </span>
                </div>
                <div className="stat-card">
                  <strong>Cache (L1 / OPFS)</strong>
                  <span className="mono">
                    L1: {metrics.l1RamHits} • OPFS: {metrics.l2OpfsHits} • {metrics.avgReadLatencyMs.toFixed(2)} ms
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
