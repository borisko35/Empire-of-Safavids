// ============================================================
// Звук и музыка — Empire of Safavids
// ============================================================
// Всё синтезируется WebAudio (без внешних файлов):
//  * музыка: пэд + ней-подобныйLead в ладу Хиджаз,_frame drum;
//    днём — спокойная, ночью — напряжённая;
//  * эмбиент: ветер (шумовой слой), птицы днём, сверчки ночью,
//    гомон базара в городе;
//  * SFX: шаги, взмах, удар, блок, убийство, уровень, смерть.
// Запуск — после первого жеста пользователя (клик по «Войти в мир»).

const HICAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 554.37]; // D Eb F# G A Bb C
const HICAZ_NIGHT = [261.63, 277.18, 329.63, 349.23, 392.0, 415.3, 493.88]; // C Db E F G Ab B
// Светлый раст для стартовой страницы: D E F# G A B C# — спокойный, без барабанов.
const RAST_AUTH = [293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 554.37];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private murmurGain: GainNode | null = null;
  private murmurGain2: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private stormGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private chirpTimer: ReturnType<typeof setTimeout> | null = null;
  private cityTimer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private night = false;
  private inCity = false;
  private mode: 'auth' | 'game' = 'auth';   // тема: экраны входа / игровой мир
  /** Текущая тема (для отладочного хука) */
  get currentMode(): 'auth' | 'game' { return this.mode; }
  private ambienceOn = false;
  private ambienceStarted = false;
  private _muted = localStorage.getItem('eos_mute') === '1';

  get muted() { return this._muted; }

  /**
   * Создать контекст и включить тему экранов входа/регистрации.
   * Браузер разрешает звук только после жеста пользователя — вызывается
   * из глобального слушателя installAuthMusicTrigger().
   */
  ensureAuth(): void {
    this.ensure();
    this.mode = 'auth';
    this.step = 0;
    (window as unknown as Record<string, unknown>).__eosAudio = 'auth';
    this.setAmbienceEnabled(false);
  }

  /** Создать контекст (только после жеста пользователя) */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.musicTimer) this.startMusic();
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
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0.9;
    this.ambienceGain.connect(this.master);

    // общий буфер шума для перкуссии/шагов/взмахов/эмбиента
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startMusic();
  }

  /** Полный игровой звук: боевая тема + эмбиент (ветер/птицы/гомон) */
  ensureGame(): void {
    this.ensure();
    this.mode = 'game';
    this.step = 0;
    (window as unknown as Record<string, unknown>).__eosAudio = 'game';
    this.setAmbienceEnabled(true);
  }

  /** Остановить все таймеры (выход из мира) */
  dispose(): void {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (this.chirpTimer) { clearTimeout(this.chirpTimer); this.chirpTimer = null; }
    if (this.cityTimer) { clearTimeout(this.cityTimer); this.cityTimer = null; }
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

  /** Эмбиент звучит только в игровом мире; на экранах входа заглушается */
  private setAmbienceEnabled(on: boolean): void {
    this.ambienceOn = on;
    if (on && this.ctx && !this.ambienceStarted) this.startAmbience();
    if (this.ambienceGain && this.ctx) {
      this.ambienceGain.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.6);
    }
  }

  /**
   * Глобальный триггер: первый клик/клавиша на экранах входа, регистрации
   * и выбора персонажа запускает тему авторизации (политика автовоспроизведения).
   */
  installAuthMusicTrigger(): void {
    const trigger = () => {
      if (this.mode !== 'game') this.ensureAuth();
    };
    document.addEventListener('pointerdown', trigger);
    document.addEventListener('keydown', trigger);
  }

  /** Персонаж в городе — включить гомон базара */
  setCity(inCity: boolean): void {
    if (this.inCity === inCity) return;
    this.inCity = inCity;
    if (this.murmurGain && this.ctx) {
      this.murmurGain.gain.setTargetAtTime(inCity ? 0.06 : 0, this.ctx.currentTime, 0.8);
    }
    if (this.murmurGain2 && this.ctx) {
      this.murmurGain2.gain.setTargetAtTime(inCity ? 0.035 : 0, this.ctx.currentTime, 0.8);
    }
  }

  // ── Эмбиент: ветер, птицы, сверчки, гомон ────────────────────
  private startAmbience(): void {
    const ctx = this.ctx, out = this.ambienceGain;
    if (!ctx || !out || this.ambienceStarted) return;
    this.ambienceStarted = true;

    // Ветер: зацикленный шум через lowpass с медленным «дыханием»
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf!;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 240;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain); lfoGain.connect(windGain.gain);
    wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(out);
    wind.start();
    lfo.start();

    // Гомон базара (только в городе): приглушённый «жужжащий» шум
    const murmur = ctx.createBufferSource();
    murmur.buffer = this.noiseBuf!;
    murmur.loop = true;
    murmur.playbackRate.value = 0.6;
    const murmurFilter = ctx.createBiquadFilter();
    murmurFilter.type = 'bandpass';
    murmurFilter.frequency.value = 620;
    murmurFilter.Q.value = 0.6;
    this.murmurGain = ctx.createGain();
    this.murmurGain.gain.value = 0;
    murmur.connect(murmurFilter); murmurFilter.connect(this.murmurGain); this.murmurGain.connect(out);
    murmur.start();

    // Второй слой гомона (выше и быстрее) — толпа звучит плотнее.
    const murmur2 = ctx.createBufferSource();
    murmur2.buffer = this.noiseBuf!;
    murmur2.loop = true;
    murmur2.playbackRate.value = 0.85;
    const murmurFilter2 = ctx.createBiquadFilter();
    murmurFilter2.type = 'bandpass';
    murmurFilter2.frequency.value = 900;
    murmurFilter2.Q.value = 0.7;
    this.murmurGain2 = ctx.createGain();
    this.murmurGain2.gain.value = 0;
    murmur2.connect(murmurFilter2); murmurFilter2.connect(this.murmurGain2); this.murmurGain2.connect(out);
    murmur2.start();

    // Дождь: шипение (highpass-шум), громкость задаёт setRainLevel.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf!;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 4200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainFilter); rainFilter.connect(this.rainGain); this.rainGain.connect(out);
    rain.start();

    // Вой ветра для бури: низкий гул поверх обычного ветра.
    const storm = ctx.createBufferSource();
    storm.buffer = this.noiseBuf!;
    storm.loop = true;
    storm.playbackRate.value = 0.45;
    const stormFilter = ctx.createBiquadFilter();
    stormFilter.type = 'lowpass';
    stormFilter.frequency.value = 420;
    this.stormGain = ctx.createGain();
    this.stormGain.gain.value = 0;
    storm.connect(stormFilter); stormFilter.connect(this.stormGain); this.stormGain.connect(out);
    storm.start();

    // Расписание птиц/сверчков
    const scheduleChirps = () => {
      this.chirpTimer = setTimeout(() => {
        if (this.ctx && !this._muted && this.ambienceOn) {
          if (this.night) this.cricket();
          else { this.birdChirp(); if (Math.random() < 0.4) this.birdChirp(); }
        }
        scheduleChirps();
      }, this.night ? 1800 + Math.random() * 3200 : 2600 + Math.random() * 5200);
    };
    scheduleChirps();
    this.scheduleCityLife();
  }

  /** Шумный город: молот кузнеца, всплески толпы, верблюжьи бубенцы. */
  /** Уровень дождя 0..1 (шипение). */
  setRainLevel(v: number): void {
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.11, this.ctx.currentTime, 0.8);
    }
  }

  /** Уровень штормового ветра 0..1 (вой). Обычный ветер звучит всегда. */
  setWindLevel(v: number): void {
    if (this.stormGain && this.ctx) {
      this.stormGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.14, this.ctx.currentTime, 1.0);
    }
  }

  /** Раскат грома: низкий затухающий грохот. */
  thunder(): void {
    if (!this.ctx || !this.noiseBuf || !this.ambienceGain) return;
    if (this._muted || !this.ambienceOn) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.6 + Math.random() * 1.2;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(160, t);
    f.frequency.exponentialRampToValueAtTime(55, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.ambienceGain);
    n.start(t); n.stop(t + dur + 0.05);
  }

  private scheduleCityLife(): void {
    this.cityTimer = setTimeout(() => {
      if (this.ctx && !this._muted && this.ambienceOn && this.inCity) {
        const roll = Math.random();
        if (roll < 0.4) this.hammerClank();
        else if (roll < 0.75) this.chatterBurst();
        else this.camelBell();
      }
      this.scheduleCityLife();
    }, 2000 + Math.random() * 5000);
  }

  private cityOut(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx || !this.ambienceGain) return null;
    return { ctx: this.ctx, out: this.ambienceGain };
  }

  /** Удар молота по наковальне: металлический звон с быстрым затуханием. */
  private hammerClank(): void {
    const io = this.cityOut();
    if (!io) return;
    const { ctx, out } = io;
    const t = ctx.currentTime;
    for (const hz of [1244, 1866, 2493]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.02, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.4);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.03, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(nf); nf.connect(ng); ng.connect(out);
    n.start(t); n.stop(t + 0.08);
  }

  /** Всплеск толпы: полоса шума вспухает и гаснет. */
  private chatterBurst(): void {
    const io = this.cityOut();
    if (!io) return;
    const { ctx, out } = io;
    const t = ctx.currentTime;
    const dur = 0.5 + Math.random() * 0.7;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 0.5 + Math.random() * 0.4;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 400 + Math.random() * 500;
    nf.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(nf); nf.connect(g); g.connect(out);
    n.start(t); n.stop(t + dur + 0.05);
  }

  /** Верблюжий бубенец: высокий чистый динь. */
  private camelBell(): void {
    const io = this.cityOut();
    if (!io) return;
    const { ctx, out } = io;
    const t = ctx.currentTime;
    const hz = 2093 * (0.97 + Math.random() * 0.06);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.025, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.95);
  }

  /** Птица: 2–4 щелчка с падающей высотой */
  private birdChirp(): void {
    const ctx = this.ctx, out = this.ambienceGain;
    if (!ctx || !out) return;
    const base = 2400 + Math.random() * 1800;
    const t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const hz = base * (1 - i * 0.09) * (0.92 + Math.random() * 0.16);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(hz, t);
      o.frequency.exponentialRampToValueAtTime(hz * 1.35, t + 0.03);
      o.frequency.exponentialRampToValueAtTime(hz * 0.85, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.1);
    }
  }

  /** Сверчок: серия коротких высоких трелей */
  private cricket(): void {
    const ctx = this.ctx, out = this.ambienceGain;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime;
    const pulses = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.11;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 4300 + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.011, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.08);
    }
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
    if (this.mode === 'auth') {
      this.authMusicStep(ctx);
      return;
    }
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

  /**
   * Тема стартовой страницы: светлый раст, редкие аккорды, неторопливый
   * ней поверх, барабанов нет. Слышно сразу, что это не игровая тема.
   */
  private authMusicStep(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const s = this.step++;
    if (s % 8 === 0) {
      const rootHz = RAST_AUTH[0] / 2;
      this.pad(rootHz, t, 14);
      this.pad(rootHz * 1.498, t, 14);
    }
    if (s % 8 === 4) {
      const idx = [3, 4, 5, 2][Math.floor(Math.random() * 4)];
      this.ney(RAST_AUTH[idx], t + 0.2, 2.2);
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
