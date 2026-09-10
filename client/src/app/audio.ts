// ============================================================
// Звук и музыка — Empire of Safavids
// ============================================================
// Всё синтезируется WebAudio (без внешних файлов):
//  * музыка: пэд + ней-подобныйLead в ладу Хиджаз,_frame drum;
//    днём — спокойная, ночью — напряжённая;
//  * SFX: шаги, взмах, удар, блок, убийство, уровень, смерть.
// Запуск — после первого жеста пользователя (клик по «Войти в мир»).

const HICAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 554.37]; // D Eb F# G A Bb C
const HICAZ_NIGHT = [261.63, 277.18, 329.63, 349.23, 392.0, 415.3, 493.88]; // C Db E F G Ab B

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private night = false;
  private _muted = localStorage.getItem('eos_mute') === '1';

  get muted() { return this._muted; }

  /** Создать контекст (только после жеста пользователя) */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 1;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);

    // общий буфер шума для перкуссии/шагов/взмахов
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startMusic();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    localStorage.setItem('eos_mute', m ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  setNight(night: boolean): void {
    this.night = night;
  }

  // ── Музыка ───────────────────────────────────────────────────
  private startMusic(): void {
    if (!this.ctx || this.musicTimer) return;
    const tick = () => this.musicStep();
    tick();
    this.musicTimer = setInterval(tick, 1900); // темп ~31 BPM на шаг
  }

  private musicStep(): void {
    const ctx = this.ctx, out = this.musicGain;
    if (!ctx || !out || ctx.state !== 'running') return;
    const scale = this.night ? HICAZ_NIGHT : HICAZ;
    const t = ctx.currentTime;
    const s = this.step++;

    // Пэд: тонику + квинта (каждые 4 шага — смена)
    if (s % 4 === 0) {
      const rootHz = scale[(this.night ? 0 : 3) % scale.length] / 2;
      this.pad(rootHz, t, 8.2);
      this.pad(rootHz * 1.498, t, 8.2); // квинта
    }

    // Барабан: глухой удар на чётные шаги, лёгкий шейк на нечётные
    if (s % 2 === 0) this.drum(t, 0.5);
    else if (this.night && s % 4 === 3) this.drum(t, 0.25);

    // Мелодия нея: случайная нота лада с вибрато
    if (s % 2 === 1 || Math.random() < 0.3) {
      const idx = Math.floor(Math.random() * scale.length);
      this.ney(scale[idx] * (Math.random() < 0.25 ? 2 : 1), t + 0.15, 1.4);
    }
  }

  private pad(hz: number, t: number, dur: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 1.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = this.night ? 500 : 800;
    filt.connect(g); g.connect(out);
    for (const det of [-4, 3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.detune.value = det;
      o.connect(filt);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  private ney(hz: number, t: number, dur: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hz, t);
    // вибрато
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoG = ctx.createGain();
    lfoG.gain.value = hz * 0.012;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.25);
    g.gain.linearRampToValueAtTime(0.035, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.1);
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  private drum(t: number, vol: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    // корпус: синус с падающей высотой
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.32);
    // шелест
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 4200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(nf); nf.connect(ng); ng.connect(out);
    n.start(t); n.stop(t + 0.1);
  }

  // ── SFX ──────────────────────────────────────────────────────
  private noise(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, sweepTo?: number): void {
    const ctx = this.ctx, out = this.sfxGain;
    if (!ctx || !out) return;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + dur + 0.05);
  }

  private tone(hz: number, t: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx, out = this.sfxGain;
    if (!ctx || !out) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(running: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.09, 'bandpass', running ? 900 : 700, 0.10);
    this.tone(85, t, 0.07, 'sine', 0.06, 55);
  }
  whoosh(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.22, 'bandpass', 500, 0.16, 2600);
  }
  hit(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(160, t, 0.16, 'square', 0.10, 70);
    this.noise(t, 0.12, 'lowpass', 1400, 0.14);
  }
  blocked(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1200, t, 0.1, 'square', 0.07, 900);
    this.noise(t, 0.08, 'highpass', 3000, 0.06);
  }
  kill(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(HICAZ[0] * 2, t, 0.14, 'triangle', 0.09);
    this.tone(HICAZ[2] * 2, t + 0.09, 0.18, 'triangle', 0.09);
  }
  levelUp(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 2, 4, 7].forEach((semi, i) => {
      this.tone(440 * Math.pow(2, semi / 12), t + i * 0.11, 0.24, 'triangle', 0.08);
    });
  }
  playerDeath(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(220, t, 0.7, 'sawtooth', 0.09, 70);
    this.noise(t, 0.5, 'lowpass', 500, 0.1);
  }
  jump(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.12, 'bandpass', 700, 0.06, 1500);
  }
}

export const audio = new AudioEngine();
