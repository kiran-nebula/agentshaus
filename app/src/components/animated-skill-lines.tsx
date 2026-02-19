'use client';

import { useEffect, useRef } from 'react';

interface Props {
  className?: string;
  variant?: 'dark' | 'light';
}

interface LineSpec {
  y: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  color: string;
}

export function AnimatedSkillLines({ className = '', variant = 'dark' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const darkColors = ['#a5ef41', '#91d631', '#c0f57a', '#9be85d', '#84d14b', '#b4f26a', '#7bc23f', '#d1fa94'];
    const lightColors = ['#6ea428', '#7ab22f', '#8bc843', '#5f9121', '#7db838', '#91cf4e', '#6a9f28', '#84c03e'];
    const palette = variant === 'light' ? lightColors : darkColors;
    const lines: LineSpec[] = [
      { y: 0.18, amplitude: 18, frequency: 0.010, speed: 0.0016, phase: 0.2, color: palette[0] },
      { y: 0.24, amplitude: 22, frequency: 0.012, speed: -0.0012, phase: 1.4, color: palette[1] },
      { y: 0.32, amplitude: 20, frequency: 0.009, speed: 0.0011, phase: 3.0, color: palette[2] },
      { y: 0.42, amplitude: 24, frequency: 0.011, speed: -0.0018, phase: 2.4, color: palette[3] },
      { y: 0.50, amplitude: 20, frequency: 0.010, speed: 0.0015, phase: 4.6, color: palette[4] },
      { y: 0.58, amplitude: 16, frequency: 0.013, speed: -0.0013, phase: 5.1, color: palette[5] },
      { y: 0.66, amplitude: 20, frequency: 0.008, speed: 0.0012, phase: 0.9, color: palette[6] },
      { y: 0.74, amplitude: 18, frequency: 0.010, speed: -0.0014, phase: 2.1, color: palette[7] },
    ];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let start = performance.now();

    const draw = (now: number) => {
      const elapsed = now - start;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = variant === 'light' ? 0.55 : 0.9;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([1.5, 3.5]);

      for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const baseY = h * line.y;
          const waveA = Math.sin(x * line.frequency + line.phase + elapsed * line.speed) * line.amplitude;
          const waveB = Math.sin(x * (line.frequency * 0.55) + elapsed * line.speed * -1.2) * (line.amplitude * 0.35);
          const y = baseY + waveA + waveB;
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(raf);
    };
  }, [variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
