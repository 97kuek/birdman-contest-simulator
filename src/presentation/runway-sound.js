// Wheel and vehicle sounds share the ambience switch. Generate short looping
// textures once. The source rate follows rolling speed instead of the frame rate.
export function createRunwaySound(context, destination) {
  function engineBuffer(render, seconds) {
    const buffer = context.createBuffer(1, Math.round(seconds * context.sampleRate), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = render(i / context.sampleRate);
    // Blend the wrap into the lead-in so low-frequency engine pulses never click.
    const seam = Math.round(.03 * context.sampleRate);
    for (let i = 0; i < seam; i++) {
      const mix = i / seam;
      data[data.length - seam + i] = (1 - mix) * data[data.length - seam + i] + mix * data[i];
    }
    return buffer;
  }
  function loop(buffer, output, offset = 0) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(output);
    source.start(0, offset);
    return { source, gain: gain.gain };
  }

  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 7;
  panner.rolloffFactor = .8;
  panner.connect(destination);
  let exhaust = 0;
  const engine = engineBuffer(t => {
    const phase = 2 * Math.PI * 45 * t + .34 * Math.sin(7.2*t) + .12 * Math.sin(13*t);
    exhaust += .042 * (2 * Math.random() - 1 - exhaust);
    return .27 * Math.sin(phase) + .14 * Math.sin(2*phase + .4) +
      .07 * Math.sin(3*phase + 1.1) + .045 * Math.sin(5*phase) + .6 * exhaust;
  }, 4);
  const car = loop(engine, panner);
  car.source.loopStart = .03;
  let tyres, carTyres;
  function setTyreBuffer(buffer) {
    if (tyres) return;
    tyres = loop(buffer, destination);
    carTyres = loop(buffer, panner, buffer.duration / 2);
  }
  const targets = new Map();
  function set(param, value, lag = .10) {
    if (targets.get(param) === value) return;
    targets.set(param, value);
    param.setTargetAtTime(value, context.currentTime, lag);
  }

  function update(field) {
    if (!field) {
      if (tyres) { set(tyres.gain, 0); set(carTyres.gain, 0); }
      set(car.gain, 0);
      return;
    }
    const speed = Math.max(0, field.wheelSpeed);
    const wheelLevel = Math.min(1, speed / 6) ** .8;
    const drive = Math.min(1, Math.max(0, field.carSpeed) / 9);
    if (tyres) {
      const contact = Math.sqrt(Math.min(1.5, field.wheelLoad));
      set(tyres.gain, wheelLevel * contact / (1 + field.wheelRange / 8), .035);
      set(tyres.source.playbackRate, .56 + Math.min(speed, 12) * .065);
      set(carTyres.gain, field.carOnPavement ? .44 * drive : 0);
      set(carTyres.source.playbackRate, .52 + drive * .31);
    }
    set(car.gain, .24 + .64 * drive);
    set(car.source.playbackRate, .74 + drive * .8, .30);
    const { x, y, z } = field.carPosition;
    const p = panner;
    if (p.positionX) {
      set(p.positionX, x); set(p.positionY, y); set(p.positionZ, z);
    } else p.setPosition(x, y, z);
  }

  function horn() {
    const now = context.currentTime, duration = .62;
    const envelope = context.createGain();
    envelope.connect(panner);
    envelope.gain.setValueAtTime(.001, now);
    envelope.gain.exponentialRampToValueAtTime(.29, now + .028);
    envelope.gain.setValueAtTime(.29, now + duration - .045);
    envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
    // Two close horn reeds share the engine's spatial position on the van.
    let voices = 2;
    for (const hz of [405, 497]) {
      const reed = context.createOscillator();
      reed.type = 'sawtooth';
      reed.frequency.setValueAtTime(hz * .96, now);
      reed.frequency.exponentialRampToValueAtTime(hz, now + .025);
      reed.connect(envelope);
      reed.onended = () => { reed.disconnect(); if (--voices === 0) envelope.disconnect(); };
      reed.start(now);
      reed.stop(now + duration);
    }
  }
  return { update, horn, setTyreBuffer };
}
