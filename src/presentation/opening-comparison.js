import data from './opening-comparison.json';

// Official broadcast seconds corresponding to logger time 3.90 s.
// See docs/tatsumi-video-timing.md for the two visual bounds and clock uncertainty.
const videoZero = 123.42;
const clipEnd = videoZero + data.duration;
const videoId = 'brdhsnknoKs';
const byId = id => document.getElementById(id);
const scrubber = byId('time');
const play = byId('play');
const status = byId('film-status');
const colors = { imu: '#aa4c10', model: '#057469', alternative: '#816398' };
const clampTime = t => Math.min(data.duration, Math.max(0, t));
const sourceUrl = t => 'https://www.youtube.com/watch?v=' + videoId + '&t=' + Math.floor(videoZero + t) + 's';
byId('sync').textContent = '離台の目安は映像 ' + videoZero.toFixed(2) + ' 秒、機上ログ 3.90 秒。映像とログを合わせる際の読み取り幅は約 ±0.60 秒です。';

function interpolate(rows, key, t) {
  if (t < rows[0][0] || t > rows.at(-1)[0]) return null;
  const i = rows.findIndex(p => p[0] >= t);
  const b = rows[i];
  if (i === 0 || b[0] === t) return b[key];
  const a = rows[i - 1];
  return a[key] + (b[key] - a[key]) * (t - a[0]) / (b[0] - a[0]);
}

const ns = 'http://www.w3.org/2000/svg';
function svg(tag, props, parent) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(props)) element.setAttribute(key, value);
  parent.append(element);
  return element;
}
const charts = [];
function chart(title, unit, seriesKey, modelColumn, imuColumn, ticks) {
  const imuRows = seriesKey === 'rates' ? data.imuRates : data.imu;
  const figure = document.createElement('figure'), caption = document.createElement('figcaption');
  const label = document.createElement('strong');
  label.textContent = title + ' (' + unit + ')';
  caption.append(label);
  figure.append(caption);
  byId('plots').append(figure);
  const w = 520, h = 105, left = 35, right = 12, top = 10, bottom = 23;
  const x = t => left + (w - left - right) * t / data.duration;
  const y = v => top + (h - top - bottom) * (ticks.at(-1) - v) / (ticks.at(-1) - ticks[0]);
  const g = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label':title + '、横軸は離台後0から3秒' }, figure);
  svg('rect', { x:x(.5), y:top, width:x(1.25)-x(.5), height:h-top-bottom, fill:'#e0ebf9' }, g);
  for (const v of ticks) {
    svg('line', { x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#d5dfe6' },g);
    svg('text', { x:left-5,y:y(v)+4,'text-anchor':'end' },g).textContent = v;
  }
  for (const t of [0,.5,1,1.5,2,2.5,3]) {
    svg('text', { x:x(t), y:h-5, 'text-anchor':'middle' },g).textContent = t + (t === 3 ? ' s' : '');
  }
  function line(rows, column, color, dashed) {
    const points = [];
    for (const t of [0, ...rows.map(row => row[0]).filter(t => t > 0 && t < data.duration), data.duration]) {
      const value = interpolate(rows, column, t);
      if (value !== null) points.push(x(t).toFixed(2) + ',' + y(value).toFixed(2));
    }
    return svg('polyline', { points:points.join(' '), stroke:color, fill:'none','stroke-width':2.4,
      'stroke-dasharray': dashed ? '5 4' : 'none' },g);
  }
  const alternatives = {};
  for (const key of ['previous','fixed']) alternatives[key] = line(data[key][seriesKey], modelColumn, colors.alternative, true);
  line(data.current[seriesKey], modelColumn, colors.model, false);
  if (imuColumn !== null) line(imuRows, imuColumn, colors.imu, false);
  const cursor = svg('line', { y1:top, y2:h-bottom, stroke:'#213b58','stroke-width':1.5 },g);
  const readings = [];
  for (const [name, rows, column, text] of [
    ['imu',imuRows,imuColumn,'実機'], ['model',data.current[seriesKey],modelColumn,'モデル'],
  ]) {
    if (column === null) continue;
    const out = document.createElement('span');
    out.className = name;
    caption.append(out);
    const dot = svg('circle', { r:3.4, fill:colors[name],stroke:'#fff','stroke-width':1 },g);
    readings.push(t => {
      const value = interpolate(rows, column, t);
      out.textContent = text + ' ' + (value === null ? '—' : value.toFixed(1));
      dot.setAttribute('visibility', value === null ? 'hidden' : 'visible');
      if (value !== null) { dot.setAttribute('cx', x(t)); dot.setAttribute('cy', y(value)); }
    });
  }
  const alternateValue = document.createElement('span');
  alternateValue.className = 'alt-value';
  caption.append(alternateValue);
  charts.push(t => {
    const key = byId('alternative').value;
    const value = key ? interpolate(data[key][seriesKey], modelColumn, t) : null;
    alternateValue.hidden = !key;
    alternateValue.textContent = '比較 ' + (value === null ? '—' : value.toFixed(1));
    cursor.setAttribute('x1', x(t)); cursor.setAttribute('x2', x(t));
    for (const [key, path] of Object.entries(alternatives)) path.style.display = byId('alternative').value === key ? '' : 'none';
    for (const update of readings) update(t);
  });
}
chart('ピッチ', '°', 'states', 1, 1, [-20,-15,-10,-5,0,5]);
chart('ピッチ変化率', '°/s', 'rates', 1, 1, [-20,-10,0,10,20]);
chart('身体位置', 'cm', 'states', 2, null, [-10,-5,0,5,10]);

let time = 0, player, ready = false, playing = false, frame, lastTick, failed = false;
let filmStarted = false, previewAt = null;
const synced = '読売テレビ公式 · 映像の再生位置に同期';
function display(t) {
  time = clampTime(t);
  scrubber.value = time;
  byId('elapsed').textContent = time.toFixed(2);
  byId('watch').href = sourceUrl(time);
  const filmTime = videoZero + time;
  byId('clocks').textContent = '映像 ' + filmTime.toFixed(2) + ' 秒 ／ ログ ' + (data.logOrigin + time).toFixed(2) + ' 秒';
  byId('shot').textContent = filmTime < 123.824
    ? '後上方から見ると、補助員と機体の輪郭が重なります。'
    : filmTime <= 124.791 ? '機体が台の外へ出ています。後上方からは肩・腰の前後移動を読み取れません。'
    : filmTime < 124.858 ? '台上後方から側方のカメラに切り替わります。'
      : '側方からの映像。機体の動きは見えますが、腰の位置はカウルに隠れます。';
  for (const update of charts) update(time);
}
function playback(active) {
  playing = active;
  play.textContent = active ? 'Ⅱ 停止' : (time >= data.duration ? '↺ 再生' : '▶ 再生');
  cancelAnimationFrame(frame);
  if (active) { lastTick = performance.now(); frame = requestAnimationFrame(tick); }
}
function tick(now) {
  if (!playing) return;
  const t = ready ? player.getCurrentTime() - videoZero : time + (now - lastTick) / 1000;
  lastTick = now;
  display(t);
  if (t >= data.duration) {
    if (ready) { player.pauseVideo(); player.seekTo(clipEnd, true); }
    playback(false);
  } else frame = requestAnimationFrame(tick);
}
function jump(t) {
  if (ready) {
    const target = videoZero + t;
    if (filmStarted) {
      previewAt = null;
      player.pauseVideo();
      player.seekTo(target, true);
    } else {
      // A seek on an unstarted/cued iframe can leave its poster on screen.
      // Decode the first requested frame before switching to paused scrubbing.
      previewAt = target;
      player.seekTo(target, true);
      player.playVideo();
      status.textContent = '指定した場面を読み込み中';
    }
  }
  display(t);
  playback(false);
}
function unavailable() {
  ready = false;
  failed = true;
  playback(false);
  status.textContent = '映像を埋め込み再生できません。グラフは単独で操作できます。';
}
play.addEventListener('click', () => {
  if (playing) { if (ready) player.pauseVideo(); playback(false); return; }
  if (time >= data.duration) display(0);
  if (ready) {
    previewAt = null;
    player.seekTo(videoZero + time, true);
    player.playVideo();
  } else playback(true);
});
scrubber.addEventListener('input', () => jump(Number(scrubber.value)));
for (const button of document.querySelectorAll('[data-time]')) button.onclick = () => jump(Number(button.dataset.time));
byId('alternative').onchange = () => display(time);
display(0);

window.onYouTubeIframeAPIReady = () => {
  player = new window.YT.Player('film', {
    videoId, width:'100%',height:'100%',
    playerVars:{ start:Math.floor(videoZero), controls:0, disablekb:1, playsinline:1, rel:0, origin:location.origin },
    events:{
      onReady() {
        failed = false;
        ready = true;
        playback(false);
        player.mute();
        status.textContent = '読売テレビ公式 · 再生または時刻を選択';
        const iframe = player.getIframe();
        iframe.title = '2025年大会・鳥科「竜海」の飛行映像';
      },
      onStateChange(event) {
        if (!ready || failed) return;
        if (event.data === window.YT.PlayerState.PLAYING) {
          filmStarted = true;
          status.textContent = synced;
          if (previewAt !== null) {
            const target = previewAt;
            previewAt = null;
            player.pauseVideo();
            player.seekTo(target, true);
            return;
          }
          const current = player.getCurrentTime();
          if (current < videoZero - .5 || current >= clipEnd) player.seekTo(videoZero + (time >= data.duration ? 0 : time), true);
          playback(true);
        } else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
          playback(false);
        }
      },
      onAutoplayBlocked() {
        playback(false);
        status.textContent = '映像内の再生ボタンを押してください';
      },
      onError: unavailable,
    },
  });
};
const api = document.createElement('script');
api.src = 'https://www.youtube.com/iframe_api';
api.onerror = unavailable;
document.head.append(api);
setTimeout(() => { if (!ready && !failed) unavailable(); }, 12000);
