import { useEffect, useRef } from "react";

interface WaveformBarProps {
  active?: boolean;
  color?: string;
  height?: number;
  barCount?: number;
}

export function WaveformBar({
  active = false,
  color = "#4d9cff",
  height = 28,
  barCount = 48,
}: WaveformBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const gap = 2;
    const barW = (W - gap * (barCount - 1)) / barCount;

    const heights = Array.from({ length: barCount }, (_, i) =>
      Math.abs(Math.sin(i * 0.42) * 0.6 + Math.sin(i * 0.17) * 0.3 + Math.sin(i * 0.9) * 0.1)
    );

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < barCount; i++) {
        const phase = active ? (i + offsetRef.current * 0.4) : i;
        const h = heights[i % heights.length] * H *
          (active ? (0.5 + 0.5 * Math.abs(Math.sin(phase * 0.3))) : 0.35);
        const x = i * (barW + gap);
        const y = (H - h) / 2;

        ctx.fillStyle = active
          ? `${color}${Math.round(80 + h / H * 120).toString(16).padStart(2, "0")}`
          : "#3a3a3d";
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, 1);
        ctx.fill();
      }
    };

    const animate = () => {
      if (active) {
        offsetRef.current += 1;
        draw();
        frameRef.current = requestAnimationFrame(animate);
      } else {
        draw();
      }
    };

    animate();
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, color, barCount, height]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={height}
      style={{ width: "100%", height: `${height}px`, display: "block" }}
    />
  );
}
