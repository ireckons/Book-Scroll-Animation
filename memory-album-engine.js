/**
 * 3D Memory Album Simulation Engine
 * Recreates the multi-segment physical page curling, spring physics,
 * dynamic lighting gradients, cast shadows, and gesture handling.
 */

(function () {
  'use strict';

  // Number of vertical strips for realistic cylindrical page bending
  const SEGMENTS = 12;
  const PAGE_GAP = 0.035; // Min distance between pages to prevent z-fighting

  const clamp = (val, min, max) => Math.min(max, Math.max(min, val));
  const numOrDefault = (val, def) => (typeof val === 'number' && isFinite(val) ? val : def);
  const padZero = (n) => (n < 10 ? `0${n}` : `${n}`);

  class MemoryAlbum {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.querySelector(container) : container;
      if (!this.container) throw new Error('Album container element not found');

      this.data = options.data || (typeof ALBUM_DATA !== 'undefined' ? ALBUM_DATA : {});
      this.bookConfig = this.data.book || {};
      this.coversConfig = this.data.covers || {};
      this.motionConfig = this.data.motion || {};
      this.bgConfig = this.data.background || {};
      this.sheetsConfig = this.data.sheets || [];

      // Elements
      this.stage = document.getElementById('stage');
      this.bookOrigin = document.getElementById('book-origin');
      this.indicators = document.getElementById('indicators');
      this.headlineEl = document.getElementById('album-headline');
      this.bgEl = document.getElementById('album-background');

      // Build sheet models
      this.leaves = this.buildLeaves();
      this.totalLeaves = this.leaves.length;

      // Deck state
      const startMode = this.bookConfig.start || 'cover';
      const initialPos = startMode === 'spread' ? Math.min(2, this.totalLeaves - 1) : 0;
      this.deck = this.initDeckState(this.totalLeaves, initialPos);

      // Animation & Interaction state
      this.animId = null;
      this.lastFrameTime = performance.now();
      this.drag = null;
      this.leafNodes = new Map(); // DOM nodes for active curling leaves
      this.castLeftEl = null;
      this.castRightEl = null;
      this.videoElements = new Set();

      // Setup
      this.initBackground();
      this.initHeadline();
      this.initIndicators();
      this.bindEvents();
      this.updateDimensions();

      // Initial render & wake animation
      this.refreshLayout();
      this.wake();
    }

    /**
     * Build page/leaf definitions from config
     */
    buildLeaves() {
      const c = this.coversConfig;
      const emptyPaper = (kind) => ({ kind, img: '', video: '', caption: '', bleed: false, folio: 0 });

      const leaves = [
        // Front Cover Leaf (board: true)
        {
          board: true,
          front: {
            kind: 'cover',
            img: c.frontImage || '',
            video: c.frontVideo || '',
            caption: c.title || '',
            bleed: true,
            folio: 0
          },
          back: emptyPaper('endpaper')
        }
      ];

      // Inner sheets
      this.sheetsConfig.forEach((s, idx) => {
        leaves.push({
          board: false,
          front: {
            kind: 'photo',
            img: s.frontImage || '',
            video: s.frontVideo || '',
            caption: s.frontCaption || '',
            bleed: s.frontFill === 'bleed',
            folio: idx * 2 + 1
          },
          back: {
            kind: 'photo',
            img: s.backImage || '',
            video: s.backVideo || '',
            caption: s.backCaption || '',
            bleed: s.backFill === 'bleed',
            folio: idx * 2 + 2
          }
        });
      });

      // Rear Cover Leaf (board: true)
      leaves.push({
        board: true,
        front: emptyPaper('endpaper'),
        back: {
          kind: 'rear',
          img: c.backImage || '',
          video: c.backVideo || '',
          caption: '',
          bleed: true,
          folio: 0
        }
      });

      return leaves;
    }

    /**
     * Initialize Deck state
     */
    initDeckState(total, startPos) {
      const p = [];
      const v = [];
      const goal = [];
      const bend = [];
      const skew = [];

      for (let i = 0; i < total; i++) {
        const val = i < startPos ? 1 : 0;
        p.push(val);
        goal.push(val);
        v.push(0);
        bend.push(0);
        skew.push(0);
      }

      return {
        p,
        v,
        goal,
        bend,
        skew,
        queue: [],
        dragK: -1,
        hoverK: -1,
        hoverP: 0,
        hoverV: 0,
        tilt: 0,
        tiltGoal: 0,
        lastTouch: performance.now(),
        act: [],
        right: -1,
        left: -1,
        key: ''
      };
    }

    /**
     * Compute visible flat pages and active curling leaves
     */
    computeActivePages() {
      const d = this.deck;
      const total = d.p.length;
      const act = [];
      let right = -1;
      let left = -1;
      let pos = 0;

      const isStationary = (k) => k !== d.dragK && k !== d.hoverK && (d.p[k] === 0 || d.p[k] === 1);

      for (let k = 0; k < total; k++) {
        pos += d.goal[k];
        if (!isStationary(k)) {
          act.push(k);
        }
      }

      // Top flat leaf on right stack (lowest index where p === 0)
      for (let k = 0; k < total; k++) {
        if (isStationary(k) && d.p[k] === 0) {
          right = k;
          break;
        }
      }

      // Top flat leaf on left stack (highest index where p === 1)
      for (let k = total - 1; k >= 0; k--) {
        if (isStationary(k) && d.p[k] === 1) {
          left = k;
          break;
        }
      }

      return {
        act,
        right,
        left,
        pos,
        key: `${act.join(',')}|${right}|${left}|${pos}|${total}`
      };
    }

    /**
     * Physics spring parameters
     */
    getMotionParams() {
      const m = this.motionConfig;
      return {
        speed: clamp(numOrDefault(m.speed, 1.0), 0.2, 4.0),
        feel: clamp(numOrDefault(m.feel, 0.45), 0.0, 1.0),
        curl: clamp(numOrDefault(m.curl, 1.0), 0.0, 2.0),
        tilt: m.tilt !== false,
        tiltAmount: clamp(numOrDefault(m.tiltAmount, 6), 0, 30)
      };
    }

    /**
     * Update viewport CSS variables for responsiveness
     */
    updateDimensions() {
      const b = this.bookConfig;
      const size = clamp(numOrDefault(b.size, 0.68), 0.2, 1.0);
      const aspect = clamp(numOrDefault(b.aspect, 0.76), 0.3, 2.0);

      this.container.style.setProperty('--ph', `min(${(size * 100).toFixed(3)}cqh, ${(size * 100 / (2 * aspect)).toFixed(3)}cqw)`);
      this.container.style.setProperty('--pw', `calc(var(--ph) * ${aspect})`);
      this.container.style.setProperty('--rim', `calc(var(--ph) * 0.018)`);
      if (this.stage) {
        this.stage.style.perspective = `calc(var(--ph) * 3.2)`;
      }
    }

    /**
     * Initialize background
     */
    initBackground() {
      if (!this.bgEl) return;
      const bg = this.bgConfig;
      this.bgEl.style.backgroundColor = bg.color || '#e7e3da';
      if (bg.image) {
        const img = document.createElement('img');
        img.src = bg.image;
        img.className = 'media-cover';
        img.style.opacity = clamp(numOrDefault(bg.opacity, 1), 0, 1);
        this.bgEl.appendChild(img);
      }
      if (bg.tintStrength && bg.tintStrength > 0) {
        const tint = document.createElement('div');
        tint.style.cssText = `position: absolute; inset: 0; background: ${bg.tint || '#000000'}; opacity: ${clamp(bg.tintStrength, 0, 1)};`;
        this.bgEl.appendChild(tint);
      }
    }

    /**
     * Initialize headline text if provided
     */
    initHeadline() {
      if (!this.headlineEl) return;
      const h = this.data.headline || {};
      if (!h.text) {
        this.headlineEl.style.display = 'none';
        return;
      }
      const scale = clamp(numOrDefault(h.scale, 23), 2, 80);
      this.headlineEl.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        white-space: pre-line;
        font-size: ${scale}cqw;
        line-height: 0.84;
        margin: 0;
        pointer-events: none;
        user-select: none;
        font-weight: 800;
        letter-spacing: -0.045em;
        color: ${h.color || '#171717'};
        z-index: 1;
      `;
      this.headlineEl.innerText = h.text;
    }

    /**
     * Initialize indicator dots
     */
    initIndicators() {
      if (!this.indicators) return;
      if (this.bookConfig.indicator === 'none') {
        this.indicators.style.display = 'none';
        return;
      }
      this.indicators.innerHTML = '';
      const dotCount = this.totalLeaves + 1;
      const color = this.bookConfig.indicatorColor || 'rgba(23, 23, 23, 0.72)';

      for (let i = 0; i < dotCount; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'indicator-dot';
        btn.setAttribute('aria-label', `Go to spread ${i + 1}`);
        btn.style.backgroundColor = color;
        btn.style.width = i === this.deck.pos ? '16px' : '6px';
        btn.style.opacity = i === this.deck.pos ? '1' : '0.32';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.riffleTo(i);
        });
        this.indicators.appendChild(btn);
      }
    }

    updateIndicators() {
      if (!this.indicators || this.bookConfig.indicator === 'none') return;
      const dots = this.indicators.children;
      const curPos = this.deck.pos;
      for (let i = 0; i < dots.length; i++) {
        dots[i].style.width = i === curPos ? '16px' : '6px';
        dots[i].style.opacity = i === curPos ? '1' : '0.32';
      }
    }

    /**
     * 12-segment cylindrical page curl angles computation
     */
    computeCurlAngles(progress, bend, outAngles) {
      const base = 180 * progress;
      const curlAmount = 78 * bend * Math.sin(Math.PI * progress);
      for (let s = 0; s < SEGMENTS; s++) {
        const t = (s + 1) / SEGMENTS;
        outAngles[s] = clamp(base + curlAmount * (Math.pow(t, 1.7) - 0.36), 0, 180);
      }
      return outAngles;
    }

    /**
     * Render the flat pages and structural book thickness
     */
    refreshLayout() {
      const state = this.computeActivePages();
      this.deck.act = state.act;
      this.deck.right = state.right;
      this.deck.left = state.left;
      this.deck.pos = state.pos;
      this.deck.key = state.key;

      this.updateIndicators();

      const b = this.bookConfig;
      const c = this.coversConfig;
      const radius = clamp(numOrDefault(b.radius, 4), 0, 60);
      const shadowFactor = clamp(numOrDefault(b.shadow, 0.6), 0, 1);
      const bookShadow = `0 calc(var(--ph) * 0.035) calc(var(--ph) * 0.09) rgba(0,0,0,${(0.36 * shadowFactor).toFixed(3)})`;
      const thickness = clamp(numOrDefault(b.thickness, 8), 0, 40);
      const total = this.totalLeaves;

      const O = state.left;
      const D = state.right;

      // Rebuild book origin contents
      this.bookOrigin.innerHTML = '';
      this.leafNodes.clear();

      // 1. Cover underside backings when book is open
      if (O > 0 && O < total - 1) {
        const leftCoverBacking = document.createElement('div');
        leftCoverBacking.style.cssText = `
          position: absolute;
          top: calc(var(--ph) / -2);
          height: var(--ph);
          width: var(--pw);
          left: calc(var(--pw) * -1);
          background: ${c.color || '#26332d'};
          border-radius: ${radius}px 0 0 ${radius}px;
          box-shadow: ${bookShadow}, inset 0 0 0 1px rgba(0,0,0,0.12);
        `;
        this.bookOrigin.appendChild(leftCoverBacking);
      }

      if (D > 0 && D < total - 1) {
        const rightCoverBacking = document.createElement('div');
        rightCoverBacking.style.cssText = `
          position: absolute;
          top: calc(var(--ph) / -2);
          height: var(--ph);
          width: var(--pw);
          left: 0;
          background: ${c.color || '#26332d'};
          border-radius: 0 ${radius}px ${radius}px 0;
          box-shadow: ${bookShadow}, inset 0 0 0 1px rgba(0,0,0,0.12);
        `;
        this.bookOrigin.appendChild(rightCoverBacking);
      }

      // 2. Paper stack side thickness edges
      const leftCount = O >= 0 ? O + 1 : 0;
      const rightCount = D >= 0 ? total - D : 0;

      if (leftCount > 0 && thickness > 0) {
        const leftThickness = Math.max(1, (thickness * leftCount) / total);
        const leftEdge = document.createElement('div');
        leftEdge.style.cssText = `
          position: absolute;
          top: calc(var(--ph) / -2 + var(--ph) * 0.014);
          height: calc(var(--ph) * 0.972);
          width: ${leftThickness.toFixed(2)}px;
          left: calc(var(--pw) * -1 - ${leftThickness.toFixed(2)}px);
          background: repeating-linear-gradient(90deg, ${b.paper || '#fbfaf6'} 0px, ${b.paper || '#fbfaf6'} 1px, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0.18) 1.6px);
          border-radius: 3px 0 0 3px;
          box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.14);
        `;
        this.bookOrigin.appendChild(leftEdge);
      }

      if (rightCount > 0 && thickness > 0) {
        const rightThickness = Math.max(1, (thickness * rightCount) / total);
        const rightEdge = document.createElement('div');
        rightEdge.style.cssText = `
          position: absolute;
          top: calc(var(--ph) / -2 + var(--ph) * 0.014);
          height: calc(var(--ph) * 0.972);
          width: ${rightThickness.toFixed(2)}px;
          left: var(--pw);
          background: repeating-linear-gradient(90deg, ${b.paper || '#fbfaf6'} 0px, ${b.paper || '#fbfaf6'} 1px, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0.18) 1.6px);
          border-radius: 0 3px 3px 0;
          box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.14);
        `;
        this.bookOrigin.appendChild(rightEdge);
      }

      // 3. Flat Left Page
      if (O >= 0) {
        const isBoard = this.leaves[O].board;
        const pageEl = document.createElement('div');
        const w = isBoard ? `var(--pw)` : `calc(var(--pw) - var(--rim))`;
        const h = isBoard ? `var(--ph)` : `calc(var(--ph) - 2 * var(--rim))`;
        const top = isBoard ? `calc(var(--ph) / -2)` : `calc(var(--ph) / -2 + var(--rim))`;

        pageEl.style.cssText = `
          position: absolute;
          top: ${top};
          height: ${h};
          width: ${w};
          left: calc(${w} * -1);
          transform: translateZ(0.2px);
          box-shadow: ${isBoard ? bookShadow : '0 1px 2px rgba(0,0,0,0.08)'};
          border-radius: ${radius}px 0 0 ${radius}px;
          overflow: hidden;
        `;
        pageEl.appendChild(this.createFaceNode(this.leaves[O].back, 'back', isBoard, true));

        // Cast shadow overlay from right turning page
        this.castLeftEl = document.createElement('div');
        this.castLeftEl.className = 'shading-layer';
        pageEl.appendChild(this.castLeftEl);

        this.bookOrigin.appendChild(pageEl);
      }

      // 4. Flat Right Page
      if (D >= 0) {
        const isBoard = this.leaves[D].board;
        const pageEl = document.createElement('div');
        const w = isBoard ? `var(--pw)` : `calc(var(--pw) - var(--rim))`;
        const h = isBoard ? `var(--ph)` : `calc(var(--ph) - 2 * var(--rim))`;
        const top = isBoard ? `calc(var(--ph) / -2)` : `calc(var(--ph) / -2 + var(--rim))`;

        pageEl.style.cssText = `
          position: absolute;
          top: ${top};
          height: ${h};
          width: ${w};
          left: 0;
          transform: translateZ(0.2px);
          box-shadow: ${isBoard ? bookShadow : '0 1px 2px rgba(0,0,0,0.08)'};
          border-radius: 0 ${radius}px ${radius}px 0;
          overflow: hidden;
        `;
        pageEl.appendChild(this.createFaceNode(this.leaves[D].front, 'front', isBoard, true));

        // Cast shadow overlay from left turning page
        this.castRightEl = document.createElement('div');
        this.castRightEl.className = 'shading-layer';
        pageEl.appendChild(this.castRightEl);

        this.bookOrigin.appendChild(pageEl);
      }

      // 5. Active Curling Leaves (12-segment 3D nested strips)
      state.act.forEach((leafIdx) => {
        const leafModel = this.leaves[leafIdx];
        const isBoard = leafModel.board;
        const w = isBoard ? `var(--pw)` : `calc(var(--pw) - var(--rim))`;
        const h = isBoard ? `var(--ph)` : `calc(var(--ph) - 2 * var(--rim))`;
        const top = isBoard ? `calc(var(--ph) / -2)` : `calc(var(--ph) / -2 + var(--rim))`;

        const rootEl = document.createElement('div');
        rootEl.className = `curling-leaf-${leafIdx}`;
        rootEl.style.cssText = `
          position: absolute;
          left: 0;
          top: ${top};
          width: ${w};
          height: ${h};
          transform-style: preserve-3d;
          transform-origin: 0 50%;
          pointer-events: none;
          --lw: ${w};
        `;

        const sNodes = [];
        const fShadeNodes = [];
        const bShadeNodes = [];

        // Build nested strips from innermost (s=11) out to outermost (s=0)
        let innermostEl = null;

        for (let s = SEGMENTS - 1; s >= 0; s--) {
          const stripEl = document.createElement('div');
          stripEl.style.cssText = `
            position: absolute;
            top: 0;
            height: 100%;
            left: ${s === 0 ? '0' : `calc(var(--lw) / ${SEGMENTS})`};
            width: calc(var(--lw) / ${SEGMENTS} + 0.7px);
            transform-origin: 0 50%;
            transform-style: preserve-3d;
          `;
          sNodes[s] = stripEl;

          // Front Face Strip Slice
          const frontSlice = document.createElement('div');
          frontSlice.style.cssText = `
            position: absolute;
            inset: 0;
            overflow: hidden;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
          `;
          const frontInner = document.createElement('div');
          frontInner.style.cssText = `
            position: absolute;
            top: 0;
            height: 100%;
            width: var(--lw);
            left: calc(var(--lw) * ${(-s / SEGMENTS).toFixed(5)});
          `;
          frontInner.appendChild(this.createFaceNode(leafModel.front, 'front', isBoard, false));
          frontSlice.appendChild(frontInner);

          const frontShade = document.createElement('div');
          frontShade.className = 'shading-layer';
          fShadeNodes[s] = frontShade;
          frontSlice.appendChild(frontShade);
          stripEl.appendChild(frontSlice);

          // Back Face Strip Slice (rotated 180deg)
          const backSlice = document.createElement('div');
          backSlice.style.cssText = `
            position: absolute;
            inset: 0;
            overflow: hidden;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
            transform: rotateY(180deg);
          `;
          const backInner = document.createElement('div');
          backInner.style.cssText = `
            position: absolute;
            top: 0;
            height: 100%;
            width: var(--lw);
            left: calc(var(--lw) * ${(-(SEGMENTS - 1 - s) / SEGMENTS).toFixed(5)});
          `;
          backInner.appendChild(this.createFaceNode(leafModel.back, 'back', isBoard, false));
          backSlice.appendChild(backInner);

          const backShade = document.createElement('div');
          backShade.className = 'shading-layer';
          bShadeNodes[s] = backShade;
          backSlice.appendChild(backShade);
          stripEl.appendChild(backSlice);

          // Nest previous child inside current strip
          if (innermostEl) {
            stripEl.appendChild(innermostEl);
          }
          innermostEl = stripEl;
        }

        rootEl.appendChild(innermostEl);
        this.bookOrigin.appendChild(rootEl);

        this.leafNodes.set(leafIdx, {
          root: rootEl,
          s: sNodes,
          f: fShadeNodes,
          b: bShadeNodes
        });
      });

      this.paint();
    }

    /**
     * Create face DOM (cover, endpaper, photo, video, caption, folio)
     */
    createFaceNode(side, face, isBoard, isFlat) {
      const b = this.bookConfig;
      const c = this.coversConfig;
      const radius = clamp(numOrDefault(b.radius, 4), 0, 60);
      const isFront = face === 'front';

      const container = document.createElement('div');
      container.className = 'face-container';
      container.style.borderRadius = isFront ? `0 ${radius}px ${radius}px 0` : `${radius}px 0 0 ${radius}px`;

      // 1. Cover or Rear Cover
      if (side.kind === 'cover' || side.kind === 'rear') {
        container.style.backgroundColor = c.color || '#26332d';

        if (side.video && isFlat) {
          const video = document.createElement('video');
          video.src = side.video;
          if (side.img) video.poster = side.img;
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.autoplay = true;
          video.className = 'media-cover';
          container.appendChild(video);
          this.videoElements.add(video);
        } else if (side.img) {
          const img = document.createElement('img');
          img.src = side.img;
          img.alt = side.caption || '';
          img.className = 'media-cover';
          img.draggable = false;
          container.appendChild(img);
        }

        // Dark gradient overlay
        const gradOverlay = document.createElement('div');
        gradOverlay.className = 'shading-layer';
        gradOverlay.style.background = 'linear-gradient(180deg, rgba(0,0,0,0) 46%, rgba(0,0,0,0.38) 100%)';
        container.appendChild(gradOverlay);

        // Spine shading
        const spineShade = document.createElement('div');
        spineShade.className = 'shading-layer';
        spineShade.style.background = this.getSpineGradient(face, b.spine);
        container.appendChild(spineShade);

        // Cover Title
        if (side.caption) {
          const title = document.createElement('div');
          title.style.cssText = `
            position: absolute;
            left: 13%;
            right: 9%;
            bottom: 9%;
            color: ${c.titleColor || '#f4f1ea'};
            font-size: calc(var(--ph) * 0.07);
            line-height: 0.95;
            font-weight: 500;
            letter-spacing: -0.045em;
          `;
          title.innerText = side.caption;
          container.appendChild(title);
        }
        return container;
      }

      // 2. Endpaper
      if (side.kind === 'endpaper') {
        container.style.backgroundColor = c.color || '#26332d';

        const pinstripe = document.createElement('div');
        pinstripe.className = 'shading-layer';
        pinstripe.style.background = `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 7px),
          linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08))
        `;
        container.appendChild(pinstripe);

        const spineShade = document.createElement('div');
        spineShade.className = 'shading-layer';
        spineShade.style.background = this.getSpineGradient(face, b.spine);
        container.appendChild(spineShade);
        return container;
      }

      // 3. Inner Photo / Video Page
      container.style.backgroundColor = b.paper || '#fbfaf6';

      let mediaWrapper;
      if (side.bleed) {
        mediaWrapper = container;
      } else {
        mediaWrapper = document.createElement('div');
        mediaWrapper.style.cssText = `
          position: absolute;
          top: 8%;
          left: 9%;
          right: 9%;
          bottom: 18%;
          overflow: hidden;
          border-radius: ${radius * 0.25}px;
          background: rgba(0,0,0,0.05);
        `;
        container.appendChild(mediaWrapper);
      }

      if (side.video && isFlat) {
        const video = document.createElement('video');
        video.src = side.video;
        if (side.img) video.poster = side.img;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        video.className = 'media-cover';
        mediaWrapper.appendChild(video);
        this.videoElements.add(video);
      } else if (side.img) {
        const img = document.createElement('img');
        img.src = side.img;
        img.alt = side.caption || '';
        img.className = 'media-cover';
        img.draggable = false;
        mediaWrapper.appendChild(img);
      }

      // Bleed subtle bottom gradient
      if (side.bleed) {
        const bleedGrad = document.createElement('div');
        bleedGrad.className = 'shading-layer';
        bleedGrad.style.background = 'linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%)';
        container.appendChild(bleedGrad);
      }

      const textColor = side.bleed ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,20,0.58)';

      // Caption
      if (side.caption) {
        const cap = document.createElement('div');
        cap.className = 'page-caption';
        cap.style.color = textColor;
        if (isFront) {
          cap.style.left = '9%';
        } else {
          cap.style.right = '9%';
          cap.style.textAlign = 'right';
        }
        cap.innerText = side.caption;
        container.appendChild(cap);
      }

      // Folio (page number)
      if (side.folio > 0) {
        const folio = document.createElement('div');
        folio.className = 'page-folio';
        folio.style.color = textColor;
        if (isFront) {
          folio.style.right = '9%';
        } else {
          folio.style.left = '9%';
        }
        folio.innerText = padZero(side.folio);
        container.appendChild(folio);
      }

      // Spine shadow
      const spineShade = document.createElement('div');
      spineShade.className = 'shading-layer';
      spineShade.style.background = this.getSpineGradient(face, b.spine);
      container.appendChild(spineShade);

      return container;
    }

    /**
     * Spine depth gradient
     */
    getSpineGradient(face, spineFactor) {
      const s = clamp(numOrDefault(spineFactor, 0.55), 0, 1);
      const angle = face === 'front' ? 90 : 270;
      return `linear-gradient(${angle}deg, rgba(0,0,0,${(s * 0.34).toFixed(3)}) 0%, rgba(0,0,0,${(s * 0.12).toFixed(3)}) 3.5%, rgba(0,0,0,0) 10%, rgba(255,255,255,${(s * 0.12).toFixed(3)}) 12%, rgba(255,255,255,0) 17%)`;
    }

    /**
     * Apply real-time transforms and dynamic lighting gradients to DOM
     */
    paint() {
      const d = this.deck;
      const total = d.p.length;
      if (!total) return;

      const p0 = d.p[0];
      const pLast = d.p[total - 1];

      // Spine shift offset: centers book whether closed on front cover, open spread, or closed on back
      const off = -0.5 * (1 - p0) + 0.5 * pLast;
      const lx = Math.max(0, -Math.cos(Math.PI * p0));
      const rx = Math.max(0, Math.cos(Math.PI * pLast));

      this.container.style.setProperty('--off', off.toFixed(4));
      this.container.style.setProperty('--lx', lx.toFixed(4));
      this.container.style.setProperty('--rx', rx.toFixed(4));
      this.container.style.setProperty('--tilt', `${d.tilt.toFixed(3)}deg`);

      if (this.bookOrigin) {
        this.bookOrigin.style.transform = `translate3d(calc(var(--off) * var(--pw)), 0, 0) rotateX(var(--tilt))`;
      }

      const shadowFactor = clamp(numOrDefault(this.bookConfig.shadow, 0.6), 0, 1);
      const { curl } = this.getMotionParams();
      const pShadow = (deg) => 0.5 * shadowFactor * (deg <= 90 ? Math.pow(deg / 90, 1.35) : 1);
      const mShadow = (deg) => pShadow(180 - deg);

      const angles = new Array(SEGMENTS).fill(0);

      // Render transforms for active curling leaves
      for (const k of d.act) {
        const node = this.leafNodes.get(k);
        if (!node || !node.root) continue;

        const isBoard = this.leaves[k].board;
        const leafP = d.p[k];
        const bendMult = isBoard ? 0.22 : 1.0;
        this.computeCurlAngles(leafP, d.bend[k] * bendMult, angles);

        const zIndex = (leafP < 0.5 ? total - k : k + 1) * 0.35 + 0.6;
        const skewY = d.skew[k] * 5 * curl * Math.sin(Math.PI * leafP) * (isBoard ? 0.3 : 1.0);

        node.root.style.transform = `translateZ(${zIndex.toFixed(2)}px) skewY(${skewY.toFixed(3)}deg)`;

        let prevAngle = 0;
        for (let s = 0; s < SEGMENTS; s++) {
          const stripEl = node.s[s];
          const curAngle = angles[s];
          const delta = curAngle - prevAngle;
          prevAngle = curAngle;

          if (stripEl) {
            stripEl.style.transform = `rotateY(${(-delta).toFixed(3)}deg)`;
          }

          // Shading and specular highlights on the curve
          const anglePrev = s > 0 ? (angles[s - 1] + angles[s]) / 2 : angles[0];
          const angleNext = s < SEGMENTS - 1 ? (angles[s] + angles[s + 1]) / 2 : angles[s];
          const curvatureDiff = Math.abs((s < SEGMENTS - 1 ? angles[s + 1] : angles[s]) - (s > 0 ? angles[s - 1] : angles[s]));

          const specularAlpha = (Math.min(0.32, curvatureDiff * 0.02) * shadowFactor).toFixed(3);
          const specularGrad = `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,${specularAlpha}), rgba(255,255,255,0))`;

          const fShade = node.f[s];
          if (fShade) {
            fShade.style.background = `linear-gradient(90deg, rgba(0,0,0,${pShadow(anglePrev).toFixed(3)}), rgba(0,0,0,${pShadow(angleNext).toFixed(3)})), ${specularGrad}`;
          }

          const bShade = node.b[s];
          if (bShade) {
            bShade.style.background = `linear-gradient(90deg, rgba(0,0,0,${mShadow(angleNext).toFixed(3)}), rgba(0,0,0,${mShadow(anglePrev).toFixed(3)})), ${specularGrad}, linear-gradient(rgba(96,80,56,0.08), rgba(96,80,56,0.08))`;
          }
        }
      }

      // Cast Shadows onto facing flat pages
      const computeCastShadow = (k) => {
        if (k < 0 || k >= total || d.act.indexOf(k) < 0 || !this.leaves[k]) return null;
        const isBoard = this.leaves[k].board;
        this.computeCurlAngles(d.p[k], d.bend[k] * (isBoard ? 0.22 : 1.0), angles);
        return {
          e: Math.cos((angles[SEGMENTS - 1] * Math.PI) / 180),
          alpha: (shadowFactor * 0.5 * Math.pow(Math.sin(Math.PI * d.p[k]), 0.6)).toFixed(3)
        };
      };

      if (this.castRightEl) {
        let grad = 'none';
        const shadowData = d.right >= 0 ? computeCastShadow(d.right - 1) : null;
        if (shadowData && shadowData.e > 0) {
          const pct = shadowData.e * 100;
          grad = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, pct - 1).toFixed(2)}%, rgba(0,0,0,${shadowData.alpha}) ${pct.toFixed(2)}%, rgba(0,0,0,0) ${Math.min(100, pct + 24).toFixed(2)}%)`;
        }
        this.castRightEl.style.background = grad;
      }

      if (this.castLeftEl) {
        let grad = 'none';
        const shadowData = d.left >= 0 ? computeCastShadow(d.left + 1) : null;
        if (shadowData && shadowData.e < 0) {
          const pct = (1 + shadowData.e) * 100;
          grad = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, pct - 24).toFixed(2)}%, rgba(0,0,0,${shadowData.alpha}) ${pct.toFixed(2)}%, rgba(0,0,0,0) ${Math.min(100, pct + 1).toFixed(2)}%)`;
        }
        this.castLeftEl.style.background = grad;
      }
    }

    /**
     * Main Physics & Animation Frame Loop
     */
    tick(now) {
      this.animId = null;
      const d = this.deck;
      const total = d.p.length;
      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      const { speed, feel, curl } = this.getMotionParams();

      // Spring constants
      const springStiffness = 95 * speed * speed * (1.2 - 0.55 * feel);
      const damping = 2 * (0.9 - 0.32 * feel) * Math.sqrt(springStiffness);

      // Process staggered riffle queue
      while (d.queue.length && d.queue[0].at <= now) {
        const item = d.queue.shift();
        d.goal[item.k] = item.g;
        d.v[item.k] += item.g ? 0.8 : -0.8;
      }

      let stillMoving = d.queue.length > 0;

      // Update positions and velocities
      for (let i = 0; i < total; i++) {
        if (i === d.dragK) continue;

        const target = i === d.hoverK ? d.hoverP : d.goal[i];
        const accel = springStiffness * (target - d.p[i]) - damping * d.v[i];
        let newV = d.v[i] + accel * dt;
        let newP = d.p[i] + newV * dt;

        // Bounce back if exceeding bounds
        if (newP < 0) {
          newP = 0;
          if (newV < 0) newV = -newV * 0.18;
        } else if (newP > 1) {
          newP = 1;
          if (newV > 0) newV = -newV * 0.18;
        }

        d.p[i] = newP;
        d.v[i] = newV;
      }

      // Maintain physical page stacking constraints
      for (let i = 0; i < total - 1; i++) {
        const maxAllowed = d.p[i] >= 0.9995 ? 1.0 : Math.max(0, d.p[i] - PAGE_GAP);
        if (d.p[i + 1] > maxAllowed) {
          d.p[i + 1] = maxAllowed;
          if (d.v[i + 1] > d.v[i]) d.v[i + 1] = d.v[i];
        }
      }

      // Update bend and skew dynamics
      for (let i = 0; i < total; i++) {
        const isDragging = i === d.dragK;
        const isHovering = i === d.hoverK;
        const target = isHovering ? d.hoverP : d.goal[i];

        let targetBend = 0;
        let targetSkew = 0;

        if (isDragging && this.drag) {
          targetBend = curl * (this.drag.side * 0.8 + clamp(this.drag.vp * 0.25, -0.7, 0.7));
          targetSkew = this.drag.v0;
        } else if (isHovering) {
          targetBend = curl * 1.6 * (d.hoverP < 0.5 ? 1 : -1);
          targetSkew = d.hoverV;
        } else if (Math.abs(target - d.p[i]) > 0.002) {
          targetBend = curl * (target > d.p[i] ? 1 : -1);
        }

        d.bend[i] += (targetBend - d.bend[i]) * Math.min(1, dt * 9);
        d.skew[i] += (targetSkew - d.skew[i]) * Math.min(1, dt * 7);

        if (isDragging) {
          stillMoving = true;
        } else if (Math.abs(target - d.p[i]) < 0.0008 && Math.abs(d.v[i]) < 0.004) {
          d.p[i] = target;
          d.v[i] = 0;
        } else {
          stillMoving = true;
        }

        if (Math.abs(targetBend - d.bend[i]) > 0.01 || Math.abs(targetSkew - d.skew[i]) > 0.01) {
          stillMoving = true;
        } else {
          d.bend[i] = targetBend;
          d.skew[i] = targetSkew;
        }
      }

      // Update 3D book perspective tilt
      const targetTilt = this.motionConfig.tilt !== false ? d.tiltGoal : 0;
      d.tilt += (targetTilt - d.tilt) * Math.min(1, dt * 6);
      if (Math.abs(targetTilt - d.tilt) > 0.02) {
        stillMoving = true;
      } else {
        d.tilt = targetTilt;
      }

      // Check if page state key changed (requiring DOM structure update)
      const curState = this.computeActivePages();
      if (curState.key !== d.key) {
        this.refreshLayout();
      } else {
        this.paint();
      }

      if (stillMoving) {
        this.wake();
      }
    }

    wake() {
      if (!this.animId) {
        this.lastFrameTime = performance.now();
        this.animId = requestAnimationFrame((t) => this.tick(t));
      }
    }

    park() {
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
      this.cancelDrag();
      this.deck.hoverK = -1;
      this.deck.tiltGoal = 0;
    }

    /**
     * Turn single page forward (+1) or backward (-1)
     */
    turn(dir) {
      const d = this.deck;
      const total = d.p.length;
      d.queue.length = 0;
      d.hoverK = -1;
      d.lastTouch = performance.now();

      let pos = 0;
      for (const g of d.goal) pos += g;

      let targetLeaf = -1;
      if (dir > 0 && pos < total) {
        targetLeaf = pos;
        d.goal[targetLeaf] = 1;
        d.v[targetLeaf] += 0.5;
      } else if (dir < 0 && pos > 0) {
        targetLeaf = pos - 1;
        d.goal[targetLeaf] = 0;
        d.v[targetLeaf] -= 0.5;
      }

      if (targetLeaf >= 0) {
        this.wake();
      }
    }

    /**
     * Riffle flip to specific spread index
     */
    riffleTo(targetSpread) {
      const d = this.deck;
      const total = d.p.length;
      const clamped = clamp(Math.round(targetSpread), 0, total);

      d.queue.length = 0;
      d.hoverK = -1;
      d.lastTouch = performance.now();

      let curPos = 0;
      for (const g of d.goal) curPos += g;

      const staggerInterval = 72 / this.getMotionParams().speed;
      const now = performance.now();

      if (clamped > curPos) {
        for (let i = curPos; i < clamped; i++) {
          d.queue.push({ k: i, g: 1, at: now + (i - curPos) * staggerInterval });
        }
      } else {
        for (let i = curPos - 1, step = 0; i >= clamped; i--, step++) {
          d.queue.push({ k: i, g: 0, at: now + step * staggerInterval });
        }
      }

      this.wake();
    }

    /**
     * Calculate normalized book coordinates from pointer
     */
    pointerToBookCoords(clientX, clientY) {
      const rect = this.container.getBoundingClientRect();
      const b = this.bookConfig;
      const size = clamp(numOrDefault(b.size, 0.68), 0.2, 1.0);
      const aspect = clamp(numOrDefault(b.aspect, 0.76), 0.3, 2.0);

      const ph = Math.min(size * rect.height, (size * rect.width) / (2 * aspect));
      const pw = ph * aspect;

      const d = this.deck;
      const total = d.p.length;
      const off = -0.5 * (1 - d.p[0]) + 0.5 * d.p[total - 1];

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const u = (clientX - centerX - off * pw) / pw;
      const v = (clientY - centerY) / (ph / 2);

      let side = 0;
      if (Math.abs(v) <= 1) {
        if (u >= 0 && u <= 1 && d.p[total - 1] < 0.5) {
          side = 1;
        } else if (u < 0 && u >= -1 && d.p[0] > 0.5) {
          side = -1;
        }
      }

      return {
        u,
        v,
        side,
        ty: (clientY - centerY) / Math.max(1, rect.height / 2)
      };
    }

    cancelDrag() {
      const d = this.deck;
      if (this.drag && this.drag.live && this.drag.leaf >= 0 && this.drag.leaf < d.p.length) {
        d.goal[this.drag.leaf] = +(d.p[this.drag.leaf] > 0.5);
        d.dragK = -1;
      }
      this.drag = null;
      this.container.style.cursor = '';
    }

    /**
     * Attach all interaction handlers (Pointer, Touch, Drag, Hover, Keyboard, Wheel)
     */
    bindEvents() {
      window.addEventListener('resize', () => {
        this.updateDimensions();
        this.paint();
      });

      // Pointer Down
      this.container.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const coords = this.pointerToBookCoords(e.clientX, e.clientY);
        this.deck.lastTouch = performance.now();

        if (coords.side) {
          this.drag = {
            id: e.pointerId,
            side: coords.side,
            x0: e.clientX,
            y0: e.clientY,
            u0: coords.u,
            v0: clamp(coords.v, -1, 1),
            live: false,
            leaf: -1,
            uEdge: 0,
            vp: 0,
            t: performance.now()
          };
          try {
            this.container.setPointerCapture(e.pointerId);
          } catch (_) {}
        }
      });

      // Pointer Move
      this.container.addEventListener('pointermove', (e) => {
        const d = this.deck;
        const total = d.p.length;
        const coords = this.pointerToBookCoords(e.clientX, e.clientY);
        d.lastTouch = performance.now();

        // 3D Perspective Tilt on mouse move
        if (this.motionConfig.tilt !== false && e.pointerType === 'mouse') {
          const tiltAmount = clamp(numOrDefault(this.motionConfig.tiltAmount, 6), 0, 30);
          const targetTilt = clamp(-coords.ty, -1, 1) * tiltAmount;
          if (Math.abs(targetTilt - d.tiltGoal) > 0.05) {
            d.tiltGoal = targetTilt;
            this.wake();
          }
        }

        // Dragging leaf
        if (this.drag && this.drag.id === e.pointerId) {
          if (!this.drag.live) {
            if (Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0) < 6) return;

            let pos = 0;
            for (const g of d.goal) pos += g;

            const leafIdx = this.drag.side > 0 ? pos : pos - 1;
            if (leafIdx < 0 || leafIdx >= total) {
              this.drag = null;
              return;
            }

            d.queue.length = 0;
            d.hoverK = -1;
            this.drag.live = true;
            this.drag.leaf = leafIdx;
            this.drag.uEdge = Math.cos(Math.PI * d.p[leafIdx]);
            this.drag.u0 = coords.u;
            this.drag.t = performance.now();
            d.dragK = leafIdx;
            this.container.style.cursor = 'grabbing';
          }

          const k = this.drag.leaf;
          const uGoal = clamp(this.drag.uEdge + (coords.u - this.drag.u0), -1, 1);
          const newP = Math.acos(uGoal) / Math.PI;
          const now = performance.now();
          const dt = Math.max(1, now - this.drag.t) / 1000;

          this.drag.vp = this.drag.vp * 0.55 + ((newP - d.p[k]) / dt) * 0.45;
          this.drag.t = now;
          d.p[k] = newP;
          d.v[k] = this.drag.vp;
          this.wake();
          return;
        }

        // Hover page peeking on edges
        if (e.pointerType !== 'mouse' || this.drag) return;

        let curPos = 0;
        for (const g of d.goal) curPos += g;

        let hoverLeaf = -1;
        let hoverTarget = 0;
        const isVerticallyCentered = Math.abs(coords.v) > 0.5;

        if (coords.side > 0 && coords.u > 0.78 && isVerticallyCentered && curPos < total) {
          if (d.hoverK === curPos || (d.p[curPos] === 0 && d.goal[curPos] === 0)) {
            hoverLeaf = curPos;
            hoverTarget = 0.05;
          }
        } else if (coords.side < 0 && coords.u < -0.78 && isVerticallyCentered && curPos > 0) {
          if (d.hoverK === curPos - 1 || (d.p[curPos - 1] === 1 && d.goal[curPos - 1] === 1)) {
            hoverLeaf = curPos - 1;
            hoverTarget = 0.95;
          }
        }

        if (hoverLeaf !== d.hoverK || (hoverLeaf >= 0 && Math.abs(d.hoverV - coords.v) > 0.05)) {
          d.hoverK = hoverLeaf;
          d.hoverP = hoverTarget;
          d.hoverV = hoverLeaf >= 0 ? clamp(coords.v, -1, 1) : 0;
          this.wake();
        }

        this.container.style.cursor = hoverLeaf >= 0 ? 'grab' : coords.side ? 'pointer' : '';
      });

      // Pointer Up
      this.container.addEventListener('pointerup', (e) => {
        if (!this.drag || this.drag.id !== e.pointerId) return;

        try {
          this.container.releasePointerCapture(e.pointerId);
        } catch (_) {}

        const dragInfo = this.drag;
        this.drag = null;
        const d = this.deck;

        if (dragInfo.live) {
          const k = dragInfo.leaf;
          const p = d.p[k];
          const vp = dragInfo.vp;

          if (dragInfo.side > 0) {
            d.goal[k] = +(vp > 1.1 || (p > 0.5 && vp > -1.1));
          } else {
            d.goal[k] = vp < -1.1 || (p < 0.5 && vp < 1.1) ? 0 : 1;
          }

          d.v[k] = clamp(vp, -6, 6);
          d.dragK = -1;
          this.container.style.cursor = '';
          this.wake();
          return;
        }

        // Tap/click trigger if pointer didn't drag far
        const dist = Math.hypot(e.clientX - dragInfo.x0, e.clientY - dragInfo.y0);
        if (dist < 6) {
          this.turn(dragInfo.side);
        }
      });

      this.container.addEventListener('pointercancel', (e) => {
        if (this.drag && this.drag.id === e.pointerId) {
          this.cancelDrag();
          this.wake();
        }
      });

      this.container.addEventListener('pointerleave', () => {
        if (!this.drag || !this.drag.live) {
          this.deck.hoverK = -1;
          this.deck.tiltGoal = 0;
          this.container.style.cursor = '';
          this.wake();
        }
      });

      // Double-click resets back to cover (spread 0)
      this.container.addEventListener('dblclick', (e) => {
        const coords = this.pointerToBookCoords(e.clientX, e.clientY);
        if (!coords.side) {
          this.riffleTo(0);
        }
      });

      // Keyboard navigation
      window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          this.turn(1);
          e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          this.turn(-1);
          e.preventDefault();
        } else if (e.key === 'Home') {
          this.riffleTo(0);
          e.preventDefault();
        } else if (e.key === 'End') {
          this.riffleTo(this.totalLeaves);
          e.preventDefault();
        }
      });

      // Prevent mobile touch scroll while dragging
      this.container.addEventListener(
        'touchmove',
        (e) => {
          if (this.drag && this.drag.live && e.cancelable) {
            e.preventDefault();
          }
        },
        { passive: false }
      );
    }
  }

  // Auto-instantiate when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    window.album = new MemoryAlbum('#album-viewport');
  });

  // Export class
  window.MemoryAlbum = MemoryAlbum;
})();
