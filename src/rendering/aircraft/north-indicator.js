// Clockwise from the top of the instrument or its fixed-orientation map.
export function drawNorth(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.font = 'bold ' + size + 'px sans-serif';
  ctx.fillText('N', Math.sin(angle) * size, -Math.cos(angle) * size + size*.33);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -.65*size);
  ctx.lineTo(.28*size, .4*size);
  ctx.lineTo(0, .23*size);
  ctx.lineTo(-.28*size, .4*size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
