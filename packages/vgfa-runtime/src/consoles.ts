import type { ConsoleId } from '@vgfa/pad';

export type EngineTier = 'libretro-wasm' | 'emulatorjs-wasm' | 'vgfa-ps2-webgpu';

export interface ConsoleDefinition {
  id: ConsoleId;
  name: string;
  shortName: string;
  year: number;
  generation: string;
  accent: string;
  engineTier: EngineTier;
  /** Core verificado HTTP 200 no RetroArch WASM (nostalgist). */
  libretroCore?: string;
  /** Sistema verificado HTTP 200 no EmulatorJS CDN (stella2014, mupen64plus_next, ppsspp). */
  emulatorJsSystem?: string;
  extensions: string[];
  aspectRatio: string;
  supportsStreamingDisc: boolean;
}

export const CONSOLES: ConsoleDefinition[] = [
  {
    id: 'ps2',
    name: 'PlayStation 2',
    shortName: 'PlayStation 2',
    year: 2000,
    generation: '6ª Geração • WebGPU/WASM',
    accent: '#3B82F6',
    engineTier: 'vgfa-ps2-webgpu',
    extensions: ['.iso', '.chd', '.cso', '.zso', '.bin', '.elf'],
    aspectRatio: '16/9',
    supportsStreamingDisc: true,
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    shortName: 'PSP',
    year: 2004,
    generation: 'Portátil • PPSSPP WASM',
    accent: '#0EA5E9',
    engineTier: 'emulatorjs-wasm',
    emulatorJsSystem: 'psp',
    extensions: ['.iso', '.cso', '.pbp'],
    aspectRatio: '16/9',
    supportsStreamingDisc: true,
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
    emulatorJsSystem: 'psx',
    extensions: ['.cue', '.chd', '.pbp', '.iso', '.bin'],
    aspectRatio: '4/3',
    supportsStreamingDisc: true,
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    shortName: 'Nintendo 64',
    year: 1996,
    generation: '5ª Geração',
    accent: '#10B981',
    engineTier: 'emulatorjs-wasm',
    emulatorJsSystem: 'n64',
    extensions: ['.z64', '.n64', '.v64'],
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
    emulatorJsSystem: 'snes',
    extensions: ['.sfc', '.smc'],
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
    emulatorJsSystem: 'segaMD',
    extensions: ['.md', '.gen', '.smd', '.bin'],
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
    emulatorJsSystem: 'gba',
    extensions: ['.gba', '.gb', '.gbc'],
    aspectRatio: '3/2',
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
    emulatorJsSystem: 'nes',
    extensions: ['.nes', '.fds', '.unf'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
  },
  {
    id: 'atari2600',
    name: 'Atari 2600',
    shortName: 'Atari 2600',
    year: 1977,
    generation: '2ª Geração',
    accent: '#E86A17',
    engineTier: 'emulatorjs-wasm',
    emulatorJsSystem: 'atari2600',
    extensions: ['.a26', '.bin'],
    aspectRatio: '4/3',
    supportsStreamingDisc: false,
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
  if (lower.endsWith('.zso') || lower.endsWith('.elf')) return 'ps2';
  if (lower.endsWith('.cso') || lower.endsWith('.pbp')) return fallback === 'ps1' ? 'ps1' : 'psp';
  if (lower.endsWith('.iso') || lower.endsWith('.chd') || lower.endsWith('.cue')) {
    // Se o nome cita PS2 / PSP / PS1 explicitamente, respeita
    if (/ps2|playstation\s*2|slus[-_]?2|scus[-_]?97|sles[-_]?5/i.test(lower)) return 'ps2';
    if (/psp|ul[uej]s/i.test(lower)) return 'psp';
    if (/ps1|psx|slus[-_]?0/i.test(lower)) return 'ps1';
    return fallback;
  }
  return fallback;
}
