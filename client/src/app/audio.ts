// ============================================================
// Звук и музыка — Empire of Safavids
// ============================================================
// Всё синтезируется WebAudio (без внешних файлов):
//  * музыка — ЧЕТЫРЕ темы: экран входа, ЗАГРУЗКА мира, игра
//    (разведка / СЮЖЕТНАЯ во время диалогов / БОЙ), днём и ночью
//    по-разному. Инструменты: пэд, ней, сантур, каманче, бас-остинато,
//    frame drum; лады хиджаз (день), хиджаз-ночь и раст (вход);
//  * эмбиент: ветер, птицы днём, сверчки ночью, гомон базара;
//  * SFX: шаги, бой, ВОДА (всплеск, шаг по воде) и весь интерфейс —
//    клик, наведение, открытие/закрытие панели, ошибка, уведомление;
//  * громкость музыки и эффектов независимая, хранится в localStorage.
// Запуск — после первого жеста пользователя (политика автовоспроизведения).

const HICAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 554.37]; // D Eb F# G A Bb C
const HICAZ_NIGHT = [261.63, 277.18, 329.63, 349.23, 392.0, 415.3, 493.88]; // C Db E F G Ab B
// Светлый раст для стартовой страницы и экрана загрузки: D E F# G A B C# —
// спокойный, без барабанов.
const RAST_AUTH = [293.66, 329.63, 369.99, 392.0, 440.0, 493.88, 554.37];

// Базовые громкости каналов (умножаются на пользовательские проценты)
const BASE_MUSIC = 0.16;
const BASE_SFX = 0.5;
const BASE_AMBIENCE = 0.9;

/** Прочитать процент 0..100 из localStorage (иначе значение по умолчанию) */
function readPct(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback / 100;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : fallback / 100;
}

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
  /** Отдельная шина для грома: она не приглушается вместе с эмбиентом,
   *  иначе нечем было бы приглушать дождь и ветер под раскат */
  private thunderGain: GainNode | null = null;
  /** Таймер возврата громкости после раската */
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private chirpTimer: ReturnType<typeof setTimeout> | null = null;
  private cityTimer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private night = false;
  private inCity = false;
  /** Тема: экраны входа / экран загрузки мира / игровой мир */
  private mode: 'auth' | 'loading' | 'game' = 'auth';
  /** Настроение игровой музыки: разведка / сюжетная / бой */
  private mood: 'explore' | 'story' | 'combat' = 'explore';
  private moodTimer: ReturnType<typeof setTimeout> | null = null;
  /** Текущая тема (для отладочного хука) */
  get currentMode(): 'auth' | 'loading' | 'game' { return this.mode; }
  private ambienceOn = false;
  private ambienceStarted = false;
  private _muted = localStorage.getItem('eos_mute') === '1';
  private _musicVol = readPct('eos_music_vol', 50);
  private _sfxVol = readPct('eos_sfx_vol', 70);
  /**
   * Видел ли браузер настоящий жест игрока.
   *
   * Браузеры запрещают создавать AudioContext без жеста: контекст
   * рождается « suspended », и Chrome ругается в консоль. Раньше этим
   * занимался installAuthMusicTrigger() — но ensure() звали ещё и
   * ensureLoading()/ensureGame() при входе в мир, и если игрок попадал
   * в мир по ссылке или с автовходом, контекст создавался раньше жеста.
   * Теперь проверка стоит внутри самого ensure() — оттуда не пройти.
   */
  private gestured = false;
  /** Что надо сделать, когда жест наконец случится */
  private pendingEnsure: (() => void) | null = null;

  get muted() { return this._muted; }
  /** Громкость музыки, проценты 0..100 */
  get musicVolume() { return Math.round(this._musicVol * 100); }
  /** Громкость эффектов и эмбиента, проценты 0..100 */
  get sfxVolume() { return Math.round(this._sfxVol * 100); }

  /**
   * Создать контекст и включить тему экранов входа/регистрации.
   * Браузер разрешает звук только после жеста пользователя — вызывается
   * из глобального слушателя installAuthMusicTrigger().
   */
  ensureAuth(): void {
    this.ensure();
    this.mode = 'auth';
    this.mood = 'explore';
    this.step = 0;
    (window as unknown as Record<string, unknown>).__eosAudio = 'auth';
    this.setAmbienceEnabled(false);
  }

  /**
   * Создать контекст — но только после жеста пользователя.
   *
   * Если жеста ещё не было, контекст НЕ создаётся: браузер всё равно
   * запустит его в suspended, а игрок получит предупреждение в консоли
   * и тишину. Вместо этого запоминаем, что нужно, и делаем это на
   * первом же клике или нажатии клавиши.
   */
  ensure(): void {
    if (!this.gestured) {
      this.pendingEnsure = () => this.ensure();
      return;
    }
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
    this.musicGain.gain.value = BASE_MUSIC * this._musicVol;
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = BASE_SFX * this._sfxVol;
    this.sfxGain.connect(this.master);
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = BASE_AMBIENCE * this._sfxVol;
    this.ambienceGain.connect(this.master);
    // Гром идёт в свою шину: приглушать надо дождь, ветер, музыку и
    // эффекты, а сам раскат остаётся на полной громкости
    this.thunderGain = ctx.createGain();
    this.thunderGain.gain.value = BASE_AMBIENCE * this._sfxVol;
    this.thunderGain.connect(this.master);

    // общий буфер шума для перкуссии/шагов/взмахов/эмбиента
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startMusic();

    // Диагностика: реальные уровни шин. Нужен, чтобы отличать «звук пропал»
    // от «звук заглушён раскатом» — по цифрам это видно сразу.
    (window as unknown as Record<string, unknown>).__eosAudioBuses = (): Record<string, number> => ({
      master: this.master?.gain.value ?? -1,
      music: this.musicGain?.gain.value ?? -1,
      sfx: this.sfxGain?.gain.value ?? -1,
      ambience: this.ambienceGain?.gain.value ?? -1,
      thunder: this.thunderGain?.gain.value ?? -1,
    });
  }

  /**
   * Экран загрузки мира: отдельная тема на светлом расте — нарастающие
   * пэды и редкий «тик», как счётчик загрузки. Эмбиент пока молчит.
   */
  ensureLoading(): void {
    this.ensure();
    this.mode = 'loading';
    this.mood = 'explore';
    this.step = 0;
    (window as unknown as Record<string, unknown>).__eosAudio = 'loading';
    this.setAmbienceEnabled(false);
  }

  /** Полный игровой звук: тема мира + эмбиент (ветер/птицы/гомон) */
  ensureGame(): void {
    this.ensure();
    this.mode = 'game';
    this.mood = 'explore';
    this.step = 0;
    (window as unknown as Record<string, unknown>).__eosAudio = 'game';
    this.setAmbienceEnabled(true);
  }

  /**
   * Настроение игровой музыки. «story» — во время сюжетных диалогов,
   * «combat» — после удара, сама возвращается в «explore».
   */
  setMusicMood(mood: 'explore' | 'story' | 'combat'): void {
    if (this.mood === mood) return;
    this.mood = mood;
    this.step = 0; // фраза начинается заново — тема не «съезжает» посередине
  }

  /** Бой начался: переключить на боевую тему и через паузу вернуть разведку */
  pokeCombat(seconds = 14): void {
    if (this.mode !== 'game' || this.mood === 'story') return;
    this.setMusicMood('combat');
    if (this.moodTimer) clearTimeout(this.moodTimer);
    this.moodTimer = setTimeout(() => {
      this.moodTimer = null;
      this.setMusicMood('explore');
    }, seconds * 1000);
  }

  /** Громкость музыки, проценты 0..100 */
  setMusicVolume(pct: number): void {
    this._musicVol = Math.max(0, Math.min(100, pct)) / 100;
    localStorage.setItem('eos_music_vol', String(Math.round(this._musicVol * 100)));
    this.applyVolumes();
  }

  /** Громкость эффектов и эмбиента, проценты 0..100 */
  setSfxVolume(pct: number): void {
    this._sfxVol = Math.max(0, Math.min(100, pct)) / 100;
    localStorage.setItem('eos_sfx_vol', String(Math.round(this._sfxVol * 100)));
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(BASE_MUSIC * this._musicVol, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(BASE_SFX * this._sfxVol, now, 0.05);
    if (this.ambienceGain && this.ambienceOn) {
      this.ambienceGain.gain.setTargetAtTime(BASE_AMBIENCE * this._sfxVol, now, 0.05);
    }
    // Шина громы не приглушается, но следует за ползунком эффектов
    if (this.thunderGain) {
      this.thunderGain.gain.setTargetAtTime(BASE_AMBIENCE * this._sfxVol, now, 0.05);
    }
  }

  /** Остановить все таймеры (выход из мира) */
  dispose(): void {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (this.chirpTimer) { clearTimeout(this.chirpTimer); this.chirpTimer = null; }
    if (this.cityTimer) { clearTimeout(this.cityTimer); this.cityTimer = null; }
    if (this.moodTimer) { clearTimeout(this.moodTimer); this.moodTimer = null; }
    // Возврат громкости после приглушения: иначе ушедший из мира
    // персонаж оставил бы music/sfx приглушёнными до перезагрузки
    if (this.duckTimer) { clearTimeout(this.duckTimer); this.duckTimer = null; }
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
      this.ambienceGain.gain.setTargetAtTime(
        on ? BASE_AMBIENCE * this._sfxVol : 0,
        this.ctx.currentTime,        0.6,
      );
    }
  }

  /**
   * Глобальный триггер: первый клик/клавиша на экранах входа, регистрации
   * и выбора персонажа запускает тему авторизации (политика автовоспроизведения).
   */
  installAuthMusicTrigger(): void {
    const trigger = () => {
      this.gestured = true;
      // Догоняем то, что не смогли сделать до жеста
      if (this.pendingEnsure) {
        const run = this.pendingEnsure;
        this.pendingEnsure = null;
        run();
      }
      if (this.mode !== 'game') this.ensureAuth();
    };
    // pointerdown срабатывает раньше click, поэтому контекст готов
    // уже к моменту, когда начнёт играть приветственная музыка
    document.addEventListener('pointerdown', trigger, { once: false });
    document.addEventListener('keydown', trigger, { once: false });
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

  /**
   * Раскат грома: низкий затухающий грохот.
   *
   * Раньше гром бил по эмбиент-шине с усилением 0.5, а отдельная нота
   * музыки даёт около 0.01 — раскат был в 10–45 раз громче всего
   * остального и на свои две секунды просто заглушал музыку, шаги и
   * эмбиент («звуки резко пропадают»). Плюс источник играл со
   * playbackRate 0.3, то есть двухсекундный буфер растягивался до
   * 6,7 с, но обрывался на 2,5-й — удар кончался щелчком.
   *
   * Теперь: своя шина, честная огибающая с длинным хвостом и
   * приглушение остальных шин на время раската — как в студийной
   * обработке. Гром слышно как событие, но он не затыкает игру.
   */
  thunder(): void {
    if (!this.ctx || !this.noiseBuf) return;
    if (this._muted || !this.ambienceOn) return;
    const out = this.thunderGain ?? this.ambienceGain;
    if (!out) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.2 + Math.random() * 1.4;

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;                       // хвост есть целиком, без обрыва
    n.playbackRate.value = 0.55;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.04);   // удар
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.6);    // быстрый спад
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);  // долгий хвост
    n.connect(f); f.connect(g); g.connect(out);
    // Старт не с нуля: два раска подряд из одного буфера звучат одинаково
    n.start(t, Math.random() * 1.2);
    n.stop(t + dur + 0.05);

    this.duckOthers(dur);
  }

  /**
   * Приглушить музыку, эффекты и эмбиент на время раската и вернуть
   * обратно. Перекрывающиеся раскаты продлевают приглушение: таймер
   * переносится, а не дублируется.
   */
  private duckOthers(dur: number): void {
    const ctx = this.ctx;
    const { musicGain: music, sfxGain: sfx, ambienceGain: amb } = this;
    if (!ctx || !music || !sfx) return;
    const t = ctx.currentTime;

    const restMusic = BASE_MUSIC * this._musicVol;
    const restSfx = BASE_SFX * this._sfxVol;
    const restAmb = BASE_AMBIENCE * this._sfxVol;

    music.gain.cancelScheduledValues(t);
    music.gain.setTargetAtTime(restMusic * 0.3, t, 0.1);
    sfx.gain.cancelScheduledValues(t);
    sfx.gain.setTargetAtTime(restSfx * 0.45, t, 0.1);
    if (amb) {
      amb.gain.cancelScheduledValues(t);
      amb.gain.setTargetAtTime(restAmb * 0.5, t, 0.15);
    }

    if (this.duckTimer) clearTimeout(this.duckTimer);
    const hold = Math.max(0.4, dur * 0.6);
    this.duckTimer = setTimeout(() => {
      const back = ctx.currentTime;
      music.gain.cancelScheduledValues(back);
      music.gain.setTargetAtTime(restMusic, back, 0.45);
      sfx.gain.cancelScheduledValues(back);
      sfx.gain.setTargetAtTime(restSfx, back, 0.35);
      if (amb) {
        amb.gain.cancelScheduledValues(back);
        amb.gain.setTargetAtTime(restAmb, back, 0.55);
      }
      this.duckTimer = null;
    }, hold * 1000);
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

  /** Один музыкальный такт (~1.9 с): тема выбирается по режиму и настроению */
  private musicStep(): void {
    const ctx = this.ctx, out = this.musicGain;
    if (!ctx || !out || ctx.state !== 'running') return;
    if (this.mode === 'auth') { this.authMusicStep(ctx); return; }
    if (this.mode === 'loading') { this.loadingMusicStep(ctx); return; }
    if (this.mood === 'story') { this.storyMusicStep(ctx); return; }
    if (this.mood === 'combat') { this.combatMusicStep(ctx); return; }
    this.exploreMusicStep(ctx);
  }

  /** Разведка: привычная тема мира — пэд, frame drum, ней и сантур */
  private exploreMusicStep(ctx: AudioContext): void {
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

    // Сантур: редкий перебор — фактура богаче, но такт не плотнее
    if (s % 4 === 2) {
      this.santur(scale[0], t + 0.1);
      this.santur(scale[2], t + 0.28);
      this.santur(scale[4], t + 0.46);
    }
  }

  /**
   * Сюжетная тема — во время диалогов и важных сцен. Без барабанов:
   * медленные пэды с терцией, выразительный ней и низкий каманче.
   */
  private storyMusicStep(ctx: AudioContext): void {
    const scale = HICAZ;
    const t = ctx.currentTime;
    const s = this.step++;

    if (s % 6 === 0) {
      const rootHz = scale[0] / 2;
      this.pad(rootHz, t, 11.4);
      this.pad(rootHz * 1.498, t, 11.4); // квинта
      this.pad(rootHz * 1.26, t, 11.4);  // терция — теплее, «рассказочнее»
    }
    // Каманче: длинная низкая нота под фразой
    if (s % 6 === 3) this.bowed(scale[0], t, 5.5);
    // Ней — медленными длинными фразами
    if (s % 3 === 1) {
      const idx = [0, 2, 3, 4, 5][Math.floor(Math.random() * 5)];
      this.ney(scale[idx] * 2, t + 0.25, 3.0);
    }
    // Тихий сантур в конце фразы — «точка» за мыслью
    if (s % 6 === 5) {
      this.santur(scale[5], t + 0.3);
      this.santur(scale[3], t + 0.55);
    }
  }

  /** Боевая тема: бас-остинато, двойной frame drum, сантур, тревожный ней */
  private combatMusicStep(ctx: AudioContext): void {
    const scale = HICAZ;
    const t = ctx.currentTime;
    const s = this.step++;

    // Низкий остинато держит напряжение
    this.bassPulse(scale[0] / 2, t, 1.9);
    if (s % 4 === 2) this.bassPulse(scale[4] / 4, t + 0.95, 0.9);

    // Барабан вполсилы: две восьмых внутри такта
    this.drum(t, 0.62);
    this.drum(t + 0.95, 0.38);
    if (s % 4 === 2) this.drum(t + 0.475, 0.22);

    // Сантур — короткие металлические щелчки в ритм
    if (s % 2 === 0) {
      const a = Math.floor(s / 2) % scale.length;
      this.santur(scale[a] * 2, t + 0.12);
      this.santur(scale[(a + 2) % scale.length] * 2, t + 0.58);
    }
    // Тревожный ней в конце фразы
    if (s % 4 === 3) this.ney(scale[2 + (s % 3)] * 2, t + 0.1, 1.3);
  }

  /**
   * Тема загрузки мира: светлый раст, нарастающие пэды, редкий «тик»
   * счётчика и ней, который уводит прямо в игровую тему.
   */
  private loadingMusicStep(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const s = this.step++;

    if (s % 4 === 0) {
      const rootHz = RAST_AUTH[0] / 2;
      this.pad(rootHz, t, 7.6);
      this.pad(rootHz * 1.498, t, 7.6);
      if (s % 8 === 0) this.pad(rootHz * 1.5, t, 7.6); // терция к концу
    }
    if (s % 2 === 1) this.loadTick(t);                  // счётчик загрузки
    if (s % 8 === 6) this.ney(RAST_AUTH[4], t + 0.2, 2.2);
    if (s % 8 === 7) {
      this.santur(RAST_AUTH[3], t + 0.2);
      this.santur(RAST_AUTH[5], t + 0.45);
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

  /** Сантур: короткий металлический щелчок струны (перебор, ритм) */
  private santur(hz: number, t: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    for (const det of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.75);
    }
    // «молоточек» — короткий шумовой щелчок
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + 0.08);
  }

  /** Каманче: натянутая струна — медленный вход, вибрато, тёплый фильтр */
  private bowed(hz: number, t: number, dur: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(420, t);
    filt.frequency.linearRampToValueAtTime(1250, t + dur * 0.45);
    filt.frequency.linearRampToValueAtTime(700, t + dur);
    filt.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.9);
    g.gain.linearRampToValueAtTime(0.038, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    filt.connect(g); g.connect(out);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const lfoG = ctx.createGain();
    lfoG.gain.value = hz * 0.008;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    o.connect(filt);
    o.start(t); o.stop(t + dur + 0.1);
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  /** Бас-остинато: низкий «пинок» — каркас боевой темы */
  private bassPulse(hz: number, t: number, dur: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(700, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filt); filt.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** «Тик» загрузчика: мягкий светлый сигнал счётчика */
  private loadTick(t: number): void {
    const ctx = this.ctx!, out = this.musicGain!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1567.98; // G6 — светлый, не раздражающий
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.25);
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
  /**
   * Парирование: металлический лязг.
   *
   * Отдельный звук, а не переиспользованный blocked: парирование — это
   * успех игрока, и оно должно звучать иначе, чем обычный блок. Иначе
   * игрок не услышит, что поймал удар в окно.
   */
  parry(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(2400, t, 0.22, 'triangle', 0.11, 1500);
    this.tone(3200, t + 0.02, 0.16, 'sine', 0.06, 2100);
    this.noise(t, 0.14, 'highpass', 4200, 0.07);
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

  // ── Интерфейс (клик, наведение, панели, ошибки) ─────────────
  /** Клик по кнопке: короткий сухой «тик» */
  uiClick(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1180, t, 0.045, 'square', 0.035, 860);
    this.noise(t, 0.05, 'highpass', 2600, 0.03);
  }
  /** Наведение: еле слышный шелест — курсор «зацепился» */
  uiHover(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.05, 'bandpass', 3200, 0.018);
  }
  /** Открытие панели/меню: восходящие полтона */
  uiOpen(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(523.25, t, 0.12, 'triangle', 0.05);       // C5
    this.tone(783.99, t + 0.06, 0.16, 'triangle', 0.05); // G5
  }
  /** Закрытие панели/меню: нисходящие полтона */
  uiClose(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(659.25, t, 0.1, 'triangle', 0.045);  // E5
    this.tone(392.0, t + 0.06, 0.16, 'triangle', 0.045); // G4
  }
  /** Отказ/ошибка: глухой низкий сигнал */
  uiError(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(150, t, 0.28, 'sawtooth', 0.07, 96);
    this.noise(t, 0.18, 'lowpass', 700, 0.06);
  }
  /** Уведомление/награда: светлый колокольчик */
  notify(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1318.5, t, 0.5, 'sine', 0.05);          // E6
    this.tone(1760.0, t + 0.09, 0.6, 'sine', 0.04);   // A6
  }
  /** Квест принят/выполнен: короткая фанфара в ладу */
  questDone(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [HICAZ[0], HICAZ[2], HICAZ[3], HICAZ[4]].forEach((hz, i) => {
      this.tone(hz * 2, t + i * 0.1, 0.3, 'triangle', 0.07);
    });
  }

  // ── Вода ────────────────────────────────────────────────────
  /** Всплеск при входе в воду: шумовой «уход» + брызги */
  splash(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.45, 'bandpass', 900, 0.16, 2600);
    this.noise(t + 0.04, 0.5, 'lowpass', 1800, 0.1, 500);
    for (let i = 0; i < 5; i++) {
      this.tone(700 + Math.random() * 1400, t + 0.05 + i * 0.05, 0.1, 'sine', 0.03, 1500);
    }
  }
  /** Шаг по воде: короткое журчание */
  waterStep(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.2, 'bandpass', 620, 0.11, 1500);
    this.noise(t + 0.02, 0.14, 'lowpass', 900, 0.06, 400);
  }
}

export const audio = new AudioEngine();
