// MESBG fight SIMULATOR (dice rolled at random). Only used by test.js to cross-check engine.js.
(function (root) {
  'use strict';

  // Seeded RNG so the same inputs always give the same numbers.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Wound chart: [first roll, second roll or 0], or null if it can't wound.
  function woundNeed(S, D) {
    const d = D - S;
    if (d <= -2) return [3, 0];
    if (d <= 0) return [4, 0];
    if (d <= 2) return [5, 0];
    if (d <= 4) return [6, 0];
    if (d === 5) return [6, 4];
    if (d === 6) return [6, 5];
    if (d === 7) return [6, 6];
    return null;
  }
  // What the striker actually needs on the dice after its wound modifier.
  function needLabel(need, mod) {
    if (!need) return "can't wound";
    const f = t => (t - mod > 6 ? 'X' : `${Math.max(2, t - mod)}+`);
    return need[1] ? `${f(need[0])} then ${f(need[1])}` : f(need[0]);
  }

  const num = (v, d = 0) => (v !== '' && Number.isFinite(+v) ? +v : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function prep(side) {
    const models = side.models.map(m => {
      const support = m.role === 'support';
      return {
        support,
        fight: num(m.fight, 3),
        dice: support ? 1 : Math.max(0, num(m.attacks, 1)),   // supporters add 1 die
        strikes: support ? 1 : Math.max(0, num(m.attacks, 1)), // ...and 1 strike
        strength: num(m.strength, 3), defence: num(m.defence, 4),
        wounds: Math.max(1, num(m.wounds, 1)), fate: Math.max(0, num(m.fate)),
        duelMod: num(m.duelMod) - (m.twoHanded ? 1 : 0),
        woundMod: num(m.woundMod) + (m.twoHanded ? 1 : 0),
        elf: !!m.elf, shield: !!m.shielding,
      };
    });
    const supported = models.some(m => m.support);
    for (const m of models) {
      m.shielding = m.shield && !m.support && !supported; // can't shield while supported
      if (m.shielding) m.dice *= 2;
    }
    const front = models.filter(m => !m.support);
    const target = front[clamp(num(side.target), 0, Math.max(0, front.length - 1))] || models[0];
    return {
      models, target, trapped: !!side.trapped, banner: !!side.banner,
      fight: Math.max(...models.map(m => m.fight)),
      elf: models.some(m => m.elf && !m.shielding), // shielding loses the elf tie-break
    };
  }

  function simulate(input, runs = 100000, seed = 12345) {
    const R = rng(seed);
    const d6 = () => 1 + Math.floor(R() * 6);
    const S = [prep(input.a), prep(input.b)];
    // Two-handed (or any minus): a natural 6 stays a 6.
    const score = (raw, mod) => (raw === 6 && mod < 0) ? 6 : clamp(raw + mod, 1, 6);

    const out = {
      runs, wins: [0, 0], kills: [0, 0], tieFight: 0, tieRoll: 0,
      dist: [[], []], // dist[side][w] = fights this side won dealing exactly w wounds
      needs: [0, 1].map(i => S[i].models.map(m =>
        m.shielding ? 'shielding — no strikes' : needLabel(woundNeed(m.strength, S[1 - i].target.defence), m.woundMod))),
      shieldBlocked: [0, 1].map(i => S[i].models.some(m => m.shield && !m.shielding && !m.support)),
    };
    for (const i of [0, 1]) out.dist[i] = new Array(S[1 - i].target.wounds + 1).fill(0);

    // Roll-off when duel dice and Fight are both tied: 50/50, or 4-in-6 for the elf-weapon side.
    const elfEdge = S[0].elf === S[1].elf ? 0.5 : (S[0].elf ? 4 / 6 : 2 / 6);

    // --- Banner decisions -------------------------------------------------
    const bestOf = side => side.reduce((b, x) => Math.max(b, x.s), 0);
    // Chance side 0 wins if nobody re-rolls any more (roll-off counted as odds).
    const p0 = d => {
      const a = bestOf(d[0]), b = bestOf(d[1]);
      if (a !== b) return a > b ? 1 : 0;
      if (S[0].fight !== S[1].fight) return S[0].fight > S[1].fight ? 1 : 0;
      return elfEdge;
    };
    // Which die to re-roll: with 2+ dice, any die except one copy of the best
    // (pick the one with the best modifier); with 1 die, that die.
    const pickDie = side => {
      if (side.length === 1) return 0;
      let top = 0;
      side.forEach((x, k) => { if (x.s > side[top].s || (x.s === side[top].s && x.mod < side[top].mod)) top = k; }); // keep the worse copy of the best
      let pick = -1;
      side.forEach((x, k) => { if (k !== top && (pick < 0 || x.mod > side[pick].mod)) pick = k; });
      return pick;
    };
    // Sides that could still use a banner and aren't already certain to win, priority first.
    const actors = (d, used, passed, prio) => [prio, 1 - prio].filter(i =>
      S[i].banner && !used[i] && !passed[i] && d[i].length && (i === 0 ? p0(d) < 1 : p0(d) > 0));
    const withDie = (d, i, k, s) => { const n = [d[0].slice(), d[1].slice()]; n[i][k] = { s, mod: d[i][k].mod }; return n; };
    // Exact value (chance side 0 wins) with both sides choosing well from here on.
    // Everything that matters for a banner decision: each side's best score,
    // whether it has a spare die, and the modifier on the die it would re-roll.
    const memo = new Map();
    const key = (d, used, passed, prio) => [0, 1].map(i => {
      const sd = d[i]; if (!sd.length) return '-';
      return `${bestOf(sd)},${sd.length > 1 ? 1 : 0},${sd[pickDie(sd)].mod},${used[i] ? 1 : 0},${passed[i] ? 1 : 0}`;
    }).join('|') + '|' + prio;
    function V(d, used, passed, prio) {
      const kk = key(d, used, passed, prio);
      if (memo.has(kk)) return memo.get(kk);
      const v = V0(d, used, passed, prio);
      memo.set(kk, v);
      return v;
    }
    function V0(d, used, passed, prio) {
      const act = actors(d, used, passed, prio);
      if (!act.length) return p0(d);
      const c = act[0];
      const keep = V(d, used, { ...passed, [c]: true }, prio);
      const rr = reroll(d, used, c, prio);
      return c === 0 ? Math.max(keep, rr) : Math.min(keep, rr);
    }
    function reroll(d, used, c, prio) {
      const k = pickDie(d[c]); let sum = 0;
      for (let raw = 1; raw <= 6; raw++)
        sum += V(withDie(d, c, k, score(raw, d[c][k].mod)), { ...used, [c]: true }, {}, prio);
      return sum / 6;
    }
    function playBanners(dice, prio, d6) {
      let d = dice, used = {}, passed = {};
      for (;;) {
        const act = actors(d, used, passed, prio);
        if (!act.length) break;
        const c = act[0];
        const dk = 'go|' + key(d, used, passed, prio);
        let go = memo.get(dk);
        if (go === undefined) {
          const keep = V(d, used, { ...passed, [c]: true }, prio);
          const rr = reroll(d, used, c, prio);
          go = c === 0 ? rr > keep + 1e-12 : rr < keep - 1e-12;
          memo.set(dk, go);
        }
        if (go) {
          const k = pickDie(d[c]);
          d = withDie(d, c, k, score(d6(), d[c][k].mod));
          used = { ...used, [c]: true }; passed = {};
        } else passed = { ...passed, [c]: true };
      }
      dice[0] = d[0]; dice[1] = d[1];
    }

    for (let r = 0; r < runs; r++) {
      const dice = [[], []];
      for (const i of [0, 1]) for (const m of S[i].models)
        for (let k = 0; k < m.dice; k++) dice[i].push({ s: score(d6(), m.duelMod), mod: m.duelMod });
      const best = i => dice[i].reduce((b, x) => Math.max(b, x.s), 0);
      const rollOff = R() < elfEdge ? 0 : 1; // drawn up front, used only on a full tie
      const winner = () => {
        const a = best(0), b = best(1);
        if (a !== b) return a > b ? 0 : 1;
        if (S[0].fight !== S[1].fight) return S[0].fight > S[1].fight ? 0 : 1;
        return rollOff;
      };

      // Banner: each side may re-roll one die once. Choices are made by working out
      // the odds both ways (keep vs re-roll), never by peeking at the roll-off.
      if (S[0].banner || S[1].banner) playBanners(dice, R() < 0.5 ? 0 : 1, d6);

      const W = winner(), Lo = 1 - W;
      out.wins[W]++;
      if (best(0) === best(1)) { if (S[0].fight !== S[1].fight) out.tieFight++; else out.tieRoll++; }

      // Strikes at the loser's chosen target. Trapped loser = double strikes.
      const tgt = S[Lo].target, mult = S[Lo].trapped ? 2 : 1;
      let wounds = 0;
      for (const m of S[W].models) {
        if (m.shielding) continue;
        const need = woundNeed(m.strength, tgt.defence);
        if (!need) continue;
        for (let k = 0; k < m.strikes * mult; k++) {
          let ok = true;
          for (const t of need) {
            if (!t) break;
            const roll = d6();
            if (roll === 1 || roll + m.woundMod < t) { ok = false; break; } // modifier applies to both parts
          }
          if (ok) wounds++;
        }
      }

      // Fate: one roll per Fate point, 4+ saves that wound.
      let fate = tgt.fate, taken = 0;
      for (let k = 0; k < wounds && taken < tgt.wounds; k++) {
        let saved = false;
        while (fate > 0 && !saved) { fate--; saved = d6() >= 4; }
        if (!saved) taken++;
      }
      out.dist[W][taken]++;
      if (taken >= tgt.wounds) out.kills[W]++;
    }
    return out;
  }

  const api = { simulate, woundNeed, needLabel };
  if (typeof module !== 'undefined') module.exports = api; else root.MESBG_SIM = api;
})(this);
