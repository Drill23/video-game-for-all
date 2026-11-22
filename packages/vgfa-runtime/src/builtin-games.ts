import type { ConsoleId } from '@vgfa/pad';

export type GameLaunchMode = 'builtin-arcade' | 'libretro-rom' | 'ps2-webgpu-lab';

export interface CatalogGame {
  id: string;
  title: string;
  consoleId: ConsoleId;
  year: number;
  genre: string;
  players: string;
  mode: GameLaunchMode;
  builtinVariant?: 'star-drift' | 'cyber-runner' | 'apex-circuit' | 'neon-arena';
  taglinePt: string;
  taglineEn: string;
  taglineEs: string;
  gradient: [string, string];
  badge: string;
  sizeLabel: string;
  romUrl?: string;
}

/**
 * Jogos leves embutidos no próprio VGFA (100% código próprio/livre — zero risco de DMCA),
 * prontos para jogar em 1 clique no navegador e testar o Controle pelo Celular + Bluetooth
 * + Save State em IndexedDB em todos os consoles (Atari até DualShock 2 do PS2).
 */
export const BUILTIN_CATALOG: CatalogGame[] = [
  {
    id: 'star-drift-2600',
    title: 'Star Drift 2600',
    consoleId: 'atari2600',
    year: 1981,
    genre: 'Arcade / Shooter',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'star-drift',
    taglinePt: 'Clássico espacial retrô 8-bit com ondas de inimigos, chefe e controle Atari CX40.',
    taglineEn: 'Retro 8-bit space shooter with enemy waves, boss fights, and Atari CX40 controls.',
    taglineEs: 'Clásico espacial retro de 8 bits con oleadas, jefe y control Atari CX40.',
    gradient: ['#E86A17', '#7C2D12'],
    badge: 'Embutido • 60 FPS',
    sizeLabel: '18 KB',
  },
  {
    id: 'cyber-runner-nes',
    title: 'Cyber Runner 8-Bit',
    consoleId: 'nes',
    year: 1987,
    genre: 'Plataforma / Ação',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'cyber-runner',
    taglinePt: 'Plataforma ágil estilo Nintendinho com pulo duplo, moedas de energia e chefes.',
    taglineEn: 'Fast-paced NES-style platformer with double jump, energy coins, and hazards.',
    taglineEs: 'Plataformas ágil estilo NES con doble salto, monedas de energía y obstáculos.',
    gradient: ['#DC2626', '#7F1D1D'],
    badge: 'Embutido • 60 FPS',
    sizeLabel: '22 KB',
  },
  {
    id: 'apex-circuit-snes',
    title: 'Apex Circuit 16',
    consoleId: 'snes',
    year: 1993,
    genre: 'Corrida / Mode 7',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'apex-circuit',
    taglinePt: 'Corrida pseudo-3D inspirada em Top Gear/OutRun com curvas, turbo L/R e placar.',
    taglineEn: 'Pseudo-3D racer inspired by Top Gear/OutRun with curves, L/R turbo, and lap times.',
    taglineEs: 'Carreras pseudo-3D inspiradas en Top Gear/OutRun con curvas, turbo L/R y vueltas.',
    gradient: ['#7C3AED', '#312E81'],
    badge: 'Embutido • 60 FPS',
    sizeLabel: '28 KB',
  },
  {
    id: 'sonic-pulse-md',
    title: 'Turbo Pulse 16-Bit',
    consoleId: 'megadrive',
    year: 1991,
    genre: 'Corrida / Alta Velocidade',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'apex-circuit',
    taglinePt: 'Velocidade 16-bit com layout Mega Drive 6-botões, nitro e vibração háptica.',
    taglineEn: '16-bit high-speed racer tuned for Mega Drive 6-button layout and haptics.',
    taglineEs: 'Velocidad de 16 bits con control Mega Drive de 6 botones y vibración háptica.',
    gradient: ['#2563EB', '#1E3A8A'],
    badge: 'Embutido • 60 FPS',
    sizeLabel: '28 KB',
  },
  {
    id: 'neon-arena-ps1',
    title: 'Vector Strike PS1',
    consoleId: 'ps1',
    year: 1997,
    genre: 'Arena 3D / Twin-Stick',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'neon-arena',
    taglinePt: 'Arena vetorial retrô para testar os dois analógicos do PlayStation DualShock.',
    taglineEn: 'Retro vector arena built to test both PlayStation DualShock analog sticks.',
    taglineEs: 'Arena vectorial retro para probar los dos analógicos del PlayStation DualShock.',
    gradient: ['#475569', '#0F172A'],
    badge: 'Embutido • DualShock',
    sizeLabel: '34 KB',
  },
  {
    id: 'neon-arena-ps2',
    title: 'DualShock 2 Arena • WebGPU Lab',
    consoleId: 'ps2',
    year: 2004,
    genre: 'Ação 3D / Teste DualShock 2',
    players: '1P',
    mode: 'builtin-arcade',
    builtinVariant: 'neon-arena',
    taglinePt: 'Testa analógicos L/R, gatilhos sensíveis à pressão L2/R2 e vibração do PS2 no celular.',
    taglineEn: 'Tests dual analog sticks, pressure-sensitive L2/R2 triggers, and PS2 rumble on your phone.',
    taglineEs: 'Prueba analógicos L/R, gatillos sensibles a presión L2/R2 y vibración PS2 en tu móvil.',
    gradient: ['#2563EB', '#0C4A6E'],
    badge: 'PS2 DualShock 2 • Embutido',
    sizeLabel: '36 KB',
  },
  {
    id: 'vgfa-ps2-disc-lab',
    title: 'VGFA-PS2 / PSP Streaming Engine',
    consoleId: 'ps2',
    year: 2026,
    genre: 'Motor WebGPU + WASM + P2P',
    players: '1P–4P',
    mode: 'ps2-webgpu-lab',
    taglinePt: 'Carregue sua ISO de PS2/PSP (local, HTTP Range ou WebTorrent P2P) sem estourar a RAM.',
    taglineEn: 'Stream your PS2/PSP ISO (local, HTTP Range, or WebTorrent P2P) with OPFS chunk cache.',
    taglineEs: 'Transmite tu ISO de PS2/PSP (local, HTTP Range o WebTorrent P2P) con caché OPFS.',
    gradient: ['#0EA5E9', '#1E1B4B'],
    badge: 'WebGPU + VGFA-Disc',
    sizeLabel: 'Streaming',
  },
];
