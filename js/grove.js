const LEAF_SRCS = ["./grove/leaf-1.png", "./grove/leaf-2.png", "./grove/leaf-3.png"];

function startGrove() {
  const canvas = document.getElementById("grove-leaves");
  const video = document.getElementById("grove-film");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const leaves = [];
  const images = [];

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  LEAF_SRCS.forEach((src) => {
    const img = new Image();
    img.src = src;
    img.onload = () => images.push(img);
  });

  const spawn = (w, fromCanopy) => {
    if (!images.length) return;
    const img = images[(Math.random() * images.length) | 0];
    const canopyLeft = w * 0.42;
    leaves.push({
      x: fromCanopy ? canopyLeft + Math.random() * w * 0.5 : Math.random() * w,
      y: fromCanopy ? window.innerHeight * 0.16 + Math.random() * Math.min(window.innerHeight * 0.3, 260) : -40,
      vx: (Math.random() - 0.35) * 18,
      vy: 18 + Math.random() * 28,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.025,
      size: 18 + Math.random() * 28,
      img,
      wobble: Math.random() * Math.PI * 2,
      spin: Math.random() * 0.4 + 0.7,
    });
  };

  let last = performance.now();
  let acc = 0;

  const tick = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (!reduced && images.length) {
      acc += dt;
      while (acc > 380 && leaves.length < 28) {
        acc -= 380;
        spawn(w, true);
      }
      const wind = Math.sin(now * 0.00028) * 0.35;
      for (let i = leaves.length - 1; i >= 0; i--) {
        const L = leaves[i];
        L.wobble += dt * 0.0024;
        L.vx += Math.sin(L.wobble) * 0.06 + wind * 0.04;
        L.vy += 0.008 * dt;
        L.x += L.vx * (dt / 16);
        L.y += L.vy * (dt / 16);
        L.rot += L.vr * dt * L.spin;
        const fade = L.y > h * 0.88 ? 1 - (L.y - h * 0.88) / (h * 0.14) : 1;
        if (fade <= 0 || L.y > h + 50) {
          leaves.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.rotate(L.rot);
        ctx.globalAlpha = Math.max(0, fade) * 0.95;
        ctx.drawImage(L.img, -L.size / 2, -L.size / 2, L.size, L.size * 1.05);
        ctx.restore();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const tryPlay = () => {
    if (!video || reduced) return;
    video.play().catch(() => undefined);
  };
  tryPlay();
  document.addEventListener("visibilitychange", tryPlay);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startGrove);
} else {
  startGrove();
}
