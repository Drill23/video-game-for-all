export type ConsoleId =
  | 'atari2600'
  | 'nes'
  | 'snes'
  | 'megadrive'
  | 'gba'
  | 'n64'
  | 'ps1'
  | 'psp'
  | 'ps2';

export const PAD_BIT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  SOUTH: 1 << 4, // Cross / B / A / Fire
  EAST: 1 << 5, // Circle / A / B
  WEST: 1 << 6, // Square / Y / X
  NORTH: 1 << 7, // Triangle / X / Y
  L1: 1 << 8,
  R1: 1 << 9,
  L2: 1 << 10,
  R2: 1 << 11,
  SELECT: 1 << 12,
  START: 1 << 13,
  L3: 1 << 14,
  R3: 1 << 15,
} as const;

export type PadButtonName = keyof typeof PAD_BIT;

export interface PadState {
  slot: number; // 0..3
  buttons: number; // uint16 bitmask
  lx: number; // -1..1
  ly: number; // -1..1
  rx: number; // -1..1
  ry: number; // -1..1
  l2Pressure: number; // 0..1
  r2Pressure: number; // 0..1
  crossPressure: number; // 0..1 (DualShock 2 acelerador)
  squarePressure: number; // 0..1 (DualShock 2 freio)
  seq: number;
}

export function createEmptyPadState(slot = 0): PadState {
  return {
    slot,
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    l2Pressure: 0,
    r2Pressure: 0,
    crossPressure: 0,
    squarePressure: 0,
    seq: 0,
  };
}

export interface ConnectedPadInfo {
  id: string;
  slot: number;
  kind: 'phone-webrtc' | 'phone-ws' | 'phone-relay' | 'bluetooth' | 'keyboard';
  label: string;
  latencyMs?: number;
  connectedAt: number;
}

export interface ButtonSpec {
  bit: number;
  name: PadButtonName;
  label: string;
  color: string;
  textColor?: string;
}

export interface ControllerLayoutProfile {
  consoleId: ConsoleId;
  title: string;
  shellAccent: string;
  dpadStyle: 'joystick' | 'cross' | 'segmented';
  hasLeftStick: boolean;
  hasRightStick: boolean;
  hasPressureButtons: boolean;
  shoulders: ButtonSpec[];
  faceButtons: ButtonSpec[];
  centerButtons: ButtonSpec[];
}

export interface RumbleCommand {
  slot: number;
  strong: number; // 0..1
  weak: number; // 0..1
  durationMs: number;
}
