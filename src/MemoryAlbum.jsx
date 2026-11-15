import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import './MemoryAlbum.css';

const SEGMENTS = 12;
const PAGE_GAP = 0.035;

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));
const numOrDefault = (val, def) => (typeof val === 'number' && isFinite(val) ? val : def);
const padZero = (n) => (n < 10 ? `0${n}` : `${n}`);

export default function MemoryAlbum({ data }) {
  const containerRef = useRef(null);
  const bookOriginRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(performance.now());
  const dragRef = useRef(null);
  const leafNodesRef = useRef(new Map());
  const castLeftRef = useRef(null);
  const castRightRef = useRef(null);

  const bookConfig = data?.book || {};
  const coversConfig = data?.covers || {};
  const motionConfig = data?.motion || {};
  const bgConfig = data?.background || {};
  const sheetsConfig = data?.sheets || [];

  // Build leaves
  const leaves = useMemo(() => {
    const c = coversConfig;
    const emptyPaper = (kind) => ({ kind, img: '', video: '', caption: '', bleed: false, folio: 0 });

    const list = [
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

    sheetsConfig.forEach((s, idx) => {
      list.push({
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

    list.push({
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

    return list;
  }, [coversConfig, sheetsConfig]);

  const totalLeaves = leaves.length;

  // Initial position
  const initialPos = bookConfig.start === 'spread' ? Math.min(2, totalLeaves - 1) : 0;

  // Deck state in ref for 60fps mutability without React re-render lag
  const deckRef = useRef({
    p: Array.from({ length: totalLeaves }, (_, i) => (i < initialPos ? 1 : 0)),
    v: new Array(totalLeaves).fill(0),
    goal: Array.from({ length: totalLeaves }, (_, i) => (i < initialPos ? 1 : 0)),
    bend: new Array(totalLeaves).fill(0),
    skew: new Array(totalLeaves).fill(0),
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
  });

  const [activeSpread, setActiveSpread] = useState(initialPos);
  const [, setRerenderKey] = useState(0);

  // Compute active pages & stacks
  const computeActivePages = useCallback(() => {
    const d = deckRef.current;
    const total = d.p.length;
    const act = [];
    let right = -1;
    let left = -1;
    let pos = 0;

    const isStationary = (k) => k !== d.dragK && k !== d.hoverK && (d.p[k] === 0 || d.p[k] === 1);

    for (let k = 0; k < total; k++) {
      pos += d.goal[k];
      if (!isStationary(k)) act.push(k);
    }

    for (let k = 0; k < total; k++) {
      if (isStationary(k) && d.p[k] === 0) {
        right = k;
        break;
      }
    }

    for (let k = total - 1; k >= 0; k--) {
      if (isStationary(k) && d.p[k] === 1) {
        left = k;
        break;
      }
    }

    return { act, right, left, pos, key: `${act.join(',')}|${right}|${left}|${pos}|${total}` };
  }, []);

  const getMotionParams = useCallback(() => {
    const m = motionConfig;
    return {
      speed: clamp(numOrDefault(m.speed, 1.0), 0.2, 4.0),
      feel: clamp(numOrDefault(m.feel, 0.45), 0.0, 1.0),
      curl: clamp(numOrDefault(m.curl, 1.0), 0.0, 2.0),
      tilt: m.tilt !== false,
      tiltAmount: clamp(numOrDefault(m.tiltAmount, 6), 0, 30)
    };
  }, [motionConfig]);

  // 12-segment cylindrical page curl angles computation
  const computeCurlAngles = (progress, bend, outAngles) => {
    const base = 180 * progress;
    const curlAmount = 78 * bend * Math.sin(Math.PI * progress);
    for (let s = 0; s < SEGMENTS; s++) {
      const t = (s + 1) / SEGMENTS;
      outAngles[s] = clamp(base + curlAmount * (Math.pow(t, 1.7) - 0.36), 0, 180);
    }
    return outAngles;
  };

  const getSpineGradient = (face, spineFactor) => {
    const s = clamp(numOrDefault(spineFactor, 0.55), 0, 1);
    const angle = face === 'front' ? 90 : 270;
    return `linear-gradient(${angle}deg, rgba(0,0,0,${(s * 0.34).toFixed(3)}) 0%, rgba(0,0,0,${(s * 0.12).toFixed(3)}) 3.5%, rgba(0,0,0,0) 10%, rgba(255,255,255,${(s * 0.12).toFixed(3)}) 12%, rgba(255,255,255,0) 17%)`;
  };

  // Paint transforms and lighting directly on DOM
  const paint = useCallback(() => {
    const d = deckRef.current;
    const container = containerRef.current;
    const bookOrigin = bookOriginRef.current;
    if (!container || !bookOrigin) return;

    const total = d.p.length;
    const p0 = d.p[0];
    const pLast = d.p[total - 1];

    const off = -0.5 * (1 - p0) + 0.5 * pLast;
    const lx = Math.max(0, -Math.cos(Math.PI * p0));
    const rx = Math.max(0, Math.cos(Math.PI * pLast));

    container.style.setProperty('--off', off.toFixed(4));
    container.style.setProperty('--lx', lx.toFixed(4));
    container.style.setProperty('--rx', rx.toFixed(4));
    container.style.setProperty('--tilt', `${d.tilt.toFixed(3)}deg`);

    bookOrigin.style.transform = `translate3d(calc(var(--off) * var(--pw)), 0, 0) rotateX(var(--tilt))`;

    const shadowFactor = clamp(numOrDefault(bookConfig.shadow, 0.6), 0, 1);
    const { curl } = getMotionParams();
    const pShadow = (deg) => 0.5 * shadowFactor * (deg <= 90 ? Math.pow(deg / 90, 1.35) : 1);
    const mShadow = (deg) => pShadow(180 - deg);

    const angles = new Array(SEGMENTS).fill(0);

    for (const k of d.act) {
      const node = leafNodesRef.current.get(k);
      if (!node || !node.root) continue;

      const isBoard = leaves[k]?.board;
      const leafP = d.p[k];
      const bendMult = isBoard ? 0.22 : 1.0;
      computeCurlAngles(leafP, d.bend[k] * bendMult, angles);

      const zIndex = (leafP < 0.5 ? total - k : k + 1) * 0.35 + 0.6;
      const skewY = d.skew[k] * 5 * curl * Math.sin(Math.PI * leafP) * (isBoard ? 0.3 : 1.0);

      node.root.style.transform = `translateZ(${zIndex.toFixed(2)}px) skewY(${skewY.toFixed(3)}deg)`;

      let prevAngle = 0;
      for (let s = 0; s < SEGMENTS; s++) {
        const stripEl = node.s[s];
        const curAngle = angles[s];
        const delta = curAngle - prevAngle;
        prevAngle = curAngle;

        if (stripEl) stripEl.style.transform = `rotateY(${(-delta).toFixed(3)}deg)`;

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

    // Cast shadows on facing pages
    const computeCast = (k) => {
      if (k < 0 || k >= total || d.act.indexOf(k) < 0 || !leaves[k]) return null;
      const isBoard = leaves[k].board;
      computeCurlAngles(d.p[k], d.bend[k] * (isBoard ? 0.22 : 1.0), angles);
      return {
        e: Math.cos((angles[SEGMENTS - 1] * Math.PI) / 180),
        alpha: (shadowFactor * 0.5 * Math.pow(Math.sin(Math.PI * d.p[k]), 0.6)).toFixed(3)
      };
    };

    if (castRightRef.current) {
      let grad = 'none';
      const shadowData = d.right >= 0 ? computeCast(d.right - 1) : null;
      if (shadowData && shadowData.e > 0) {
        const pct = shadowData.e * 100;
        grad = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, pct - 1).toFixed(2)}%, rgba(0,0,0,${shadowData.alpha}) ${pct.toFixed(2)}%, rgba(0,0,0,0) ${Math.min(100, pct + 24).toFixed(2)}%)`;
      }
      castRightRef.current.style.background = grad;
    }

    if (castLeftRef.current) {
      let grad = 'none';
      const shadowData = d.left >= 0 ? computeCast(d.left + 1) : null;
      if (shadowData && shadowData.e < 0) {
        const pct = (1 + shadowData.e) * 100;
        grad = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, pct - 24).toFixed(2)}%, rgba(0,0,0,${shadowData.alpha}) ${pct.toFixed(2)}%, rgba(0,0,0,0) ${Math.min(100, pct + 1).toFixed(2)}%)`;
      }
      castLeftRef.current.style.background = grad;
    }
  }, [bookConfig.shadow, getMotionParams, leaves]);

  // Main animation tick
  const tick = useCallback((now) => {
    animFrameRef.current = null;
    const d = deckRef.current;
    const total = d.p.length;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - lastTimeRef.current) / 1000));
    lastTimeRef.current = now;

    const { speed, feel, curl } = getMotionParams();
    const springStiffness = 95 * speed * speed * (1.2 - 0.55 * feel);
    const damping = 2 * (0.9 - 0.32 * feel) * Math.sqrt(springStiffness);

    while (d.queue.length && d.queue[0].at <= now) {
      const item = d.queue.shift();
      d.goal[item.k] = item.g;
      d.v[item.k] += item.g ? 0.8 : -0.8;
    }

    let stillMoving = d.queue.length > 0;

    for (let i = 0; i < total; i++) {
      if (i === d.dragK) continue;
      const target = i === d.hoverK ? d.hoverP : d.goal[i];
      const accel = springStiffness * (target - d.p[i]) - damping * d.v[i];
      let newV = d.v[i] + accel * dt;
      let newP = d.p[i] + newV * dt;

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

    for (let i = 0; i < total - 1; i++) {
      const maxAllowed = d.p[i] >= 0.9995 ? 1.0 : Math.max(0, d.p[i] - PAGE_GAP);
      if (d.p[i + 1] > maxAllowed) {
        d.p[i + 1] = maxAllowed;
        if (d.v[i + 1] > d.v[i]) d.v[i + 1] = d.v[i];
      }
    }

    for (let i = 0; i < total; i++) {
      const isDragging = i === d.dragK;
      const isHovering = i === d.hoverK;
      const target = isHovering ? d.hoverP : d.goal[i];
      let targetBend = 0;
      let targetSkew = 0;

      if (isDragging && dragRef.current) {
        targetBend = curl * (dragRef.current.side * 0.8 + clamp(dragRef.current.vp * 0.25, -0.7, 0.7));
        targetSkew = dragRef.current.v0;
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

    const targetTilt = motionConfig.tilt !== false ? d.tiltGoal : 0;
    d.tilt += (targetTilt - d.tilt) * Math.min(1, dt * 6);
    if (Math.abs(targetTilt - d.tilt) > 0.02) stillMoving = true;
    else d.tilt = targetTilt;

    const curState = computeActivePages();
    if (curState.key !== d.key) {
      d.act = curState.act;
      d.right = curState.right;
      d.left = curState.left;
      d.pos = curState.pos;
      d.key = curState.key;
      setActiveSpread(curState.pos);
      setRerenderKey((k) => k + 1);
    } else {
      paint();
    }

    if (stillMoving) wake();
  }, [computeActivePages, getMotionParams, motionConfig.tilt, paint]);

  const wake = useCallback(() => {
    if (!animFrameRef.current) {
      lastTimeRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const turn = useCallback((dir) => {
    const d = deckRef.current;
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

    if (targetLeaf >= 0) wake();
  }, [wake]);

  const riffleTo = useCallback((targetSpread) => {
    const d = deckRef.current;
    const total = d.p.length;
    const clamped = clamp(Math.round(targetSpread), 0, total);

    d.queue.length = 0;
    d.hoverK = -1;
    d.lastTouch = performance.now();

    let curPos = 0;
    for (const g of d.goal) curPos += g;

    const staggerInterval = 72 / getMotionParams().speed;
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

    wake();
  }, [getMotionParams, wake]);

  // Coordinate conversion helper
  const pointerToBookCoords = useCallback((clientX, clientY) => {
    const rect = containerRef.current.getBoundingClientRect();
    const size = clamp(numOrDefault(bookConfig.size, 0.68), 0.2, 1.0);
    const aspect = clamp(numOrDefault(bookConfig.aspect, 0.76), 0.3, 2.0);

    const ph = Math.min(size * rect.height, (size * rect.width) / (2 * aspect));
    const pw = ph * aspect;

    const d = deckRef.current;
    const total = d.p.length;
    const off = -0.5 * (1 - d.p[0]) + 0.5 * d.p[total - 1];

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const u = (clientX - centerX - off * pw) / pw;
    const v = (clientY - centerY) / (ph / 2);

    let side = 0;
    if (Math.abs(v) <= 1) {
      if (u >= 0 && u <= 1 && d.p[total - 1] < 0.5) side = 1;
      else if (u < 0 && u >= -1 && d.p[0] > 0.5) side = -1;
    }

    return { u, v, side, ty: (clientY - centerY) / Math.max(1, rect.height / 2) };
  }, [bookConfig.aspect, bookConfig.size]);

  // Mount effects
  useEffect(() => {
    wake();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [wake]);

  useEffect(() => {
    paint();
  });

  const state = computeActivePages();
  const radius = clamp(numOrDefault(bookConfig.radius, 4), 0, 60);
  const shadowFactor = clamp(numOrDefault(bookConfig.shadow, 0.6), 0, 1);
  const bookShadow = `0 calc(var(--ph) * 0.035) calc(var(--ph) * 0.09) rgba(0,0,0,${(0.36 * shadowFactor).toFixed(3)})`;
  const thickness = clamp(numOrDefault(bookConfig.thickness, 8), 0, 40);

  const O = state.left;
  const D = state.right;
  const leftCount = O >= 0 ? O + 1 : 0;
  const rightCount = D >= 0 ? totalLeaves - D : 0;

  // Face component renderer
  const renderFace = (side, face, isFlat) => {
    const isFront = face === 'front';
    const borderRadius = isFront ? `0 ${radius}px ${radius}px 0` : `${radius}px 0 0 ${radius}px`;

    if (side.kind === 'cover' || side.kind === 'rear') {
      return (
        <div className="face-container" style={{ backgroundColor: coversConfig.color || '#26332d', borderRadius }}>
          {side.video && isFlat ? (
            <video src={side.video} poster={side.img} muted loop playsInline autoPlay className="media-cover" />
          ) : side.img ? (
            <img src={side.img} alt={side.caption || ''} className="media-cover" draggable={false} />
          ) : null}
          <div className="shading-layer" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 46%, rgba(0,0,0,0.38) 100%)' }} />
          <div className="shading-layer" style={{ background: getSpineGradient(face, bookConfig.spine) }} />
          {side.caption && (
            <div style={{ position: 'absolute', left: '13%', right: '9%', bottom: '9%', color: coversConfig.titleColor || '#f4f1ea', fontSize: 'calc(var(--ph) * 0.07)', lineHeight: 0.95, fontWeight: 500, letterSpacing: '-0.045em' }}>
              {side.caption}
            </div>
          )}
        </div>
      );
    }

    if (side.kind === 'endpaper') {
      return (
        <div className="face-container" style={{ backgroundColor: coversConfig.color || '#26332d', borderRadius }}>
          <div className="shading-layer" style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 7px), linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08))' }} />
          <div className="shading-layer" style={{ background: getSpineGradient(face, bookConfig.spine) }} />
        </div>
      );
    }

    const textColor = side.bleed ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,20,0.58)';

    return (
      <div className="face-container" style={{ backgroundColor: bookConfig.paper || '#fbfaf6', borderRadius }}>
        {side.bleed ? (
          <>
            {side.video && isFlat ? (
              <video src={side.video} poster={side.img} muted loop playsInline autoPlay className="media-cover" />
            ) : side.img ? (
              <img src={side.img} alt={side.caption || ''} className="media-cover" draggable={false} />
            ) : null}
            <div className="shading-layer" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%)' }} />
          </>
        ) : (
          <div style={{ position: 'absolute', top: '8%', left: '9%', right: '9%', bottom: '18%', overflow: 'hidden', borderRadius: radius * 0.25, background: 'rgba(0,0,0,0.05)' }}>
            {side.video && isFlat ? (
              <video src={side.video} poster={side.img} muted loop playsInline autoPlay className="media-cover" />
            ) : side.img ? (
              <img src={side.img} alt={side.caption || ''} className="media-cover" draggable={false} />
            ) : null}
          </div>
        )}

        {side.caption && (
          <div className="page-caption" style={{ color: textColor, ...(isFront ? { left: '9%' } : { right: '9%', textAlign: 'right' }) }}>
            {side.caption}
          </div>
        )}
        {side.folio > 0 && (
          <div className="page-folio" style={{ color: textColor, ...(isFront ? { right: '9%' } : { left: '9%' }) }}>
            {padZero(side.folio)}
          </div>
        )}
        <div className="shading-layer" style={{ background: getSpineGradient(face, bookConfig.spine) }} />
      </div>
    );
  };

  // Render 12 nested strips for curling leaf
  const renderCurlingLeaf = (leafIdx) => {
    const leaf = leaves[leafIdx];
    const isBoard = leaf.board;
    const w = isBoard ? 'var(--pw)' : 'calc(var(--pw) - var(--rim))';
    const h = isBoard ? 'var(--ph)' : 'calc(var(--ph) - 2 * var(--rim))';
    const top = isBoard ? 'calc(var(--ph) / -2)' : 'calc(var(--ph) / -2 + var(--rim))';

    let nodeRef = leafNodesRef.current.get(leafIdx);
    if (!nodeRef) {
      nodeRef = { root: null, s: [], f: [], b: [] };
      leafNodesRef.current.set(leafIdx, nodeRef);
    }

    let nestedStrips = null;
    for (let s = SEGMENTS - 1; s >= 0; s--) {
      nestedStrips = (
        <div
          key={s}
          ref={(el) => { nodeRef.s[s] = el; }}
          style={{
            position: 'absolute',
            top: 0,
            height: '100%',
            left: s === 0 ? 0 : `calc(var(--lw) / ${SEGMENTS})`,
            width: `calc(var(--lw) / ${SEGMENTS} + 0.7px)`,
            transformOrigin: '0 50%',
            transformStyle: 'preserve-3d'
          }}
        >
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, height: '100%', width: 'var(--lw)', left: `calc(var(--lw) * ${(-s / SEGMENTS).toFixed(5)})` }}>
              {renderFace(leaf.front, 'front', false)}
            </div>
            <div ref={(el) => { nodeRef.f[s] = el; }} className="shading-layer" />
          </div>

          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <div style={{ position: 'absolute', top: 0, height: '100%', width: 'var(--lw)', left: `calc(var(--lw) * ${(-(SEGMENTS - 1 - s) / SEGMENTS).toFixed(5)})` }}>
              {renderFace(leaf.back, 'back', false)}
            </div>
            <div ref={(el) => { nodeRef.b[s] = el; }} className="shading-layer" />
          </div>
          {nestedStrips}
        </div>
      );
    }

    return (
      <div
        key={`curling-${leafIdx}`}
        ref={(el) => { nodeRef.root = el; }}
        style={{
          position: 'absolute',
          left: 0,
          top,
          width: w,
          height: h,
          transformStyle: 'preserve-3d',
          transformOrigin: '0 50%',
          pointerEvents: 'none',
          '--lw': w
        }}
      >
        {nestedStrips}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      id="album-viewport"
      tabIndex={0}
      role="region"
      aria-label="Photo book"
      onPointerDown={(e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const coords = pointerToBookCoords(e.clientX, e.clientY);
        deckRef.current.lastTouch = performance.now();
        if (coords.side) {
          dragRef.current = {
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
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch (_) {}
        }
      }}
      onPointerMove={(e) => {
        const d = deckRef.current;
        const total = d.p.length;
        const coords = pointerToBookCoords(e.clientX, e.clientY);
        d.lastTouch = performance.now();

        if (motionConfig.tilt !== false && e.pointerType === 'mouse') {
          const tiltAmount = clamp(numOrDefault(motionConfig.tiltAmount, 6), 0, 30);
          const targetTilt = clamp(-coords.ty, -1, 1) * tiltAmount;
          if (Math.abs(targetTilt - d.tiltGoal) > 0.05) {
            d.tiltGoal = targetTilt;
            wake();
          }
        }

        if (dragRef.current && dragRef.current.id === e.pointerId) {
          if (!dragRef.current.live) {
            if (Math.hypot(e.clientX - dragRef.current.x0, e.clientY - dragRef.current.y0) < 6) return;
            let pos = 0;
            for (const g of d.goal) pos += g;
            const leafIdx = dragRef.current.side > 0 ? pos : pos - 1;
            if (leafIdx < 0 || leafIdx >= total) {
              dragRef.current = null;
              return;
            }
            d.queue.length = 0;
            d.hoverK = -1;
            dragRef.current.live = true;
            dragRef.current.leaf = leafIdx;
            dragRef.current.uEdge = Math.cos(Math.PI * d.p[leafIdx]);
            dragRef.current.u0 = coords.u;
            dragRef.current.t = performance.now();
            d.dragK = leafIdx;
            containerRef.current.style.cursor = 'grabbing';
          }

          const k = dragRef.current.leaf;
          const uGoal = clamp(dragRef.current.uEdge + (coords.u - dragRef.current.u0), -1, 1);
          const newP = Math.acos(uGoal) / Math.PI;
          const now = performance.now();
          const dt = Math.max(1, now - dragRef.current.t) / 1000;

          dragRef.current.vp = dragRef.current.vp * 0.55 + ((newP - d.p[k]) / dt) * 0.45;
          dragRef.current.t = now;
          d.p[k] = newP;
          d.v[k] = dragRef.current.vp;
          wake();
          return;
        }

        if (e.pointerType !== 'mouse' || dragRef.current) return;
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
          wake();
        }
        containerRef.current.style.cursor = hoverLeaf >= 0 ? 'grab' : coords.side ? 'pointer' : '';
      }}
      onPointerUp={(e) => {
        if (!dragRef.current || dragRef.current.id !== e.pointerId) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (_) {}
        const dragInfo = dragRef.current;
        dragRef.current = null;
        const d = deckRef.current;

        if (dragInfo.live) {
          const k = dragInfo.leaf;
          const p = d.p[k];
          const vp = dragInfo.vp;
          if (dragInfo.side > 0) d.goal[k] = +(vp > 1.1 || (p > 0.5 && vp > -1.1));
          else d.goal[k] = vp < -1.1 || (p < 0.5 && vp < 1.1) ? 0 : 1;
          d.v[k] = clamp(vp, -6, 6);
          d.dragK = -1;
          containerRef.current.style.cursor = '';
          wake();
          return;
        }

        const dist = Math.hypot(e.clientX - dragInfo.x0, e.clientY - dragInfo.y0);
        if (dist < 6) turn(dragInfo.side);
      }}
      onDoubleClick={(e) => {
        const coords = pointerToBookCoords(e.clientX, e.clientY);
        if (!coords.side) riffleTo(0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { turn(1); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { turn(-1); e.preventDefault(); }
        else if (e.key === 'Home') { riffleTo(0); e.preventDefault(); }
        else if (e.key === 'End') { riffleTo(totalLeaves); e.preventDefault(); }
      }}
    >
      <div className="ui-hints">Drag or click page edge to flip • Double-click to close • Arrow keys</div>

      {/* 3D Perspective Stage */}
      <div className="perspective-stage">
        <div ref={bookOriginRef} className="book-origin">
          {O > 0 && O < totalLeaves - 1 && (
            <div style={{ position: 'absolute', top: 'calc(var(--ph) / -2)', height: 'var(--ph)', width: 'var(--pw)', left: 'calc(var(--pw) * -1)', background: coversConfig.color || '#26332d', borderRadius: `${radius}px 0 0 ${radius}px`, boxShadow: `${bookShadow}, inset 0 0 0 1px rgba(0,0,0,0.12)` }} />
          )}

          {D > 0 && D < totalLeaves - 1 && (
            <div style={{ position: 'absolute', top: 'calc(var(--ph) / -2)', height: 'var(--ph)', width: 'var(--pw)', left: 0, background: coversConfig.color || '#26332d', borderRadius: `0 ${radius}px ${radius}px 0`, boxShadow: `${bookShadow}, inset 0 0 0 1px rgba(0,0,0,0.12)` }} />
          )}

          {leftCount > 0 && thickness > 0 && (
            <div style={{ position: 'absolute', top: 'calc(var(--ph) / -2 + var(--ph) * 0.014)', height: 'calc(var(--ph) * 0.972)', width: `${Math.max(1, (thickness * leftCount) / totalLeaves).toFixed(2)}px`, left: `calc(var(--pw) * -1 - ${Math.max(1, (thickness * leftCount) / totalLeaves).toFixed(2)}px)`, background: `repeating-linear-gradient(90deg, ${bookConfig.paper || '#fbfaf6'} 0px, ${bookConfig.paper || '#fbfaf6'} 1px, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0.18) 1.6px)`, borderRadius: '3px 0 0 3px', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.14)' }} />
          )}

          {rightCount > 0 && thickness > 0 && (
            <div style={{ position: 'absolute', top: 'calc(var(--ph) / -2 + var(--ph) * 0.014)', height: 'calc(var(--ph) * 0.972)', width: `${Math.max(1, (thickness * rightCount) / totalLeaves).toFixed(2)}px`, left: 'var(--pw)', background: `repeating-linear-gradient(90deg, ${bookConfig.paper || '#fbfaf6'} 0px, ${bookConfig.paper || '#fbfaf6'} 1px, rgba(0,0,0,0.18) 1px, rgba(0,0,0,0.18) 1.6px)`, borderRadius: '0 3px 3px 0', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.14)' }} />
          )}

          {/* Flat Left Page */}
          {O >= 0 && (
            <div style={{ position: 'absolute', top: leaves[O].board ? 'calc(var(--ph) / -2)' : 'calc(var(--ph) / -2 + var(--rim))', height: leaves[O].board ? 'var(--ph)' : 'calc(var(--ph) - 2 * var(--rim))', width: leaves[O].board ? 'var(--pw)' : 'calc(var(--pw) - var(--rim))', left: `calc(${leaves[O].board ? 'var(--pw)' : 'calc(var(--pw) - var(--rim))'} * -1)`, transform: 'translateZ(0.2px)', boxShadow: leaves[O].board ? bookShadow : '0 1px 2px rgba(0,0,0,0.08)', borderRadius: `${radius}px 0 0 ${radius}px`, overflow: 'hidden' }}>
              {renderFace(leaves[O].back, 'back', true)}
              <div ref={castLeftRef} className="shading-layer" />
            </div>
          )}

          {/* Flat Right Page */}
          {D >= 0 && (
            <div style={{ position: 'absolute', top: leaves[D].board ? 'calc(var(--ph) / -2)' : 'calc(var(--ph) / -2 + var(--rim))', height: leaves[D].board ? 'var(--ph)' : 'calc(var(--ph) - 2 * var(--rim))', width: leaves[D].board ? 'var(--pw)' : 'calc(var(--pw) - var(--rim))', left: 0, transform: 'translateZ(0.2px)', boxShadow: leaves[D].board ? bookShadow : '0 1px 2px rgba(0,0,0,0.08)', borderRadius: `0 ${radius}px ${radius}px 0`, overflow: 'hidden' }}>
              {renderFace(leaves[D].front, 'front', true)}
              <div ref={castRightRef} className="shading-layer" />
            </div>
          )}

          {/* Active 12-segment Curling Leaves */}
          {state.act.map((k) => renderCurlingLeaf(k))}
        </div>
      </div>

      {/* Indicator dots */}
      {bookConfig.indicator !== 'none' && (
        <div className="indicator-bar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {Array.from({ length: totalLeaves + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              className="indicator-dot"
              aria-label={`Go to spread ${i + 1}`}
              onClick={() => riffleTo(i)}
              style={{
                width: i === activeSpread ? '16px' : '6px',
                opacity: i === activeSpread ? 1 : 0.32,
                backgroundColor: bookConfig.indicatorColor || 'rgba(23, 23, 23, 0.72)'
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
