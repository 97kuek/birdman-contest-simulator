import { criticalPressure } from '../domain/ren-divergence.js';
import { AIR_DENSITY, CRUISE_AIRCRAFT, runCruiseTrial } from '../domain/powered-cruise.js';

const aircraft = document.querySelector('#aircraft');
const power = document.querySelector('#power');

function renderTrial() {
  document.getElementById('torsion').hidden = aircraft.value !== 'ren';
  const plane = CRUISE_AIRCRAFT[aircraft.value];
  const watts = plane.power * Number(power.value);
  const samples = runCruiseTrial(aircraft.value, watts);
  const final = samples.at(-1);
  document.querySelector('#result').textContent =
    plane.power + ' W → ' + watts + ' W　｜　60秒間の水平距離 ' + final.distance.toFixed(1) + ' m';
  const rows = [0, 30, 31, 35, 45, 60].map(second => {
    const { rpm, thrust, speed, height } = samples[second];
    const row = document.createElement('tr');
    const time = document.createElement('th');
    time.scope = 'row';
    time.textContent = second;
    row.append(time);
    for (const value of [rpm.toFixed(1), thrust.toFixed(1), speed.toFixed(2), (Math.round(height * 100) / 100).toFixed(2)]) {
      row.insertCell().textContent = value;
    }
    return row;
  });
  document.querySelector('#readings').replaceChildren(...rows);
}

document.querySelector('form').addEventListener('change', renderTrial);
renderTrial();

const torsion = document.getElementById('torsion');
function renderDivergence() {
  function parameter(id, format) {
    const input = document.getElementById(id);
    const value = input.valueAsNumber, text = format(value);
    torsion.querySelector('output[for="' + id + '"]').textContent = text;
    input.setAttribute('aria-valuetext', text);
    return value;
  }
  const rigidity = parameter('rigidity', v => v.toLocaleString('ja-JP') + ' N·m²');
  const offset = parameter('offset', v => v === 0 ? '同じ位置' : (v > 0 ? '後方 ' : '前方 ') + Math.abs(v) + ' %翼弦') / 100;
  const speed = parameter('airspeed', v => v.toFixed(1) + ' m/s');
  const critical = criticalPressure({ rigidity, offset });
  const ratio = .5 * AIR_DENSITY * speed ** 2 / critical;
  const out = document.getElementById('torsion-result');
  out.dataset.unstable = String(ratio >= 1);
  out.textContent = Number.isFinite(critical)
    ? (ratio >= 1 ? '静的発散域' : '復元力あり') + '　発散速度 ' + Math.sqrt(2*critical/AIR_DENSITY).toFixed(2) +
      ' m/s　動圧は限界の ' + Math.round(100*ratio) + '%'
    : 'この弾性軸位置では、モデルに正の発散動圧はありません。';
}
torsion.addEventListener('input', renderDivergence);
torsion.addEventListener('toggle', () => { if (torsion.open) renderDivergence(); });
if (location.hash === '#torsion') torsion.open = true;
