// Project the platform cloth's actual upper hem into a nose-up plan view.
// The small oblique view of its depth keeps the fabric readable on a phone.
export function createFlagInset(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width, centre = size / 2, pixelsPerMetre = size * .215;
  const sectors = ['正面', '右前', '右', '右後ろ', '後ろ', '左後ろ', '左', '左前'];
  return function draw(visible, {points, strips, stripColors, poleHeight}, wind, heading) {
    if (canvas.hidden !== !visible) canvas.hidden = !visible;
    if (!visible) return;
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const cross = wind.crosswind ?? 0;
    const x = -cross * cos + wind.headwind * sin;
    const y = cross * sin + wind.headwind * cos;
    const speed = Math.hypot(x, y);
    const dx = speed ? x / speed : 0, dy = speed ? y / speed : 1;
    const from = Math.round(Math.atan2(-x, y) * 4 / Math.PI);
    const label = speed < .05 ? '風見旗、無風' : '風見旗、' + sectors[(from + 8) % 8] + 'からの風。上が機首方向';
    if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label);
    ctx.clearRect(0, 0, size, size);
    // The wing mark stays at twelve o'clock as the player turns the glider.
    ctx.strokeStyle = '#86a3b580';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      const a = i * Math.PI / 4, sx = Math.sin(a), sy = -Math.cos(a);
      ctx.beginPath(); ctx.moveTo(centre + 83 * sx, centre + 83 * sy);
      ctx.lineTo(centre + 88 * sx, centre + 88 * sy); ctx.stroke();
    }
    ctx.fillStyle = '#e5f7ff';
    ctx.beginPath();
    ctx.moveTo(centre, 6); ctx.lineTo(centre + 3, 14); ctx.lineTo(centre + 12, 20);
    ctx.lineTo(centre + 2, 18); ctx.lineTo(centre, 24); ctx.lineTo(centre - 2, 18); ctx.lineTo(centre - 12, 20); ctx.lineTo(centre - 3, 14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#a9bdc9';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(centre, centre); ctx.lineTo(centre - 6, centre + 51); ctx.stroke();
    const crest = i => {
      const right = points.getX(i), aft = points.getZ(i);
      const drop = poleHeight - points.getY(i);
      return [centre + pixelsPerMetre * (right * cos + aft * sin),
        centre + pixelsPerMetre * (aft * cos - right * sin + .33 * drop)];
    };
    let previous = crest(0);
    for (let i = 1; i <= strips; i++) {
      const next = crest(i);
      const depth = (points.getY(i) - points.getY(i + strips + 1)) * pixelsPerMetre * .79;
      const hemX = -dy * depth, hemY = dx * depth;
      ctx.beginPath();
      ctx.moveTo(...previous); ctx.lineTo(...next);
      ctx.lineTo(next[0] + hemX, next[1] + hemY);
      ctx.lineTo(previous[0] + hemX, previous[1] + hemY); ctx.closePath();
      ctx.fillStyle = stripColors[i];
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
      previous = next;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(centre, centre, 4, 0, Math.PI * 2); ctx.fill();
  };
}
