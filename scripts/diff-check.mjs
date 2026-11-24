const LEFT = new Set('qwertasdfgzxcvb');
function difficulty(word) {
  const n = word.length;
  if (n === 0) return 0;
  let s = n;
  let repeats = 0;
  for (let i = 1; i < n; i++) if (word[i] === word[i - 1]) repeats++;
  s -= repeats * 0.8;
  const unique = new Set(word).size;
  s -= (1 - unique / n) * n * 0.5;
  let sameHand = 0;
  for (let i = 1; i < n; i++) if (LEFT.has(word[i - 1]) === LEFT.has(word[i])) sameHand++;
  s += sameHand * 0.25;
  let rare = 0;
  for (const ch of new Set(word)) if ('qzxj'.includes(ch)) rare++;
  s += rare * 0.3;
  return Math.max(1, Math.round(s * 100) / 100);
}
const BANDS = [[0,3.5],[3.5,4.5],[4.5,5.5],[5.5,6.5],[6.5,7.5],[7.5,9],[9,999]];
function band(w){const s=difficulty(w);return BANDS.findIndex(([a,b])=>s>=a&&s<b);}
const candidates = process.argv.slice(2);
for (const w of candidates) console.log(`${w}\t${difficulty(w)}\tband${band(w)}`);
