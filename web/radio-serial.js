(() => {
  'use strict';

  const button = document.getElementById('knob-connect');
  if (!button) return;

  if (!('serial' in navigator)) {
    button.disabled = true;
    button.textContent = 'Knob needs Chrome';
    return;
  }

  let busy = false;

  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.textContent = 'Choose the ESP32';
    try {
      const port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 0x303a }],
      });
      button.disabled = true;
      button.textContent = 'Knob connected';
      setState('Waiting');
      await readPort(port);
    } catch (error) {
      busy = false;
      button.disabled = false;
      button.textContent = 'Connect knob';
      if (!error || error.name === 'NotFoundError') return;
      setState('Port busy');
      console.warn(error);
    }
  });

  async function readPort(port) {
    try {
      if (!port.readable) await port.open({ baudRate: 115200 });
      // Default DTR/RTS holds the ESP32-S3 in reset, so the knob never runs.
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await pump(port);
    } catch (error) {
      console.warn(error);
      setState('Link lost');
      try { await port.close(); } catch (closeError) { console.warn(closeError); }
    }
    button.disabled = false;
    button.textContent = 'Connect knob';
    busy = false;
  }

  async function pump(port) {
    const reader = port.readable.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.search(/\r?\n/)) >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut).replace(/^\r?\n/, '');
          takeLine(line);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  function takeLine(line) {
    if (line === '+' || line === '-') {
      stepFrequency(line === '+');
      return;
    }
    if (line === 'ready') {
      setState('Live');
      return;
    }
    if (line.startsWith('L ')) {
      const parts = line.split(' ');
      setState(`D2 ${parts[1]}  D3 ${parts[2]}`);
    }
  }

  function stepFrequency(up) {
    const radio = window.LOSTRadio;
    if (!radio) return;
    const next = radio.frequency + (up ? 0.1 : -0.1);
    radio.setFrequency(Math.round(next * 10) / 10);
  }

  function setState(text) {
    const state = document.getElementById('knob-state');
    if (state) state.textContent = text;
  }
})();
