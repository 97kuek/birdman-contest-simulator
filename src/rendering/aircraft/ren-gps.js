import { drawNorth } from './north-indicator.js';
import { navigation, practiceBuoys, reserveCapacityJ } from '../../domain/ren-practice.js';

// A course-upstream map on a portrait cockpit display. One scale fits the
// course and the aircraft even after a wide turn; the arrow follows ground track.
export function drawRenGps(ctx, s, instruments, northInCourse, runway) {
  const w = 360, h = 600, target = runway ? null : navigation(s);
  const speed = instruments.airspeed.toFixed(1), height = instruments.altitude.toFixed(1);
  const reserve = Math.round(100 * (s.reserve ?? reserveCapacityJ) / reserveCapacityJ);
  function label(value, x, y, size, color, align = 'left') {
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  ctx.fillStyle = '#152b34'; ctx.fillRect(0, 0, w, h);
  label(speed + ' m/s', 12, 50, 43, '#f5faf7');
  label(height + ' m', w - 12, 50, 43, '#f5faf7', 'right');
  const minX = Math.min(-65, s.right - 15), maxX = Math.max(110, s.right + 15);
  const minY = Math.min(-20, s.forward - 15), maxY = Math.max(runway ? runway.length + 20 : Math.max(...practiceBuoys.map(mark => mark.forward + 20)), s.forward + 15);
  const scale = Math.min(320 / (maxX - minX), 345 / (maxY - minY));
  const xy = point => [180 + (point.right - (minX + maxX) / 2) * scale,
    248 - (point.forward - (minY + maxY) / 2) * scale];
  ctx.fillStyle = runway ? '#bfd6b1' : '#c8e5eb'; ctx.fillRect(0, 69, w, 358);
  if (runway) {
    const [left, top] = xy({ right: -runway.width / 2, forward: runway.length });
    ctx.fillStyle = '#52615d';
    ctx.fillRect(left, top, runway.width * scale, runway.length * scale);
    ctx.beginPath();
    ctx.moveTo(...xy({ right: 0, forward: 0 }));
    ctx.lineTo(...xy({ right: 0, forward: runway.length }));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  } else {
    const start = xy({ right: 0, forward: 0 });
    ctx.beginPath(); ctx.moveTo(...start);
    for (const mark of practiceBuoys) ctx.lineTo(...xy(mark));
    ctx.strokeStyle = '#598998'; ctx.lineWidth = 3; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
    practiceBuoys.forEach((mark, i) => {
      const [x,y] = xy(mark);
      ctx.beginPath(); ctx.arc(x,y,14,0,2*Math.PI);
      ctx.fillStyle = target?.number === i+1 ? '#b63e16' : '#3b6268'; ctx.fill();
      label(i+1,x,y+8,21,'white','center');
    });
    if (target) {
      ctx.beginPath(); ctx.moveTo(...xy(s)); ctx.lineTo(...xy(practiceBuoys[target.number - 1]));
      ctx.strokeStyle = '#aa411e'; ctx.lineWidth = 4; ctx.stroke();
    }
  }
  ctx.save(); ctx.translate(...xy(s)); ctx.rotate(s.track ?? 0);
  ctx.beginPath(); ctx.moveTo(0,-17); ctx.lineTo(11,12); ctx.lineTo(0,7); ctx.lineTo(-11,12); ctx.closePath();
  ctx.fillStyle = '#123642'; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  drawNorth(ctx, 29, 100, northInCourse, 18, '#123642');
  const route = runway ? '北端まで ' + Math.round(Math.hypot(runway.length - s.forward, s.right)) + ' m' :
    target ? 'ブイ ' + target.number + 'まで ' + Math.round(target.metres) + ' m' : '完走 ' + (s.courseTime ?? 0).toFixed(1) + ' 秒';
  label(route, 12, 468, 32, '#fff');
  label(Math.round(s.watts ?? 0) + ' W', 12, 539, 42, '#b8dce3');
  label('加速余力 ' + reserve + '%', w-12, 539, 38, '#f7e596', 'right');
  ctx.fillStyle = '#4c5860'; ctx.fillRect(12,564,336,11);
  ctx.fillStyle = '#f2c647'; ctx.fillRect(12,564,336 * reserve / 100,11);
  return '対気速度 ' + speed + ' m/s、高度 ' + height + ' m、' +
    route + '、余力' + reserve + '%。';
}
