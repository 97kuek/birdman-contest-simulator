import { CRUISE_AIRCRAFT, runCruiseTrial } from '../domain/powered-cruise.js';

const aircraft = document.querySelector('#aircraft');
const power = document.querySelector('#power');

function renderTrial() {
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
