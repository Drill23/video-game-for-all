import React, { useEffect, useRef, useState } from 'react';
import { PAD_BIT, type PadState } from '@vgfa/pad';
import {
  buildProxyStreamUrl,
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
  romFilename?: string;
  externalPadState?: PadState | null;
  onIframeChange?: (el: HTMLIFrameElement | null) => void;
}

/** Mapeamento oficial do DualShock 2 no núcleo Play!.wasm (mesma origem) */
const PLAYJS_KEY_BINDINGS: Array<{ bit: number; key: string; code: string; keyCode: number }> = [
  { bit: PAD_BIT.UP, key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  { bit: PAD_BIT.DOWN, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  { bit: PAD_BIT.LEFT, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  { bit: PAD_BIT.RIGHT, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  { bit: PAD_BIT.SOUTH, key: 'z', code: 'KeyZ', keyCode: 90 }, // Cross
  { bit: PAD_BIT.EAST, key: 'x', code: 'KeyX', keyCode: 88 }, // Circle
  { bit: PAD_BIT.WEST, key: 'a', code: 'KeyA', keyCode: 65 }, // Square
  { bit: PAD_BIT.NORTH, key: 's', code: 'KeyS', keyCode: 83 }, // Triangle
  { bit: PAD_BIT.START, key: 'Enter', code: 'Enter', keyCode: 13 },
  { bit: PAD_BIT.SELECT, key: 'Backspace', code: 'Backspace', keyCode: 8 },
  { bit: PAD_BIT.L1, key: '1', code: 'Digit1', keyCode: 49 },
  { bit: PAD_BIT.L2, key: '2', code: 'Digit2', keyCode: 50 },
  { bit: PAD_BIT.L3, key: '3', code: 'Digit3', keyCode: 51 },
  { bit: PAD_BIT.R1, key: '8', code: 'Digit8', keyCode: 56 },
  { bit: PAD_BIT.R2, key: '9', code: 'Digit9', keyCode: 57 },
  { bit: PAD_BIT.R3, key: '0', code: 'Digit0', keyCode: 48 },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function hasSavedPs2Bios(): boolean {
  try {
    return localStorage.getItem('vgfa:has_ps2_bios') === '1';
  } catch {
    return false;
  }
}

export const Ps2LabPanel: React.FC<Props> = ({
  gameTitle = 'PlayStation 2',
  expectedSerial,
  initialFile,
  initialUrl,
  romFilename,
  externalPadState,
  onIframeChange,
}) => {
  const [caps, setCaps] = useState<WebGpuCapabilities | null>(null);
  // Se o usuário já salvou sua BIOS PS2 uma vez, abre direto no Modo Turbo 60 FPS!
  const [engineMode, setEngineMode] = useState<'vgfa-native' | 'pcsx2-webgpu' | 'disc'>(() =>
    hasSavedPs2Bios() ? 'pcsx2-webgpu' : 'vgfa-native',
  );
  const [activeFile, setActiveFile] = useState<File | null>(initialFile ?? null);
  const [activeUrl, setActiveUrl] = useState<string | null>(initialUrl ?? null);
  const [runnerKey, setRunnerKey] = useState(1);
  const [session, setSession] = useState<Ps2MountedSession | null>(null);
  const [metrics, setMetrics] = useState<DiscMetrics | null>(null);
  const [isoMeta, setIsoMeta] = useState<Iso9660Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const prevPadMaskRef = useRef(0);

  useEffect(() => {
    void probePs2WebCapabilities().then(setCaps);
  }, []);

  useEffect(() => {
    onIframeChange?.(engineMode === 'disc' ? null : iframeRef.current);
  }, [engineMode, runnerKey, onIframeChange]);

  // Valida metadados ISO-9660 em paralelo via @vgfa/disc
  useEffect(() => {
    let active = true;
    const validate = async () => {
      setError(null);
      try {
        await session?.dispose();
        if (activeFile) {
          const s = await mountPs2DiscSession({ kind: 'file', file: activeFile }, setMetrics);
          if (!active) return;
          setSession(s);
          setIsoMeta(s.metadata);
          setMetrics(await s.disc.getMetrics());
        } else if (activeUrl) {
          const s = await mountPs2DiscSession({ kind: 'url', url: activeUrl, name: romFilename }, setMetrics);
          if (!active) return;
          setSession(s);
          setIsoMeta(s.metadata);
          setMetrics(await s.disc.getMetrics());
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Não foi possível validar o disco PS2.');
        }
      }
    };
    if (activeFile || activeUrl) {
      void validate();
    }
    return () => {
      active = false;
    };
  }, [activeFile, activeUrl, romFilename]);

  // Envia automaticamente o disco (File local ou URL HTTP Range via VGFA Hyper-Stream) para o motor PS2 ativo!
  useEffect(() => {
    if (engineMode === 'disc') return;

    const sendBootToIframe = () => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      if (activeFile) {
        win.postMessage({ type: 'vgfa-ps2-boot', file: activeFile, filename: activeFile.name }, '*');
      } else if (activeUrl) {
        const proxyUrl = /^https?:\/\//i.test(activeUrl)
          ? buildProxyStreamUrl(activeUrl)
          : activeUrl;
        const cleanName =
          romFilename ||
          decodeURIComponent(activeUrl.split('/').pop()?.split('?')[0] || 'disc.iso');
        win.postMessage({ type: 'vgfa-ps2-boot', url: proxyUrl, filename: cleanName }, '*');
      }
    };

    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === 'vgfa-ps2-runner-ready') {
        sendBootToIframe();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [engineMode, activeFile, activeUrl, romFilename, runnerKey]);

  // Ponte em tempo real do Celular DualShock 2 / Bluetooth / VGFA-Cast -> motor PS2 ativo!
  useEffect(() => {
    if (!externalPadState || engineMode === 'disc') return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    // Motor Turbo (PCSX2 WebGPU) recebe estado analógico completo (25 entradas DualShock 2!)
    if (engineMode === 'pcsx2-webgpu') {
      win.postMessage({ type: 'vgfa-ps2-pad', state: externalPadState }, '*');
      return;
    }

    let mask = externalPadState.buttons;
    if (externalPadState.lx < -0.4) mask |= PAD_BIT.LEFT;
    if (externalPadState.lx > 0.4) mask |= PAD_BIT.RIGHT;
    if (externalPadState.ly < -0.4) mask |= PAD_BIT.UP;
    if (externalPadState.ly > 0.4) mask |= PAD_BIT.DOWN;

    const changed = mask ^ prevPadMaskRef.current;
    if (changed === 0) return;

    for (const bind of PLAYJS_KEY_BINDINGS) {
      if ((changed & bind.bit) === 0) continue;
      win.postMessage(
        {
          type: 'vgfa-ps2-key',
          key: bind.key,
          code: bind.code,
          keyCode: bind.keyCode,
          down: (mask & bind.bit) !== 0,
        },
        '*',
      );
    }
    prevPadMaskRef.current = mask;
  }, [externalPadState, engineMode]);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Barra de Modos PS2 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${engineMode === 'pcsx2-webgpu' ? 'btn-primary' : 'btn-cyan'}`}
            onClick={() => {
              setEngineMode('pcsx2-webgpu');
              setRunnerKey((k) => k + 1);
            }}
          >
            ⚡ VGFA-PS2 Turbo 60 FPS (WebGPU + Hyper-Stream)
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'vgfa-native' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setEngineMode('vgfa-native');
              setRunnerKey((k) => k + 1);
            }}
          >
            🚀 Instantâneo Sem BIOS (Play.wasm)
          </button>
          <button
            className={`btn btn-sm ${engineMode === 'disc' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setEngineMode('disc')}
          >
            ⚙️ Diagnóstico ({expectedSerial || 'PS2'})
          </button>
        </div>

        <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
          📂 Trocar ISO Local
          <input
            type="file"
            accept=".iso,.bin,.chd,.cso,.zso,.elf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setActiveUrl(null);
                setActiveFile(f);
                setRunnerKey((k) => k + 1);
              }
            }}
          />
        </label>
      </div>

      {/* Aviso útil quando rodando no modo Sem BIOS ou no Safari */}
      {engineMode === 'vgfa-native' && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            color: '#bae6fd',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            💡 <strong>Quer jogar em 50–60 FPS fluídos sem travar?</strong> O modo Sem BIOS é ótimo para teste rápido, mas o{' '}
            <strong>VGFA-PS2 Turbo WebGPU</strong> usa GPU real no <strong>Chrome / Edge</strong> + Hyper-Stream NVMe!
          </span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setEngineMode('pcsx2-webgpu');
              setRunnerKey((k) => k + 1);
            }}
          >
            ⚡ Ativar Turbo 60 FPS
          </button>
        </div>
      )}

      {caps && !caps.dualSourceBlending && engineMode === 'pcsx2-webgpu' && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(255, 181, 71, 0.12)',
            border: '1px solid rgba(255, 181, 71, 0.38)',
            color: '#fde68a',
            fontSize: 12,
          }}
        >
          ⚠️ Você está em um navegador sem <strong>WebGPU Dual-Source Blending / JSPI</strong> (como Safari). Abra este mesmo endereço no{' '}
          <strong>Google Chrome ou Microsoft Edge</strong> para destravar aceleração de GPU em <strong>50–60 FPS</strong>!
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
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(52, 211, 153, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            color: '#a7f3d0',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            ✓ Disco PS2 montado: <strong>{isoMeta.serial || isoMeta.volumeId || gameTitle}</strong>
            {isoMeta.region && isoMeta.region !== 'UNKNOWN' ? ` (${isoMeta.region})` : ''}
          </span>
          <span className="mono">
            {fmtSize(metrics.discSizeBytes)} • VGFA Hyper-Stream NVMe 2 MiB + Prefetch 4x
          </span>
        </div>
      )}

      {/* MOTOR 1: VGFA-PS2 TURBO WEBGPU (PCSX2 WASM JIT + WebGPU HW 60 FPS + VGFA Hyper-Stream + Celular Analógico!) */}
      {engineMode === 'pcsx2-webgpu' && (
        <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid var(--glass-border)', background: '#000' }}>
          <iframe
            key={`turbo-${runnerKey}`}
            ref={(el) => {
              iframeRef.current = el;
              onIframeChange?.(el);
            }}
            title="VGFA PS2 Turbo WebGPU 60 FPS"
            src={`${import.meta.env.BASE_URL}ps2-turbo-runner.html`}
            style={{ width: '100%', height: 560, border: 'none', display: 'block', background: '#000' }}
            allow="gamepad *; fullscreen *; autoplay *"
          />
        </div>
      )}

      {/* MOTOR 2: VGFA-PS2 INSTANTÂNEO (Sem BIOS — Play.wasm + OPFS Virtual SSD Anti-503) */}
      {engineMode === 'vgfa-native' && (
        <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid var(--glass-border)', background: '#000' }}>
          <iframe
            key={`play-${runnerKey}`}
            ref={(el) => {
              iframeRef.current = el;
              onIframeChange?.(el);
            }}
            title="VGFA PlayStation 2 Instant Engine"
            src={`${import.meta.env.BASE_URL}ps2-runner.html`}
            style={{ width: '100%', height: 560, border: 'none', display: 'block', background: '#000' }}
            allow="gamepad *; fullscreen *; autoplay *"
          />
        </div>
      )}

      {/* Diagnóstico Técnico */}
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
              <strong>SharedArrayBuffer (COOP/COEP)</strong>
              <span style={{ color: caps.sharedArrayBuffer && caps.crossOriginIsolated ? '#34d399' : '#fbbf24' }}>
                {caps.sharedArrayBuffer && caps.crossOriginIsolated ? 'Ativo' : 'Requer Cmd+Shift+R'}
              </span>
            </div>
            <div className="stat-card">
              <strong>Dual-Source Blending (PS2 HW)</strong>
              <span style={{ color: caps.dualSourceBlending ? '#34d399' : '#fbbf24' }}>
                {caps.dualSourceBlending ? 'Sim (Chrome/Edge)' : 'Não no Safari (use Chrome p/ 60 FPS)'}
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
