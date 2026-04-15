/* ── Game logic & UI ── */
(function () {
  'use strict';

  /* ── State ── */
  let sourceCollection  = null;
  let processId         = null;
  let productCollection = null;
  let savedMaterials    = [];
  let savedCounter      = 0;

  const baseRock = Rock.createBase();

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
  const forgeAnimCanvas = document.getElementById('forge-anim-canvas');
  const forgeAnimLabel = document.getElementById('forge-anim-label');
  const animCtx        = forgeAnimCanvas.getContext('2d');

  /* ── Draw sidebar rock ── */
  baseRock.render(document.getElementById('sidebar-rock-canvas'));

  /* ── Particle system ── */
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

  function spawnParticles(cx, cy, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 40 + Math.random() * 30,
        maxLife: 70,
        size: 2 + Math.random() * 4,
        color,
      });
    }
  }

  function tickParticles() {
    pctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life--;
      const alpha = p.life / p.maxLife;
      pctx.globalAlpha = alpha;
      pctx.fillStyle = p.color;
      pctx.fillRect(Math.round(p.x), Math.round(p.y),
                     Math.round(p.size), Math.round(p.size));
    }
    pctx.globalAlpha = 1;
    requestAnimationFrame(tickParticles);
  }
  tickParticles();

  /* ── Helpers ── */
  const PROCESS_NAMES = {
    flip:        'Flip',
    mosaic_ruby: 'Mosaic Ruby',
    gold_plated: 'Gold Plated',
    split_half:  'Split Half',
  };

  const PROCESS_COLORS = {
    flip:        '#e0e0e0',
    mosaic_ruby: '#dc143c',
    gold_plated: '#ffd700',
    split_half:  '#88ccff',
  };

  const PROCESS_ICONS = {
    flip:        { symbol: '↔', cls: '' },
    mosaic_ruby: { symbol: '◆', cls: 'ruby-icon' },
    gold_plated: { symbol: '✦', cls: 'gold-icon' },
    split_half:  { symbol: '⫽', cls: '' },
  };

  function updateForgeBtn() {
    const hasSelected = sourceCollection && sourceCollection.hasSelection();
    forgeBtn.disabled = !(hasSelected && processId);
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
        e.dataTransfer.setData('text/plain', 'rock');
      } else if (type === 'process') {
        e.dataTransfer.setData('text/plain', 'process:' + el.dataset.process);
      }
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  productBox.addEventListener('dragstart', e => {
    if (!productCollection) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', 'product');
    e.dataTransfer.effectAllowed = 'copyMove';
  });

  sourceBox.addEventListener('dragstart', e => {
    if (!sourceCollection) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', 'source');
    e.dataTransfer.effectAllowed = 'move';
  });

  processBox.addEventListener('dragstart', e => {
    if (!processId) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', 'boxprocess');
    e.dataTransfer.effectAllowed = 'move';
  });

  function addDropZone(el, acceptFn) {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      acceptFn(e.dataTransfer.getData('text/plain'));
    });
  }

  addDropZone(sourceBox, data => {
    if (data === 'rock') {
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
  });

  addDropZone(processBox, data => {
    if (data.startsWith('process:')) setProcess(data.split(':')[1]);
  });

  addDropZone(saveZone, data => {
    if (data === 'product' && productCollection)
      saveMaterial(productCollection.clone());
  });

  // Trash can
  addDropZone(trashCan, data => {
    if (data === 'product') {
      setProduct(null);
    } else if (data === 'source') {
      setSource(null);
    } else if (data === 'boxprocess') {
      setProcess(null);
    } else if (data.startsWith('saved:')) {
      const idx = parseInt(data.split(':')[1]);
      const el = savedDiv.querySelector('[data-saved-index="' + idx + '"');
      if (el) { el.remove(); savedMaterials[idx] = null; }
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
    setTimeout(() => {
      forgeOverlay.classList.remove('active');
      callback();
    }, 400);
  }

  function showForgeAnimation(sourceColl, resultColl, pid, callback) {
    forgeOverlay.classList.add('active');
    forgeAnimLabel.textContent = PROCESS_NAMES[pid] + '...';
    forgeAnimLabel.style.color = PROCESS_COLORS[pid];

    const finish = () => finishAnimation(resultColl, callback);

    switch (pid) {
      case 'gold_plated': animateGoldPlating(sourceColl, resultColl, finish); break;
      case 'mosaic_ruby': animateRubyMosaic(sourceColl, resultColl, finish); break;
      case 'flip':        animateFlip(sourceColl, resultColl, finish); break;
      case 'split_half':  animateSplit(sourceColl, resultColl, finish); break;
      default: finish();
    }
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

  /* ── Gold Plating: wave of gold sweeps top→bottom ── */
  function animateGoldPlating(sourceColl, resultColl, finish) {
    const changes = getPixelChanges(sourceColl, resultColl);
    changes.sort((a, b) => a.y - b.y || a.x - b.x);

    const work = sourceColl.clone();
    const total = changes.length;
    const frames = 50;
    const batch = Math.max(1, Math.ceil(total / frames));
    let idx = 0;

    function frame() {
      const end = Math.min(idx + batch, total);
      for (let i = idx; i < end; i++) {
        const c = changes[i];
        work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
      }
      work.render(forgeAnimCanvas, false);

      // spawn golden sparkles
      if (end > idx) {
        const { rect, ds } = canvasScreenPos();
        const last = changes[end - 1];
        const b = work._bounds[last.pi];
        if (b) {
          const s = work._scale || 4;
          const sx = rect.left + (b.x + last.x * s + s / 2) * ds;
          const sy = rect.top  + (b.y + last.y * s + s / 2) * ds;
          spawnParticles(sx, sy, '#ffd700', 3);
        }
      }

      idx = end;
      if (idx < total) requestAnimationFrame(frame);
      else finish();
    }
    frame();
  }

  /* ── Ruby Mosaic: rubies pop in randomly ── */
  function animateRubyMosaic(sourceColl, resultColl, finish) {
    const changes = getPixelChanges(sourceColl, resultColl);
    // shuffle for random pop-in
    for (let i = changes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [changes[i], changes[j]] = [changes[j], changes[i]];
    }

    const work = sourceColl.clone();
    const total = changes.length;
    const frames = 40;
    const batch = Math.max(1, Math.ceil(total / frames));
    let idx = 0;

    function frame() {
      const end = Math.min(idx + batch, total);
      for (let i = idx; i < end; i++) {
        const c = changes[i];
        work.pieces[c.pi].rock.grid[c.y][c.x] = { mat: c.mat, shade: c.shade };
      }
      work.render(forgeAnimCanvas, false);

      if (end > idx) {
        const { rect, ds } = canvasScreenPos();
        const c = changes[end - 1];
        const b = work._bounds[c.pi];
        if (b) {
          const s = work._scale || 4;
          const sx = rect.left + (b.x + c.x * s + s / 2) * ds;
          const sy = rect.top  + (b.y + c.y * s + s / 2) * ds;
          spawnParticles(sx, sy, '#dc143c', 4);
        }
      }

      idx = end;
      if (idx < total) requestAnimationFrame(frame);
      else finish();
    }
    frame();
  }

  /* ── Flip: per-piece squeeze → expand ── */
  function animateFlip(sourceColl, resultColl, finish) {
    sourceColl.render(forgeAnimCanvas, false);
    const bounds = sourceColl._bounds.map(b => ({ ...b }));
    const scale = sourceColl._scale;

    const duration = 800;
    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      animCtx.clearRect(0, 0, 400, 400);

      for (let i = 0; i < sourceColl.pieces.length; i++) {
        const b = bounds[i];
        if (!sourceColl.pieces[i].selected) {
          sourceColl.pieces[i].rock.renderAt(animCtx, b.x, b.y, scale);
        } else {
          const cx = b.x + b.w / 2;
          animCtx.save();
          animCtx.translate(cx, 0);
          if (t < 0.5) {
            animCtx.scale(1 - t * 2, 1);
            animCtx.translate(-cx, 0);
            sourceColl.pieces[i].rock.renderAt(animCtx, b.x, b.y, scale);
          } else {
            animCtx.scale((t - 0.5) * 2, 1);
            animCtx.translate(-cx, 0);
            resultColl.pieces[i].rock.renderAt(animCtx, b.x, b.y, scale);
          }
          animCtx.restore();
        }
      }

      if (t > 0.45 && t < 0.55) {
        const { rect, ds } = canvasScreenPos();
        for (let i = 0; i < sourceColl.pieces.length; i++) {
          if (sourceColl.pieces[i].selected) {
            const b = bounds[i];
            spawnParticles(
              rect.left + (b.x + b.w / 2) * ds,
              rect.top + (b.y + b.h / 2) * ds,
              '#e0e0e0', 2
            );
          }
        }
      }

      if (t < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  /* ── Split Half: per-piece crack → flash → slide apart ── */
  function animateSplit(sourceColl, resultColl, finish) {
    const offBefore = document.createElement('canvas');
    offBefore.width = 400; offBefore.height = 400;
    sourceColl.render(offBefore, false);
    const bounds = sourceColl._bounds.map(b => ({ ...b }));

    const offAfter = document.createElement('canvas');
    offAfter.width = 400; offAfter.height = 400;
    resultColl.render(offAfter, false);

    // Collect bounds of selected pieces for per-piece cracks
    const selBounds = [];
    for (let i = 0; i < sourceColl.pieces.length; i++)
      if (sourceColl.pieces[i].selected) selBounds.push(bounds[i]);

    const duration = 1500;
    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      animCtx.clearRect(0, 0, 400, 400);

      if (t < 0.35) {
        // Phase 1: growing crack at each selected piece's center
        animCtx.drawImage(offBefore, 0, 0);
        const p = t / 0.35;
        animCtx.save();
        animCtx.strokeStyle = 'rgba(136,204,255,' + p + ')';
        animCtx.lineWidth = 2 + p * 2;
        animCtx.shadowColor = '#88ccff';
        animCtx.shadowBlur = 12 * p;
        for (const b of selBounds) {
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const halfH = b.h / 2 * p;
          animCtx.beginPath();
          animCtx.moveTo(cx, cy - halfH);
          animCtx.lineTo(cx, cy + halfH);
          animCtx.stroke();
        }
        animCtx.restore();
      } else if (t < 0.5) {
        // Phase 2: bright flash at each crack
        animCtx.drawImage(offBefore, 0, 0);
        const flash = Math.sin((t - 0.35) / 0.15 * Math.PI * 4) * 0.5 + 0.5;
        animCtx.save();
        animCtx.strokeStyle = 'rgba(255,255,255,' + flash + ')';
        animCtx.lineWidth = 4;
        animCtx.shadowColor = '#fff';
        animCtx.shadowBlur = 25;
        for (const b of selBounds) {
          const cx = b.x + b.w / 2;
          animCtx.beginPath();
          animCtx.moveTo(cx, b.y - 4);
          animCtx.lineTo(cx, b.y + b.h + 4);
          animCtx.stroke();
        }
        animCtx.restore();

        if (Math.random() < 0.3 && selBounds.length) {
          const { rect, ds } = canvasScreenPos();
          const rb = selBounds[Math.floor(Math.random() * selBounds.length)];
          spawnParticles(
            rect.left + (rb.x + rb.w / 2) * ds,
            rect.top + (rb.y + Math.random() * rb.h) * ds,
            '#88ccff', 3
          );
        }
      } else {
        // Phase 3: each selected piece's halves slide apart, crossfade to result
        const st = (t - 0.5) / 0.5;
        const eased = 1 - Math.pow(1 - st, 3);
        const offset = eased * 12;

        animCtx.globalAlpha = 1 - eased;
        // Draw unselected pieces static
        for (let i = 0; i < sourceColl.pieces.length; i++) {
          if (sourceColl.pieces[i].selected) continue;
          const b = bounds[i];
          animCtx.drawImage(offBefore, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
        }
        // Draw selected pieces with halves sliding apart
        for (const b of selBounds) {
          const halfW = Math.floor(b.w / 2);
          animCtx.drawImage(offBefore, b.x, b.y, halfW, b.h,
                            b.x - offset, b.y, halfW, b.h);
          animCtx.drawImage(offBefore, b.x + halfW, b.y, b.w - halfW, b.h,
                            b.x + halfW + offset, b.y, b.w - halfW, b.h);
        }

        animCtx.globalAlpha = eased;
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

})();
