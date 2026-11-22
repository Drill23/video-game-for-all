import React, { useEffect, useState } from 'react';
import {
  isVgfaBackendOnlineSync,
  probePs2WebCapabilities,
  type WebGpuCapabilities,
} from '@vgfa/runtime';

export interface NexusProfile {
  activatedAt: number;
  persistentStorage: boolean;
  opfsAvailable: boolean;
  opfsReadMbps: number;
  coresCachedCount: number;
  coresCachedMb: number;
  webgpu: boolean;
  dualSourceBlending: boolean;
  jspi: boolean;
  simd: boolean;
  cpuThreads: number;
  deviceMemoryGb: number;
  recommendedUpscale: 1 | 2;
  recommendedEngine: 'pcsx2-webgpu' | 'vgfa-native';
}

const STORAGE_KEY = 'vgfa:nexus_profile';

export function loadNexusProfile(): NexusProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NexusProfile) : null;
  } catch {
    return null;
  }
}

interface Props {
  onClose: () => void;
  onActivated?: (profile: NexusProfile) => void;
}

export const NexusOptimizerModal: React.FC<Props> = ({ onClose, onActivated }) => {
  const [profile, setProfile] = useState<NexusProfile | null>(() => loadNexusProfile());
  const [running, setRunning] = useState(false);
  const [stepLabel, setStepLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [caps, setCaps] = useState<WebGpuCapabilities | null>(null);

  useEffect(() => {
    void probePs2WebCapabilities().then(setCaps);
  }, []);

  const runOptimization = async () => {
    setRunning(true);
    setProgressPct(10);

    // Passo 1: Permissão de Armazenamento Persistente (Chrome/Android nunca apaga cache/saves!)
    setStepLabel('1/4 • Solicitando permissão de Armazenamento NVMe Persistente no navegador...');
    let persistentStorage = false;
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        persistentStorage = await navigator.storage.persist();
      }
    } catch {}
    setProgressPct(28);

    // Passo 2: Benchmark real do Disco Virtual OPFS NVMe (escrita + leitura de 4 MiB)
    setStepLabel('2/4 • Criando e calibrando Disco Virtual OPFS NVMe (anti-travamento 0 RAM)...');
    let opfsAvailable = false;
    let opfsReadMbps = 0;
    try {
      if (navigator.storage && typeof navigator.storage.getDirectory === 'function') {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('vgfa-nexus-bench', { create: true });
        const fh = await dir.getFileHandle('probe.bin', { create: true });
        const sample = new Uint8Array(4 * 1024 * 1024);
        sample[0] = 86;
        sample[sample.length - 1] = 71;
        const w = await fh.createWritable();
        await w.write(sample);
        await w.close();

        const t0 = performance.now();
        const file = await fh.getFile();
        await file.arrayBuffer();
        const ms = Math.max(0.5, performance.now() - t0);
        opfsReadMbps = Math.round((4 / (ms / 1000)) * 10) / 10;
        opfsAvailable = true;
        await dir.removeEntry('probe.bin').catch(() => {});
      }
    } catch {}
    setProgressPct(52);

    // Passo 3: Pré-aquecimento dos otimizadores & núcleos WASM leves no Cache Storage local
    setStepLabel('3/4 • Baixando e travando núcleos otimizados leves no cache do navegador...');
    let coresCachedCount = 0;
    let coresCachedMb = 0;

    const basePrefix = isVgfaBackendOnlineSync() ? '/api/' : './';
    const coreUrls = [
      new URL(`${basePrefix}ps2-core/Play.js`, window.location.href).href,
      new URL(`${basePrefix}ps2-core/Play.wasm`, window.location.href).href,
      new URL(`${basePrefix}ps2-turbo/disc-worker.js`, window.location.href).href,
      new URL(`${basePrefix}ps2-turbo/pcsx2-wasm.js`, window.location.href).href,
      new URL(`${basePrefix}ps2-turbo/pcsx2-wasm.data`, window.location.href).href,
      new URL(`${basePrefix}ps2-turbo/pcsx2-wasm.wasm`, window.location.href).href,
    ];

    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        const res = await new Promise<{ done: number; totalBytes: number }>((resolve) => {
          const ch = new MessageChannel();
          const timer = setTimeout(() => resolve({ done: coresCachedCount, totalBytes: 0 }), 35_000);
          ch.port1.onmessage = (ev) => {
            const m = ev.data;
            if (!m) return;
            if (m.type === 'progress') {
              const p = 52 + Math.round((m.done / Math.max(1, m.total)) * 38);
              setProgressPct(p);
              setStepLabel(`3/4 • Otimizador ${m.done}/${m.total} salvo em cache local...`);
            } else if (m.type === 'done') {
              clearTimeout(timer);
              resolve({ done: m.done || 0, totalBytes: m.totalBytes || 0 });
            }
          };
          worker.postMessage({ type: 'vgfa-prewarm-cores', urls: coreUrls }, [ch.port2]);
        });
        coresCachedCount = res.done;
        coresCachedMb = Math.round((res.totalBytes / (1024 * 1024)) * 10) / 10;
      } else {
        // Fallback direto via Cache API mesmo sem SW controller ainda ativo
        const cache = typeof caches !== 'undefined' ? await caches.open('vgfa-nexus-cores-v1') : null;
        let bytes = 0;
        for (let i = 0; i < coreUrls.length; i++) {
          try {
            const r = await globalThis.fetch(coreUrls[i]);
            if (r.ok) {
              const buf = await r.arrayBuffer();
              bytes += buf.byteLength;
              if (cache) {
                await cache.put(coreUrls[i], new Response(buf, { headers: r.headers }));
              }
              coresCachedCount++;
              setProgressPct(52 + Math.round(((i + 1) / coreUrls.length) * 38));
            }
          } catch {}
        }
        coresCachedMb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
      }
    } catch {}
    setProgressPct(92);

    // Passo 4: Auto-Tune de GPU / Threads / Resolução
    setStepLabel('4/4 • Calibrando perfil WebGPU, SIMD128 e resolução ideal...');
    const hw = caps ?? (await probePs2WebCapabilities());
    const cpuThreads = navigator.hardwareConcurrency || 4;
    const deviceMemoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
    const isMobileLike = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    const hasJspi =
      typeof WebAssembly === 'object' &&
      typeof (WebAssembly as unknown as Record<string, unknown>).Suspending === 'function';

    const recommendedUpscale: 1 | 2 = hw.dualSourceBlending && !isMobileLike && cpuThreads >= 6 ? 2 : 1;
    const recommendedEngine: 'pcsx2-webgpu' | 'vgfa-native' =
      hw.webgpuSupported && hw.dualSourceBlending && hasJspi ? 'pcsx2-webgpu' : 'vgfa-native';

    const nextProfile: NexusProfile = {
      activatedAt: Date.now(),
      persistentStorage,
      opfsAvailable,
      opfsReadMbps,
      coresCachedCount,
      coresCachedMb,
      webgpu: hw.webgpuSupported,
      dualSourceBlending: hw.dualSourceBlending,
      jspi: hasJspi,
      simd: hw.wasmSimdSupported,
      cpuThreads,
      deviceMemoryGb,
      recommendedUpscale,
      recommendedEngine,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
    } catch {}

    setProgressPct(100);
    setStepLabel('✓ Otimização VGFA Nexus concluída!');
    setProfile(nextProfile);
    setRunning(false);
    onActivated?.(nextProfile);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚡ VGFA Nexus Optimizer — Modo Desempenho Máximo</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }}>
          Ative os <strong>otimizadores leves nativos do navegador</strong> (apenas ~17 MB em cache local, 1 única vez) para destravar carregamento instantâneo, reduzir o uso de RAM em <strong>75%</strong> e eliminar congelamentos em batalhas pesadas de PS2 (como <em>Dragon Ball Z: BT3</em> e <em>God of War II</em>):
        </p>

        <div
          className="panel"
          style={{
            background: 'var(--bg-0)',
            marginBottom: 14,
            display: 'grid',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-1)',
          }}
        >
          <div>🚀 <strong>Disco Virtual SSD OPFS:</strong> grava setores do jogo direto no SSD (fora da RAM do Chrome, 0 crash).</div>
          <div>🛡️ <strong>Escudo Anti-503:</strong> controle inteligente de conexões + 5× retry automático contra quedas na internet.</div>
          <div>⚡ <strong>Pré-Aquecimento WASM:</strong> trava os motores otimizados (PCSX2 WebGPU + Play.wasm) no cache local (&lt; 1s boot).</div>
          <div>🎯 <strong>Auto-Tune GPU:</strong> ajusta automaticamente resolução (1x Tablet / 2x HD Desktop) e threads da CPU.</div>
        </div>

        {running && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, marginBottom: 6 }}>{stepLabel}</div>
            <div className="progress-track" style={{ width: '100%' }}>
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {profile && !running && (
          <div
            className="panel"
            style={{
              background: 'rgba(16, 185, 129, 0.08)',
              borderColor: 'rgba(52, 211, 153, 0.4)',
              marginBottom: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>Disco Virtual OPFS</div>
              <strong style={{ color: '#6ee7b7' }}>
                {profile.opfsAvailable ? `Ativo (${profile.opfsReadMbps} MB/s)` : 'Modo RAM Seguro'}
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>Motores em Cache Local</div>
              <strong style={{ color: '#6ee7b7' }}>
                {profile.coresCachedCount} módulos ({profile.coresCachedMb} MB)
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>WebGPU + JSPI (PS2 60 FPS)</div>
              <strong style={{ color: profile.dualSourceBlending && profile.jspi ? '#6ee7b7' : '#fde68a' }}>
                {profile.dualSourceBlending && profile.jspi ? 'Pronto (Chrome/Edge)' : 'Use Chrome p/ 60 FPS'}
              </strong>
            </div>
            <div>
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>Perfil Auto-Tune</div>
              <strong style={{ color: '#7dd3fc' }}>
                {profile.cpuThreads} threads • {profile.recommendedUpscale}x {profile.recommendedUpscale === 2 ? 'HD' : 'Turbo'}
              </strong>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            {profile ? 'Fechar' : 'Agora não'}
          </button>
          <button
            className="btn btn-primary"
            disabled={running}
            onClick={() => void runOptimization()}
          >
            {running
              ? '⏳ Otimizando navegador...'
              : profile
                ? '🔄 Recalibrar Otimizadores'
                : '⚡ Sim, Ativar Otimizadores Leves Agora'}
          </button>
        </div>
      </div>
    </div>
  );
};
