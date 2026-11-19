// Seconds from heading confirmation. GO is the first frame of the push.
const cues = [
  [0, '左翼、いいですか？'],
  [2.1, '右翼、いいですか？'],
  [4.2, '行きます'],
  [5.3, '3'],
  [6.3, '2'],
  [7.3, '1'],
  [8.3, 'GO'],
];
export function launchCue(seconds) {
  const [at, label] = cues.findLast(([at]) => at <= seconds);
  return { label, go: label === 'GO', elapsed: seconds - at };
}
