import { useEffect, useRef } from "react";

// Hex → rgba helper (keeps particle fills correct regardless of input format)
function toRgba(hex, alpha) {
  if (!hex) return `rgba(233,69,96,${alpha})`;
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Gradient semantics (see draw()): `glow` is stop 0 (innermost HIGHLIGHT),
// `inner` is stop 0.4 (mid body), `core` is stop 1 (dark outer edge).
// Start bright at the highlight, fall off to a dark-but-tinted edge so the
// orb reads as a coloured sphere on a near-black panel background.
const STATE_COLORS = {
  idle: {
    core: "#2a0a14",       // dark crimson edge
    inner: "#8b1e3a",      // crimson mid
    glow: "#ff4d73",       // bright crimson highlight
    particles: "#ff6b8a",
    pulse: "rgba(233, 69, 96, 0.35)",
    ring: "rgba(233, 69, 96,",
  },
  thinking: {
    core: "#140a2e",       // dark violet edge
    inner: "#3b2a7a",      // violet mid
    glow: "#a78bfa",       // bright violet highlight
    particles: "#c4b5fd",
    pulse: "rgba(167, 139, 250, 0.4)",
    ring: "rgba(167, 139, 250,",
  },
  signal: {
    core: "#041a2e",       // dark cyan edge
    inner: "#0c4a6e",      // cyan mid
    glow: "#38bdf8",       // bright cyan highlight
    particles: "#7dd3fc",
    pulse: "rgba(56, 189, 248, 0.45)",
    ring: "rgba(56, 189, 248,",
  },
  alert: {
    core: "#2a0505",       // dark red edge
    inner: "#7f1d1d",      // red mid
    glow: "#ef4444",       // bright red highlight
    particles: "#fca5a5",
    pulse: "rgba(248, 113, 113, 0.45)",
    ring: "rgba(248, 113, 113,",
  },
};

export default function VesperOrb({ state = "idle", size = 120 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = size;
    const H = size;
    canvas.width = W;
    canvas.height = H;

    const colors = STATE_COLORS[state] || STATE_COLORS.idle;
    const cx = W / 2;
    const cy = H / 2;
    const radius = W * 0.35;

    // Particle system
    const particles = Array.from({ length: 80 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: radius * (0.7 + Math.random() * 0.9),
      speed: 0.003 + Math.random() * 0.008,
      size: 0.8 + Math.random() * 2.0,
      opacity: 0.5 + Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 0.001,
    }));

    let frame = 0;
    let animId;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      frame++;

      // Outer glow pulse
      const pulse = Math.sin(frame * 0.02) * 0.3 + 0.7;
      const outerGlow = ctx.createRadialGradient(
        cx, cy, radius * 0.8,
        cx, cy, radius * 1.8
      );
      outerGlow.addColorStop(0, colors.pulse);
      outerGlow.addColorStop(1, "transparent");
      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Core orb
      const coreGrad = ctx.createRadialGradient(
        cx - radius * 0.2, cy - radius * 0.2, 0,
        cx, cy, radius
      );
      coreGrad.addColorStop(0, colors.glow);
      coreGrad.addColorStop(0.4, colors.inner);
      coreGrad.addColorStop(1, colors.core);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Inner shimmer
      const shimmer = ctx.createRadialGradient(
        cx - radius * 0.3, cy - radius * 0.3, 0,
        cx - radius * 0.3, cy - radius * 0.3,
        radius * 0.6
      );
      shimmer.addColorStop(0, `rgba(255,255,255,${0.08 * pulse})`);
      shimmer.addColorStop(1, "transparent");
      ctx.fillStyle = shimmer;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting particles
      particles.forEach((p) => {
        p.angle += p.speed * (state === "thinking" ? 2 : 1);
        p.radius += Math.sin(frame * 0.05 + p.angle) * 0.3;

        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius;

        const alpha = p.opacity * (0.5 + 0.5 * Math.sin(frame * 0.03 + p.angle));
        ctx.fillStyle = toRgba(colors.particles, alpha);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Energy rings (on signal state)
      if (state === "signal") {
        for (let i = 0; i < 3; i++) {
          const ringRadius =
            radius * (1.1 + i * 0.2) + Math.sin(frame * 0.05 + i) * 3;
          ctx.strokeStyle = `${colors.ring} ${0.3 - i * 0.08})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [state, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        borderRadius: "50%",
        filter: "blur(0.3px)",
        width: size,
        height: size,
      }}
    />
  );
}
