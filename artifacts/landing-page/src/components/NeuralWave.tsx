import { useEffect, useRef } from "react";

/**
 * Das Signature-Visual des Heros: eine Punktwolke auf einer Kugel, die von
 * einem Rauschfeld verformt wird und langsam rotiert. Canvas statt Bild, damit
 * es in jeder Aufloesung scharf bleibt und nichts nachgeladen werden muss.
 */

const POINT_COUNT = 1500;
const FOCAL_LENGTH = 2.6;

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Fibonacci-Gitter — verteilt Punkte gleichmaessig auf der Kugel. */
function buildSphere(count: number): Array<Point> {
  const points: Array<Point> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
    });
  }

  return points;
}

/** Billiges, glattes Pseudo-Rauschen aus ueberlagerten Sinuswellen. */
function wobble(p: Point, t: number): number {
  return (
    Math.sin(p.x * 3.1 + t * 1.2) * 0.5 +
    Math.sin(p.y * 4.3 - t * 0.9) * 0.3 +
    Math.sin(p.z * 2.7 + t * 1.5) * 0.4 +
    Math.sin((p.x + p.y + p.z) * 5.2 - t * 2.1) * 0.18
  );
}

export function NeuralWave({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const points = buildSphere(POINT_COUNT);
    let width = 0;
    let height = 0;
    let frame = 0;
    let time = 0;
    let visible = true;

    function resize(): void {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(): void {
      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width, height) * 0.38;

      ctx!.clearRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      const tiltX = 0.28 + pointerRef.current.y * 0.22;
      const spin = time * 0.34 + pointerRef.current.x * 0.5;
      const cosSpin = Math.cos(spin);
      const sinSpin = Math.sin(spin);
      const cosTilt = Math.cos(tiltX);
      const sinTilt = Math.sin(tiltX);

      for (const p of points) {
        const displacement = 1 + wobble(p, time) * 0.22;
        const px = p.x * displacement;
        const py = p.y * displacement;
        const pz = p.z * displacement;

        // Rotation um Y, danach Kippen um X.
        const rx = px * cosSpin - pz * sinSpin;
        const rzTemp = px * sinSpin + pz * cosSpin;
        const ry = py * cosTilt - rzTemp * sinTilt;
        const rz = py * sinTilt + rzTemp * cosTilt;

        const depth = FOCAL_LENGTH / (FOCAL_LENGTH + rz);
        const sx = cx + rx * scale * depth;
        const sy = cy + ry * scale * depth;

        // Vorne = hell und gross, hinten = schwach und klein.
        const near = (depth - 0.55) / 0.75;
        const alpha = Math.max(0, Math.min(1, near)) * 0.85;
        if (alpha <= 0.01) continue;

        const hue = 186 + (ry + 1) * 26 + (1 - near) * 34;
        const radius = Math.max(0.35, near * 1.7);

        ctx!.fillStyle = `hsla(${hue}, 100%, ${58 + near * 16}%, ${alpha})`;
        ctx!.beginPath();
        ctx!.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.globalCompositeOperation = "source-over";
    }

    function loop(): void {
      if (visible) {
        time += 0.006;
        draw();
      }
      frame = window.requestAnimationFrame(loop);
    }

    function onPointerMove(event: PointerEvent): void {
      pointerRef.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
    }

    resize();
    draw();

    if (reduceMotion) {
      return () => undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={className}>
      {/* Weiche Lichtquelle hinter der Punktwolke */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(46,230,255,.22), rgba(79,125,255,.16) 38%, transparent 68%)",
        }}
      />
      <canvas ref={canvasRef} className="relative h-full w-full" aria-hidden />
    </div>
  );
}
