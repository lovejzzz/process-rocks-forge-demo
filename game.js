/* ── Game logic & UI ── */
(function () {
  'use strict';

  /* ── State ── */
  let sourceCollection  = null;
  let processId         = null;
  let productCollection = null;
  let savedMaterials    = [];
  let savedCounter      = 0;

  let dragType = null; // track what is being dragged

  const baseRock = Rock.createBase();

  /* ── Sound (Web Audio) ──
     Layered SFX: chord + filtered noise burst + optional bend.
     Still 8-bit in spirit, but with more body so impacts feel weightier. */
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);

  // Reusable noise buffer (~1s of white noise)
  const NOISE_BUF = (() => {
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  })();

  function playTone(freq, duration, type, vol, bend) {
    const t0 = audioCtx.currentTime;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    g.connect(masterGain);
    const o = audioCtx.createOscillator();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq * bend), t0 + duration);
    o.connect(g);
    o.start(t0); o.stop(t0 + duration + 0.02);
  }

  function playNoise(duration, vol, filterFreq, filterQ, filterType) {
    const t0 = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = NOISE_BUF;
    const filt = audioCtx.createBiquadFilter();
    filt.type = filterType || 'bandpass';
    filt.frequency.value = filterFreq || 1200;
    filt.Q.value = filterQ || 1;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filt).connect(g).connect(masterGain);
    src.start(t0); src.stop(t0 + duration + 0.02);
  }

  function playChord(freqs, duration, type, vol) {
    for (const f of freqs) playTone(f, duration, type, (vol || 0.1) / Math.sqrt(freqs.length));
  }

  function sfxDrop()   { playTone(520, 0.05, 'square', 0.06); playTone(780, 0.04, 'triangle', 0.04); }
  function sfxForge()  {
    playChord([220, 330, 440], 0.18, 'square', 0.08);
    playNoise(0.12, 0.1, 900, 1.4);
  }
  function sfxDone()   {
    playChord([660, 880, 1320], 0.22, 'triangle', 0.09);
    playNoise(0.08, 0.05, 4000, 2, 'highpass');
  }
  function sfxTrash()  { playTone(200, 0.1, 'sawtooth', 0.06, 0.4); playNoise(0.08, 0.06, 400); }
  function sfxReject() { playTone(150, 0.08, 'square', 0.05, 0.6); }

  // Per-process forge SFX — layered to feel weightier.
  function sfxProcess(pid) {
    switch (pid) {
      case 'gold_plated':
        playChord([523, 659, 784, 1047], 0.35, 'triangle', 0.09);
        playNoise(0.15, 0.05, 6000, 1.5, 'highpass');
        break;
      case 'mosaic_ruby':
        playChord([349, 440, 523], 0.25, 'square', 0.08);
        playNoise(0.18, 0.08, 1800, 3);
        break;
      case 'flip':
        playTone(440, 0.25, 'sine', 0.12, 1.6);
        playNoise(0.1, 0.06, 1500, 2);
        break;
      case 'split_half':
        playNoise(0.3, 0.18, 2500, 4);
        playTone(120, 0.4, 'sawtooth', 0.14, 0.25);
        playChord([330, 660], 0.2, 'square', 0.07);
        break;
      case 'emerald_filler':
        playChord([392, 523, 659, 784], 0.45, 'sine', 0.1);
        playNoise(0.2, 0.06, 3200, 2.5, 'highpass');
        break;
    }
  }

  /* ── DOM refs ── */
  const sourceBox      = document.getElementById('source-box');
  const processBox     = document.getElementById('process-box');
  const productBox     = document.getElementById('product-box');
  const forgeBtn       = document.getElementById('forge-btn');
  const historyDiv     = document.getElementById('history');
  const saveZone       = document.getElementById('save-zone');
  const savedDiv       = document.getElementById('saved-materials');
  const sourceCanvas   = sourceBox.querySelector('canvas');
  const trashCan       = document.getElementById('trash-can');
  const forgeOverlay   = document.getElementById('forge-overlay');
  const forgeStage     = document.getElementById('forge-stage');
  const forgeFlash     = document.getElementById('forge-flash');
  const forgeAnimCanvas = document.getElementById('forge-anim-canvas');
  const forgeAnimLabel = document.getElementById('forge-anim-label');
  const animCtx        = forgeAnimCanvas.getContext('2d');

  /* ── FX helpers ── */

  // Easings.
  const EASE = {
    outCubic:  t => 1 - Math.pow(1 - t, 3),
    inCubic:   t => t * t * t,
    inOutCubic:t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outQuint:  t => 1 - Math.pow(1 - t, 5),
    outBack:   t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
    outElastic:t => {
      if (t === 0 || t === 1) return t;
      const c = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
    },
  };

  // Screen shake (applied to the forge stage via transform).
  const shake = { x: 0, y: 0, mag: 0, decay: 0.88 };
  function kickShake(mag) { shake.mag = Math.max(shake.mag, mag); }
  function tickShake() {
    if (shake.mag > 0.2) {
      shake.x = (Math.random() - 0.5) * shake.mag * 2;
      shake.y = (Math.random() - 0.5) * shake.mag * 2;
      shake.mag *= shake.decay;
      if (forgeStage) forgeStage.style.transform = 'translate(' + shake.x.toFixed(2) + 'px,' + shake.y.toFixed(2) + 'px)';
    } else if (shake.mag !== 0) {
      shake.mag = 0; shake.x = 0; shake.y = 0;
      if (forgeStage) forgeStage.style.transform = '';
    }
    requestAnimationFrame(tickShake);
  }
  tickShake();

  // Radial bloom flash centered on the forge stage. Edges stay transparent
  // so it reads as a bright halo on the canvas, not a full-screen tint.
  function hexToRgb(h) {
    h = (h || '#ffffff').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function flash(color, intensity, duration) {
    if (!forgeFlash) return;
    const [r, g, b] = hexToRgb(color || '#ffffff');
    // Anchor the bloom on the forge canvas.
    let cx = '50%', cy = '50%';
    if (forgeAnimCanvas) {
      const rect = forgeAnimCanvas.getBoundingClientRect();
      cx = (rect.left + rect.width / 2) + 'px';
      cy = (rect.top  + rect.height / 2) + 'px';
    }
    forgeFlash.style.background =
      'radial-gradient(circle at ' + cx + ' ' + cy + ',' +
      ' rgba(' + r + ',' + g + ',' + b + ',0.95) 0%,' +
      ' rgba(' + r + ',' + g + ',' + b + ',0.4) 14%,' +
      ' rgba(' + r + ',' + g + ',' + b + ',0) 36%)';
    forgeFlash.style.transition = 'opacity 40ms linear';
    forgeFlash.style.opacity = String(Math.min(0.85, intensity || 0.5));
    setTimeout(() => {
      forgeFlash.style.transition = 'opacity ' + (duration || 220) + 'ms ease-out';
      forgeFlash.style.opacity = '0';
    }, 40);
  }

  // Draw a soft radial glow at (x,y) on the anim canvas.
  function drawGlow(x, y, radius, color, alpha) {
    const grad = animCtx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    animCtx.save();
    animCtx.globalCompositeOperation = 'lighter';
    animCtx.globalAlpha = alpha == null ? 1 : alpha;
    animCtx.fillStyle = grad;
    animCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    animCtx.restore();
  }

  // Spawn a lightning-bolt polyline between two points with jitter + branches.
  function drawLightning(x1, y1, x2, y2, color, alpha, width) {
    const segs = 12;
    const amp  = Math.hypot(x2 - x1, y2 - y1) * 0.08;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jitter = (i === 0 || i === segs) ? 0 : (Math.random() - 0.5) * amp;
      pts.push({ x: x1 + (x2 - x1) * t + jitter, y: y1 + (y2 - y1) * t });
    }
    animCtx.save();
    animCtx.globalCompositeOperation = 'lighter';
    animCtx.strokeStyle = color;
    animCtx.globalAlpha = alpha;
    animCtx.shadowColor = color;
    animCtx.shadowBlur = 14;
    animCtx.lineWidth = width;
    animCtx.beginPath();
    animCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) animCtx.lineTo(pts[i].x, pts[i].y);
    animCtx.stroke();
    // Branches
    for (let i = 2; i < pts.length - 2; i++) {
      if (Math.random() > 0.7) {
        const bx = pts[i].x + (Math.random() - 0.5) * amp * 2;
        const by = pts[i].y + (Math.random() - 0.5) * amp * 2;
        animCtx.lineWidth = Math.max(1, width * 0.5);
        animCtx.globalAlpha = alpha * 0.6;
        animCtx.beginPath();
        animCtx.moveTo(pts[i].x, pts[i].y);
        animCtx.lineTo(bx, by);
        animCtx.stroke();
      }
    }
    animCtx.restore();
  }

  /* ── Draw sidebar rock ── */
  baseRock.render(document.getElementById('sidebar-rock-canvas'));

  /* ── Particle system (typed, with trails + additive blending) ──
     Types:
       'spark'  — bright streak, gravity pull, long trail, additive
       'ember'  — soft glow, slow drift, rises then falls
       'dust'   — small fragment chunks, high gravity, bounce-free
       'ring'   — expanding hollow ring (impact)
       'shard'  — rotating chip with no gravity
  */
  const particleCanvas = document.createElement('canvas');
  particleCanvas.id = 'particle-canvas';
  document.body.appendChild(particleCanvas);
  const pctx = particleCanvas.getContext('2d');
  let particles = [];

  function resizeParticles() {
    particleCanvas.width  = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeParticles);
  resizeParticles();

  // Back-compat shim used by old call sites.
  function spawnParticles(cx, cy, color, count) {
    spawnBurst(cx, cy, color, count, 'spark');
  }

  function spawnBurst(cx, cy, color, count, type) {
    type = type || 'spark';
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      let speed, life, size, gravity;
      switch (type) {
        case 'ember':
          speed = 0.4 + Math.random() * 1.6;
          life  = 50 + Math.random() * 40;
          size  = 2 + Math.random() * 3;
          gravity = 0.02;
          break;
        case 'dust':
          speed = 1 + Math.random() * 3;
          life  = 30 + Math.random() * 20;
          size  = 1 + Math.random() * 2;
          gravity = 0.22;
          break;
        case 'shard':
          speed = 2 + Math.random() * 4;
          life  = 40 + Math.random() * 30;
          size  = 2 + Math.random() * 3;
          gravity = 0.15;
          break;
        case 'spark':
        default:
          speed = 2 + Math.random() * 5;
          life  = 30 + Math.random() * 25;
          size  = 1.5 + Math.random() * 2.5;
          gravity = 0.06;
      }
      particles.push({
        type,
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'ember' ? 1.4 : 1.8),
        life, maxLife: life,
        size,
        gravity,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        color,
        trail: [],
      });
    }
  }

  function spawnRing(cx, cy, color, radiusPx, thickness) {
    particles.push({
      type: 'ring',
      x: cx, y: cy,
      r: 2, maxR: radiusPx,
      thickness: thickness || 2,
      life: 22, maxLife: 22,
      color,
    });
  }

  function tickParticles() {
    pctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    const prevComp = pctx.globalCompositeOperation;

    const keep = [];
    for (const p of particles) {
      if (p.type === 'ring') {
        const t = 1 - p.life / p.maxLife;
        p.r = p.maxR * (1 - Math.pow(1 - t, 3));
        p.life--;
        pctx.globalCompositeOperation = 'lighter';
        pctx.globalAlpha = (1 - t) * 0.9;
        pctx.strokeStyle = p.color;
        pctx.lineWidth = p.thickness;
        pctx.beginPath();
        pctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        pctx.stroke();
        if (p.life > 0) keep.push(p);
        continue;
      }

      // Track trail
      if (p.type === 'spark' || p.type === 'shard') {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 6) p.trail.shift();
      }

      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rot += p.vrot || 0;
      p.life--;

      const alpha = p.life / p.maxLife;

      if (p.type === 'spark' || p.type === 'ember') {
        pctx.globalCompositeOperation = 'lighter';
      } else {
        pctx.globalCompositeOperation = 'source-over';
      }

      // Trail
      if (p.trail && p.trail.length > 1) {
        pctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < p.trail.length; i++) {
          const t = p.trail[i];
          const a = (i / p.trail.length) * alpha * 0.55;
          pctx.globalAlpha = a;
          pctx.fillStyle = p.color;
          const s = Math.max(1, p.size * (i / p.trail.length));
          pctx.fillRect(Math.round(t.x - s / 2), Math.round(t.y - s / 2), Math.round(s), Math.round(s));
        }
      }

      // Head
      pctx.globalAlpha = alpha;
      pctx.fillStyle = p.color;
      const s = Math.max(1, Math.round(p.size));
      if (p.type === 'shard') {
        pctx.save();
        pctx.translate(p.x, p.y);
        pctx.rotate(p.rot);
        pctx.fillRect(-s, -s / 2, s * 2, s);
        pctx.restore();
      } else if (p.type === 'ember') {
        // Soft blob: stacked rects
        pctx.globalAlpha = alpha * 0.45;
        pctx.fillRect(Math.round(p.x - s), Math.round(p.y - s), s * 2, s * 2);
        pctx.globalAlpha = alpha;
        pctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      } else {
        pctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      }

      if (p.life > 0) keep.push(p);
    }
    particles = keep;

    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = prevComp;
    requestAnimationFrame(tickParticles);
  }
  tickParticles();

  /* ── Helpers ── */
  const PROCESS_NAMES = {
    flip:           'Flip',
    mosaic_ruby:    'Mosaic Ruby',
    gold_plated:    'Gold Plated',
    split_half:     'Split Half',
    emerald_filler: 'Emerald Filler',
  };

  const PROCESS_COLORS = {
    flip:           '#e0e0e0',
    mosaic_ruby:    '#dc143c',
    gold_plated:    '#ffd700',
    split_half:     '#88ccff',
    emerald_filler: '#2fdc8a',
  };

  const PROCESS_ICONS = {
    flip:           { symbol: '↔', cls: '' },
    mosaic_ruby:    { symbol: '◆', cls: 'ruby-icon' },
    gold_plated:    { symbol: '✦', cls: 'gold-icon' },
    split_half:     { symbol: '⫽', cls: '' },
    emerald_filler: { symbol: '❖', cls: 'emerald-icon' },
  };

  function updateForgeBtn() {
    const hasSelected = sourceCollection && sourceCollection.hasSelection();
    let valid = hasSelected && processId;
    if (valid && processId === 'emerald_filler') {
      valid = sourceCollection.hasAdjacentSelected();
    }
    forgeBtn.disabled = !valid;
  }

  function renderSource() {
    if (sourceCollection) {
      sourceCollection.render(sourceCanvas, true);
    } else {
      sourceCanvas.getContext('2d').clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    }
  }

  function setSource(coll) {
    sourceCollection = coll;
    sourceBox.classList.toggle('filled', !!coll);
    sourceBox.classList.toggle('has-multi', !!(coll && coll.pieces.length > 1));
    sourceBox.draggable = !!coll;
    renderSource();
    updateForgeBtn();
  }

  function setProcess(id) {
    processId = id;
    processBox.classList.toggle('filled', !!id);
    processBox.draggable = !!id;
    const disp = processBox.querySelector('.process-display');
    if (id) {
      const icon = PROCESS_ICONS[id];
      disp.innerHTML =
        '<div class="process-box-icon ' + icon.cls + '">' + icon.symbol + '</div>' +
        '<div class="process-box-name" style="color:' + PROCESS_COLORS[id] + '">' +
        PROCESS_NAMES[id] + '</div>';
    } else {
      disp.innerHTML = '';
    }
    updateForgeBtn();
  }

  function setProduct(coll) {
    productCollection = coll;
    const c = productBox.querySelector('canvas');
    productBox.classList.toggle('filled', !!coll);
    productBox.classList.toggle('has-product', !!coll);
    if (coll) {
      coll.render(c, false);
      if (coll.history.length) {
        historyDiv.innerHTML = '<b>History:</b> ' +
          coll.history.map(h => '<span>' + h + '</span>').join(' → ');
      }
    } else {
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }
    productBox.draggable = !!coll;
    updateForgeBtn();
  }

  /* ── Click to select pieces in source ── */
  sourceCanvas.addEventListener('click', e => {
    if (!sourceCollection) return;
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = sourceCanvas.width / rect.width;
    const scaleY = sourceCanvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const idx = sourceCollection.hitTest(cx, cy);
    if (idx >= 0) {
      sourceCollection.toggleSelect(idx);
      renderSource();
      updateForgeBtn();
    }
  });

  /* ── Drag & drop ── */

  document.querySelectorAll('.sidebar-item[data-type]').forEach(el => {
    el.addEventListener('dragstart', e => {
      const type = el.dataset.type;
      if (type === 'rock') {
        dragType = 'rock';
        e.dataTransfer.setData('text/plain', 'rock');
      } else if (type === 'process') {
        dragType = 'process';
        e.dataTransfer.setData('text/plain', 'process:' + el.dataset.process);
      }
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dragend', () => { dragType = null; });
  });

  productBox.addEventListener('dragstart', e => {
    if (!productCollection) { e.preventDefault(); return; }
    dragType = 'product';
    e.dataTransfer.setData('text/plain', 'product');
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  productBox.addEventListener('dragend', () => { dragType = null; });

  sourceBox.addEventListener('dragstart', e => {
    if (!sourceCollection) { e.preventDefault(); return; }
    dragType = 'source';
    e.dataTransfer.setData('text/plain', 'source');
    e.dataTransfer.effectAllowed = 'move';
  });
  sourceBox.addEventListener('dragend', () => { dragType = null; });

  processBox.addEventListener('dragstart', e => {
    if (!processId) { e.preventDefault(); return; }
    dragType = 'boxprocess';
    e.dataTransfer.setData('text/plain', 'boxprocess');
    e.dataTransfer.effectAllowed = 'move';
  });
  processBox.addEventListener('dragend', () => { dragType = null; });

  function addDropZone(el, acceptFn, rejectTest) {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (rejectTest && rejectTest()) {
        el.classList.add('drag-reject');
        el.classList.remove('drag-over');
      } else {
        el.classList.add('drag-over');
        el.classList.remove('drag-reject');
      }
    });
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove('drag-over');
        el.classList.remove('drag-reject');
      }
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const rejected = el.classList.contains('drag-reject');
      el.classList.remove('drag-over');
      el.classList.remove('drag-reject');
      if (rejected) { sfxReject(); return; }
      acceptFn(e.dataTransfer.getData('text/plain'));
    });
  }

  addDropZone(sourceBox, data => {
    if (data === 'rock') {
      sfxDrop();
      setSource(RockCollection.fromRock(baseRock));
    } else if (data === 'product' && productCollection) {
      const coll = productCollection.clone();
      coll.selectAll();
      setSource(coll);
      setProduct(null);
    } else if (data.startsWith('saved:')) {
      const idx = parseInt(data.split(':')[1]);
      if (savedMaterials[idx]) {
        const coll = savedMaterials[idx].clone();
        coll.selectAll();
        setSource(coll);
      }
    }
  }, () => dragType === 'process');

  addDropZone(processBox, data => {
    if (data.startsWith('process:')) { sfxDrop(); setProcess(data.split(':')[1]); }
  });

  addDropZone(saveZone, data => {
    if (data === 'product' && productCollection) {
      sfxDrop();
      saveMaterial(productCollection.clone());
    }
  });

  // Trash can
  addDropZone(trashCan, data => {
    if (data === 'product') {
      sfxTrash(); setProduct(null);
    } else if (data === 'source') {
      sfxTrash(); setSource(null);
    } else if (data === 'boxprocess') {
      sfxTrash(); setProcess(null);
    } else if (data.startsWith('saved:')) {
      const idx = parseInt(data.split(':')[1]);
      const el = savedDiv.querySelector('[data-saved-index="' + idx + '"');
      if (el) { sfxTrash(); el.remove(); savedMaterials[idx] = null; }
    }
  });

  /* ── Save material to sidebar ── */
  function saveMaterial(collection) {
    savedCounter++;
    const idx = savedMaterials.length;
    collection.deselectAll();
    savedMaterials.push(collection);

    const item = document.createElement('div');
    item.className = 'sidebar-item saved-material';
    item.draggable = true;
    item.dataset.type = 'saved';
    item.dataset.savedIndex = idx;

    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 120;
    collection.render(canvas, false);

    const label = document.createElement('span');
    label.textContent = 'Custom #' + savedCounter;

    item.appendChild(canvas);
    item.appendChild(label);
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', 'saved:' + idx);
      e.dataTransfer.effectAllowed = 'copy';
    });
    savedDiv.appendChild(item);
  }

  /* ═══════════════════════════════════════════
     FORGE ANIMATION SYSTEM
     ═══════════════════════════════════════════ */

  function canvasScreenPos() {
    const r = forgeAnimCanvas.getBoundingClientRect();
    return {
      rect: r,
      ds: r.width / forgeAnimCanvas.width,
    };
  }

  function finishAnimation(resultColl, callback) {
    resultColl.render(forgeAnimCanvas, false);
    sfxDone();
    setTimeout(() => {
      forgeOverlay.classList.remove('active');
      callback();
    }, 380);
  }

  function showForgeAnimation(sourceColl, resultColl, pid, callback) {
    forgeOverlay.classList.add('active');
    forgeAnimLabel.textContent = PROCESS_NAMES[pid] + '...';
    forgeAnimLabel.style.color = PROCESS_COLORS[pid];
    sfxProcess(pid);

    const finish = () => finishAnimation(resultColl, callback);

    switch (pid) {
      case 'gold_plated':    animateGoldPlating(sourceColl, resultColl, finish); break;
      case 'mosaic_ruby':    animateRubyMosaic(sourceColl, resultColl, finish); break;
      case 'flip':           animateFlip(sourceColl, resultColl, finish); break;
      case 'split_half':     animateSplit(sourceColl, resultColl, finish); break;
      case 'emerald_filler': animateEmeraldFiller(sourceColl, resultColl, finish); break;
      default: finish();
    }
  }

  // Map a canvas point (x,y in 400x400 space) to screen coords.
  function canvasToScreen(x, y) {
    const { rect, ds } = canvasScreenPos();
    return { sx: rect.left + x * ds, sy: rect.top + y * ds };
  }

  /* ── Pixel-diff helper ── */
  function getPixelChanges(sourceColl, resultColl) {
    const changes = [];
    for (let i = 0; i < sourceColl.pieces.length; i++) {
      if (!sourceColl.pieces[i].selected) continue;
      const before = sourceColl.pieces[i].rock;
      const after  = resultColl.pieces[i].rock;
      for (let y = 0; y < before.h; y++)
        for (let x = 0; x < before.w; x++) {
          const b = before.grid[y][x];
          const a = after.grid[y][x];
          if (!b && !a) continue;
          if (!b || !a || b.mat !== a.mat || b.shade !== a.shade)
            changes.push({ pi: i, x, y, mat: a ? a.mat : 0, shade: a ? a.shade : 0 });
        }
    }
    return changes;
  }

  /* ── Gold Plating: charge → radial molten-gold sweep → shine + pop ── */
  function animateGoldPlating(sourceColl, resultColl, finish) {
    const work = resultColl.clone();
    // Render once so _bounds / _scale are populated, then hide new gold pixels.
    work.render(forgeAnimCanvas, false);
    const scale = work._scale || 4;

    // Find new gold border pixels and hide them initially.
    // Pre-compute distance from piece center so the sweep is radial.
    const goldPixels = [];
    for (let i = 0; i < resultColl.pieces.length; i++) {
      if (!sourceColl.pieces[i].selected) continue;
      const src = sourceColl.pieces[i].rock;
      const res = resultColl.pieces[i].rock;
      const cxP = res.w / 2, cyP = res.h / 2;
      for (let y = 0; y < res.h; y++)
        for (let x = 0; x < res.w; x++) {
          const p = res.grid[y][x];
          if (!p) continue;
          const ox = x - 1, oy = y - 1;
          const isOriginal = ox >= 0 && ox < src.w && oy >= 0 && oy < src.h && src.grid[oy][ox];
          if (!isOriginal) {
            const dist = Math.hypot(x - cxP, y - cyP);
            goldPixels.push({ pi: i, x, y, mat: p.mat, shade: p.shade, dist });
            work.pieces[i].rock.grid[y][x] = null;
          }
        }
    }
    goldPixels.sort((a, b) => a.dist - b.dist);

    const chargeMs = 260;
    const sweepMs  = 900;
    const popMs    = 280;
    const total = chargeMs + sweepMs + popMs;
    const start = performance.now();
    const n = goldPixels.length;
    let revealed = 0;

    // Piece centers in canvas coords for glow.
    const centers = work._bounds.map((b, i) => ({
      cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2,
      sel: sourceColl.pieces[i].selected,
    }));

    function frame(now) {
      const dt = now - start;
      animCtx.clearRect(0, 0, 400, 400);

      if (dt < chargeMs) {
        // Phase 1: charge — render source, pulse a gold glow at each piece center.
        sourceColl.render(forgeAnimCanvas, false);
        const p = dt / chargeMs;
        const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 4);
        for (const c of centers) {
          if (!c.sel) continue;
          drawGlow(c.cx, c.cy, c.r * (1.2 + 0.4 * pulse), 'rgba(255,215,0,' + (0.5 * pulse).toFixed(3) + ')', 1);
        }
        if (p > 0.5 && Math.random() < 0.5) {
          for (const c of centers) if (c.sel) {
            const { sx, sy } = canvasToScreen(c.cx + (Math.random() - 0.5) * c.r, c.cy + (Math.random() - 0.5) * c.r);
            spawnBurst(sx, sy, '#ffd700', 1, 'ember');
          }
        }
      } else if (dt < chargeMs + sweepMs) {
        // Phase 2: radial sweep — reveal gold pixels in dist order.
        const p = (dt - chargeMs) / sweepMs;
        const targetRevealed = Math.floor(EASE.outCubic(p) * n);
        while (revealed < targetRevealed) {
          const c = goldPixels[revealed];
          work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
          revealed++;
        }
        work.render(forgeAnimCanvas, false);

        // Bright "wave front" glow between last revealed and next hidden.
        if (revealed > 0 && revealed < n) {
          const frontDist = goldPixels[revealed].dist;
          for (const c of centers) {
            if (!c.sel) continue;
            drawGlow(c.cx, c.cy, frontDist * scale * 1.3,
              'rgba(255,230,120,0.28)', 1);
          }
        }

        // Sparks at the frontier.
        if (revealed > 0) {
          const stepsThisFrame = Math.max(1, Math.min(6, Math.ceil(n / 50)));
          for (let k = 0; k < stepsThisFrame && revealed - k > 0; k++) {
            const px = goldPixels[revealed - 1 - k];
            const b = work._bounds[px.pi];
            if (!b) continue;
            const { sx, sy } = canvasToScreen(b.x + px.x * scale + scale / 2, b.y + px.y * scale + scale / 2);
            if (Math.random() < 0.35) spawnBurst(sx, sy, '#ffd700', 1, 'spark');
          }
        }
      } else {
        // Phase 3: finished gold — shine sweep + pop.
        while (revealed < n) {
          const c = goldPixels[revealed];
          work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
          revealed++;
        }
        const p = (dt - chargeMs - sweepMs) / popMs;

        work.render(forgeAnimCanvas, false);

        // Diagonal shine sweep — painted with `source-atop` so it only
        // touches pixels that are already on the canvas (i.e. the rock
        // silhouette). With `lighter` this would additively paint the
        // whole bounding-box rectangle over the dark background and read
        // as a square flash.
        animCtx.save();
        animCtx.globalCompositeOperation = 'source-atop';
        for (const b of work._bounds) {
          const bandX = b.x - b.w + p * (b.w * 2.2);
          const grad = animCtx.createLinearGradient(bandX, 0, bandX + b.w * 0.45, b.h);
          grad.addColorStop(0,   'rgba(255,255,255,0)');
          grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
          grad.addColorStop(1,   'rgba(255,255,255,0)');
          animCtx.fillStyle = grad;
          animCtx.fillRect(b.x, b.y, b.w, b.h);
        }
        animCtx.restore();

        // Kick flash + shake once.
        if (p < 0.08) {
          flash('#ffe680', 0.35, 240);
          kickShake(5);
          for (const c of centers) {
            if (!c.sel) continue;
            const { sx, sy } = canvasToScreen(c.cx, c.cy);
            spawnRing(sx, sy, '#ffd700', c.r * 2.2, 3);
            spawnBurst(sx, sy, '#fff0a0', 16, 'spark');
          }
        }
      }

      if (dt < total) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Ruby Mosaic: aura → staggered pop-in with rings → red flash ── */
  function animateRubyMosaic(sourceColl, resultColl, finish) {
    const changes = getPixelChanges(sourceColl, resultColl);
    for (let i = changes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [changes[i], changes[j]] = [changes[j], changes[i]];
    }

    const work = sourceColl.clone();
    work.render(forgeAnimCanvas, false);
    const scale = work._scale || 4;

    const auraMs = 300;
    const popMs  = 950;
    const flashMs = 260;
    const total = auraMs + popMs + flashMs;
    const start = performance.now();
    const n = changes.length;
    let revealed = 0;

    const centers = work._bounds.map((b, i) => ({
      cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2,
      sel: sourceColl.pieces[i].selected,
    }));

    function frame(now) {
      const dt = now - start;
      animCtx.clearRect(0, 0, 400, 400);

      if (dt < auraMs) {
        work.render(forgeAnimCanvas, false);
        const p = dt / auraMs;
        const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 3);
        for (const c of centers) {
          if (!c.sel) continue;
          drawGlow(c.cx, c.cy, c.r * (1.1 + 0.3 * pulse),
            'rgba(220,20,60,' + (0.42 * pulse).toFixed(3) + ')', 1);
        }
      } else if (dt < auraMs + popMs) {
        const p = (dt - auraMs) / popMs;
        const target = Math.floor(EASE.outQuint(p) * n);
        let justRevealed = 0;
        while (revealed < target) {
          const c = changes[revealed];
          work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
          revealed++;
          justRevealed++;
        }
        work.render(forgeAnimCanvas, false);

        // For each newly revealed ruby this frame, emit a tiny ring + sparks.
        const emitBudget = Math.min(justRevealed, 5);
        for (let k = 0; k < emitBudget; k++) {
          const idx2 = revealed - 1 - Math.floor(Math.random() * justRevealed);
          const c = changes[idx2];
          const b = work._bounds[c.pi];
          if (!b) continue;
          const { sx, sy } = canvasToScreen(b.x + c.x * scale + scale / 2, b.y + c.y * scale + scale / 2);
          spawnRing(sx, sy, '#ff3060', scale * 3, 2);
          if (Math.random() < 0.6) spawnBurst(sx, sy, '#ff4060', 2, 'spark');
          if (Math.random() < 0.3) spawnBurst(sx, sy, '#dc143c', 1, 'ember');
        }
      } else {
        while (revealed < n) {
          const c = changes[revealed];
          work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
          revealed++;
        }
        const p = (dt - auraMs - popMs) / flashMs;
        work.render(forgeAnimCanvas, false);
        if (p < 0.08) {
          flash('#ff4060', 0.5, 240);
          kickShake(4);
          for (const c of centers) {
            if (!c.sel) continue;
            const { sx, sy } = canvasToScreen(c.cx, c.cy);
            spawnRing(sx, sy, '#dc143c', c.r * 2, 3);
          }
        }
      }

      if (dt < total) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Flip: anticipation squash → 3D-ish rotate w/ motion trails → overshoot settle ── */
  function animateFlip(sourceColl, resultColl, finish) {
    sourceColl.render(forgeAnimCanvas, false);
    const bounds = sourceColl._bounds.map(b => ({ ...b }));
    const scale = sourceColl._scale;

    // Pre-render source/result per-piece to their own small offscreens so we
    // can apply transforms cleanly.
    function pieceCanvas(coll, i) {
      const b = bounds[i];
      const c = document.createElement('canvas');
      c.width = b.w; c.height = b.h;
      coll.pieces[i].rock.renderAt(c.getContext('2d'), 0, 0, scale);
      return c;
    }
    const srcCanvases = sourceColl.pieces.map((_, i) => pieceCanvas(sourceColl, i));
    const resCanvases = resultColl.pieces.map((_, i) => pieceCanvas(resultColl, i));

    const duration = 900;
    const start = performance.now();
    let flashedMid = false;

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      animCtx.clearRect(0, 0, 400, 400);

      for (let i = 0; i < sourceColl.pieces.length; i++) {
        const b = bounds[i];
        if (!sourceColl.pieces[i].selected) {
          animCtx.drawImage(srcCanvases[i], b.x, b.y);
          continue;
        }

        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;

        // 0..0.2  anticipation  (squash slightly, tiny counter-rotate)
        // 0.2..0.8 rotation     (scaleX goes 1 → 0 → 1 in flipped form)
        // 0.8..1  overshoot settle
        let sx, skew, srcAlpha, resAlpha;
        if (t < 0.2) {
          const p = t / 0.2;
          const squash = 1 - 0.08 * EASE.outCubic(p);
          sx = squash; skew = -0.05 * p;
          srcAlpha = 1; resAlpha = 0;
        } else if (t < 0.8) {
          const p = (t - 0.2) / 0.6;
          // True flip: scaleX does cos(p*pi): 1 at 0, -1 at 1.
          const cos = Math.cos(p * Math.PI);
          sx = cos;
          skew = 0.12 * Math.sin(p * Math.PI);
          // Midpoint swap at cos=0.
          if (cos >= 0) { srcAlpha = 1; resAlpha = 0; }
          else          { srcAlpha = 0; resAlpha = 1; }
        } else {
          const p = (t - 0.8) / 0.2;
          sx = -1 + (EASE.outElastic(p) * 0); // stays at flipped
          sx = -1 * (1 - 0.05 * Math.sin(p * Math.PI * 2));
          skew = 0;
          srcAlpha = 0; resAlpha = 1;
        }

        animCtx.save();
        animCtx.translate(cx, cy);
        animCtx.transform(sx, skew * 0.6, skew, 1, 0, 0);
        animCtx.translate(-cx, -cy);

        // Motion blur: draw faded ghost of the other side under.
        if (t >= 0.2 && t < 0.8) {
          const ghost = srcAlpha > 0 ? srcCanvases[i] : resCanvases[i];
          animCtx.globalAlpha = 0.25;
          animCtx.drawImage(ghost, b.x - 3, b.y);
          animCtx.drawImage(ghost, b.x + 3, b.y);
          animCtx.globalAlpha = 1;
        }

        if (srcAlpha > 0) {
          animCtx.globalAlpha = srcAlpha;
          animCtx.drawImage(srcCanvases[i], b.x, b.y);
        }
        if (resAlpha > 0) {
          animCtx.globalAlpha = resAlpha;
          animCtx.drawImage(resCanvases[i], b.x, b.y);
        }
        animCtx.globalAlpha = 1;
        animCtx.restore();
      }

      // Mid-point flash & sparks at the edge-on moment.
      if (!flashedMid && t >= 0.5) {
        flashedMid = true;
        flash('#ffffff', 0.35, 180);
        kickShake(3);
        for (let i = 0; i < sourceColl.pieces.length; i++) {
          if (!sourceColl.pieces[i].selected) continue;
          const b = bounds[i];
          const { sx, sy } = canvasToScreen(b.x + b.w / 2, b.y + b.h / 2);
          spawnRing(sx, sy, '#e0e0e0', Math.max(b.w, b.h) * 0.9, 2);
          spawnBurst(sx, sy, '#ffffff', 10, 'spark');
        }
      }

      if (t < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Split Half: charge → lightning crack + flash + big shake → violent slide-apart ── */
  function animateSplit(sourceColl, resultColl, finish) {
    const offBefore = document.createElement('canvas');
    offBefore.width = 400; offBefore.height = 400;
    sourceColl.render(offBefore, false);
    const bounds = sourceColl._bounds.map(b => ({ ...b }));

    const offAfter = document.createElement('canvas');
    offAfter.width = 400; offAfter.height = 400;
    resultColl.render(offAfter, false);

    const selBounds = [];
    for (let i = 0; i < sourceColl.pieces.length; i++)
      if (sourceColl.pieces[i].selected) selBounds.push(bounds[i]);

    const duration = 1600;
    const start = performance.now();
    let impactFired = false;

    // Tiny per-piece shake during charge.
    const jitter = (mag) => (Math.random() - 0.5) * mag * 2;

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      animCtx.clearRect(0, 0, 400, 400);

      if (t < 0.35) {
        // Phase 1: charge — piece trembles, blue aura converges on the split line.
        const p = t / 0.35;
        const shakeAmp = 1.2 * p;
        animCtx.save();
        animCtx.translate(jitter(shakeAmp), jitter(shakeAmp));
        animCtx.drawImage(offBefore, 0, 0);
        animCtx.restore();

        // Aura glow at split line; line itself brightens.
        animCtx.save();
        animCtx.globalCompositeOperation = 'lighter';
        for (const b of selBounds) {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          drawGlow(cx, cy, b.h * (0.6 + 0.4 * p),
            'rgba(136,204,255,' + (0.5 * p).toFixed(3) + ')', 1);
          animCtx.strokeStyle = 'rgba(180,220,255,' + (0.35 + 0.5 * p).toFixed(3) + ')';
          animCtx.lineWidth = 1.5 + 1.5 * p;
          animCtx.shadowColor = '#88ccff';
          animCtx.shadowBlur = 18 * p;
          const halfH = b.h / 2 * p;
          animCtx.beginPath();
          animCtx.moveTo(cx + (Math.random() - 0.5) * 1.5, cy - halfH);
          animCtx.lineTo(cx + (Math.random() - 0.5) * 1.5, cy + halfH);
          animCtx.stroke();
        }
        animCtx.restore();

        // Stray blue embers rising off the line.
        if (p > 0.4 && Math.random() < 0.55 && selBounds.length) {
          const rb = selBounds[Math.floor(Math.random() * selBounds.length)];
          const { sx, sy } = canvasToScreen(rb.x + rb.w / 2, rb.y + Math.random() * rb.h);
          spawnBurst(sx, sy, '#88ccff', 1, 'ember');
        }
      } else if (t < 0.5) {
        // Phase 2: the crack. Lightning strike + full-screen flash + big shake.
        animCtx.drawImage(offBefore, 0, 0);
        for (const b of selBounds) {
          const cx = b.x + b.w / 2;
          // Main bolt
          drawLightning(cx, b.y - 8, cx, b.y + b.h + 8, '#eaffff', 0.95, 3);
          // Secondary bolt
          drawLightning(cx, b.y - 8, cx, b.y + b.h + 8, '#88ccff', 0.7, 1.5);
        }

        if (!impactFired) {
          impactFired = true;
          flash('#ffffff', 0.85, 300);
          kickShake(14);
          for (const b of selBounds) {
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const { sx, sy } = canvasToScreen(cx, cy);
            spawnRing(sx, sy, '#ffffff', Math.max(b.w, b.h) * 1.4, 3);
            spawnRing(sx, sy, '#88ccff', Math.max(b.w, b.h) * 1.0, 2);
            spawnBurst(sx, sy, '#cfefff', 24, 'spark');
            spawnBurst(sx, sy, '#ffffff', 12, 'shard');
            spawnBurst(sx, sy, '#88ccff', 8, 'ember');
          }
        }
      } else {
        // Phase 3: violent slide-apart with dust + residual sparks, then crossfade.
        const st = (t - 0.5) / 0.5;
        const eased = EASE.outQuint(st);
        const offset = eased * 16;

        // Unselected pieces static.
        for (let i = 0; i < sourceColl.pieces.length; i++) {
          if (sourceColl.pieces[i].selected) continue;
          const b = bounds[i];
          animCtx.drawImage(offBefore, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
        }
        // Selected halves slide apart with slight rotation.
        animCtx.globalAlpha = 1 - eased;
        for (const b of selBounds) {
          const halfW = Math.floor(b.w / 2);
          const rot = 0.035 * eased;
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;

          animCtx.save();
          animCtx.translate(cx - halfW / 2 - offset, cy);
          animCtx.rotate(-rot);
          animCtx.drawImage(offBefore, b.x, b.y, halfW, b.h, -halfW / 2, -b.h / 2, halfW, b.h);
          animCtx.restore();

          animCtx.save();
          animCtx.translate(cx + (b.w - halfW) / 2 + offset, cy);
          animCtx.rotate(rot);
          animCtx.drawImage(offBefore, b.x + halfW, b.y, b.w - halfW, b.h,
                            -(b.w - halfW) / 2, -b.h / 2, b.w - halfW, b.h);
          animCtx.restore();
        }
        animCtx.globalAlpha = 1;

        // Residual dust during slide.
        if (st < 0.6 && Math.random() < 0.6 && selBounds.length) {
          const rb = selBounds[Math.floor(Math.random() * selBounds.length)];
          const { sx, sy } = canvasToScreen(rb.x + rb.w / 2, rb.y + Math.random() * rb.h);
          spawnBurst(sx, sy, '#aac8e0', 2, 'dust');
        }

        // Crossfade to result.
        animCtx.globalAlpha = eased;
        animCtx.drawImage(offAfter, 0, 0);
        animCtx.globalAlpha = 1;
      }

      if (t < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Emerald Filler: gap between adjacent pieces blinks emerald row-by-row,
     then solidifies, flashes, and crossfades to the merged result. ── */
  function animateEmeraldFiller(sourceColl, resultColl, finish) {
    const offBefore = document.createElement('canvas');
    offBefore.width = 400; offBefore.height = 400;
    sourceColl.render(offBefore, false);
    const bounds = sourceColl._bounds.map(b => ({ ...b }));
    const scale = sourceColl._scale || 4;

    const offAfter = document.createElement('canvas');
    offAfter.width = 400; offAfter.height = 400;
    resultColl.render(offAfter, false);

    // For each adjacent selected pair, compute the final emerald band width
    // (existing EMERALD/INTERIOR edge layer on each side + any new columns
    // inserted by the merge), then emit a per-row cell covering that width
    // centered on the gap, so the animation matches the final filler area.
    const cells = [];

    function edgeLayerDepth(rock, fromRight) {
      let depth = 0;
      for (let x = 0; x < rock.w; x++) {
        const col = fromRight ? rock.w - 1 - x : x;
        let hasAny = false, allLayer = true;
        for (let y = 0; y < rock.h; y++) {
          const c = rock.grid[y][col];
          if (!c) continue;
          hasAny = true;
          if (c.mat !== MATERIAL.EMERALD && c.mat !== MATERIAL.INTERIOR) {
            allLayer = false;
            break;
          }
        }
        if (!hasAny || !allLayer) break;
        depth++;
      }
      return depth;
    }

    function edgeHasEmerald(rock, fromRight) {
      const col = fromRight ? rock.w - 1 : 0;
      for (let y = 0; y < rock.h; y++) {
        const c = rock.grid[y][col];
        if (c && c.mat === MATERIAL.EMERALD) return true;
      }
      return false;
    }

    for (let i = 0; i < sourceColl.pieces.length - 1; i++) {
      const a = sourceColl.pieces[i];
      const b = sourceColl.pieces[i + 1];
      if (!(a.selected && b.selected)) continue;
      const bA = bounds[i], bB = bounds[i + 1];
      const aRock = a.rock, bRock = b.rock;

      const kA = edgeLayerDepth(aRock, true);
      const kB = edgeLayerDepth(bRock, false);
      const extras = (edgeHasEmerald(aRock, true) || edgeHasEmerald(bRock, false)) ? 2 : 0;
      const bandCols = kA + extras + kB;
      if (bandCols === 0) continue;

      const bandPx = bandCols * scale;
      const gapMid = (bA.x + bA.w + bB.x) / 2;
      const cellX  = Math.round(gapMid - bandPx / 2);

      const rowYs = new Set();
      for (let yy = 0; yy < aRock.h; yy++) {
        if (aRock.grid[yy][aRock.w - 1]) rowYs.add(bA.y + yy * scale);
      }
      for (let yy = 0; yy < bRock.h; yy++) {
        if (bRock.grid[yy][0]) rowYs.add(bB.y + yy * scale);
      }
      for (const sy of rowYs) {
        cells.push({ x: cellX, y: sy, w: bandPx, h: scale });
      }
    }

    // Pre-compute gap centers (screen coords) and energy-stream emitters.
    const gaps = [];
    for (let i = 0; i < sourceColl.pieces.length - 1; i++) {
      const a = sourceColl.pieces[i], b = sourceColl.pieces[i + 1];
      if (!(a.selected && b.selected)) continue;
      const bA = bounds[i], bB = bounds[i + 1];
      const gapCx = (bA.x + bA.w + bB.x) / 2;
      const gapCy = (bA.y + bA.h / 2 + bB.y + bB.h / 2) / 2;
      gaps.push({
        cx: gapCx, cy: gapCy,
        leftX: bA.x + bA.w * 0.3, rightX: bB.x + bB.w * 0.7,
        top: Math.min(bA.y, bB.y),
        bot: Math.max(bA.y + bA.h, bB.y + bB.h),
      });
    }

    const duration = 1500;
    const start = performance.now();
    let popFired = false;

    function drawCells(alpha, glow) {
      animCtx.save();
      if (glow > 0) {
        animCtx.shadowColor = '#2fdc8a';
        animCtx.shadowBlur  = glow;
      }
      animCtx.fillStyle   = '#2fdc8a';
      animCtx.globalAlpha = alpha;
      for (const c of cells) animCtx.fillRect(c.x, c.y, c.w, c.h);
      animCtx.restore();
    }

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      animCtx.clearRect(0, 0, 400, 400);

      if (t < 0.45) {
        // Phase 1: energy streams flow from both sides into the gap + ramp-up pulse.
        animCtx.drawImage(offBefore, 0, 0);
        const p = t / 0.45;
        const pulse = 0.4 + 0.6 * ((Math.sin(p * Math.PI * 5) + 1) / 2);

        // Streams: animated dashes moving toward gap center.
        animCtx.save();
        animCtx.globalCompositeOperation = 'lighter';
        animCtx.strokeStyle = 'rgba(47,220,138,' + (0.6 * p).toFixed(3) + ')';
        animCtx.lineWidth = 2;
        animCtx.shadowColor = '#2fdc8a';
        animCtx.shadowBlur = 10;
        animCtx.setLineDash([6, 6]);
        animCtx.lineDashOffset = -(now * 0.08);
        for (const g of gaps) {
          animCtx.beginPath();
          animCtx.moveTo(g.leftX, g.cy); animCtx.lineTo(g.cx, g.cy);
          animCtx.moveTo(g.rightX, g.cy); animCtx.lineTo(g.cx, g.cy);
          animCtx.stroke();
        }
        animCtx.setLineDash([]);
        animCtx.restore();

        drawCells(0.25 + 0.35 * pulse, 14 * pulse);

        // Emit flowing embers toward the gap.
        if (Math.random() < 0.9 && gaps.length) {
          const g = gaps[Math.floor(Math.random() * gaps.length)];
          const side = Math.random() < 0.5 ? g.leftX : g.rightX;
          const { sx, sy } = canvasToScreen(side, g.cy + (Math.random() - 0.5) * (g.bot - g.top) * 0.6);
          spawnBurst(sx, sy, '#2fdc8a', 1, 'ember');
        }
      } else if (t < 0.75) {
        // Phase 2: crystal pop — band materializes with bright white flash + shake.
        animCtx.drawImage(offBefore, 0, 0);
        drawCells(1, 26);

        const phase = (t - 0.45) / 0.3;
        const flashLum = Math.max(0, 1 - phase * 2.2);
        if (flashLum > 0) {
          animCtx.save();
          animCtx.globalCompositeOperation = 'lighter';
          animCtx.globalAlpha = flashLum;
          animCtx.fillStyle   = '#eaffe8';
          for (const c of cells) {
            animCtx.fillRect(c.x - 2, c.y - 1, c.w + 4, c.h + 2);
          }
          animCtx.restore();
        }

        if (!popFired) {
          popFired = true;
          flash('#b9ffe0', 0.45, 260);
          kickShake(6);
          for (const g of gaps) {
            const { sx, sy } = canvasToScreen(g.cx, g.cy);
            spawnRing(sx, sy, '#2fdc8a', Math.max(80, (g.bot - g.top)), 3);
            spawnBurst(sx, sy, '#b9ffe0', 18, 'spark');
            spawnBurst(sx, sy, '#2fdc8a', 10, 'ember');
          }
        }
      } else {
        // Phase 3: crossfade to merged result.
        const p = (t - 0.75) / 0.25;
        animCtx.globalAlpha = 1 - p;
        animCtx.drawImage(offBefore, 0, 0);
        drawCells(1 - p, 18 * (1 - p));
        animCtx.globalAlpha = p;
        animCtx.drawImage(offAfter, 0, 0);
        animCtx.globalAlpha = 1;
      }

      if (t < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Forge! ── */
  forgeBtn.addEventListener('click', () => {
    if (!sourceCollection || !processId) return;
    if (!sourceCollection.hasSelection()) return;
    forgeBtn.disabled = true;

    sfxForge();
    const pColor = PROCESS_COLORS[processId] || '#fff';
    const rect = forgeBtn.getBoundingClientRect();
    spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, pColor, 50);

    const result = sourceCollection.apply(processId, PROCESS_NAMES[processId]);
    if (result.pieces.length === 1) result.pieces[0].selected = true;

    showForgeAnimation(sourceCollection, result, processId, () => {
      const pRect = productBox.getBoundingClientRect();
      spawnParticles(pRect.left + pRect.width / 2, pRect.top + pRect.height / 2, pColor, 40);

      setProduct(result);
      setSource(null);
    });
  });

  /* ── Double-click to clear ── */
  processBox.addEventListener('dblclick', () => setProcess(null));

  /* ── Click trash to clear entire forge table ── */
  trashCan.addEventListener('click', () => {
    if (!sourceCollection && !processId && !productCollection) return;
    sfxTrash();
    setSource(null);
    setProcess(null);
    setProduct(null);
  });

  /* ═══════════════════════════════════════════
     MOBILE TOUCH-DRAG SUPPORT
     ═══════════════════════════════════════════ */

  // Resume AudioContext on first user gesture (required by iOS Safari)
  function resumeAudio() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    document.removeEventListener('touchstart', resumeAudio);
    document.removeEventListener('click', resumeAudio);
  }
  document.addEventListener('touchstart', resumeAudio);
  document.addEventListener('click', resumeAudio);

  (function initTouchDrag() {
    let ghost = null;
    let touchData = null;
    let currentOver = null;

    const dropZones = [
      { el: sourceBox,   accept: d => d === 'rock' || d === 'product' || d.startsWith('saved:') },
      { el: processBox,  accept: d => d.startsWith('process:') },
      { el: saveZone,    accept: d => d === 'product' },
      { el: trashCan,    accept: d => true },
    ];

    function createGhost(el) {
      const g = el.cloneNode(true);
      g.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:0.85;' +
        'transform:scale(0.8);transition:none;width:' + el.offsetWidth + 'px;';
      document.body.appendChild(g);
      return g;
    }

    function moveGhost(x, y) {
      if (!ghost) return;
      ghost.style.left = (x - ghost.offsetWidth / 2) + 'px';
      ghost.style.top  = (y - ghost.offsetHeight / 2) + 'px';
    }

    function hitZone(x, y) {
      for (const z of dropZones) {
        const r = z.el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
      }
      return null;
    }

    function highlightZone(zone) {
      if (currentOver === zone) return;
      if (currentOver) currentOver.el.classList.remove('drag-over', 'drag-reject');
      currentOver = zone;
      if (zone) {
        if (zone.accept(touchData)) zone.el.classList.add('drag-over');
        else zone.el.classList.add('drag-reject');
      }
    }

    function handleDrop(zone) {
      if (!zone || !zone.accept(touchData)) return;
      const data = touchData;
      // Reuse same logic as desktop drop handlers
      if (zone.el === sourceBox) {
        if (data === 'rock') {
          sfxDrop(); setSource(RockCollection.fromRock(baseRock));
        } else if (data === 'product' && productCollection) {
          sfxDrop();
          const coll = productCollection.clone(); coll.selectAll();
          setSource(coll); setProduct(null);
        } else if (data.startsWith('saved:')) {
          const idx = parseInt(data.split(':')[1]);
          if (savedMaterials[idx]) {
            sfxDrop();
            const coll = savedMaterials[idx].clone(); coll.selectAll();
            setSource(coll);
          }
        }
      } else if (zone.el === processBox) {
        if (data.startsWith('process:')) { sfxDrop(); setProcess(data.split(':')[1]); }
      } else if (zone.el === saveZone) {
        if (data === 'product' && productCollection) {
          sfxDrop(); saveMaterial(productCollection.clone());
        }
      } else if (zone.el === trashCan) {
        if (data === 'product') { sfxTrash(); setProduct(null); }
        else if (data === 'source') { sfxTrash(); setSource(null); }
        else if (data === 'boxprocess') { sfxTrash(); setProcess(null); }
        else if (data.startsWith('saved:')) {
          const idx = parseInt(data.split(':')[1]);
          const el = savedDiv.querySelector('[data-saved-index="' + idx + '"]');
          if (el) { sfxTrash(); el.remove(); savedMaterials[idx] = null; }
        }
      }
    }

    function registerDraggable(el, dataFn) {
      el.addEventListener('touchstart', e => {
        const d = dataFn();
        if (!d) return;
        e.preventDefault();
        touchData = d;
        const touch = e.touches[0];
        ghost = createGhost(el);
        moveGhost(touch.clientX, touch.clientY);
      }, { passive: false });
    }

    // Register all draggable sources
    document.querySelectorAll('.sidebar-item[data-type]').forEach(el => {
      registerDraggable(el, () => {
        const type = el.dataset.type;
        if (type === 'rock') return 'rock';
        if (type === 'process') return 'process:' + el.dataset.process;
        return null;
      });
    });

    registerDraggable(productBox, () => productCollection ? 'product' : null);
    registerDraggable(sourceBox,  () => sourceCollection ? 'source' : null);
    registerDraggable(processBox, () => processId ? 'boxprocess' : null);

    // Saved materials are dynamic — use delegation
    savedDiv.addEventListener('touchstart', e => {
      const item = e.target.closest('.saved-material');
      if (!item) return;
      e.preventDefault();
      touchData = 'saved:' + item.dataset.savedIndex;
      const touch = e.touches[0];
      ghost = createGhost(item);
      moveGhost(touch.clientX, touch.clientY);
    }, { passive: false });

    // Global touchmove & touchend
    document.addEventListener('touchmove', e => {
      if (!ghost) return;
      e.preventDefault();
      const touch = e.touches[0];
      moveGhost(touch.clientX, touch.clientY);
      highlightZone(hitZone(touch.clientX, touch.clientY));
    }, { passive: false });

    document.addEventListener('touchend', e => {
      if (!ghost) return;
      if (currentOver) {
        currentOver.el.classList.remove('drag-over', 'drag-reject');
        handleDrop(currentOver);
      }
      ghost.remove();
      ghost = null;
      touchData = null;
      currentOver = null;
    });
  })();

})();
