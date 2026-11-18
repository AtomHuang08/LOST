(() => {
  'use strict';

  // 音量旋钮驱动 output（GainNode），增益是旋钮位置的平方。
  // 接音频：把音源 connect 到 LOSTRadio.output，或往 stations 里加台后调用 refresh()。
  // station = { frequency, label, tolerance?, mount(ctx, output) => { stop() } }
  // 尚未解锁音频时 output 为 null；拖动旋钮或调用 ensureOutput() 后才会创建。

  const MIN_TENTHS = 875;
  const MAX_TENTHS = 1080;
  const SWEEP = 270;
  const START = 240;
  const BAR_COUNT = 10;

  const SEGMENT_MAP = {
    0: 'abcdef',
    1: 'bc',
    2: 'abdeg',
    3: 'abcdg',
    4: 'bcfg',
    5: 'acdfg',
    6: 'acdefg',
    7: 'abc',
    8: 'abcdefg',
    9: 'abcdfg',
  };

  const SEGMENT_POINTS = {
    a: '8,2 32,2 36,6 32,10 8,10 4,6',
    b: '32,8 36,4 40,8 40,30 36,34 32,30',
    c: '32,34 36,30 40,34 40,56 36,60 32,56',
    d: '8,54 32,54 36,58 32,62 8,62 4,58',
    e: '4,34 8,30 12,34 12,56 8,60 4,56',
    f: '4,8 8,4 12,8 12,30 8,34 4,30',
    g: '8,28 32,28 36,32 32,36 8,36 4,32',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const tuneKnob = document.getElementById('tune');
  const volumeKnob = document.getElementById('volume');
  const digitRow = document.getElementById('digits');
  const scale = document.getElementById('scale');
  const needle = document.getElementById('needle');
  const status = document.getElementById('status');
  const volNum = document.getElementById('vol-num');
  const bars = document.getElementById('bars');

  const state = {
    precise: 98.5,
    tenths: 985,
    volume: 0.7,
    ctx: null,
    gain: null,
  };

  const listeners = new Set();
  let mounted = null;
  const digitSlots = [];

  const radio = {
    minFrequency: MIN_TENTHS / 10,
    maxFrequency: MAX_TENTHS / 10,
    stations: [],
    get frequency() { return state.tenths / 10; },
    get volume() { return state.volume; },
    get outputGain() { return taper(state.volume); },
    get context() { return state.ctx; },
    get output() { return state.gain; },
    get tuned() { return mounted?.station ?? null; },
    setFrequency,
    setVolume,
    ensureOutput,
    refresh,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  window.LOSTRadio = radio;

  init();

  function init() {
    buildDigits();
    buildScale();
    buildBars();
    bindKnob(tuneKnob, {
      get: () => (state.precise - MIN_TENTHS / 10) / ((MAX_TENTHS - MIN_TENTHS) / 10),
      set: (unit) => setFrequency(MIN_TENTHS / 10 + unit * (MAX_TENTHS - MIN_TENTHS) / 10),
      step: 1 / (MAX_TENTHS - MIN_TENTHS),
      page: 10 / (MAX_TENTHS - MIN_TENTHS),
      onRelease: () => setFrequency(state.tenths / 10),
    });
    bindKnob(volumeKnob, {
      get: () => state.volume,
      set: (unit) => setVolume(unit),
      step: 0.02,
      page: 0.1,
    });
    if (window.RadioRig) {
      try { RadioRig.mount(); } catch (error) { console.warn('3D view unavailable', error); }
    }
    render();
  }

  function buildDigits() {
    for (let i = 0; i < 4; i += 1) {
      if (i === 3) {
        const point = document.createElement('span');
        point.className = 'point';
        point.setAttribute('aria-hidden', 'true');
        digitRow.appendChild(point);
      }
      const digit = document.createElementNS(SVG_NS, 'svg');
      digit.setAttribute('viewBox', '0 0 44 66');
      digit.setAttribute('class', 'digit');
      digit.setAttribute('aria-hidden', 'true');
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        const seg = document.createElementNS(SVG_NS, 'polygon');
        seg.setAttribute('points', SEGMENT_POINTS[name]);
        seg.dataset.seg = name;
        digit.appendChild(seg);
      }
      digitRow.appendChild(digit);
      digitSlots.push(digit);
    }
  }

  function buildScale() {
    const track = document.createElement('div');
    track.className = 'scale-track';
    scale.appendChild(track);
    track.appendChild(needle);
    for (let mhz = 88; mhz <= 108; mhz += 1) {
      const tick = document.createElement('span');
      const major = mhz % 2 === 0;
      tick.className = major ? 'tick major' : 'tick';
      tick.style.removeProperty('left');
      tick.style.setProperty('--p', String(percentFor(mhz) / 100));
      if (mhz % 4 === 0) {
        const label = document.createElement('span');
        label.className = 'tick-label';
        label.textContent = String(mhz);
        tick.appendChild(label);
      }
      scale.appendChild(tick);
    }
  }

  function buildBars() {
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const bar = document.createElement('i');
      bar.style.setProperty('--i', String(i));
      bars.appendChild(bar);
    }
  }

  function bindKnob(el, { get, set, step, page, onRelease }) {
    let dragging = false;
    let lastAngle = 0;
    let lastY = 0;

    const geometry = (event) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      return { rect, cx, cy, dx, dy, dist: Math.hypot(dx, dy) };
    };

    el.addEventListener('pointerdown', (event) => {
      dragging = true;
      const point = geometry(event);
      lastAngle = Math.atan2(point.dy, point.dx);
      lastY = event.clientY;
      el.setPointerCapture(event.pointerId);
      el.focus();
      ensureOutput();
    });

    el.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const point = geometry(event);
      if (point.dist < point.rect.width * 0.28) {
        const delta = (lastY - event.clientY) / (point.rect.height * 1.35);
        lastY = event.clientY;
        lastAngle = Math.atan2(point.dy, point.dx);
        set(clamp(get() + delta, 0, 1));
        return;
      }
      const angle = Math.atan2(point.dy, point.dx);
      let delta = angle - lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      lastAngle = angle;
      lastY = event.clientY;
      set(clamp(get() + delta / (Math.PI * 1.5), 0, 1));
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      onRelease?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const amount = event.shiftKey ? step / 5 : step;
      set(clamp(get() + direction * amount, 0, 1));
      ensureOutput();
    }, { passive: false });

    el.addEventListener('keydown', (event) => {
      const keyStep = {
        ArrowUp: step,
        ArrowRight: step,
        ArrowDown: -step,
        ArrowLeft: -step,
        PageUp: page,
        PageDown: -page,
      }[event.key];
      if (keyStep) {
        event.preventDefault();
        set(clamp(get() + keyStep * (event.shiftKey ? 0.2 : 1), 0, 1));
        ensureOutput();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        set(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        set(1);
      }
    });
  }

  function setFrequency(mhz) {
    const precise = clamp(Number(mhz), MIN_TENTHS / 10, MAX_TENTHS / 10);
    const tenths = clamp(Math.round(precise * 10), MIN_TENTHS, MAX_TENTHS);
    const displayChanged = tenths !== state.tenths;
    const moved = Math.abs(precise - state.precise) > 0.00001;
    if (!displayChanged && !moved) return;
    state.precise = precise;
    state.tenths = tenths;
    if (displayChanged) syncStation();
    render();
    if (displayChanged) emit();
  }

  function setVolume(unit) {
    const volume = clamp(Number(unit), 0, 1);
    if (Math.abs(volume - state.volume) < 0.0005) return;
    state.volume = volume;
    applyGain();
    render();
    emit();
  }

  function ensureOutput() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!state.ctx) {
      state.ctx = new Ctx();
      state.gain = state.ctx.createGain();
      state.gain.gain.value = taper(state.volume);
      state.gain.connect(state.ctx.destination);
      mountIfReady();
    }
    if (state.ctx.state === 'suspended') state.ctx.resume();
    return state.gain;
  }

  function applyGain() {
    if (!state.gain || !state.ctx) return;
    const now = state.ctx.currentTime;
    state.gain.gain.cancelScheduledValues(now);
    state.gain.gain.setTargetAtTime(taper(state.volume), now, 0.02);
  }

  function refresh() {
    stopMounted();
    syncStation();
    render();
    emit();
  }

  function syncStation() {
    const match = nearestStation(state.tenths / 10);
    const station = match?.station ?? null;
    if ((mounted?.station ?? null) === station) {
      renderSignal(match);
      return;
    }
    stopMounted();
    if (station) {
      mounted = { station, handle: null, pending: true };
      mountIfReady();
    }
    renderStatus();
    renderSignal(match);
  }

  function mountIfReady() {
    if (!mounted?.pending || !state.ctx || !state.gain) return;
    try {
      mounted.handle = mounted.station.mount?.(state.ctx, state.gain) ?? null;
      mounted.pending = false;
    } catch (error) {
      mounted.pending = false;
      mounted.error = error;
      console.warn('Station failed to mount', error);
    }
  }

  function stopMounted() {
    if (!mounted) return;
    try {
      mounted.handle?.stop?.();
    } catch (error) {
      console.warn('Station failed to stop', error);
    }
    mounted = null;
  }

  function nearestStation(frequency) {
    let best = null;
    let bestDistance = Infinity;
    for (const station of radio.stations) {
      const tolerance = station.tolerance ?? 0.25;
      const distance = Math.abs(station.frequency - frequency);
      if (distance <= tolerance && distance < bestDistance) {
        best = station;
        bestDistance = distance;
      }
    }
    return best ? { station: best, distance: bestDistance } : null;
  }

  function render() {
    const frequency = state.tenths / 10;
    const [whole, frac] = frequency.toFixed(1).split('.');
    const chars = whole.padStart(3, ' ').concat(frac);
    digitSlots.forEach((slot, index) => {
      const blank = chars[index] === ' ';
      const lit = blank ? '' : SEGMENT_MAP[chars[index]];
      slot.classList.toggle('is-blank', blank);
      slot.querySelectorAll('polygon').forEach((seg) => {
        seg.classList.toggle('on', lit.includes(seg.dataset.seg));
      });
    });
    if (window.RadioRig) RadioRig.setDisplay(frequency.toFixed(1));
    needle.style.removeProperty('left');
    needle.style.setProperty('--p', String(percentFor(frequency) / 100));
    volNum.textContent = String(Math.round(state.volume * 100));
    paintKnob(tuneKnob, (state.precise - MIN_TENTHS / 10) / ((MAX_TENTHS - MIN_TENTHS) / 10));
    paintKnob(volumeKnob, state.volume);
    tuneKnob.setAttribute('aria-valuenow', frequency.toFixed(1));
    tuneKnob.setAttribute('aria-valuetext', `${frequency.toFixed(1)} megahertz`);
    volumeKnob.setAttribute('aria-valuenow', String(Math.round(state.volume * 100)));
    volumeKnob.setAttribute('aria-valuetext', `output volume ${Math.round(state.volume * 100)}`);
    renderStatus();
    renderSignal(nearestStation(frequency));
  }

  function renderStatus() {
    const station = mounted?.station;
    status.textContent = station ? station.label || 'TUNED' : 'NO SIGNAL';
    status.classList.toggle('is-tuned', Boolean(station));
  }

  function renderSignal(match) {
    let level = 0;
    if (match) {
      const tolerance = match.station.tolerance ?? 0.25;
      const strength = 1 - match.distance / tolerance;
      level = Math.max(1, Math.round(strength * BAR_COUNT));
    }
    bars.querySelectorAll('i').forEach((bar, index) => {
      bar.classList.toggle('on', index < level);
    });
  }

  function paintKnob(el, unit) {
    const t = clamp(unit, 0, 1);
    const angle = START + t * SWEEP;
    el.style.setProperty('--sweep', `${t * SWEEP}deg`);
    el.style.setProperty('--angle', `${angle}deg`);
    if (window.RadioRig) RadioRig.setKnob(el.id, angle);
  }

  function percentFor(mhz) {
    return ((mhz - MIN_TENTHS / 10) / ((MAX_TENTHS - MIN_TENTHS) / 10)) * 100;
  }

  function taper(volume) {
    if (volume <= 0) return 0;
    return volume * volume;
  }

  function emit() {
    const snapshot = {
      frequency: state.tenths / 10,
      volume: state.volume,
      outputGain: taper(state.volume),
      station: mounted?.station ?? null,
    };
    listeners.forEach((fn) => fn(snapshot));
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }
})();
