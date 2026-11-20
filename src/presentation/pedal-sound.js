import { propTurnsPerCrank } from '../domain/ren-practice.js';

// Both loops represent one crank revolution per second at their native rate.
// The propeller keeps its own RPM even when the freewheel disengages the crank.
export function createPedalSound(context, destination) {
  const sampleRate = context.sampleRate;
  function voice(render) {
    const buffer = context.createBuffer(1, sampleRate * 2, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = render(i / sampleRate);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain).connect(destination);
    source.start();
    return { source, gain };
  }

  let air = 0, chainNoise = 0;
  const propeller = voice(t => {
    const bladePhase = 2 * Math.PI * t * propTurnsPerCrank * 2;
    const passage = (.5 + .5 * Math.cos(bladePhase)) ** 3;
    air += .047 * (2 * Math.random() - 1 - air);
    return air * (.40 + 1.7 * passage) + .045 * passage * Math.sin(6 * bladePhase);
  });
  const chain = voice(t => {
    // A short metallic contact at each roller, accented with alternating strokes.
    const tooth = (t * 44) % 1;
    const stroke = .60 + .40 * Math.cos(4 * Math.PI * t);
    const noise = Math.random() * 2 - 1;
    chainNoise += .055 * (noise - chainNoise);
    const click = Math.exp(-5 * tooth) * (.16 * Math.sin(2 * Math.PI * 8 * tooth) + .36 * chainNoise);
    return click * stroke;
  });
  function set(voice, rate, volume) {
    const now = context.currentTime;
    voice.source.playbackRate.setTargetAtTime(Math.max(.02, rate), now, .055);
    voice.gain.gain.setTargetAtTime(volume, now, .045);
  }
  return function update(rpm, watts, distance) {
    const rate = Math.max(0, rpm) / (60 * propTurnsPerCrank);
    const range = 1 / (1 + distance / 6);
    const strength = Math.sqrt(Math.max(0, watts) / 203);
    set(propeller, rate, Math.min(1.5, rate ** 1.5) * .36 * range);
    set(chain, rate, rate > 0 ? .65 * Math.min(1.5, strength) * range : 0);
  };
}
