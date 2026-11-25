(() => {
  'use strict';

  const AUDIO_DIR = './audio';
  const WHITENOISE_SRC = `${AUDIO_DIR}/whitenoise.wav`;
  const LOOP_GAP_MS = 2000;
  const PROXIMITY_RANGE_MHZ = 0.5; // Distance within which station fades in & noise fades out
  const EXACT_TOLERANCE_MHZ = 0.05; // Treated as locked onto the exact station frequency
  const RAMP_TIME_SEC = 0.06;

  const FREQUENCY_TRACKS = {
    89.5: { file: '89.5.mp3', label: 'CH 89.5' },
    94.1: { file: '94.1.mp3', label: 'CH 94.1' },
    98.5: { file: '98.5.wav', label: 'CH 98.5' },
    103.3: { file: '103.3.mp3', label: 'CH 103.3' },
  };

  const radio = window.LOSTRadio;
  if (!radio) return;

  const stationEntries = Object.entries(FREQUENCY_TRACKS)
    .map(([freqStr, entry]) => ({
      frequency: Number(freqStr),
      file: entry.file,
      label: entry.label,
      url: `${AUDIO_DIR}/${encodeURIComponent(entry.file)}`,
    }))
    .filter((s) => !Number.isNaN(s.frequency))
    .sort((a, b) => a.frequency - b.frequency);

  const bufferCache = new Map();
  const stationControllers = new Map();

  let ctx = null;
  let outputNode = null;
  let noiseSource = null;
  let noiseGain = null;
  let noiseStarting = false;
  let lastNoiseTarget = null;
  let userInteracted = false;
  let rafId = null;

  async function loadBuffer(audioCtx, url) {
    if (bufferCache.has(url)) {
      return bufferCache.get(url);
    }
    const promise = (async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const arr = await res.arrayBuffer();
      return await audioCtx.decodeAudioData(arr);
    })();
    bufferCache.set(url, promise);
    try {
      return await promise;
    } catch (err) {
      bufferCache.delete(url);
      throw err;
    }
  }

  function rampTo(param, targetValue) {
    if (!ctx || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, targetValue));
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(clamped, now + RAMP_TIME_SEC);
  }

  async function ensureWhiteNoiseStarted() {
    if (!ctx || !outputNode || ctx.state === 'closed') return;
    if (!noiseGain) {
      noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(1, ctx.currentTime);
      noiseGain.connect(outputNode);
      lastNoiseTarget = 1;
    }
    if (noiseSource || noiseStarting) return;
    noiseStarting = true;
    try {
      const buffer = await loadBuffer(ctx, WHITENOISE_SRC);
      if (!ctx || ctx.state === 'closed' || noiseSource) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(noiseGain);
      src.start();
      noiseSource = src;
    } catch (err) {
      console.warn(`White noise failed (${WHITENOISE_SRC})`, err);
    } finally {
      noiseStarting = false;
    }
  }

  function computeStationMix(currentFreq, stationFreq) {
    if (typeof currentFreq !== 'number' || Number.isNaN(currentFreq)) {
      return 0;
    }
    const dist = Math.abs(currentFreq - stationFreq);
    if (dist <= EXACT_TOLERANCE_MHZ) {
      return 1;
    }
    if (dist >= PROXIMITY_RANGE_MHZ) {
      return 0;
    }
    const t = 1 - (dist - EXACT_TOLERANCE_MHZ) / (PROXIMITY_RANGE_MHZ - EXACT_TOLERANCE_MHZ);
    return t * t * (3 - 2 * t);
  }

  function createStationController(spec) {
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.connect(outputNode);

    let buffer = null;
    let loadFailed = false;
    let sourceNode = null;
    let gapTimerId = null;
    let isPlaying = false;
    let lastTargetMix = 0;

    function stopNode() {
      if (gapTimerId !== null) {
        window.clearTimeout(gapTimerId);
        gapTimerId = null;
      }
      isPlaying = false;
      if (sourceNode) {
        const current = sourceNode;
        sourceNode = null;
        current.onended = null;
        try {
          current.stop();
        } catch (_) {}
        try {
          current.disconnect();
        } catch (_) {}
      }
    }

    function startCycle() {
      if (!ctx || ctx.state === 'closed' || !buffer || loadFailed || isPlaying) return;
      isPlaying = true;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = false;
      src.connect(gainNode);
      src.onended = () => {
        if (sourceNode === src) {
          sourceNode = null;
        }
        src.onended = null;
        try {
          src.disconnect();
        } catch (_) {}
        isPlaying = false;

        if (!ctx || ctx.state === 'closed' || loadFailed) return;
        if (computeStationMix(radio.frequency, spec.frequency) > 0) {
          gapTimerId = window.setTimeout(() => {
            gapTimerId = null;
            if (!ctx || ctx.state === 'closed' || loadFailed) return;
            if (computeStationMix(radio.frequency, spec.frequency) > 0) {
              startCycle();
            }
          }, LOOP_GAP_MS);
        }
      };

      sourceNode = src;
      src.start();
    }

    loadBuffer(ctx, spec.url)
      .then((decoded) => {
        buffer = decoded;
        if (computeStationMix(radio.frequency, spec.frequency) > 0) {
          startCycle();
        }
      })
      .catch((err) => {
        loadFailed = true;
        console.warn(`Station audio failed (${spec.url}), keeping white noise`, err);
      });

    return {
      spec,
      applyMix(mix) {
        if (!ctx || ctx.state === 'closed') return;
        const effectiveMix = loadFailed ? 0 : mix;
        const quantized = Math.round(effectiveMix * 1000) / 1000;

        if (quantized !== lastTargetMix) {
          lastTargetMix = quantized;
          rampTo(gainNode.gain, quantized);
        }

        if (quantized > 0) {
          if (buffer && !isPlaying && gapTimerId === null) {
            startCycle();
          }
        } else {
          stopNode();
        }
      },
      destroy() {
        stopNode();
        try {
          gainNode.disconnect();
        } catch (_) {}
      },
    };
  }

  function resolveOutputTuple(out) {
    if (!out) return null;
    if (out.ctx && out.output) return { audioCtx: out.ctx, dest: out.output };
    if (out.context && out.output) return { audioCtx: out.context, dest: out.output };
    if (out instanceof AudioNode) {
      return { audioCtx: out.context, dest: out };
    }
    return null;
  }

  function ensureAudioReady() {
    if (!userInteracted) return false;
    if (ctx && outputNode) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return true;
    }
    if (typeof radio.ensureOutput === 'function') {
      const resolved = resolveOutputTuple(radio.ensureOutput());
      if (resolved && resolved.audioCtx && resolved.dest) {
        ctx = resolved.audioCtx;
        outputNode = resolved.dest;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        ensureWhiteNoiseStarted();
        stationEntries.forEach((spec) => {
          if (!stationControllers.has(spec.frequency)) {
            stationControllers.set(spec.frequency, createStationController(spec));
          }
        });
        return true;
      }
    }
    return false;
  }

  function updateMix() {
    if (!ensureAudioReady() || !ctx || ctx.state === 'closed') return;

    const currentFreq = typeof radio.frequency === 'number' ? radio.frequency : null;
    let highestStationMix = 0;

    stationControllers.forEach((ctrl, freq) => {
      const mix = computeStationMix(currentFreq, freq);
      if (mix > highestStationMix) {
        highestStationMix = mix;
      }
      ctrl.applyMix(mix);
    });

    if (noiseGain) {
      const noiseTarget = Math.round((1 - highestStationMix) * 1000) / 1000;
      if (noiseTarget !== lastNoiseTarget) {
        lastNoiseTarget = noiseTarget;
        rampTo(noiseGain.gain, noiseTarget);
      }
    }
  }

  radio.stations = stationEntries.map((spec) => ({
    frequency: spec.frequency,
    label: spec.label,
    tolerance: EXACT_TOLERANCE_MHZ,
    mount(mountCtx, mountOutput) {
      if (!ctx && mountCtx && mountOutput) {
        ctx = mountCtx;
        outputNode = mountOutput;
        ensureWhiteNoiseStarted();
        stationEntries.forEach((s) => {
          if (!stationControllers.has(s.frequency)) {
            stationControllers.set(s.frequency, createStationController(s));
          }
        });
      }
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      updateMix();
      return { stop() {} };
    },
  }));
  radio.refresh();

  function onUserGesture() {
    userInteracted = true;
    updateMix();
  }

  ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((evtName) => {
    window.addEventListener(evtName, onUserGesture, { passive: true });
  });

  function loop() {
    if (userInteracted) {
      updateMix();
    }
    rafId = window.requestAnimationFrame(loop);
  }

  rafId = window.requestAnimationFrame(loop);

  window.addEventListener('beforeunload', () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
    stationControllers.forEach((ctrl) => ctrl.destroy());
    stationControllers.clear();
    if (noiseSource) {
      try {
        noiseSource.stop();
        noiseSource.disconnect();
      } catch (_) {}
      noiseSource = null;
    }
  });
})();