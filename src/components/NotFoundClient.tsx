'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, RotateCcw } from 'lucide-react';
import styles from './NotFoundClient.module.css';

type GamePhase = 'ready' | 'running' | 'over';

type Obstacle = {
  x: number;
  w: number;
  h: number;
  kind: 0 | 1 | 2;
};

const CANVAS_H = 320;
const GRAVITY_UP = 0.28;
const GRAVITY_DOWN = 0.36;
const JUMP_V = -8.6;
const GROUND_Y = 268;
const PLAYER_X = 72;
const PLAYER_W = 44;
const PLAYER_H = 48;
const BASE_SPEED = 3.0;
const MAX_SPEED = 6.8;

export default function NotFoundClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<GamePhase>('ready');
  const scoreRef = useRef(0);
  const speedRef = useRef(BASE_SPEED);
  const playerYRef = useRef(GROUND_Y - PLAYER_H);
  const velRef = useRef(0);
  const onGroundRef = useRef(true);
  const landSquashRef = useRef(0);
  const jumpStretchRef = useRef(0);
  const wasAirborneRef = useRef(false);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const spawnAtRef = useRef(0);
  const frameRef = useRef(0);
  const bestRef = useRef(0);
  const widthRef = useRef(1000);
  const heightRef = useRef(CANVAS_H);

  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [level, setLevel] = useState(1);

  useEffect(() => {
    document.body.classList.add('sp-hide-footer');
    return () => {
      document.body.classList.remove('sp-hide-footer');
    };
  }, []);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('sp-404-best') || '0');
      if (!Number.isNaN(saved)) {
        bestRef.current = saved;
        setBest(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const resetRun = useCallback(() => {
    scoreRef.current = 0;
    speedRef.current = BASE_SPEED;
    playerYRef.current = GROUND_Y - PLAYER_H;
    velRef.current = 0;
    onGroundRef.current = true;
    landSquashRef.current = 0;
    jumpStretchRef.current = 0;
    wasAirborneRef.current = false;
    obstaclesRef.current = [];
    spawnAtRef.current = 160;
    frameRef.current = 0;
    setScore(0);
    setLevel(1);
  }, []);

  const startGame = useCallback(() => {
    resetRun();
    phaseRef.current = 'running';
  }, [resetRun]);

  const endGame = useCallback(() => {
    phaseRef.current = 'over';
    const finalScore = Math.floor(scoreRef.current);
    setScore(finalScore);
    if (finalScore > bestRef.current) {
      bestRef.current = finalScore;
      setBest(finalScore);
      try {
        localStorage.setItem('sp-404-best', String(finalScore));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const jump = useCallback(() => {
    if (phaseRef.current === 'ready' || phaseRef.current === 'over') {
      startGame();
      return;
    }
    if (phaseRef.current === 'running' && onGroundRef.current) {
      velRef.current = JUMP_V;
      onGroundRef.current = false;
      jumpStretchRef.current = 8;
      landSquashRef.current = 0;
    }
  }, [startGame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
      if (e.code === 'Enter' && phaseRef.current !== 'running') {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jump, startGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const syncSize = () => {
      const cssW = Math.max(canvas.clientWidth, 320);
      const cssH = Math.max(canvas.clientHeight || CANVAS_H, 220);
      widthRef.current = cssW;
      heightRef.current = cssH;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    };

    const drawRunner = (x: number, y: number, running: boolean) => {
      const inAir = !onGroundRef.current;
      const vy = velRef.current;
      const t = frameRef.current;

      // Mild squash / stretch for jump polish
      let scaleX = 1;
      let scaleY = 1;
      let rot = 0;
      if (jumpStretchRef.current > 0) {
        const k = jumpStretchRef.current / 10;
        scaleX = 0.94 + (1 - k) * 0.06;
        scaleY = 1.08 - (1 - k) * 0.08;
        jumpStretchRef.current -= 1;
      } else if (inAir) {
        const soar = Math.max(0, Math.min(1, (-vy - 0.5) / 6));
        const fall = Math.max(0, Math.min(1, (vy - 0.5) / 6));
        scaleX = 0.96 - soar * 0.03 + fall * 0.05;
        scaleY = 1.04 + soar * 0.05 - fall * 0.06;
        rot = -0.12 * soar + 0.14 * fall;
      } else if (landSquashRef.current > 0) {
        const k = landSquashRef.current / 12;
        scaleX = 1 + 0.12 * k;
        scaleY = 1 - 0.1 * k;
        landSquashRef.current -= 1;
      }

      // Slow leg cycle (was ~0.38 — too frantic)
      const runCycle = running && !inAir ? Math.sin(t * 0.16) : 0;
      const stride = runCycle * 4;
      const bob = running && !inAir ? Math.abs(Math.sin(t * 0.16)) * -1.4 : 0;
      const cx = x + PLAYER_W / 2;
      const cy = y + PLAYER_H / 2 + bob;

      // Shadow
      const shadowW = inAir ? 11 + Math.max(0, 10 - (GROUND_Y - (y + PLAYER_H)) * 0.1) : 18;
      ctx.fillStyle = `rgba(15, 23, 42, ${inAir ? 0.07 : 0.13})`;
      ctx.beginPath();
      ctx.ellipse(cx, GROUND_Y - 2, shadowW, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (landSquashRef.current > 7) {
        const dust = (12 - landSquashRef.current) / 5;
        ctx.fillStyle = `rgba(148, 163, 184, ${0.4 - dust * 0.25})`;
        ctx.beginPath();
        ctx.arc(cx - 14 - dust * 8, GROUND_Y - 4, 2.5 + dust, 0, Math.PI * 2);
        ctx.arc(cx + 14 + dust * 8, GROUND_Y - 4, 2.5 + dust, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(cx, cy + (1 - scaleY) * (PLAYER_H / 2));
      ctx.rotate(rot);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-PLAYER_W / 2, -PLAYER_H / 2);

      // Legs (tucked slightly in air)
      ctx.fillStyle = '#0369a1';
      const leftLen = inAir ? 10 : 14 + stride;
      const rightLen = inAir ? 10 : 14 - stride;
      roundRect(12, 34, 8, leftLen, 3);
      ctx.fill();
      roundRect(26, 34, 8, rightLen, 3);
      ctx.fill();

      // Body capsule
      const body = ctx.createLinearGradient(0, 8, 0, 40);
      body.addColorStop(0, '#38bdf8');
      body.addColorStop(1, '#0284c7');
      ctx.fillStyle = body;
      roundRect(6, 10, 32, 28, 10);
      ctx.fill();

      // Chest plate
      ctx.fillStyle = '#e0f2fe';
      roundRect(12, 16, 20, 14, 5);
      ctx.fill();
      ctx.fillStyle = '#0369a1';
      ctx.font = '800 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DG', 22, 27);

      // Head
      ctx.fillStyle = '#0f172a';
      roundRect(14, -2, 20, 16, 6);
      ctx.fill();
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(28, 6, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(16, 3, 6, 2);

      // Antenna
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, -2);
      ctx.lineTo(24, inAir ? -14 : -10);
      ctx.stroke();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(24, inAir ? -16 : -12, 3, 0, Math.PI * 2);
      ctx.fill();

      // Motion streaks
      if (running && !inAir) {
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-2, 20);
        ctx.lineTo(-14, 20);
        ctx.moveTo(0, 28);
        ctx.lineTo(-10, 28);
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawObstacle = (o: Obstacle) => {
      const baseY = GROUND_Y - o.h;

      // shared ground shadow
      ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, GROUND_Y - 1, o.w * 0.55, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (o.kind === 0) {
        // cactus twin
        ctx.fillStyle = '#166534';
        roundRect(o.x + 10, baseY, 12, o.h, 4);
        ctx.fill();
        roundRect(o.x, baseY + 14, 10, 10, 4);
        ctx.fill();
        roundRect(o.x + 22, baseY + 22, 10, 10, 4);
        ctx.fill();
        ctx.fillStyle = '#86efac';
        ctx.fillRect(o.x + 13, baseY + 8, 2, 8);
        ctx.fillRect(o.x + 17, baseY + 18, 2, 8);
      } else if (o.kind === 1) {
        // rock pile
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.ellipse(o.x + 14, GROUND_Y - 10, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.ellipse(o.x + 26, GROUND_Y - 14, 12, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.ellipse(o.x + 8, GROUND_Y - 16, 9, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // sign post 404
        ctx.fillStyle = '#78716c';
        ctx.fillRect(o.x + o.w / 2 - 3, baseY + 20, 6, o.h - 20);
        ctx.fillStyle = '#0f172a';
        roundRect(o.x, baseY, o.w, 28, 6);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.font = '800 12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('404', o.x + o.w / 2, baseY + 19);
      }
    };

    const loop = () => {
      frameRef.current += 1;
      const running = phaseRef.current === 'running';
      const W = widthRef.current;
      const H = heightRef.current;

      if (running) {
        // Asymmetric gravity: float up, snap down (Chrome-dino feel)
        velRef.current += velRef.current < 0 ? GRAVITY_UP : GRAVITY_DOWN;
        playerYRef.current += velRef.current;

        if (!onGroundRef.current) {
          wasAirborneRef.current = true;
        }

        if (playerYRef.current >= GROUND_Y - PLAYER_H) {
          playerYRef.current = GROUND_Y - PLAYER_H;
          if (wasAirborneRef.current && velRef.current >= 0) {
            landSquashRef.current = 12;
            wasAirborneRef.current = false;
          }
          velRef.current = 0;
          onGroundRef.current = true;
        }

        // Gentle difficulty climb
        const progress = scoreRef.current;
        speedRef.current = Math.min(MAX_SPEED, BASE_SPEED + progress / 1100);
        const lvl = Math.min(6, 1 + Math.floor(progress / 280));
        if (frameRef.current % 12 === 0) {
          setLevel(lvl);
          setScore(Math.floor(scoreRef.current));
        }

        scoreRef.current += speedRef.current * 0.085;

        spawnAtRef.current -= 1;
        if (spawnAtRef.current <= 0) {
          const roll = Math.random();
          const kind = (roll > 0.72 ? 2 : roll > 0.38 ? 1 : 0) as 0 | 1 | 2;
          const h = kind === 2 ? 56 : kind === 1 ? 34 : 42;
          const w = kind === 2 ? 40 : kind === 1 ? 36 : 34;
          obstaclesRef.current.push({ x: W + 20, w, h, kind });

          // Wide gaps — stays easy longer
          const gap = Math.max(
            90,
            170 - lvl * 4 - Math.floor(speedRef.current * 1.2) + Math.floor(Math.random() * 50),
          );
          spawnAtRef.current = gap;
        }

        obstaclesRef.current.forEach((o) => {
          o.x -= speedRef.current;
        });
        obstaclesRef.current = obstaclesRef.current.filter((o) => o.x + o.w > -30);

        // Forgiving hitbox
        const px = PLAYER_X + 10;
        const py = playerYRef.current + 8;
        const pw = PLAYER_W - 16;
        const ph = PLAYER_H - 10;
        for (const o of obstaclesRef.current) {
          const ox = o.x + 6;
          const oy = GROUND_Y - o.h + 6;
          const ow = o.w - 10;
          const oh = o.h - 8;
          if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy) {
            endGame();
            break;
          }
        }
      }

      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#e0f2fe');
      sky.addColorStop(0.45, '#f0f9ff');
      sky.addColorStop(1, '#f8fafc');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // sun
      ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
      ctx.beginPath();
      ctx.arc(W - 70, 48, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(253, 224, 71, 0.55)';
      ctx.beginPath();
      ctx.arc(W - 70, 48, 16, 0, Math.PI * 2);
      ctx.fill();

      // clouds
      const drift = (frameRef.current * (running ? 0.25 : 0.08)) % (W + 160);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 240 - drift) % (W + 160) + W + 160) % (W + 160) - 50;
        const cy = 36 + (i % 3) * 22;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 34, 14, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 22, cy + 2, 24, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 18, cy + 4, 18, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // distant dunes
      ctx.fillStyle = 'rgba(125, 211, 252, 0.28)';
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.quadraticCurveTo(W * 0.25, GROUND_Y - 40, W * 0.5, GROUND_Y);
      ctx.quadraticCurveTo(W * 0.75, GROUND_Y - 50, W, GROUND_Y);
      ctx.lineTo(W, GROUND_Y);
      ctx.lineTo(0, GROUND_Y);
      ctx.fill();

      // ground
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, GROUND_Y, W, 3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, GROUND_Y + 3, W, 10);

      const groundScroll = running ? (frameRef.current * speedRef.current) % 32 : 0;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      for (let x = -groundScroll; x < W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y + 14);
        ctx.lineTo(x + 14, GROUND_Y + 14);
        ctx.stroke();
      }

      obstaclesRef.current.forEach(drawObstacle);

      drawRunner(PLAYER_X, playerYRef.current, running);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 16px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(Math.floor(scoreRef.current)).padStart(5, '0'), W - 20, 30);
      ctx.fillStyle = '#64748b';
      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
      if (bestRef.current > 0) {
        ctx.fillText(`HI ${String(bestRef.current).padStart(5, '0')}`, W - 20, 50);
      }

      if (phaseRef.current === 'ready') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = '800 24px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Press Space or tap to start', W / 2, H / 2 - 8);
        ctx.fillStyle = '#bae6fd';
        ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Jump over cacti, rocks & 404 signs', W / 2, H / 2 + 22);
      }

      if (phaseRef.current === 'over') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = '800 26px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Packet dropped', W / 2, H / 2 - 8);
        ctx.fillStyle = '#bae6fd';
        ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Hit Try again to jump back in', W / 2, H / 2 + 22);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    window.addEventListener('resize', syncSize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', syncSize);
    };
  }, [endGame]);

  return (
    <main className={styles.page} data-sp-404-page>
      <div className={styles.wrap}>
        <p className={styles.kicker}>Lost packet</p>
        <h1 className={styles.code}>404</h1>
        <h2 className={styles.title}>This route is offline</h2>
        <p className={styles.sub}>
          Jump the courier past obstacles — easier pace, bigger playfield.
        </p>

        <section className={styles.gameCard} aria-label="404 runner game">
          <div className={styles.gameTop}>
            <span className={styles.gameLabel}>Packet Run</span>
            <span className={styles.gameMeta}>
              Score {score} · Best {best} · Lv {level}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            height={CANVAS_H}
            role="img"
            aria-label="Runner game. Press Space or tap to jump."
            onClick={jump}
            onTouchStart={(e) => {
              e.preventDefault();
              jump();
            }}
          />
          <div className={styles.gameHint}>
            <kbd>Space</kbd> / <kbd>↑</kbd> / tap to jump
          </div>
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.tryAgain} onClick={startGame}>
            <RotateCcw size={17} strokeWidth={2.25} />
            Try again
          </button>
          <Link href="/" className={styles.homeBtn}>
            <Home size={17} strokeWidth={2.25} />
            Back to home page
          </Link>
        </div>
      </div>
    </main>
  );
}
