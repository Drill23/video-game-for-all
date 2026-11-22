import { PAD_BIT, type ConsoleId, type ControllerLayoutProfile } from './types.js';

export const CONTROLLER_PROFILES: Record<ConsoleId, ControllerLayoutProfile> = {
  atari2600: {
    consoleId: 'atari2600',
    title: 'Atari CX40 Joystick',
    shellAccent: '#E86A17',
    dpadStyle: 'joystick',
    hasLeftStick: true,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [],
    faceButtons: [
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'FIRE', color: '#E03E2D', textColor: '#FFF' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#4B5563' },
      { bit: PAD_BIT.START, name: 'START', label: 'RESET', color: '#4B5563' },
    ],
  },
  nes: {
    consoleId: 'nes',
    title: 'NES Classic Pad',
    shellAccent: '#D92B2B',
    dpadStyle: 'cross',
    hasLeftStick: false,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [],
    faceButtons: [
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'B', color: '#DC2626', textColor: '#FFF' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: 'A', color: '#DC2626', textColor: '#FFF' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#374151' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#374151' },
    ],
  },
  snes: {
    consoleId: 'snes',
    title: 'Super Nintendo Pad',
    shellAccent: '#7C3AED',
    dpadStyle: 'cross',
    hasLeftStick: false,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L1, name: 'L1', label: 'L', color: '#4B5563' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R', color: '#4B5563' },
    ],
    faceButtons: [
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: 'X', color: '#3B82F6', textColor: '#FFF' },
      { bit: PAD_BIT.WEST, name: 'WEST', label: 'Y', color: '#22C55E', textColor: '#052E16' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: 'A', color: '#EF4444', textColor: '#FFF' },
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'B', color: '#EAB308', textColor: '#422006' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#374151' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#374151' },
    ],
  },
  megadrive: {
    consoleId: 'megadrive',
    title: 'Mega Drive 6-Button',
    shellAccent: '#2563EB',
    dpadStyle: 'cross',
    hasLeftStick: false,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L1, name: 'L1', label: 'X', color: '#374151' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'Z', color: '#374151' },
    ],
    faceButtons: [
      { bit: PAD_BIT.WEST, name: 'WEST', label: 'A', color: '#1F2937', textColor: '#F9FAFB' },
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'B', color: '#1F2937', textColor: '#F9FAFB' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: 'C', color: '#1F2937', textColor: '#F9FAFB' },
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: 'Y', color: '#374151', textColor: '#E5E7EB' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'MODE', color: '#374151' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#2563EB' },
    ],
  },
  gba: {
    consoleId: 'gba',
    title: 'Game Boy Advance',
    shellAccent: '#6366F1',
    dpadStyle: 'cross',
    hasLeftStick: false,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L1, name: 'L1', label: 'L', color: '#4B5563' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R', color: '#4B5563' },
    ],
    faceButtons: [
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'B', color: '#4F46E5', textColor: '#FFF' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: 'A', color: '#6366F1', textColor: '#FFF' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#374151' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#374151' },
    ],
  },
  n64: {
    consoleId: 'n64',
    title: 'Nintendo 64 Controller',
    shellAccent: '#10B981',
    dpadStyle: 'cross',
    hasLeftStick: true,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L2, name: 'L2', label: 'Z', color: '#4B5563' },
      { bit: PAD_BIT.L1, name: 'L1', label: 'L', color: '#374151' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R', color: '#374151' },
    ],
    faceButtons: [
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: 'A', color: '#2563EB', textColor: '#FFF' },
      { bit: PAD_BIT.WEST, name: 'WEST', label: 'B', color: '#16A34A', textColor: '#FFF' },
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: 'C▲', color: '#EAB308', textColor: '#1F2937' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: 'C▶', color: '#EAB308', textColor: '#1F2937' },
    ],
    centerButtons: [
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#DC2626' },
    ],
  },
  ps1: {
    consoleId: 'ps1',
    title: 'PlayStation DualShock',
    shellAccent: '#94A3B8',
    dpadStyle: 'segmented',
    hasLeftStick: true,
    hasRightStick: true,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L2, name: 'L2', label: 'L2', color: '#334155' },
      { bit: PAD_BIT.L1, name: 'L1', label: 'L1', color: '#475569' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R1', color: '#475569' },
      { bit: PAD_BIT.R2, name: 'R2', label: 'R2', color: '#334155' },
    ],
    faceButtons: [
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: '△', color: '#1E293B', textColor: '#34D399' },
      { bit: PAD_BIT.WEST, name: 'WEST', label: '□', color: '#1E293B', textColor: '#F472B6' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: '○', color: '#1E293B', textColor: '#F87171' },
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: '×', color: '#1E293B', textColor: '#60A5FA' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#334155' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#334155' },
    ],
  },
  psp: {
    consoleId: 'psp',
    title: 'PlayStation Portable',
    shellAccent: '#0EA5E9',
    dpadStyle: 'segmented',
    hasLeftStick: true,
    hasRightStick: false,
    hasPressureButtons: false,
    shoulders: [
      { bit: PAD_BIT.L1, name: 'L1', label: 'L', color: '#334155' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R', color: '#334155' },
    ],
    faceButtons: [
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: '△', color: '#1E293B', textColor: '#34D399' },
      { bit: PAD_BIT.WEST, name: 'WEST', label: '□', color: '#1E293B', textColor: '#F472B6' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: '○', color: '#1E293B', textColor: '#F87171' },
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: '×', color: '#1E293B', textColor: '#60A5FA' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#334155' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#334155' },
    ],
  },
  ps2: {
    consoleId: 'ps2',
    title: 'PlayStation 2 DualShock 2',
    shellAccent: '#3B82F6',
    dpadStyle: 'segmented',
    hasLeftStick: true,
    hasRightStick: true,
    hasPressureButtons: true,
    shoulders: [
      { bit: PAD_BIT.L2, name: 'L2', label: 'L2', color: '#1E293B' },
      { bit: PAD_BIT.L1, name: 'L1', label: 'L1', color: '#334155' },
      { bit: PAD_BIT.R1, name: 'R1', label: 'R1', color: '#334155' },
      { bit: PAD_BIT.R2, name: 'R2', label: 'R2', color: '#1E293B' },
    ],
    faceButtons: [
      { bit: PAD_BIT.NORTH, name: 'NORTH', label: '△', color: '#111827', textColor: '#34D399' },
      { bit: PAD_BIT.WEST, name: 'WEST', label: '□', color: '#111827', textColor: '#F472B6' },
      { bit: PAD_BIT.EAST, name: 'EAST', label: '○', color: '#111827', textColor: '#F87171' },
      { bit: PAD_BIT.SOUTH, name: 'SOUTH', label: '×', color: '#111827', textColor: '#60A5FA' },
    ],
    centerButtons: [
      { bit: PAD_BIT.SELECT, name: 'SELECT', label: 'SELECT', color: '#1E293B' },
      { bit: PAD_BIT.L3, name: 'L3', label: 'L3', color: '#1F2937' },
      { bit: PAD_BIT.R3, name: 'R3', label: 'R3', color: '#1F2937' },
      { bit: PAD_BIT.START, name: 'START', label: 'START', color: '#1E293B' },
    ],
  },
};

export function getControllerProfile(consoleId: ConsoleId): ControllerLayoutProfile {
  return CONTROLLER_PROFILES[consoleId];
}
