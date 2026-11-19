// Between calls, leave time to hear the instruments and watch the flight.
const MIN_PAUSE = 5;
const DEGREE = Math.PI / 180;
const lines = {
  release: ['さあ、竜海が飛び出した！', 'いった、竜海！', '竜海、湖上に出ました。'],
  recovery: ['おっと、機首が上がった！', 'ここで機首を上げてきた！'],
  low: ['低い、まだ飛んでいる！', '水面ぎりぎり、どこまで伸びるか！'],
  landing: ['ああ、ここで着水！', '竜海、ここで水面に降りました。', 'いま着水です！'],
};

export function createRaceCommentary(trialNumber) {
  let lastCall = -Infinity, released = false, descending = false, recovered = false;
  let calledLow = false, calledTurn = false, lastHundred = 0;
  const choose = options => options[(trialNumber - 1) % options.length];
  function say(time, text) {
    lastCall = time;
    return text;
  }
  return {
    airborne(s) {
      if (!released) {
        released = true;
        return say(s.t, choose(lines.release));
      }
      if (s.verticalSpeed < -.45) descending = true;
      const pullup = !recovered && descending && s.verticalSpeed > .15 && s.pitch > 0;
      // A pull-up happens early. Announce it at the transition, even if the launch caption just cleared.
      if (pullup && s.t <= 12 && s.t - lastCall >= 3) {
        recovered = true;
        return say(s.t, choose(lines.recovery));
      }
      if (s.t - lastCall < MIN_PAUSE) return;
      const hundred = Math.floor(s.distance / 100);
      if (hundred > lastHundred) {
        lastHundred = hundred;
        const metres = hundred * 100 + 'メートル';
        let text = metres + 'を通過しました。';
        if (hundred >= 4) text = metres + 'を超えた！　まだ飛んでいます！';
        else if (hundred >= 2) text = choose([metres + 'を超えてきた！', 'さあ、' + metres + 'です！']);
        return say(s.t, text);
      }
      if (!calledLow && s.bottomHeight < 1.2 && s.distance >= 30) {
        calledLow = true;
        return say(s.t, choose(lines.low));
      }
      if (!calledTurn && Math.abs(s.bank) > 7 * DEGREE) {
        calledTurn = true;
        return say(s.t, (s.bank > 0 ? '右' : '左') + 'に傾きました。');
      }
    },
    landing(run) {
      if (run.distance >= 400 && lastHundred < 4) return '400メートルを越えて、ここで着水！';
      return choose(lines.landing);
    },
  };
}
