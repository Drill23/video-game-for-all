import { PAD_BIT, type PadState, type RumbleCommand } from '@vgfa/pad';

export type BuiltinVariant = 'star-drift' | 'cyber-runner' | 'apex-circuit' | 'neon-arena';

export interface BuiltinEngineCallbacks {
  getInput: () => PadState;
  onHudUpdate?: (hud: { score: number; lives: number; stage: number; fps: number; extra?: string }) => void;
  onRumble?: (cmd: RumbleCommand) => void;
}

interface StarDriftState {
  x: number;
  y: number;
  score: number;
  lives: number;
  stage: number;
  cooldown: number;
  invuln: number;
  bullets: Array<{ x: number; y: number; vy: number }>;
  enemies: Array<{ x: number; y: number; vx: number; vy: number; hp: number; radius: number }>;
  stars: Array<{ x: number; y: number; speed: number }>;
  spawnTimer: number;
}

interface CyberRunnerState {
  py: number;
  vy: number;
  jumpsLeft: number;
  jumpHeld: boolean;
  score: number;
  lives: number;
  stage: number;
  speed: number;
  invuln: number;
  scroll: number;
  obstacles: Array<{ x: number; w: number; h: number }>;
  coins: Array<{ x: number; y: number; taken: boolean }>;
  spawnTimer: number;
}

interface ApexCircuitState {
  playerX: number; // -1..1
  speed: number; // 0..260
  distance: number;
  score: number;
  lives: number;
  stage: number;
  turbo: number; // 0..100
  curve: number;
  rivals: Array<{ z: number; lane: number; color: string }>;
}

interface NeonArenaState {
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  score: number;
  lives: number;
  stage: number;
  cooldown: number;
  dashCooldown: number;
  invuln: number;
  bullets: Array<{ x: number; y: number; vx: number; vy: number; life: number }>;
  enemies: Array<{ x: number; y: number; speed: number; hp: number; kind: number }>;
  particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }>;
  spawnTimer: number;
}

class RetroSynth {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted || typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  beep(freq: number, duration = 0.07, type: OscillatorType = 'square', gainVal = 0.06): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), now + duration);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}

/**
 * Motor Arcade 60 FPS próprio do VGFA para os jogos leves embutidos.
 * Suporta Teclado + Bluetooth + Celular QR Code (incluindo DualShock 2 analógico + pressão),
 * vibração háptica e Save State / Load State binário real em IndexedDB!
 */
export class VgfaBuiltinArcadeEngine {
  private rafId: number | null = null;
  private lastTs = 0;
  private fps = 60;
  private frameCounter = 0;
  private fpsTimer = 0;
  private paused = false;
  private synth = new RetroSynth();

  private starDrift!: StarDriftState;
  private cyberRunner!: CyberRunnerState;
  private apexCircuit!: ApexCircuitState;
  private neonArena!: NeonArenaState;

  private readonly W = 640;
  private readonly H = 360;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly variant: BuiltinVariant,
    private readonly callbacks: BuiltinEngineCallbacks,
  ) {
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.reset();
  }

  setMuted(muted: boolean): void {
    this.synth.muted = muted;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  reset(): void {
    this.starDrift = {
      x: this.W / 2,
      y: this.H - 44,
      score: 0,
      lives: 3,
      stage: 1,
      cooldown: 0,
      invuln: 0,
      bullets: [],
      enemies: [],
      stars: Array.from({ length: 48 }, () => ({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        speed: 40 + Math.random() * 140,
      })),
      spawnTimer: 0.4,
    };

    this.cyberRunner = {
      py: 0,
      vy: 0,
      jumpsLeft: 2,
      jumpHeld: false,
      score: 0,
      lives: 3,
      stage: 1,
      speed: 240,
      invuln: 0,
      scroll: 0,
      obstacles: [],
      coins: [],
      spawnTimer: 0.8,
    };

    this.apexCircuit = {
      playerX: 0,
      speed: 80,
      distance: 0,
      score: 0,
      lives: 3,
      stage: 1,
      turbo: 100,
      curve: 0,
      rivals: [
        { z: 0.35, lane: -0.45, color: '#EF4444' },
        { z: 0.72, lane: 0.4, color: '#22C55E' },
        { z: 0.95, lane: 0, color: '#F59E0B' },
      ],
    };

    this.neonArena = {
      x: this.W / 2,
      y: this.H / 2,
      aimX: 1,
      aimY: 0,
      score: 0,
      lives: 5,
      stage: 1,
      cooldown: 0,
      dashCooldown: 0,
      invuln: 0,
      bullets: [],
      enemies: [],
      particles: [],
      spawnTimer: 0.5,
    };
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastTs = performance.now();
    const tick = (ts: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      this.frameCounter++;
      this.fpsTimer += dt;
      if (this.fpsTimer >= 0.5) {
        this.fps = Math.round(this.frameCounter / this.fpsTimer);
        this.frameCounter = 0;
        this.fpsTimer = 0;
      }

      if (!this.paused) {
        const pad = this.callbacks.getInput();
        this.update(dt, pad);
      }
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Serializa o estado completo do jogo em bytes para Save State em IndexedDB. */
  exportState(): Uint8Array {
    const stateObj =
      this.variant === 'star-drift'
        ? this.starDrift
        : this.variant === 'cyber-runner'
          ? this.cyberRunner
          : this.variant === 'apex-circuit'
            ? this.apexCircuit
            : this.neonArena;
    return new TextEncoder().encode(JSON.stringify({ variant: this.variant, data: stateObj }));
  }

  /** Restaura o estado exato do jogo a partir de um Save State binário. */
  importState(bytes: Uint8Array): boolean {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        variant: BuiltinVariant;
        data: unknown;
      };
      if (parsed.variant !== this.variant) return false;
      if (this.variant === 'star-drift') this.starDrift = parsed.data as StarDriftState;
      else if (this.variant === 'cyber-runner') this.cyberRunner = parsed.data as CyberRunnerState;
      else if (this.variant === 'apex-circuit') this.apexCircuit = parsed.data as ApexCircuitState;
      else this.neonArena = parsed.data as NeonArenaState;
      return true;
    } catch {
      return false;
    }
  }

  private rumble(strong: number, weak: number, durationMs: number): void {
    this.callbacks.onRumble?.({ slot: 0, strong, weak, durationMs });
  }

  private axisOrDpadX(pad: PadState): number {
    if (Math.abs(pad.lx) > 0.15) return pad.lx;
    return (pad.buttons & PAD_BIT.RIGHT ? 1 : 0) - (pad.buttons & PAD_BIT.LEFT ? 1 : 0);
  }

  private axisOrDpadY(pad: PadState): number {
    if (Math.abs(pad.ly) > 0.15) return pad.ly;
    return (pad.buttons & PAD_BIT.DOWN ? 1 : 0) - (pad.buttons & PAD_BIT.UP ? 1 : 0);
  }

  private update(dt: number, pad: PadState): void {
    if (this.variant === 'star-drift') this.updateStarDrift(dt, pad);
    else if (this.variant === 'cyber-runner') this.updateCyberRunner(dt, pad);
    else if (this.variant === 'apex-circuit') this.updateApexCircuit(dt, pad);
    else this.updateNeonArena(dt, pad);
  }

  private updateStarDrift(dt: number, pad: PadState): void {
    const s = this.starDrift;
    if (s.lives <= 0) {
      if (pad.buttons & (PAD_BIT.START | PAD_BIT.SOUTH)) this.reset();
      return;
    }

    const mx = this.axisOrDpadX(pad);
    const my = this.axisOrDpadY(pad);
    s.x = Math.max(24, Math.min(this.W - 24, s.x + mx * 290 * dt));
    s.y = Math.max(120, Math.min(this.H - 24, s.y + my * 220 * dt));
    s.cooldown = Math.max(0, s.cooldown - dt);
    s.invuln = Math.max(0, s.invuln - dt);

    for (const st of s.stars) {
      st.y += st.speed * dt;
      if (st.y > this.H) {
        st.y = 0;
        st.x = Math.random() * this.W;
      }
    }

    if ((pad.buttons & (PAD_BIT.SOUTH | PAD_BIT.EAST | PAD_BIT.R2)) && s.cooldown <= 0) {
      s.bullets.push({ x: s.x, y: s.y - 16, vy: -460 });
      s.cooldown = 0.14;
      this.synth.beep(780, 0.05, 'square', 0.04);
    }

    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      const stage = 1 + Math.floor(s.score / 500);
      s.stage = stage;
      const isHeavy = Math.random() < 0.22;
      s.enemies.push({
        x: 32 + Math.random() * (this.W - 64),
        y: -20,
        vx: (Math.random() - 0.5) * (60 + stage * 20),
        vy: 75 + stage * 18 + Math.random() * 45,
        hp: isHeavy ? 3 : 1,
        radius: isHeavy ? 18 : 12,
      });
      s.spawnTimer = Math.max(0.28, 0.95 - stage * 0.08);
    }

    for (const b of s.bullets) b.y += b.vy * dt;
    s.bullets = s.bullets.filter((b) => b.y > -20);

    for (const e of s.enemies) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.x < e.radius || e.x > this.W - e.radius) e.vx *= -1;
    }

    for (const b of s.bullets) {
      for (const e of s.enemies) {
        if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.radius + 6) {
          e.hp--;
          b.y = -999;
          if (e.hp <= 0) {
            s.score += e.radius > 14 ? 150 : 50;
            this.synth.beep(260, 0.09, 'sawtooth', 0.06);
            this.rumble(0.25, 0.5, 50);
          }
        }
      }
    }

    if (s.invuln <= 0) {
      for (const e of s.enemies) {
        if (e.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < e.radius + 13) {
          e.hp = 0;
          s.lives--;
          s.invuln = 1.4;
          this.synth.beep(120, 0.2, 'sawtooth', 0.09);
          this.rumble(0.9, 0.8, 220);
        }
      }
    }

    s.enemies = s.enemies.filter((e) => e.hp > 0 && e.y < this.H + 30);
    this.callbacks.onHudUpdate?.({ score: s.score, lives: s.lives, stage: s.stage, fps: this.fps });
  }

  private updateCyberRunner(dt: number, pad: PadState): void {
    const s = this.cyberRunner;
    if (s.lives <= 0) {
      if (pad.buttons & (PAD_BIT.START | PAD_BIT.SOUTH)) this.reset();
      return;
    }

    const jumpPressed = Boolean(pad.buttons & (PAD_BIT.SOUTH | PAD_BIT.EAST | PAD_BIT.UP));
    if (jumpPressed && !s.jumpHeld && s.jumpsLeft > 0) {
      s.vy = 430;
      s.jumpsLeft--;
      this.synth.beep(s.jumpsLeft === 1 ? 520 : 740, 0.07, 'square', 0.05);
    }
    s.jumpHeld = jumpPressed;

    s.py += s.vy * dt;
    s.vy -= 1180 * dt;
    if (s.py <= 0) {
      s.py = 0;
      s.vy = 0;
      s.jumpsLeft = 2;
    }

    s.speed = Math.min(460, 240 + s.score * 0.06);
    s.stage = 1 + Math.floor(s.score / 600);
    s.scroll += s.speed * dt;
    s.score += Math.round(dt * 30);
    s.invuln = Math.max(0, s.invuln - dt);

    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      const h = 26 + Math.floor(Math.random() * 34);
      s.obstacles.push({ x: this.W + 30, w: 22 + Math.random() * 14, h });
      s.coins.push({ x: this.W + 95, y: 40 + Math.random() * 85, taken: false });
      s.spawnTimer = Math.max(0.65, 1.45 - s.stage * 0.08);
    }

    const playerX = 110;
    const playerW = 24;
    const playerH = 34;

    for (const o of s.obstacles) {
      o.x -= s.speed * dt;
      if (
        s.invuln <= 0 &&
        playerX + playerW > o.x &&
        playerX < o.x + o.w &&
        s.py < o.h
      ) {
        s.lives--;
        s.invuln = 1.3;
        this.synth.beep(130, 0.2, 'sawtooth', 0.08);
        this.rumble(0.85, 0.6, 180);
      }
    }

    for (const c of s.coins) {
      c.x -= s.speed * dt;
      if (!c.taken && Math.hypot(playerX + 12 - c.x, s.py + playerH / 2 - c.y) < 22) {
        c.taken = true;
        s.score += 100;
        this.synth.beep(980, 0.06, 'triangle', 0.05);
      }
    }

    s.obstacles = s.obstacles.filter((o) => o.x + o.w > -20);
    s.coins = s.coins.filter((c) => !c.taken && c.x > -20);
    this.callbacks.onHudUpdate?.({ score: s.score, lives: s.lives, stage: s.stage, fps: this.fps });
  }

  private updateApexCircuit(dt: number, pad: PadState): void {
    const s = this.apexCircuit;
    const steer = this.axisOrDpadX(pad);
    const accel = Math.max(
      pad.r2Pressure,
      pad.crossPressure,
      pad.buttons & (PAD_BIT.SOUTH | PAD_BIT.UP | PAD_BIT.R2) ? 1 : 0,
    );
    const brake = Math.max(
      pad.l2Pressure,
      pad.squarePressure,
      pad.buttons & (PAD_BIT.WEST | PAD_BIT.DOWN | PAD_BIT.L2) ? 1 : 0,
    );
    const turboPressed = Boolean(pad.buttons & (PAD_BIT.L1 | PAD_BIT.R1 | PAD_BIT.EAST));

    let maxSpeed = 225;
    if (turboPressed && s.turbo > 0) {
      maxSpeed = 310;
      s.turbo = Math.max(0, s.turbo - 36 * dt);
    } else {
      s.turbo = Math.min(100, s.turbo + 14 * dt);
    }

    if (accel > 0.05) {
      s.speed = Math.min(maxSpeed, s.speed + (135 * accel) * dt);
    } else {
      s.speed = Math.max(45, s.speed - 45 * dt);
    }
    if (brake > 0.05) {
      s.speed = Math.max(20, s.speed - 220 * brake * dt);
    }

    s.distance += s.speed * dt;
    s.curve = Math.sin(s.distance * 0.0022) * 0.65;
    s.playerX += (steer * 1.65 - s.curve * (s.speed / 260) * 0.55) * dt;
    s.playerX = Math.max(-1.25, Math.min(1.25, s.playerX));

    if (Math.abs(s.playerX) > 0.95) {
      s.speed = Math.max(55, s.speed - 140 * dt);
    }

    for (const r of s.rivals) {
      r.z -= (s.speed / 240) * 0.65 * dt;
      if (r.z < 0.05) {
        if (Math.abs(r.lane - s.playerX) < 0.28) {
          s.speed = Math.max(45, s.speed * 0.45);
          this.synth.beep(110, 0.16, 'sawtooth', 0.08);
          this.rumble(0.8, 0.7, 160);
        } else {
          s.score += 120;
        }
        r.z = 1.05 + Math.random() * 0.4;
        r.lane = (Math.random() - 0.5) * 1.4;
      }
    }

    s.score += Math.round((s.speed * dt) / 4);
    s.stage = 1 + Math.floor(s.distance / 2500);
    this.callbacks.onHudUpdate?.({
      score: s.score,
      lives: s.lives,
      stage: s.stage,
      fps: this.fps,
      extra: `${Math.round(s.speed)} km/h • Turbo ${Math.round(s.turbo)}%`,
    });
  }

  private updateNeonArena(dt: number, pad: PadState): void {
    const s = this.neonArena;
    if (s.lives <= 0) {
      if (pad.buttons & (PAD_BIT.START | PAD_BIT.SOUTH)) this.reset();
      return;
    }

    const mx = this.axisOrDpadX(pad);
    const my = this.axisOrDpadY(pad);
    const throttle = 1 + Math.max(pad.r2Pressure, pad.crossPressure) * 0.6;
    const speed = 210 * throttle;

    s.x = Math.max(22, Math.min(this.W - 22, s.x + mx * speed * dt));
    s.y = Math.max(22, Math.min(this.H - 22, s.y + my * speed * dt));

    // Mira pelo analógico direito (DualShock 2!) ou direção de movimento
    if (Math.hypot(pad.rx, pad.ry) > 0.2) {
      const len = Math.hypot(pad.rx, pad.ry);
      s.aimX = pad.rx / len;
      s.aimY = pad.ry / len;
    } else if (Math.hypot(mx, my) > 0.2) {
      const len = Math.hypot(mx, my);
      s.aimX = mx / len;
      s.aimY = my / len;
    }

    s.cooldown = Math.max(0, s.cooldown - dt);
    s.dashCooldown = Math.max(0, s.dashCooldown - dt);
    s.invuln = Math.max(0, s.invuln - dt);

    const wantsFire =
      Math.hypot(pad.rx, pad.ry) > 0.35 ||
      Boolean(pad.buttons & (PAD_BIT.SOUTH | PAD_BIT.R1 | PAD_BIT.R2));

    if (wantsFire && s.cooldown <= 0) {
      s.bullets.push({
        x: s.x + s.aimX * 16,
        y: s.y + s.aimY * 16,
        vx: s.aimX * 480,
        vy: s.aimY * 480,
        life: 1.2,
      });
      s.cooldown = 0.11;
      this.synth.beep(640, 0.04, 'triangle', 0.04);
    }

    if ((pad.buttons & (PAD_BIT.L1 | PAD_BIT.L2 | PAD_BIT.EAST)) && s.dashCooldown <= 0) {
      s.x = Math.max(22, Math.min(this.W - 22, s.x + s.aimX * 72));
      s.y = Math.max(22, Math.min(this.H - 22, s.y + s.aimY * 72));
      s.invuln = Math.max(s.invuln, 0.25);
      s.dashCooldown = 1.1;
      this.synth.beep(420, 0.08, 'sine', 0.06);
      this.rumble(0.3, 0.6, 60);
    }

    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      s.stage = 1 + Math.floor(s.score / 600);
      const edge = Math.floor(Math.random() * 4);
      const ex = edge === 0 ? 0 : edge === 1 ? this.W : Math.random() * this.W;
      const ey = edge === 2 ? 0 : edge === 3 ? this.H : Math.random() * this.H;
      s.enemies.push({
        x: ex,
        y: ey,
        speed: 65 + s.stage * 14 + Math.random() * 30,
        hp: s.stage >= 3 && Math.random() < 0.3 ? 2 : 1,
        kind: edge % 2,
      });
      s.spawnTimer = Math.max(0.28, 1.0 - s.stage * 0.07);
    }

    for (const b of s.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    s.bullets = s.bullets.filter((b) => b.life > 0 && b.x >= 0 && b.x <= this.W && b.y >= 0 && b.y <= this.H);

    for (const e of s.enemies) {
      const dx = s.x - e.x;
      const dy = s.y - e.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
    }

    for (const b of s.bullets) {
      for (const e of s.enemies) {
        if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < 16) {
          e.hp--;
          b.life = 0;
          if (e.hp <= 0) {
            s.score += 100;
            this.synth.beep(280, 0.07, 'sawtooth', 0.05);
            this.rumble(0.2, 0.4, 40);
            for (let k = 0; k < 8; k++) {
              const a = (Math.PI * 2 * k) / 8;
              s.particles.push({
                x: e.x,
                y: e.y,
                vx: Math.cos(a) * 140,
                vy: Math.sin(a) * 140,
                life: 0.35,
                color: e.kind === 0 ? '#38BDF8' : '#FB7185',
              });
            }
          }
        }
      }
    }

    if (s.invuln <= 0) {
      for (const e of s.enemies) {
        if (e.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < 20) {
          e.hp = 0;
          s.lives--;
          s.invuln = 1.2;
          this.synth.beep(100, 0.22, 'sawtooth', 0.09);
          this.rumble(1.0, 0.85, 240);
        }
      }
    }

    for (const p of s.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    s.particles = s.particles.filter((p) => p.life > 0);
    s.enemies = s.enemies.filter((e) => e.hp > 0);

    this.callbacks.onHudUpdate?.({
      score: s.score,
      lives: s.lives,
      stage: s.stage,
      fps: this.fps,
      extra: `Pressão R2: ${Math.round(pad.r2Pressure * 100)}%`,
    });
  }

  private render(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    if (this.variant === 'star-drift') this.renderStarDrift(ctx);
    else if (this.variant === 'cyber-runner') this.renderCyberRunner(ctx);
    else if (this.variant === 'apex-circuit') this.renderApexCircuit(ctx);
    else this.renderNeonArena(ctx);

    // Scanlines sutis de CRT
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < this.H; y += 3) {
      ctx.fillRect(0, y, this.W, 1);
    }
  }

  private renderStarDrift(ctx: CanvasRenderingContext2D): void {
    const s = this.starDrift;
    ctx.fillStyle = '#07080F';
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.fillStyle = '#94A3B8';
    for (const st of s.stars) {
      ctx.fillRect(st.x, st.y, 2, 2);
    }

    // Tiros
    ctx.fillStyle = '#FFB547';
    for (const b of s.bullets) {
      ctx.fillRect(b.x - 2, b.y - 8, 4, 14);
    }

    // Inimigos
    for (const e of s.enemies) {
      ctx.fillStyle = e.radius > 14 ? '#F43F5E' : '#FB923C';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#07080F';
      ctx.fillRect(e.x - 6, e.y - 3, 4, 4);
      ctx.fillRect(e.x + 2, e.y - 3, 4, 4);
    }

    // Nave
    if (s.lives > 0 && (s.invuln <= 0 || Math.floor(s.invuln * 15) % 2 === 0)) {
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 16);
      ctx.lineTo(s.x - 14, s.y + 12);
      ctx.lineTo(s.x + 14, s.y + 12);
      ctx.closePath();
      ctx.fill();
    }

    if (s.lives <= 0) this.drawGameOver(ctx, s.score);
  }

  private renderCyberRunner(ctx: CanvasRenderingContext2D): void {
    const s = this.cyberRunner;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#130920');
    g.addColorStop(1, '#2B103A');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    const groundY = this.H - 58;
    // Grade parallax
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.2)';
    const offset = s.scroll % 40;
    for (let x = -offset; x < this.W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x - 30, this.H);
      ctx.stroke();
    }

    ctx.fillStyle = '#1E1B4B';
    ctx.fillRect(0, groundY, this.W, 58);
    ctx.fillStyle = '#EC4899';
    ctx.fillRect(0, groundY, this.W, 3);

    // Moedas
    ctx.fillStyle = '#FACC15';
    for (const c of s.coins) {
      ctx.beginPath();
      ctx.arc(c.x, groundY - c.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Obstáculos
    ctx.fillStyle = '#EF4444';
    for (const o of s.obstacles) {
      ctx.fillRect(o.x, groundY - o.h, o.w, o.h);
    }

    // Jogador
    if (s.lives > 0 && (s.invuln <= 0 || Math.floor(s.invuln * 15) % 2 === 0)) {
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(110, groundY - s.py - 34, 24, 34);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(124, groundY - s.py - 28, 7, 6);
    }

    if (s.lives <= 0) this.drawGameOver(ctx, s.score);
  }

  private renderApexCircuit(ctx: CanvasRenderingContext2D): void {
    const s = this.apexCircuit;
    const horizon = 148;

    // Céu pôr do sol 16-bit
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0F172A');
    sky.addColorStop(0.65, '#4C1D95');
    sky.addColorStop(1, '#F97316');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.W, horizon);

    // Sol
    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.arc(this.W / 2 - s.curve * 70, horizon - 20, 34, 0, Math.PI * 2);
    ctx.fill();

    // Pista pseudo-3D faixa por faixa
    const rows = this.H - horizon;
    for (let i = 0; i < rows; i += 2) {
      const p = i / rows; // 0 no horizonte, 1 na base
      const y = horizon + i;
      const roadW = 46 + p * 460;
      const center = this.W / 2 + s.curve * (1 - p) * (1 - p) * 190 - s.playerX * p * 180;
      const stripe = Math.floor(s.distance * 0.08 + 14 / (p + 0.08)) % 2 === 0;

      ctx.fillStyle = stripe ? '#064E3B' : '#065F46';
      ctx.fillRect(0, y, this.W, 2);

      // Zebras
      ctx.fillStyle = stripe ? '#EF4444' : '#F8FAFC';
      ctx.fillRect(center - roadW / 2 - 12 * p - 2, y, roadW + 24 * p + 4, 2);

      // Asfalto
      ctx.fillStyle = stripe ? '#1E293B' : '#263349';
      ctx.fillRect(center - roadW / 2, y, roadW, 2);

      // Faixa central
      if (stripe) {
        ctx.fillStyle = '#FACC15';
        ctx.fillRect(center - 2 * p - 1, y, 4 * p + 2, 2);
      }
    }

    // Rivais
    for (const r of s.rivals) {
      if (r.z <= 0 || r.z > 1) continue;
      const p = 1 - r.z;
      const y = horizon + p * rows;
      const roadW = 46 + p * 460;
      const center = this.W / 2 + s.curve * (1 - p) * (1 - p) * 190 - s.playerX * p * 180;
      const x = center + (r.lane * roadW) * 0.42;
      const w = 14 + p * 44;
      const h = 10 + p * 26;
      ctx.fillStyle = r.color;
      ctx.fillRect(x - w / 2, y - h, w, h);
    }

    // Carro do jogador
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(this.W / 2 - 28, this.H - 44, 56, 26);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(this.W / 2 - 18, this.H - 40, 36, 10);
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(this.W / 2 - 24, this.H - 22, 10, 4);
    ctx.fillRect(this.W / 2 + 14, this.H - 22, 10, 4);
  }

  private renderNeonArena(ctx: CanvasRenderingContext2D): void {
    const s = this.neonArena;
    ctx.fillStyle = '#060812';
    ctx.fillRect(0, 0, this.W, this.H);

    // Grade vetorial
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    for (let x = 0; x < this.W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.H);
      ctx.stroke();
    }
    for (let y = 0; y < this.H; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.W, y);
      ctx.stroke();
    }

    // Partículas
    for (const p of s.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    // Tiros
    ctx.fillStyle = '#FACC15';
    for (const b of s.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inimigos
    for (const e of s.enemies) {
      ctx.strokeStyle = e.kind === 0 ? '#38BDF8' : '#FB7185';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.rect(e.x - 10, e.y - 10, 20, 20);
      ctx.stroke();
    }

    // Jogador + vetor de mira (analógico direito)
    if (s.lives > 0 && (s.invuln <= 0 || Math.floor(s.invuln * 15) % 2 === 0)) {
      ctx.strokeStyle = '#FFB547';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.aimX * 26, s.y + s.aimY * 26);
      ctx.stroke();

      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    if (s.lives <= 0) this.drawGameOver(ctx, s.score);
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, score: number): void {
    ctx.fillStyle = 'rgba(7, 8, 15, 0.78)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = '#FFB547';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', this.W / 2, this.H / 2 - 14);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText(`SCORE: ${score}  •  START / × PARA REINICIAR`, this.W / 2, this.H / 2 + 22);
  }
}
