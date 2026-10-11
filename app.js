/* Dusk FM — chill music player
   - demo streams + uploads + endless generative lo-fi (Web Audio)
   - ambience mixer (procedural noise, no assets needed)
*/
(() => {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const playBtn = $('playBtn'), nextBtn = $('nextBtn'), prevBtn = $('prevBtn');
  const shuffleBtn = $('shuffleBtn'), repeatBtn = $('repeatBtn');
  const seek = $('seek'), vol = $('vol'), volLabel = $('volLabel');
  const curTime = $('curTime'), durTime = $('durTime'), timeBadge = $('timeBadge');
  const titleEl = $('trackTitle'), artistEl = $('trackArtist'), tagEl = $('trackTag');
  const cover = $('cover'), coverEmoji = $('coverEmoji'), modeBadge = $('modeBadge');
  const listEl = $('playlist'), viz = $('viz'), toast = $('toast');
  const genBtn = $('genBtn'), rateLabel = $('rateLabel');
  const themeBtn = $('themeBtn'), sleepBtn = $('sleepBtn');
  const fileInput = $('fileInput');

  const DEMO = [
    { title: 'Midnight Static', artist: 'Dusk FM House Band', tag: 'lo-fi • 72 bpm', emoji: '🌊', hue: 250, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
    { title: 'Paper Lanterns', artist: 'Cassette Coast', tag: 'chillhop • 80 bpm', emoji: '🏮', hue: 320, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
    { title: 'Rain on Skylights', artist: 'Slow Parade', tag: 'ambient • 68 bpm', emoji: '🌧️', hue: 200, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
    { title: 'Honey Drip', artist: 'Velvet Static', tag: 'jazzy • 76 bpm', emoji: '🍯', hue: 35, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
    { title: 'Neon Nap', artist: 'Palm Dreams', tag: 'dreamy • 70 bpm', emoji: '💤', hue: 280, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
    { title: 'Cat on the Synth', artist: 'Window Seat', tag: 'cozy • 74 bpm', emoji: '🐈', hue: 150, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  ];

  let tracks = DEMO.map((t, i) => ({ ...t, id: 'demo-' + i, demo: true }));
  let idx = 0;
  let shuffle = false, repeat = false; // repeat = repeat-all; long-press idea skipped, single = all
  let generative = false;
  let rate = 1.0;
  let sleepTimer = null, sleepMin = 0;

  /* ---------- toast ---------- */
  let toastT;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ---------- stars ---------- */
  const stars = $('stars');
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${1 + Math.random() * 2}px;height:${1 + Math.random() * 2}px;border-radius:50%;background:#fff;opacity:${.2 + Math.random() * .6}`;
    stars.appendChild(s);
  }

  /* ---------- audio graph ---------- */
  let ctx = null, master, analyser, mediaSrc, genBus, ambBus;
  let vizData, vizCtx = viz.getContext('2d');
  function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = vol.value / 100;
    analyser = ctx.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.82;
    master.connect(analyser); analyser.connect(ctx.destination);
    vizData = new Uint8Array(analyser.frequencyBinCount);
    try {
      mediaSrc = ctx.createMediaElementSource(audio);
      mediaSrc.connect(master);
    } catch (e) { /* already connected */ }
    genBus = ctx.createGain(); genBus.gain.value = 0.9; genBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 1.0; ambBus.connect(master);
    startViz();
    initAmbience();
  }

  /* ---------- visualizer ---------- */
  function startViz() {
    function frame() {
      requestAnimationFrame(frame);
      const w = viz.width, h = viz.height;
      vizCtx.clearRect(0, 0, w, h);
      // gradient backdrop
      const g = vizCtx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#a78bfa'); g.addColorStop(.5, '#f0abfc'); g.addColorStop(1, '#67e8f9');
      vizCtx.fillStyle = g;
      if (analyser) {
        analyser.getByteFrequencyData(vizData);
        const n = vizData.length, bw = w / n;
        for (let i = 0; i < n; i++) {
          const v = vizData[i] / 255;
          const bh = Math.max(3, v * (h - 20));
          const x = i * bw;
          vizCtx.globalAlpha = 0.9;
          vizCtx.beginPath();
          vizCtx.roundRect(x + 1, h - bh - 8, Math.max(2, bw - 3), bh, 4);
          vizCtx.fill();
        }
        vizCtx.globalAlpha = 1;
      }
      // playhead line
      if (audio.duration && isFinite(audio.duration)) {
        const p = audio.currentTime / audio.duration;
        vizCtx.fillStyle = 'rgba(255,255,255,.85)';
        vizCtx.fillRect(p * w - 1, 0, 2, h);
      } else if (generative) {
        // animated wave when generating
        vizCtx.strokeStyle = 'rgba(255,255,255,.7)'; vizCtx.lineWidth = 2; vizCtx.beginPath();
        const t = performance.now() / 500;
        for (let x = 0; x <= w; x += 6) {
          const y = h / 2 + Math.sin(x / 40 + t) * 18 + Math.sin(x / 13 - t * 1.4) * 8;
          x === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
        }
        vizCtx.stroke();
      }
    }
    frame();
  }

  /* ---------- playlist ---------- */
  function fmt(s) {
    if (!isFinite(s) || s == null) return '0:00';
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function renderList() {
    listEl.innerHTML = '';
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'track' + (i === idx && !generative ? ' active' : '');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Play ${t.title} by ${t.artist}`);
      li.innerHTML = `<span class="n">${i === idx && !generative ? '♪' : (i + 1)}</span>
        <span class="t"><b></b><span></span></span>
        <span class="d">${t.demo ? 'stream' : 'local'}</span>
        ${t.demo ? '' : '<button class="x" title="Remove">✕</button>'}`;
      li.querySelector('b').textContent = t.title;
      li.querySelector('.t span').textContent = t.artist;
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) { removeUpload(i); return; }
        playIndex(i);
      });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') playIndex(i); });
      listEl.appendChild(li);
    });
  }
  function removeUpload(i) {
    const t = tracks[i];
    if (t.demo) return;
    if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src);
    tracks.splice(i, 1);
    if (idx >= tracks.length) idx = 0;
    renderList(); syncMeta();
    say('Removed ' + t.title);
  }
  $('clearUploads').addEventListener('click', () => {
    tracks.filter(t => !t.demo).forEach(t => { try { URL.revokeObjectURL(t.src); } catch {} });
    tracks = tracks.filter(t => t.demo);
    idx = 0; renderList(); say('Uploads cleared');
  });

  function syncMeta() {
    const t = tracks[idx];
    if (generative) {
      titleEl.textContent = 'Endless Lo-Fi ♾';
      artistEl.textContent = 'composed live in your browser';
      tagEl.textContent = 'generative • ' + GEN.key + ' • ' + GEN.bpm + ' bpm';
      coverEmoji.textContent = '✦';
      cover.style.background = `linear-gradient(135deg,hsl(265 80% 65%),hsl(310 85% 65%))`;
      modeBadge.textContent = audio.paused && !GEN.playing ? '● paused' : '● generating';
      timeBadge.textContent = '∞ live';
      durTime.textContent = '∞'; curTime.textContent = fmt(GEN.elapsed);
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: 'Endless Lo-Fi', artist: 'Dusk FM', album: 'Generative' });
      return;
    }
    titleEl.textContent = t.title;
    artistEl.textContent = t.artist;
    tagEl.textContent = t.tag;
    coverEmoji.textContent = t.emoji;
    cover.style.background = `linear-gradient(135deg,hsl(${t.hue} 75% 60%),hsl(${(t.hue + 60) % 360} 80% 60%))`;
    modeBadge.textContent = audio.paused ? '● paused' : '● playing';
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: 'Dusk FM' }); } catch {}
    }
  }

  function loadIndex(i, autoplay) {
    stopGenerative();
    idx = (i + tracks.length) % tracks.length;
    const t = tracks[idx];
    audio.src = t.src;
    audio.playbackRate = rate;
    renderList(); syncMeta();
    seek.value = 0; curTime.textContent = '0:00'; durTime.textContent = '0:00';
    if (autoplay) playAudio();
  }
  function playIndex(i) { loadIndex(i, true); }
  async function playAudio() {
    ensureCtx();
    if (generative) { resumeGenerative(); syncMeta(); updatePlayUI(); return; }
    try { await audio.play(); } catch (e) { say('Press play again — browser blocked autoplay'); }
  }
  function pauseAudio() {
    audio.pause();
    if (generative) pauseGenerative();
    updatePlayUI(); syncMeta();
  }
  function toggle() {
    ensureCtx();
    if (generative) { GEN.playing ? pauseAudio() : playAudio(); return; }
    audio.paused ? playAudio() : pauseAudio();
  }
  function updatePlayUI() {
    const playing = generative ? GEN.playing : !audio.paused;
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    document.querySelector('.player').classList.toggle('playing', playing);
    modeBadge.textContent = generative ? (playing ? '● generating' : '● paused') : (playing ? '● playing' : '● paused');
  }

  playBtn.addEventListener('click', toggle);
  nextBtn.addEventListener('click', () => step(1));
  prevBtn.addEventListener('click', () => {
    if (!generative && audio.currentTime > 3) { audio.currentTime = 0; return; }
    step(-1);
  });
  function step(d) {
    ensureCtx();
    if (generative) { GEN.nextProgression(); say('New chord mood ✦'); return; }
    if (shuffle && d > 0 && tracks.length > 1) {
      let n = idx; while (n === idx) n = Math.floor(Math.random() * tracks.length);
      return playIndex(n);
    }
    playIndex(idx + d);
  }
  audio.addEventListener('play', updatePlayUI);
  audio.addEventListener('pause', updatePlayUI);
  audio.addEventListener('loadedmetadata', () => { durTime.textContent = fmt(audio.duration); syncMeta(); });
  audio.addEventListener('timeupdate', () => {
    curTime.textContent = fmt(audio.currentTime);
    durTime.textContent = fmt(audio.duration);
    timeBadge.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    if (audio.duration) seek.value = Math.round(audio.currentTime / audio.duration * 1000);
  });
  audio.addEventListener('ended', () => {
    if (repeat) playIndex(idx);
    else if (shuffle && tracks.length > 1) step(1);
    else playIndex(idx + 1 < tracks.length ? idx + 1 : 0);
  });
  audio.addEventListener('error', () => { if (!generative) say('Stream hiccup — trying next…'); });

  seek.addEventListener('input', () => {
    if (generative) return;
    if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration;
  });
  vol.addEventListener('input', () => {
    volLabel.textContent = vol.value;
    if (master) master.gain.value = vol.value / 100;
    else audio.volume = vol.value / 100;
    localStorage.setItem('duskfm-vol', vol.value);
  });
  vol.value = localStorage.getItem('duskfm-vol') || 80;
  volLabel.textContent = vol.value;
  audio.volume = vol.value / 100;

  shuffleBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shuffleBtn.setAttribute('aria-pressed', shuffle);
    say('Shuffle ' + (shuffle ? 'on' : 'off'));
  });
  repeatBtn.addEventListener('click', () => {
    repeat = !repeat;
    repeatBtn.setAttribute('aria-pressed', repeat);
    say('Repeat ' + (repeat ? 'on' : 'off'));
  });
  function setRate(r) {
    rate = Math.min(1.5, Math.max(0.5, Math.round(r * 10) / 10));
    rateLabel.textContent = rate.toFixed(1) + '×';
    audio.playbackRate = rate;
    if (generative) GEN.setBpm(Math.round(72 * rate));
  }
  $('rateUp').addEventListener('click', () => setRate(rate + 0.1));
  $('rateDown').addEventListener('click', () => setRate(rate - 0.1));

  /* ---------- uploads ---------- */
  function addFiles(files) {
    ensureCtx();
    const list = [...files].filter(f => f.type.startsWith('audio/'));
    if (!list.length) { say('No audio files found'); return; }
    list.forEach(f => {
      tracks.push({ id: 'u' + Date.now() + Math.random().toString(16).slice(2), title: f.name.replace(/\.[^.]+$/, ''), artist: 'your upload', tag: 'local file', emoji: '🎧', hue: Math.floor(Math.random() * 360), src: URL.createObjectURL(f), demo: false });
    });
    renderList();
    say(`Added ${list.length} track${list.length > 1 ? 's' : ''} ✨`);
    if (list.length === tracks.length - DEMO.length || audio.paused && !generative) playIndex(tracks.length - list.length);
  }
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' && e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); document.body.classList.remove('dragover'); }));

  /* ---------- generative lo-fi engine ---------- */
  const GEN = {
    playing: false, bpm: 72, key: 'A minor', elapsed: 0,
    progIdx: 0, timer: null, clock: null, padNodes: [],
    // ii – V – I – VI in A minor-ish, warm frequencies
    progs: [
      { name: 'rainy window', chords: [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 349.23], [130.81, 164.81, 196, 261.63], [196, 246.94, 293.66, 392]] },
      { name: 'paper moon', chords: [[246.94, 293.66, 369.99, 440], [196, 246.94, 293.66, 349.23], [164.81, 196, 246.94, 329.63], [146.83, 174.61, 220, 293.66]] },
      { name: 'night bus', chords: [[110, 164.81, 261.63, 329.63], [87.31, 174.61, 261.63, 349.23], [130.81, 196, 246.94, 329.63], [98, 196, 246.94, 392]] },
    ],
    scale: [220, 246.94, 261.63, 293.66, 329.63, 392, 440, 523.25],
    setBpm(b) { this.bpm = b; if (this.playing) this.restart(); },
    nextProgression() { this.progIdx = Math.floor(Math.random() * this.progs.length); this.elapsed = 0; },
  };
  function beat() { return 60 / GEN.bpm; }

  function startGenerative() {
    ensureCtx();
    audio.pause();
    generative = true;
    genBtn.setAttribute('aria-pressed', 'true');
    document.querySelector('.amb[data-amb="vinyl"]').setAttribute('aria-pressed', 'true');
    setAmb('vinyl', true, true);
    GEN.playing = true; GEN.elapsed = 0;
    GEN.prog = GEN.progs[GEN.progIdx % GEN.progs.length];
    GEN.chordI = 0;
    clearInterval(GEN.timer); clearInterval(GEN.clock);
    scheduleChord(); // immediate
    GEN.timer = setInterval(scheduleChord, beat() * 4 * 1000);
    GEN.clock = setInterval(() => { GEN.elapsed += 1; if (generative) { curTime.textContent = fmt(GEN.elapsed); } }, 1000);
    // gentle random plucks
    schedulePluck();
    updatePlayUI(); syncMeta(); renderList();
    say('Endless lo-fi on ✦ (' + GEN.prog.name + ')');
  }
  function scheduleChord() {
    if (!GEN.playing) return;
    const chord = GEN.prog.chords[GEN.chordI % GEN.prog.chords.length];
    GEN.chordI++;
    const t = ctx.currentTime;
    // pad: stacked triangle oscs through lowpass
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, t);
    padGain.gain.linearRampToValueAtTime(0.16, t + 1.2);
    padGain.gain.setValueAtTime(0.16, t + beat() * 4 - 1.2);
    padGain.gain.linearRampToValueAtTime(0.0001, t + beat() * 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    padGain.connect(lp); lp.connect(genBus);
    chord.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f * (i === 0 ? 0.5 : 1);
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(padGain); o.start(t); o.stop(t + beat() * 4 + 0.1);
    });
    // soft vinyl-ish hat tick each beat
    for (let b = 0; b < 4; b++) tick(t + b * beat(), b === 0);
  }
  function tick(t, accent) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = accent ? 120 : 90;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.22 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(genBus); o.start(t); o.stop(t + 0.2);
    // hat: short noise
    noiseBurst(t + beat() / 2, 0.03, 6000, 0.05);
  }
  function noiseBuffer() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  let _nb = null;
  function noiseBurst(t, dur, freq, volm) {
    _nb = _nb || noiseBuffer();
    const s = ctx.createBufferSource(); s.buffer = _nb; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volm, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(genBus); s.start(t); s.stop(t + dur + 0.02);
  }
  function schedulePluck() {
    if (!GEN.playing) return;
    const delay = (1 + Math.random() * 3) * beat() * 1000;
    setTimeout(() => {
      if (GEN.playing) {
        pluck(GEN.scale[Math.floor(Math.random() * GEN.scale.length)] * (Math.random() < 0.3 ? 2 : 1));
        schedulePluck();
      }
    }, delay);
  }
  function pluck(freq) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2.001;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    o.connect(g); o2.connect(g); g.connect(lp); lp.connect(genBus);
    // wow: gentle vibrato
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
    const lg = ctx.createGain(); lg.gain.value = 4;
    lfo.connect(lg); lg.connect(o.frequency);
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + 2); o2.stop(t + 2); lfo.stop(t + 2);
  }
  function pauseGenerative() { GEN.playing = false; clearInterval(GEN.timer); clearInterval(GEN.clock); }
  function resumeGenerative() {
    GEN.playing = true;
    GEN.timer = setInterval(scheduleChord, beat() * 4 * 1000);
    GEN.clock = setInterval(() => { GEN.elapsed += 1; if (generative) curTime.textContent = fmt(GEN.elapsed); }, 1000);
    scheduleChord(); schedulePluck();
    updatePlayUI();
  }
  function stopGenerative(silent) {
    if (!generative) return;
    generative = false; GEN.playing = false;
    clearInterval(GEN.timer); clearInterval(GEN.clock);
    genBtn.setAttribute('aria-pressed', 'false');
    if (!silent) { updatePlayUI(); }
  }
  genBtn.addEventListener('click', () => {
    ensureCtx();
    if (generative) { stopGenerative(); loadIndex(idx, false); syncMeta(); updatePlayUI(); say('Generative off — back to playlist'); }
    else startGenerative();
  });

  /* ---------- procedural ambience ---------- */
  const AMB = {};
  function initAmbience() {
    const mk = (kind) => {
      const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ambBus);
      const st = { gain, on: false, level: 0.4, nodes: [] };
      AMB[kind] = st;
      if (kind === 'rain' || kind === 'fire' || kind === 'vinyl' || kind === 'night') {
        const src = ctx.createBufferSource(); src.buffer = longNoise(); src.loop = true;
        const f = ctx.createBiquadFilter();
        if (kind === 'rain') { f.type = 'bandpass'; f.frequency.value = 3500; f.Q.value = 0.5; }
        if (kind === 'fire') { f.type = 'lowpass'; f.frequency.value = 500; }
        if (kind === 'vinyl') { f.type = 'highpass'; f.frequency.value = 4000; }
        if (kind === 'night') { f.type = 'highpass'; f.frequency.value = 5000; }
        src.connect(f); f.connect(gain); src.start();
        st.nodes.push(src);
      }
      if (kind === 'fire') crackleLoop(st);
      if (kind === 'vinyl') vinylLoop(st);
      if (kind === 'night') cricketLoop(st);
      return st;
    };
    ['rain', 'fire', 'night', 'vinyl'].forEach(mk);
  }
  function longNoise() {
    if (longNoise._b) return longNoise._b;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = (w * 0.5 + last * 3) * 0.5; }
    longNoise._b = b; return b;
  }
  function crackleLoop(st) {
    (function pop() {
      setTimeout(() => {
        if (st.on && ctx) {
          const t = ctx.currentTime;
          const o = ctx.createBufferSource(); o.buffer = longNoise(); o.playbackRate.value = 2;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.12 * st.level + Math.random() * 0.15, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.08);
          const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800 + Math.random() * 2000;
          o.connect(f); f.connect(g); g.connect(ambBus);
          o.start(t); o.stop(t + 0.2);
        }
        pop();
      }, 120 + Math.random() * 500);
    })();
  }
  function vinylLoop(st) {
    (function pop() {
      setTimeout(() => {
        if (st.on && ctx) {
          const t = ctx.currentTime;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.05 + Math.random() * 0.08, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2000 + Math.random() * 3000;
          o.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 0.05);
        }
        pop();
      }, 200 + Math.random() * 900);
    })();
  }
  function cricketLoop(st) {
    (function chirp() {
      setTimeout(() => {
        if (st.on && ctx) {
          const t0 = ctx.currentTime;
          for (let i = 0; i < 3; i++) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4200 + Math.random() * 400;
            const g = ctx.createGain();
            const t = t0 + i * 0.09;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.05 * st.level + 0.01, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
            o.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 0.1);
          }
        }
        chirp();
      }, 1200 + Math.random() * 2500);
    })();
  }
  function setAmb(kind, on, silent) {
    const st = AMB[kind];
    if (!st) return;
    st.on = on;
    const target = on ? (st.level * 0.5) : 0;
    st.gain.gain.cancelScheduledValues(ctx.currentTime);
    st.gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.6);
    document.querySelector(`.amb[data-amb="${kind}"]`).setAttribute('aria-pressed', String(on));
    if (!silent) say(`${kind} ambience ${on ? 'on' : 'off'}`);
  }
  document.querySelectorAll('.amb').forEach(btn => {
    const kind = btn.dataset.amb;
    const slider = btn.querySelector('input');
    btn.addEventListener('click', (e) => {
      if (e.target === slider) return;
      ensureCtx();
      setAmb(kind, !(AMB[kind] && AMB[kind].on));
    });
    slider.addEventListener('input', () => {
      ensureCtx();
      const st = AMB[kind];
      st.level = slider.value / 100;
      if (st.on) st.gain.gain.linearRampToValueAtTime(st.level * 0.5, ctx.currentTime + 0.2);
    });
    slider.addEventListener('click', (e) => e.stopPropagation());
  });

  /* ---------- theme + sleep ---------- */
  function setTheme(t) {
    document.documentElement.dataset.theme = t === 'dawn' ? 'dawn' : '';
    document.body.dataset.theme = t === 'dawn' ? 'dawn' : '';
    themeBtn.textContent = t === 'dawn' ? '🌙 dusk' : '☀️ dawn';
    localStorage.setItem('duskfm-theme', t);
  }
  setTheme(localStorage.getItem('duskfm-theme') || 'dusk');
  themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dawn' ? 'dusk' : 'dawn'));

  const SLEEPS = [0, 15, 30, 60];
  sleepBtn.addEventListener('click', () => {
    const i = (SLEEPS.indexOf(sleepMin) + 1) % SLEEPS.length;
    sleepMin = SLEEPS[i];
    clearTimeout(sleepTimer);
    if (sleepMin > 0) {
      sleepTimer = setTimeout(() => { pauseAudio(); say('Sleep timer — music paused 🌙'); sleepMin = 0; sleepBtn.textContent = '⏲ sleep: off'; }, sleepMin * 60 * 1000);
      sleepBtn.textContent = `⏲ sleep: ${sleepMin}m`;
      say(`Sleep timer: ${sleepMin} min`);
    } else { sleepBtn.textContent = '⏲ sleep: off'; say('Sleep timer off'); }
  });

  /* ---------- keyboard + media keys ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="range"], input[type="text"]')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') { prevBtn.click(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); vol.value = Math.min(100, +vol.value + 5); vol.dispatchEvent(new Event('input')); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); vol.value = Math.max(0, +vol.value - 5); vol.dispatchEvent(new Event('input')); }
    else if (e.key.toLowerCase() === 's') shuffleBtn.click();
    else if (e.key.toLowerCase() === 'r') repeatBtn.click();
    else if (e.key.toLowerCase() === 'g') genBtn.click();
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', playAudio);
      navigator.mediaSession.setActionHandler('pause', pauseAudio);
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    } catch {}
  }

  /* ---------- init ---------- */
  renderList();
  syncMeta();
  updatePlayUI();
})();
