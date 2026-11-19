// Seconds after direction confirmation. The crew answer from their own wing.
const cues = [
  [0, '左翼、いいですか？'],
  [1.25, 'はい！', 'left'],
  [2.1, '右翼、いいですか？'],
  [3.35, 'はい！', 'right'],
  [4.2, '行きます'],
  [5.3, '3'],
  [6.3, '2'],
  [7.3, '1'],
  [8.3, 'GO'],
];
export function launchCue(seconds, aircraftId = 'ryukai') {
  const [at, label, wing = ''] = cues.findLast(([at]) => at <= seconds);
  const call = aircraftId === 'qx25' ? label.replace('左翼', '左').replace('右翼', '右') : label;
  return { label: call, wing, go: label === 'GO', elapsed: seconds - at };
}
