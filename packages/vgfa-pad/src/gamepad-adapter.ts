import {
  PAD_BIT,
  createEmptyPadState,
  type ConnectedPadInfo,
  type PadButtonName,
  type PadState,
  type RumbleCommand,
} from './types.js';

/**
 * VGFA Universal Gamepad (v0.8)
 *
 * Lê QUALQUER controle que o navegador enxergue (Bluetooth/USB) — 8BitDo em todos os modos,
 * Xbox, DualShock 4, DualSense, Switch Pro, Joy-Con, MFi, genéricos HID e controles de TV.
 *
 * Por que o 8BitDo "conectava e não funcionava":
 *  1. Em modo D-input/macOS o navegador entrega o mapeamento "não padrão": botões em outra ordem
 *     e o direcional como um eixo "hat" (valores -1…1 em 8 passos), que era ignorado.
 *  2. O jogo só lia o controle da posição 0 da lista do navegador; se o 8BitDo caía na posição 1
 *     (muito comum no Mac/Windows), ninguém lia.
 * Agora: perfis por fabricante + detecção automática do direcional + mapeamento manual salvo por
 * controle + jogadores atribuídos na ordem em que cada controle aperta o primeiro botão.
 */

const DEADZONE = 0.16;

function applyDeadzone(v: number): number {
  if (!Number.isFinite(v) || Math.abs(v) < DEADZONE) return 0;
  return Math.max(-1, Math.min(1, (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE)));
}

/** Origem física de um botão lógico. */
export type PadInputSource =
  | { type: 'button'; index: number }
  | { type: 'axis'; index: number; dir: 1 | -1 }
  | { type: 'hat'; index: number; dir: 'up' | 'down' | 'left' | 'right' };

export interface PadAxisSource {
  index: number;
  invert?: boolean;
}

export interface GamepadBinding {
  buttons: Partial<Record<PadButtonName, PadInputSource>>;
  axes?: { lx?: PadAxisSource; ly?: PadAxisSource; rx?: PadAxisSource; ry?: PadAxisSource };
  /** Também lê eixos/hat de direcional automaticamente (padrão: true). */
  autoDpad?: boolean;
}

export type GamepadMappingKind = 'standard' | 'profile' | 'custom' | 'generic';

export interface GamepadDescriptor {
  key: string;
  index: number;
  id: string;
  name: string;
  vendor?: string;
  product?: string;
  mapping: GamepadMappingKind;
  profileName: string;
  slot: number;
}

const BTN = (index: number): PadInputSource => ({ type: 'button', index });

/** Mapeamento W3C "standard" (Chrome/Edge/Safari reconhecem a maioria dos controles assim). */
const STANDARD_BINDING: GamepadBinding = {
  buttons: {
    SOUTH: BTN(0),
    EAST: BTN(1),
    WEST: BTN(2),
    NORTH: BTN(3),
    L1: BTN(4),
    R1: BTN(5),
    L2: BTN(6),
    R2: BTN(7),
    SELECT: BTN(8),
    START: BTN(9),
    L3: BTN(10),
    R3: BTN(11),
    UP: BTN(12),
    DOWN: BTN(13),
    LEFT: BTN(14),
    RIGHT: BTN(15),
  },
  axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: 3 } },
  autoDpad: true,
};

/** Perfis "não padrão" conhecidos (vendor:product em hex minúsculo; '*' = qualquer produto). */
const KNOWN_PROFILES: Array<{ match: (v: string, p: string, id: string) => boolean; name: string; binding: GamepadBinding }> = [
  {
    // 8BitDo em D-input / modo macOS (SN30 Pro, Pro 2, Ultimate, Lite, M30…): layout Nintendo
    name: '8BitDo (D-input)',
    match: (v, _p, id) => v === '2dc8' || /8bitdo/i.test(id),
    binding: {
      buttons: {
        EAST: BTN(0), // A (direita)
        SOUTH: BTN(1), // B (baixo)
        NORTH: BTN(3), // X (cima)
        WEST: BTN(4), // Y (esquerda)
        L1: BTN(6),
        R1: BTN(7),
        L2: BTN(8),
        R2: BTN(9),
        SELECT: BTN(10),
        START: BTN(11),
        L3: BTN(13),
        R3: BTN(14),
      },
      axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: 5 } },
      autoDpad: true,
    },
  },
  {
    // Switch Pro / Joy-Con em navegadores sem mapeamento padrão
    name: 'Nintendo Switch',
    match: (v) => v === '057e',
    binding: {
      buttons: {
        SOUTH: BTN(0), // B
        EAST: BTN(1), // A
        WEST: BTN(2), // Y
        NORTH: BTN(3), // X
        L1: BTN(4),
        R1: BTN(5),
        L2: BTN(6),
        R2: BTN(7),
        SELECT: BTN(8),
        START: BTN(9),
        L3: BTN(10),
        R3: BTN(11),
      },
      axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: 3 } },
      autoDpad: true,
    },
  },
  {
    // DualShock 4 / DualSense sem mapeamento padrão (Firefox, Safari antigo)
    name: 'PlayStation',
    match: (v) => v === '054c',
    binding: {
      buttons: {
        WEST: BTN(0), // Quadrado
        SOUTH: BTN(1), // X
        EAST: BTN(2), // Círculo
        NORTH: BTN(3), // Triângulo
        L1: BTN(4),
        R1: BTN(5),
        L2: BTN(6),
        R2: BTN(7),
        SELECT: BTN(8),
        START: BTN(9),
        L3: BTN(10),
        R3: BTN(11),
      },
      axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: 5 } },
      autoDpad: true,
    },
  },
  {
    // Xbox (360/One/Series) sem mapeamento padrão (Firefox no macOS/Linux)
    name: 'Xbox',
    match: (v) => v === '045e' || v === '0e6f' || v === '24c6',
    binding: {
      buttons: {
        SOUTH: BTN(0),
        EAST: BTN(1),
        WEST: BTN(2),
        NORTH: BTN(3),
        L1: BTN(4),
        R1: BTN(5),
        SELECT: BTN(6),
        START: BTN(7),
        L3: BTN(9),
        R3: BTN(10),
      },
      axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 3 }, ry: { index: 4 } },
      autoDpad: true,
    },
  },
];

/** Genérico HID (a maioria dos controles chineses/D-input): ordem mais comum. */
const GENERIC_BINDING: GamepadBinding = {
  buttons: {
    SOUTH: BTN(0),
    EAST: BTN(1),
    WEST: BTN(2),
    NORTH: BTN(3),
    L1: BTN(4),
    R1: BTN(5),
    L2: BTN(6),
    R2: BTN(7),
    SELECT: BTN(8),
    START: BTN(9),
    L3: BTN(10),
    R3: BTN(11),
    UP: BTN(12),
    DOWN: BTN(13),
    LEFT: BTN(14),
    RIGHT: BTN(15),
  },
  axes: { lx: { index: 0 }, ly: { index: 1 }, rx: { index: 2 }, ry: { index: 3 } },
  autoDpad: true,
};

/** Extrai vendor/product do id que cada navegador formata de um jeito. */
export function parseGamepadId(id: string): { vendor?: string; product?: string; name: string } {
  let vendor: string | undefined;
  let product: string | undefined;
  const chrome = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id);
  const firefox = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (chrome) {
    vendor = chrome[1].toLowerCase();
    product = chrome[2].toLowerCase();
  } else if (firefox) {
    vendor = firefox[1].toLowerCase().padStart(4, '0');
    product = firefox[2].toLowerCase().padStart(4, '0');
  }
  const name =
    id
      .replace(/\(STANDARD GAMEPAD.*?\)/i, '')
      .replace(/\(?Vendor:.*?Product:\s*[0-9a-f]{4}\)?/i, '')
      .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Controle';
  return { vendor, product, name };
}

function bindingStorageKey(id: string): string {
  const { vendor, product, name } = parseGamepadId(id);
  return `vgfa:pad-map:${vendor && product ? `${vendor}:${product}` : name.toLowerCase().slice(0, 60)}`;
}

export function loadCustomBinding(id: string): GamepadBinding | null {
  try {
    const raw = localStorage.getItem(bindingStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GamepadBinding;
    return parsed && typeof parsed === 'object' && parsed.buttons ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCustomBinding(id: string, binding: GamepadBinding | null): void {
  try {
    if (binding) localStorage.setItem(bindingStorageKey(id), JSON.stringify(binding));
    else localStorage.removeItem(bindingStorageKey(id));
  } catch {
    // modo privado
  }
}

/** Valor de eixo "hat" (direcional em 1 eixo): 8 posições de -1 a 1; neutro > 1. */
export function decodeHat(v: number): number {
  if (!Number.isFinite(v) || v > 1.05 || v < -1.05) return 0;
  const pos = Math.round(((v + 1) * 7) / 2);
  if (Math.abs(-1 + (pos * 2) / 7 - v) > 0.12) return 0;
  switch (pos) {
    case 0:
      return PAD_BIT.UP;
    case 1:
      return PAD_BIT.UP | PAD_BIT.RIGHT;
    case 2:
      return PAD_BIT.RIGHT;
    case 3:
      return PAD_BIT.DOWN | PAD_BIT.RIGHT;
    case 4:
      return PAD_BIT.DOWN;
    case 5:
      return PAD_BIT.DOWN | PAD_BIT.LEFT;
    case 6:
      return PAD_BIT.LEFT;
    case 7:
      return PAD_BIT.UP | PAD_BIT.LEFT;
    default:
      return 0;
  }
}

function isHatNeutral(v: number): boolean {
  return v > 1.05 && v < 3.5;
}

interface PadMemory {
  hatAxes: Set<number>;
  dpadAxisPairs: Array<[number, number]>;
  activatedAt: number;
}

function readSource(gp: Gamepad, src: PadInputSource | undefined): number {
  if (!src) return 0;
  if (src.type === 'button') {
    const b = gp.buttons[src.index];
    if (!b) return 0;
    return b.pressed ? Math.max(b.value, 1) : b.value > 0.5 ? b.value : 0;
  }
  if (src.type === 'axis') {
    const v = gp.axes[src.index] ?? 0;
    return v * src.dir > 0.5 ? 1 : 0;
  }
  const bits = decodeHat(gp.axes[src.index] ?? 9);
  const want =
    src.dir === 'up' ? PAD_BIT.UP : src.dir === 'down' ? PAD_BIT.DOWN : src.dir === 'left' ? PAD_BIT.LEFT : PAD_BIT.RIGHT;
  return bits & want ? 1 : 0;
}

function readAxis(gp: Gamepad, src: PadAxisSource | undefined): number {
  if (!src) return 0;
  const v = gp.axes[src.index];
  if (v === undefined || !Number.isFinite(v) || Math.abs(v) > 1.05) return 0;
  return applyDeadzone(src.invert ? -v : v);
}

/**
 * Leitor universal de controles. Mantém o nome antigo por compatibilidade.
 */
export class BluetoothGamepadAdapter {
  private seq = 0;
  /** chaves dos controles na ordem em que apertaram o primeiro botão (P1, P2…) */
  private order: string[] = [];
  private readonly memory = new Map<string, PadMemory>();
  private customCache = new Map<string, GamepadBinding | null>();

  private static keyOf(gp: Gamepad): string {
    return `${gp.index}:${gp.id}`;
  }

  private static pads(): Gamepad[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    let list: (Gamepad | null)[] = [];
    try {
      list = Array.from(navigator.getGamepads() || []);
    } catch {
      return [];
    }
    return list.filter((g): g is Gamepad => !!g && g.connected !== false);
  }

  /** Esquece o mapeamento manual em cache (depois de salvar/restaurar). */
  invalidateBindings(): void {
    this.customCache.clear();
  }

  bindingFor(gp: Gamepad): { binding: GamepadBinding; kind: GamepadMappingKind; profileName: string } {
    if (!this.customCache.has(gp.id)) this.customCache.set(gp.id, loadCustomBinding(gp.id));
    const custom = this.customCache.get(gp.id);
    if (custom) return { binding: custom, kind: 'custom', profileName: 'Personalizado' };
    if (gp.mapping === 'standard') return { binding: STANDARD_BINDING, kind: 'standard', profileName: 'Padrão' };
    const { vendor = '', product = '' } = parseGamepadId(gp.id);
    for (const prof of KNOWN_PROFILES) {
      if (prof.match(vendor, product, gp.id)) return { binding: prof.binding, kind: 'profile', profileName: prof.name };
    }
    return { binding: GENERIC_BINDING, kind: 'generic', profileName: 'Genérico (automático)' };
  }

  private memoryFor(gp: Gamepad): PadMemory {
    const key = BluetoothGamepadAdapter.keyOf(gp);
    let mem = this.memory.get(key);
    if (!mem) {
      mem = { hatAxes: new Set(), dpadAxisPairs: [], activatedAt: 0 };
      this.memory.set(key, mem);
    }
    if (gp.mapping !== 'standard') {
      // Descobre eixos "hat" (neutro > 1) e pares de eixos digitais usados como direcional
      for (let i = 0; i < gp.axes.length; i++) {
        if (isHatNeutral(gp.axes[i])) mem.hatAxes.add(i);
      }
      if (mem.hatAxes.size === 0 && gp.axes.length >= 8 && !mem.dpadAxisPairs.length) {
        mem.dpadAxisPairs.push([6, 7]);
      }
    }
    return mem;
  }

  private hasActivity(gp: Gamepad): boolean {
    for (const b of gp.buttons) if (b && (b.pressed || b.value > 0.5)) return true;
    for (let i = 0; i < Math.min(gp.axes.length, 4); i++) if (Math.abs(gp.axes[i]) > 0.6 && Math.abs(gp.axes[i]) <= 1.01) return true;
    return false;
  }

  /** Atualiza a ordem dos jogadores: quem aperta primeiro vira P1. */
  private refreshOrder(pads: Gamepad[]): void {
    const live = new Set(pads.map((g) => BluetoothGamepadAdapter.keyOf(g)));
    this.order = this.order.filter((k) => live.has(k));
    for (const gp of pads) {
      const key = BluetoothGamepadAdapter.keyOf(gp);
      if (this.order.includes(key)) continue;
      // Safari/iOS só lista controles depois de um aperto; Chrome pode listar "fantasmas" parados
      if (this.hasActivity(gp) || pads.length === 1) {
        this.order.push(key);
        const mem = this.memoryFor(gp);
        mem.activatedAt = Date.now();
      }
    }
  }

  describe(): GamepadDescriptor[] {
    const pads = BluetoothGamepadAdapter.pads();
    this.refreshOrder(pads);
    const out: GamepadDescriptor[] = [];
    for (const gp of pads) {
      const key = BluetoothGamepadAdapter.keyOf(gp);
      const slot = this.order.indexOf(key);
      const { vendor, product, name } = parseGamepadId(gp.id);
      const { kind, profileName } = this.bindingFor(gp);
      out.push({ key, index: gp.index, id: gp.id, name, vendor, product, mapping: kind, profileName, slot });
    }
    return out.sort((a, b) => (a.slot < 0 ? 99 : a.slot) - (b.slot < 0 ? 99 : b.slot));
  }

  listConnected(): ConnectedPadInfo[] {
    return this.describe()
      .filter((d) => d.slot >= 0 && d.slot < 4)
      .map((d) => ({
        id: `bt-${d.key}`,
        slot: d.slot,
        kind: 'bluetooth' as const,
        label: d.name,
        connectedAt: Date.now(),
      }));
  }

  /** Lê um controle e devolve o estado lógico VGFA. */
  readPad(gp: Gamepad, slot: number): PadState {
    const { binding } = this.bindingFor(gp);
    const mem = this.memoryFor(gp);
    const s = createEmptyPadState(slot);
    let mask = 0;
    const b = binding.buttons;
    (Object.keys(b) as PadButtonName[]).forEach((name) => {
      const v = readSource(gp, b[name]);
      if (v > 0) mask |= PAD_BIT[name];
      if (name === 'L2') s.l2Pressure = Math.min(1, v);
      if (name === 'R2') s.r2Pressure = Math.min(1, v);
      if (name === 'SOUTH') s.crossPressure = Math.min(1, v);
      if (name === 'WEST') s.squarePressure = Math.min(1, v);
    });

    if (binding.autoDpad !== false) {
      for (const idx of mem.hatAxes) mask |= decodeHat(gp.axes[idx] ?? 9);
      for (const [ax, ay] of mem.dpadAxisPairs) {
        const x = gp.axes[ax] ?? 0;
        const y = gp.axes[ay] ?? 0;
        if (Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01) {
          if (x < -0.5) mask |= PAD_BIT.LEFT;
          if (x > 0.5) mask |= PAD_BIT.RIGHT;
          if (y < -0.5) mask |= PAD_BIT.UP;
          if (y > 0.5) mask |= PAD_BIT.DOWN;
        }
      }
    }

    const axes = binding.axes ?? {};
    s.lx = readAxis(gp, axes.lx);
    s.ly = readAxis(gp, axes.ly);
    s.rx = readAxis(gp, axes.rx);
    s.ry = readAxis(gp, axes.ry);
    // Gatilhos analógicos em eixo (alguns perfis): eixo > 0.3 conta como apertado
    s.buttons = mask;
    s.seq = this.seq;
    return s;
  }

  /** Estado de todos os controles, por jogador (P1 = quem apertou primeiro). */
  pollAll(): Map<number, PadState> {
    const out = new Map<number, PadState>();
    const pads = BluetoothGamepadAdapter.pads();
    if (pads.length === 0) return out;
    this.refreshOrder(pads);
    this.seq++;
    for (const gp of pads) {
      const slot = this.order.indexOf(BluetoothGamepadAdapter.keyOf(gp));
      if (slot < 0 || slot > 3) continue;
      out.set(slot, this.readPad(gp, slot));
    }
    return out;
  }

  /** Leitura crua (para a tela de mapear botões). */
  rawSnapshot(key: string): { buttons: number[]; axes: number[]; id: string } | null {
    const gp = BluetoothGamepadAdapter.pads().find((g) => BluetoothGamepadAdapter.keyOf(g) === key);
    if (!gp) return null;
    return {
      id: gp.id,
      buttons: gp.buttons.map((bt) => (bt ? (bt.pressed ? Math.max(1, bt.value) : bt.value) : 0)),
      axes: Array.from(gp.axes),
    };
  }

  rumble(cmd: RumbleCommand): void {
    const pads = BluetoothGamepadAdapter.pads();
    const key = this.order[cmd.slot];
    const gp = pads.find((g) => BluetoothGamepadAdapter.keyOf(g) === key) as
      | (Gamepad & {
          vibrationActuator?: {
            playEffect?: (
              type: string,
              params: { duration: number; strongMagnitude: number; weakMagnitude: number },
            ) => Promise<void>;
          };
        })
      | undefined;
    if (!gp?.vibrationActuator?.playEffect) return;
    void gp.vibrationActuator
      .playEffect('dual-rumble', {
        duration: cmd.durationMs,
        strongMagnitude: Math.max(0, Math.min(1, cmd.strong)),
        weakMagnitude: Math.max(0, Math.min(1, cmd.weak)),
      })
      .catch(() => {});
  }
}

/**
 * Detecta, a partir de duas leituras cruas, qual entrada física mudou (para mapear botões).
 */
export function detectPressedSource(
  before: { buttons: number[]; axes: number[] },
  now: { buttons: number[]; axes: number[] },
): PadInputSource | null {
  for (let i = 0; i < now.buttons.length; i++) {
    if ((now.buttons[i] ?? 0) > 0.6 && (before.buttons[i] ?? 0) < 0.3) return { type: 'button', index: i };
  }
  for (let i = 0; i < now.axes.length; i++) {
    const v = now.axes[i] ?? 0;
    const was = before.axes[i] ?? 0;
    // Eixo "hat": em repouso fica acima de 1; ao apertar, vira uma das 8 posições
    if (isHatNeutral(was)) {
      const bits = decodeHat(v);
      if (bits === PAD_BIT.UP) return { type: 'hat', index: i, dir: 'up' };
      if (bits === PAD_BIT.DOWN) return { type: 'hat', index: i, dir: 'down' };
      if (bits === PAD_BIT.LEFT) return { type: 'hat', index: i, dir: 'left' };
      if (bits === PAD_BIT.RIGHT) return { type: 'hat', index: i, dir: 'right' };
      continue;
    }
    if (Math.abs(v) <= 1.01 && Math.abs(v) > 0.7 && Math.abs(was) < 0.3) {
      return { type: 'axis', index: i, dir: v > 0 ? 1 : -1 };
    }
  }
  return null;
}

/**
 * Mapeamento de teclado padrão (permite testar e jogar imediatamente sem controle)
 * + teclas de controles remotos de TV (Fire TV, Android TV, Smart TVs).
 */
export const DEFAULT_KEYBOARD_MAP: Record<string, number> = {
  // Mesmo padrão do EmulatorJS: o teclado funciona igual com o foco no jogo ou na página
  ArrowUp: PAD_BIT.UP,
  ArrowDown: PAD_BIT.DOWN,
  ArrowLeft: PAD_BIT.LEFT,
  ArrowRight: PAD_BIT.RIGHT,
  KeyZ: PAD_BIT.SOUTH,
  Space: PAD_BIT.SOUTH,
  KeyX: PAD_BIT.EAST,
  KeyA: PAD_BIT.WEST,
  KeyS: PAD_BIT.NORTH,
  KeyQ: PAD_BIT.L1,
  KeyE: PAD_BIT.R1,
  KeyR: PAD_BIT.L2,
  KeyT: PAD_BIT.R2,
  Digit1: PAD_BIT.L2,
  Digit2: PAD_BIT.R2,
  KeyV: PAD_BIT.SELECT,
  ShiftRight: PAD_BIT.SELECT,
  Backspace: PAD_BIT.SELECT,
  Enter: PAD_BIT.START,
  NumpadEnter: PAD_BIT.START,
  // Controle remoto de TV (chegam como e.key)
  MediaPlayPause: PAD_BIT.START,
  MediaPlay: PAD_BIT.START,
  MediaRewind: PAD_BIT.L1,
  MediaFastForward: PAD_BIT.R1,
  MediaTrackPrevious: PAD_BIT.L1,
  MediaTrackNext: PAD_BIT.R1,
  ContextMenu: PAD_BIT.SELECT,
};

/** Resolve a tecla (code, e se vier vazio — comum em TVs — key). */
export function keyboardBitFor(e: { code?: string; key?: string }): number {
  return (e.code && DEFAULT_KEYBOARD_MAP[e.code]) || (e.key ? DEFAULT_KEYBOARD_MAP[e.key] || 0 : 0);
}
