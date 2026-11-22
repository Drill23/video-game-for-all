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
  initialFile?: File | null;
  initialUrl?: string | null;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const Ps2LabPanel: React.FC<Props> = ({ initialFile, initialUrl }) => {
  const [caps, setCaps] = useState<WebGpuCapabilities | null>(null);
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
      setError(err instanceof Error ? err.message : 'Falha ao abrir streaming HTTP Range.');
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

      const cnf = new TextEncoder().encode(
        'BOOT2 = cdrom0:\\SLUS_209.46;1\r\nVER = 1.03\r\nVMODE = NTSC\r\n',
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
      // Simula leituras aleatórias + sequenciais
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
      {/* Hardware Readiness */}
      <div className="panel" style={{ background: 'var(--bg-0)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15 }}>VGFA-PS2 / PSP WebGPU + WASM Diagnostics</strong>
          <span className="badge" style={{ color: (caps?.readinessScore ?? 0) >= 60 ? '#34d399' : '#fbbf24' }}>
            Prontidão: {caps?.readinessScore ?? 0}%
          </span>
        </div>

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
      </div>

      {/* Disc Mounting Controls */}
      <div className="panel" style={{ background: 'var(--bg-0)' }}>
        <strong style={{ display: 'block', marginBottom: 6, fontSize: 14 }}>
          1. Montar ISO de PS2 / PSP no Motor VGFA-Disc (Zero Cópia para RAM)
        </strong>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Selecione uma ISO local (ex.: 4,5 GB) ou informe uma URL HTTP Range / WebSeed. O <code>@vgfa/disc</code> lê apenas ~32 KiB do disco para extrair <code>SYSTEM.CNF</code>, Serial e Região sem travar a memória.
        </p>

        <div className="input-row" style={{ marginBottom: 10 }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Escolher ISO / CHD Local
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
            Testar ISO PS2 Sintética (Demo)
          </button>
        </div>

        <div className="input-row">
          <input
            className="field"
            placeholder="https://seu-servidor/ps2-disc.iso (suporte a HTTP 206 Range)"
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

        {error && <div style={{ marginTop: 10, color: '#fb7185', fontSize: 12 }}>{error}</div>}
      </div>

      {/* Live ISO Metadata + VGFA-Disc Telemetry */}
      {isoMeta && metrics && (
        <div className="panel" style={{ background: 'var(--bg-0)', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
          <strong style={{ display: 'block', marginBottom: 10, fontSize: 14, color: 'var(--cyan)' }}>
            Disco Montado via VGFA-Disc • {isoMeta.detectedPlatform.toUpperCase()}
          </strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <div className="stat-card">
              <strong>Volume / Serial</strong>
              <span className="mono">{isoMeta.serial ?? isoMeta.volumeId ?? 'N/A'}</span>
            </div>
            <div className="stat-card">
              <strong>Boot ELF / Região</strong>
              <span className="mono">
                {isoMeta.region ?? 'UNKNOWN'} • {isoMeta.videoMode ?? 'AUTO'}
              </span>
            </div>
            <div className="stat-card">
              <strong>Tamanho ISO vs Baixado</strong>
              <span className="mono">
                {fmtSize(metrics.discSizeBytes)} → <strong>{fmtSize(metrics.bytesFromSource)}</strong>
              </span>
            </div>
            <div className="stat-card">
              <strong>Cache Hits (L1 / L2 OPFS)</strong>
              <span className="mono">
                L1: {metrics.l1RamHits} • OPFS: {metrics.l2OpfsHits} • {metrics.avgReadLatencyMs.toFixed(2)} ms
              </span>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
            <strong>Próximo passo para boot gráfico AOT em 60 FPS:</strong> execute{' '}
            <code className="mono">scripts/vgfa-ps2-recomp-pipeline.sh meu-jogo /caminho/disc.iso</code>{' '}
            para compilar o executável Emotion Engine via base MIT (<code>ps2-web-recomp</code>) para WebAssembly + WebGPU acoplado ao nosso drive <code>@vgfa/disc</code> e ao controle DualShock 2 via QR Code.
          </div>
        </div>
      )}
    </div>
  );
};
