(() => {
  'use strict';

  if (!window.THREE) return;

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
    a: [[8, 2], [32, 2], [36, 6], [32, 10], [8, 10], [4, 6]],
    b: [[32, 8], [36, 4], [40, 8], [40, 30], [36, 34], [32, 30]],
    c: [[32, 34], [36, 30], [40, 34], [40, 56], [36, 60], [32, 56]],
    d: [[8, 54], [32, 54], [36, 58], [32, 62], [8, 62], [4, 58]],
    e: [[4, 34], [8, 30], [12, 34], [12, 56], [8, 60], [4, 56]],
    f: [[4, 8], [8, 4], [12, 8], [12, 30], [8, 34], [4, 30]],
    g: [[8, 28], [32, 28], [36, 32], [32, 36], [8, 36], [4, 32]],
  };

  const knobs = {};
  let display = null;
  let displayText = '';

  window.RadioRig = { mount, setKnob, setDisplay };

  function mount() {
    mountKnob(document.getElementById('tune'));
    mountKnob(document.getElementById('volume'));
    display = mountDisplay(document.querySelector('.window'));
  }

  function setKnob(id, cssDegrees) {
    const view = knobs[id];
    if (!view) return;
    view.group.rotation.y = -THREE.MathUtils.degToRad(cssDegrees);
    view.renderer.render(view.scene, view.camera);
  }

  function setDisplay(text) {
    if (!display || text === displayText) return;
    displayText = text;
    drawReadout(display.ctx, display.canvas2d, text);
    display.texture.needsUpdate = true;
    display.renderer.render(display.scene, display.camera);
  }

  function mountKnob(el) {
    const canvas = document.createElement('canvas');
    canvas.className = 'knob-view';
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);
    el.classList.add('is-3d');

    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 12);
    camera.position.set(0, 6, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xd5dbe2, 0.35));
    const hemi = new THREE.HemisphereLight(0xf4f7fb, 0x2a2c30, 0.4);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff6ec, 2.6);
    key.position.set(-3.4, 6.5, -2.6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb7c3d0, 0.7);
    fill.position.set(2.8, 4.5, 2.2);
    scene.add(fill);

    const group = buildKnob();
    scene.add(group);

    const view = { renderer, scene, camera, group, canvas, host: el };
    knobs[el.id] = view;
    const paint = () => {
      fit(view);
      renderer.render(scene, camera);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(el);
  }

  function buildKnob() {
    const group = new THREE.Group();
    const brushed = brushMaps();
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0xd7dee4,
      metalness: 0.94,
      roughness: 0.32,
      normalMap: knurlNormal(),
      normalScale: new THREE.Vector2(0.85, 0.15),
      envMapIntensity: 1.2,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: brushed.color,
      roughnessMap: brushed.rough,
      metalness: 1,
      roughness: 0.38,
      envMapIntensity: 1.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x141618,
      metalness: 0.35,
      roughness: 0.5,
    });

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.08, 0.07, 72), skirtMat);
    foot.position.y = 0.035;
    group.add(foot);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.02, 0.42, 72), skirtMat);
    barrel.position.y = 0.26;
    group.add(barrel);

    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.032, 12, 72), capMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.46;
    group.add(lip);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.84, 0.1, 72), capMat);
    cap.position.y = 0.52;
    group.add(cap);

    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.028, 0.58), darkMat);
    mark.position.set(0, 0.585, -0.32);
    group.add(mark);

    return group;
  }

  function mountDisplay(host) {
    const canvas = document.createElement('canvas');
    canvas.id = 'display-view';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    host.classList.add('is-3d');

    const readout = document.createElement('canvas');
    readout.width = 1400;
    readout.height = 420;
    const ctx = readout.getContext('2d');
    const texture = new THREE.CanvasTexture(readout);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xd7dde4, 0.35));
    const key = new THREE.DirectionalLight(0xfff4e8, 2.1);
    key.position.set(-1.6, 3.4, 3.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb7c3d0, 0.45);
    fill.position.set(2.4, 0.6, 2);
    scene.add(fill);

    const housing = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({
      color: 0x2c3036,
      metalness: 0.9,
      roughness: 0.3,
      envMapIntensity: 1.15,
    });
    const edge = new THREE.MeshStandardMaterial({
      color: 0xc5ced6,
      metalness: 1,
      roughness: 0.24,
      envMapIntensity: 1.35,
    });

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(4.12, 0.9),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    screen.position.z = 0.04;
    housing.add(screen);

    addLip(housing, shell, edge);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(4.05, 0.82),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.04,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      })
    );
    glass.position.z = 0.2;
    housing.add(glass);

    scene.add(housing);

    const view = { renderer, scene, camera, housing, canvas, host, ctx, canvas2d: readout, texture };
    const paint = () => {
      fitDisplay(view);
      if (displayText) {
        drawReadout(ctx, readout, displayText);
        texture.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    paint();
    new ResizeObserver(paint).observe(host);
    return view;
  }

  function addLip(group, shell, edge) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 0.34), shell);
    top.position.set(0, 0.56, 0.08);
    const bottom = top.clone();
    bottom.position.y = -0.56;
    const sideGeo = new THREE.BoxGeometry(0.18, 0.96, 0.34);
    const left = new THREE.Mesh(sideGeo, shell);
    left.position.set(-2.21, 0, 0.08);
    const right = left.clone();
    right.position.x = 2.21;
    const bevel = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.045, 0.06), edge);
    bevel.position.set(0, 0.4, 0.22);
    const bevelBottom = bevel.clone();
    bevelBottom.position.y = -0.4;
    group.add(top, bottom, left, right, bevel, bevelBottom);
  }

  function fitDisplay(view) {
    const width = view.host.clientWidth || 640;
    const height = view.host.clientHeight || 118;
    view.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    view.renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    const halfH = 0.7;
    const halfW = halfH * aspect;
    view.camera.left = -halfW;
    view.camera.right = halfW;
    view.camera.top = halfH;
    view.camera.bottom = -halfH;
    view.camera.position.set(0, 0, 8);
    view.camera.lookAt(0, 0, 0);
    view.camera.updateProjectionMatrix();
    const scaleX = (halfW * 2) / 4.7;
    const scaleY = (halfH * 2) / 1.36;
    view.housing.scale.set(scaleX, scaleY, 1);
    // The bezel stretches to the wide window. The readout canvas must use that
    // same aspect, or the digit texture is squashed across the screen plane.
    const planeAspect = (4.12 * scaleX) / (0.9 * scaleY);
    const canvasH = 480;
    const canvasW = Math.max(1, Math.round(canvasH * planeAspect));
    const readout = view.canvas2d;
    if (readout.width !== canvasW || readout.height !== canvasH) {
      readout.width = canvasW;
      readout.height = canvasH;
      view.texture.needsUpdate = true;
    }
  }

  function drawReadout(ctx, canvas, text) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, width, height);
    const [whole, frac] = Number(text).toFixed(1).split('.');
    const chars = `${whole.padStart(3, ' ')}${frac}`.split('');
    const scale = (height * 0.74) / 66;
    const digitW = 44 * scale;
    const gap = 8 * scale;
    const dot = 16 * scale;
    const total = digitW * 4 + gap * 3 + dot;
    let x = (width - total) / 2;
    const y = (height - 66 * scale) / 2;
    chars.forEach((char, index) => {
      if (index === 3) {
        ctx.shadowColor = '#ff3a18';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ff4b2a';
        ctx.beginPath();
        ctx.arc(x + dot * 0.42, y + 56 * scale, 2.1 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        x += dot;
      }
      drawDigit(ctx, char, x, y, scale);
      x += digitW + gap;
    });
  }

  function drawDigit(ctx, char, x, y, scale) {
    const lit = char === ' ' ? '' : SEGMENT_MAP[char] || '';
    Object.keys(SEGMENT_POINTS).forEach((name) => {
      const on = lit.includes(name);
      ctx.beginPath();
      SEGMENT_POINTS[name].forEach((point, index) => {
        const px = x + point[0] * scale;
        const py = y + point[1] * scale;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.shadowBlur = on ? 22 : 0;
      ctx.shadowColor = '#ff2e12';
      ctx.fillStyle = on ? '#ff4d2e' : 'rgba(255, 55, 30, 0.13)';
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }

  function fit(view) {
    const width = view.host.clientWidth || 120;
    const height = view.host.clientHeight || 120;
    view.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    view.renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    const half = 1.2;
    const camera = view.camera;
    if (aspect >= 1) {
      camera.top = half;
      camera.bottom = -half;
      camera.left = -half * aspect;
      camera.right = half * aspect;
    } else {
      camera.left = -half;
      camera.right = half;
      camera.top = half / aspect;
      camera.bottom = -half / aspect;
    }
    camera.updateProjectionMatrix();
  }

  function makeRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  }

  function studioEnv(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8d939a);
    const add = (color, x, y, z, w, h) => {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color })
      );
      panel.position.set(x, y, z);
      panel.lookAt(0, 0, 0);
      scene.add(panel);
    };
    add(0xffffff, 0, 3.2, 0.4, 5, 1.4);
    add(0xe7edf2, -2.4, 1.1, 1.6, 1.6, 2.4);
    add(0xb7c0c8, 2.2, 0.4, 1.2, 1.4, 1.8);
    add(0x2c3036, 0, -1.5, 1.5, 4, 1.2);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const map = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    return map;
  }

  function knurlNormal() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, 512, 64);
    for (let x = 0; x < 512; x += 8) {
      ctx.fillStyle = '#2a2ac8';
      ctx.fillRect(x, 0, 2, 64);
      ctx.fillStyle = '#d0d0ff';
      ctx.fillRect(x + 4, 0, 2, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 1);
    return texture;
  }

  function brushMaps() {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 512;
    colorCanvas.height = 512;
    const colorCtx = colorCanvas.getContext('2d');
    colorCtx.fillStyle = '#d5dbe1';
    colorCtx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 1) {
      const tone = 175 + Math.random() * 70;
      colorCtx.fillStyle = `rgba(${tone}, ${tone}, ${tone + 6}, 0.28)`;
      colorCtx.fillRect(0, y, 512, 1);
    }
    const color = new THREE.CanvasTexture(colorCanvas);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = THREE.RepeatWrapping;
    color.wrapT = THREE.RepeatWrapping;
    color.anisotropy = 8;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = 512;
    roughCanvas.height = 512;
    const roughCtx = roughCanvas.getContext('2d');
    roughCtx.fillStyle = '#6e6e6e';
    roughCtx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 2) {
      const tone = 70 + Math.random() * 90;
      roughCtx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
      roughCtx.fillRect(0, y, 512, 1);
    }
    const rough = new THREE.CanvasTexture(roughCanvas);
    rough.wrapS = THREE.RepeatWrapping;
    rough.wrapT = THREE.RepeatWrapping;
    return { color, rough };
  }
})();
