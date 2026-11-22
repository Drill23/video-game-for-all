import type { ConsoleId } from '@vgfa/pad';

export type EngineTier = 'libretro-wasm' | 'vgfa-psp-wasm' | 'vgfa-ps2-webgpu';

export interface ConsoleDefinition {
  id: ConsoleId;
  name: string;
  shortName: string;
  year: number;
  generation: string;
  accent: string;
  engineTier: EngineTier;
  libretroCore?: string;
  extensions: string[];
  aspectRatio: string;
  supportsStreamingDisc: boolean;
}

export const CONSOLES: ConsoleDefinition[] = [
  {
    id: 'atari2600',
    name: 'Atari 2600',
    shortName: 'Atari',
    year: 1977,
    generation: '2ª Geração',
    accent: '#E86A17',
    engineTier: 'libretro-wasm',
    libretroCore: 'stella2014',
    extensions: ['.a26', '.bin'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'nes',
    name: 'Nintendo (NES)',
    shortName: 'NES',
    year: 1983,
    generation: '3ª Geração',
    accent: '#DC2626',
    engineTier: 'libretro-wasm',
    libretroCore: 'fceumm',
    extensions: ['.nes', '.fds', '.unf'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'megadrive',
    name: 'Mega Drive / Genesis',
    shortName: 'Mega Drive',
    year: 1988,
    generation: '4ª Geração',
    accent: '#2563EB',
    engineTier: 'libretro-wasm',
    libretroCore: 'genesis_plus_gx',
    extensions: ['.md', '.gen', '.smd'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'snes',
    name: 'Super Nintendo (SNES)',
    shortName: 'SNES',
    year: 1990,
    generation: '4ª Geração',
    accent: '#7C3AED',
    engineTier: 'libretro-wasm',
    libretroCore: 'snes9x',
    extensions: ['.sfc', '.smc'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'ps1',
    name: 'PlayStation 1',
    shortName: 'PS1',
    year: 1994,
    generation: '5ª Geração',
    accent: '#94A3B8',
    engineTier: 'libretro-wasm',
    libretroCore: 'pcsx_rearmed',
    extensions: ['.cue', '.chd', '.pbp', '.iso'],
    aspectRatio: '4/3',
    supportsStreamingDisc: true,
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    shortName: 'N64',
    year: 1996,
    generation: '5ª Geração',
    accent: '#10B981',
    engineTier: 'libretro-wasm',
    libretroCore: 'mupen64plus_next',
    extensions: ['.z64', '.n64', '.v64'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    shortName: 'GBA',
    year: 2001,
    generation: 'Portátil 32-bit',
    accent: '#6366F1',
    engineTier: 'libretro-wasm',
    libretroCore: 'mgba',
    extensions: ['.gba', '.gb', '.gbc'],
    aspectRatio: '3/2',
    supportsStreamingDisc: false,
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    shortName: 'PSP',
    year: 2004,
    generation: 'Portátil 6ª/7ª Gen',
    accent: '#0EA5E9',
    engineTier: 'vgfa-psp-wasm',
    extensions: ['.iso', '.cso', '.pbp'],
    aspectRatio: '16/9',
    supportsStreamingDisc: true,
  },
  {
    id: 'ps2',
    name: 'PlayStation 2',
    shortName: 'PS2',
    year: 2000,
    generation: '6ª Geração — WebGPU/WASM',
    accent: '#3B82F6',
    engineTier: 'vgfa-ps2-webgpu',
    extensions: ['.iso', '.chd', '.cso', '.zso', '.bin'],
    aspectRatio: '16/9',
    supportsStreamingDisc: true,
  },
];

export const CONSOLE_MAP: Record<ConsoleId, ConsoleDefinition> = Object.fromEntries(
  CONSOLES.map((c) => [c.id, c]),
) as Record<ConsoleId, ConsoleDefinition>;

export function detectConsoleFromFilename(filename: string, fallback: ConsoleId = 'snes'): ConsoleId {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.a26')) return 'atari2600';
  if (lower.endsWith('.nes') || lower.endsWith('.fds')) return 'nes';
  if (lower.endsWith('.sfc') || lower.endsWith('.smc')) return 'snes';
  if (lower.endsWith('.md') || lower.endsWith('.gen') || lower.endsWith('.smd')) return 'megadrive';
  if (lower.endsWith('.gba') || lower.endsWith('.gb') || lower.endsWith('.gbc')) return 'gba';
  if (lower.endsWith('.z64') || lower.endsWith('.n64') || lower.endsWith('.v64')) return 'n64';
  if (lower.endsWith('.cso') || lower.endsWith('.zso')) return 'ps2';
  if (lower.endsWith('.iso') || lower.endsWith('.chd') || lower.endsWith('.cue')) return fallback;
  return fallback;
}
