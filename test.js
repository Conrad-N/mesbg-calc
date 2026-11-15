// Checks the exact engine against hand-worked odds, then against the random simulator
// (sim.js) on many random matchups. Run: node test.js
const { calculate, woundNeed } = require('./engine');
const sim = require('./sim');
const simulate = (input) => calculate(input);
const M = (o = {}) => ({ role: 'front', fight: 3, attacks: 1, strength: 3, defence: 4, wounds: 1, fate: 0, ...o });
const side = (models, o = {}) => ({ models, target: 0, ...o });
let fails = 0;
function check(name, got, want, tol = 1e-9) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: got ${got.toFixed(4)} want ${want.toFixed(4)}`);
}
const N = 1; // exact engine returns probabilities
const pMaxLE = (k, n) => (k / 6) ** n;
// P(side A with nA dice beats nB dice outright), P(tie)
function duel(nA, nB) {
  let win = 0, tie = 0;
  for (let a = 1; a <= 6; a++) {
    const pa = pMaxLE(a, nA) - pMaxLE(a - 1, nA);
    win += pa * pMaxLE(a - 1, nB);
    tie += pa * (pMaxLE(a, nB) - pMaxLE(a - 1, nB));
  }
  return { win, tie };
}
let r, d;
r = simulate({ a: side([M()]), b: side([M()]) }, N);
check('1v1 equal', r.wins[0] / N, 0.5);
d = duel(2, 1);
r = simulate({ a: side([M({ attacks: 2 })]), b: side([M()]) }, N);
check('2 dice vs 1, equal Fight', r.wins[0] / N, d.win + d.tie / 2);
r = simulate({ a: side([M({ attacks: 2, fight: 4 })]), b: side([M()]) }, N);
check('2 dice vs 1, A higher Fight', r.wins[0] / N, d.win + d.tie);
d = duel(1, 1);
r = simulate({ a: side([M({ elf: true })]), b: side([M()]) }, N);
check('elf weapon 1v1', r.wins[0] / N, d.win + d.tie * 4 / 6);
r = simulate({ a: side([M({ elf: true, shielding: true })]), b: side([M()]) }, N);
d = duel(2, 1);
check('elf model shielding loses elf edge', r.wins[0] / N, d.win + d.tie / 2);
check('shielding side never kills', r.kills[0], 0, 0);
r = simulate({ a: side([M(), M({ role: 'support', attacks: 3 })]), b: side([M({ shielding: true })]) }, N);
check('supporter adds 1 die (B shields: 2 dice)', r.wins[0] / N, duel(2, 2).win + duel(2, 2).tie / 2);
r = simulate({ a: side([M({ shielding: true }), M({ role: 'support' })]), b: side([M()]) }, N);
check('supported model cannot shield (2 dice not 3)', r.wins[0] / N, duel(2, 1).win + duel(2, 1).tie / 2);
// Two-handed: -1 except natural 6. A's die: 1->1, 2->1, 3->2, 4->3, 5->4, 6->6
{
  const a = [1, 1, 2, 3, 4, 6];
  let w = 0; for (const x of a) for (let b = 1; b <= 6; b++) w += (x > b ? 1 : x === b ? 0.5 : 0) / 36;
  r = simulate({ a: side([M({ twoHanded: true })]), b: side([M()]) }, N);
  check('two-handed duel', r.wins[0] / N, w);
}
// Kill chance: S3 vs D4 needs 5+ ; 1 strike, W1 -> P(win)*1/3
r = simulate({ a: side([M({ fight: 4 })]), b: side([M()]) }, N);
check('S3 vs D4 kill', r.kills[0] / N, (duel(1, 1).win + duel(1, 1).tie) / 3);
// 6/4 with two-handed -> 5+ then 3+ : (2/6)*(4/6)
r = simulate({ a: side([M({ fight: 9, strength: 1, twoHanded: true })]), b: side([M({ defence: 6 })]) }, N);
{ const win = 1 - (() => { let l = 0; const a = [1, 1, 2, 3, 4, 6]; for (const x of a) for (let b = 1; b <= 6; b++) l += (b > x) / 36; return l; })();
  check('6/4 + two-handed = 5+ then 3+', r.kills[0] / N, win * (2 / 6) * (4 / 6)); }
// Trapped: 2 strikes at 4+, W1 target: 1-(1/2)^2
r = simulate({ a: side([M({ fight: 9, attacks: 1 })]), b: side([M({ defence: 3 })], { trapped: true }) }, N);
check('trapped doubles strikes', r.kills[0] / r.wins[0], 0.75);
// Fate 1 on W1: one wound at 4+ (S3 v D3), fate saves half
r = simulate({ a: side([M({ fight: 9 })]), b: side([M({ defence: 3, fate: 1 })]) }, N);
check('fate 1 halves a single-wound kill', r.kills[0] / r.wins[0], 0.5 * 0.5);
// Banner with 1 die each, equal Fight. Exact: lose -> re-roll; tie -> re-roll only if it beats the roll-off odds.
function bannerExact(pTie) {
  let p = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const rr = (6 - b) / 6 + pTie / 6;
    p += (a > b ? 1 : a < b ? rr : Math.max(pTie, rr)) / 36;
  }
  return p;
}
r = simulate({ a: side([M()], { banner: true }), b: side([M()]) }, N);
check('banner, 1 die each', r.wins[0] / N, bannerExact(0.5));
r = simulate({ a: side([M({ elf: true })], { banner: true }), b: side([M()]) }, N);
check('banner + elf weapon, 1 die each', r.wins[0] / N, bannerExact(4 / 6));
r = simulate({ a: side([M()], { banner: true }), b: side([M({ elf: true })]) }, N);
check('banner vs elf weapon, 1 die each', r.wins[0] / N, bannerExact(2 / 6));
// 2 dice + banner, equal Fight: re-rolling a non-best die is free, so it's like a 3rd die
// whenever A isn't already winning. Exact by enumeration.
{ let p = 0;
  for (let a1 = 1; a1 <= 6; a1++) for (let a2 = 1; a2 <= 6; a2++) for (let b = 1; b <= 6; b++) {
    const m = Math.max(a1, a2);
    const keep = m > b ? 1 : m < b ? 0 : 0.5;
    let rr = 0; for (let x = 1; x <= 6; x++) { const m2 = Math.max(m, x); rr += (m2 > b ? 1 : m2 < b ? 0 : 0.5) / 6; }
    p += (keep === 1 ? 1 : Math.max(keep, rr)) / 216;
  }
  r = simulate({ a: side([M({ attacks: 2 })], { banner: true }), b: side([M()]) }, N);
  check('banner, 2 dice vs 1', r.wins[0] / N, p); }
// Both sides with banners, 1 die each, equal Fight: symmetric -> 50%
r = simulate({ a: side([M()], { banner: true }), b: side([M()], { banner: true }) }, N);
check('both banners, 1 die each', r.wins[0] / N, 0.5);
check('wound chart S4 vs D9 = 6/4', +(JSON.stringify(woundNeed(4, 9)) === '[6,4]'), 1, 0);
check('wound chart S1 vs D9 = none', +(woundNeed(1, 9) === null), 1, 0);
// Random matchups: exact engine vs simulator (should agree within simulation noise).
{
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const rm = sup => ({ role: sup ? 'support' : 'front', fight: 2 + rnd(6), attacks: 1 + rnd(3), strength: 2 + rnd(5),
    defence: 3 + rnd(5), wounds: 1 + rnd(3), fate: rnd(3), duelMod: rnd(5) ? 0 : 1, woundMod: rnd(5) ? 0 : -1,
    twoHanded: !rnd(3), shielding: !rnd(4), elf: !rnd(4) });
  const rs = () => ({ models: [rm(false), ...(rnd(2) ? [rm(false)] : []), ...(rnd(3) ? [] : [rm(true)])],
    target: 0, banner: !rnd(2), trapped: !rnd(3) });
  let worst = 0;
  for (let k = 0; k < 40; k++) {
    const input = { a: rs(), b: rs() };
    const e = calculate(input), s = sim.simulate(input, 200000, 1000 + k);
    const pairs = [[e.wins[0], s.wins[0] / s.runs], [e.kills[0], s.kills[0] / s.runs], [e.kills[1], s.kills[1] / s.runs],
      [e.tieRoll, s.tieRoll / s.runs], ...e.dist[0].map((v, j) => [v, s.dist[0][j] / s.runs]), ...e.dist[1].map((v, j) => [v, s.dist[1][j] / s.runs])];
    for (const [x, y] of pairs) worst = Math.max(worst, Math.abs(x - y));
  }
  check('40 random matchups: biggest gap to simulator', worst, 0, 0.006);
}
// Side-level Fight overrides per-model Fight
{ const r2 = calculate({ a: { models: [M({ fight: 3 })], fight: 6 }, b: { models: [M({ fight: 5 })], fight: 4 } });
  const d2 = duel(1, 1);
  check('side Fight value used for ties', r2.wins[0], d2.win + d2.tie); }
// Strike plan with several enemy models. Numbers are divided by A's chance to win the duel.
{ const one = (o) => calculate({ a: { models: [M({ attacks: 2, ...o })], fight: 9 }, b: { models: [M(), M()], fight: 1, ...(o.trapB || {}) } });
  const cond = r => r.strikes[0].killsDist.map(x => x / r.wins[0]);
  let k = cond(one({}));
  check('A2 at 5+ vs two W1: splits, kills both', k[2], 1 / 9);
  check('A2 at 5+ vs two W1: kills exactly one', k[1], 4 / 9);
  k = cond(calculate({ a: { models: [M({ attacks: 1 })], fight: 9 }, b: { models: [M(), M()], fight: 1, trapped: true } }));
  check('trapped: doubled pair stays on one target (never kills 2)', k[2], 0);
  check('trapped: pair kills one', k[1], 1 - (2 / 3) ** 2);
  // Strong striker S6 (3+ vs D4) and weak S3 (5+ vs D4), two W1 enemies. Adaptive best play:
  // whatever order, each enemy gets hit by one; value can be checked by brute force.
  const r3 = calculate({ a: { models: [M({ strength: 6 }), M({ strength: 3 })], fight: 9 }, b: { models: [M(), M()], fight: 1 } });
  const k3 = cond(r3), e = k3[1] + 2 * k3[2];
  check('S6 + S3 one strike each vs two W1: expected kills', e, 2 / 3 + 1 / 3); }
console.log(fails ? `${fails} FAILED` : 'all passed');
