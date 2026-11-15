// MESBG (2024 edition) fight calculator — exact odds, no random rolls.
// Browser: window.MESBG.calculate(input). Node: require('./engine').calculate(input).
// Result shape matches sim.js with runs = 1, so every number is a probability.
(function (root) {
  'use strict';

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
  // Two-handed (or any minus): a natural 6 stays a 6.
  const score = (raw, mod) => (raw === 6 && mod < 0) ? 6 : clamp(raw + mod, 1, 6);

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
      models, front: front.length ? front : [models[0]], target, trapped: !!side.trapped, banner: !!side.banner,
      // One Fight value per side (the highest anyone has). Older inputs give it per model.
      fight: side.fight !== undefined && side.fight !== '' ? num(side.fight, 3) : Math.max(...models.map(m => m.fight)),
      elf: models.some(m => m.elf && !m.shielding), // shielding loses the elf tie-break
    };
  }

  // ---- Duel roll ----------------------------------------------------------
  // A side's roll boils down to: its best score, and which die it would re-roll
  // with a banner. With 2+ dice that's the spare die with the best modifier
  // (re-rolling it can't lower the best). With 1 die it's that die.
  // Built die by die; state "best|bestMod|spareMod" (spareMod 'n' = no spare yet).
  function sideStates(side) {
    let st = new Map([['0|0|n', 1]]);
    let count = 0;
    for (const m of side.models) for (let k = 0; k < m.dice; k++) {
      count++;
      const next = new Map();
      for (const [key, p] of st) {
        const [b, mb, ms] = key.split('|');
        const best = +b, bestMod = +mb, spare = ms === 'n' ? null : +ms;
        for (let raw = 1; raw <= 6; raw++) {
          const x = score(raw, m.duelMod);
          let nb, nmb, nms;
          const mx = (a, c) => (a === null ? c : Math.max(a, c));
          if (count === 1) { nb = x; nmb = m.duelMod; nms = null; }
          else if (x > best) { nb = x; nmb = m.duelMod; nms = mx(spare, bestMod); }
          else if (x < best) { nb = best; nmb = bestMod; nms = mx(spare, m.duelMod); }
          else { nb = best; nmb = Math.min(bestMod, m.duelMod); nms = mx(spare, Math.max(bestMod, m.duelMod)); }
          const nk = `${nb}|${nmb}|${nms === null ? 'n' : nms}`;
          next.set(nk, (next.get(nk) || 0) + p / 6);
        }
      }
      st = next;
    }
    // Final form: {best, single, rm (mod of the die a banner re-rolls), p}
    return [...st].map(([key, p]) => {
      const [b, mb, ms] = key.split('|');
      return ms === 'n' ? { best: +b, single: count === 1, rm: +mb, p, none: count === 0 }
                        : { best: +b, single: false, rm: +ms, p };
    });
  }

  function duel(S) {
    // Roll-off when duel dice and Fight are both tied: 50/50, or 4-in-6 for the elf side.
    const elfEdge = S[0].elf === S[1].elf ? 0.5 : (S[0].elf ? 4 / 6 : 2 / 6);
    // Outcome with no more re-rolls: [P(side 0 wins), P(tie settled by Fight), P(roll-off)]
    const settle = (a, b) => {
      if (a.best !== b.best) return [a.best > b.best ? 1 : 0, 0, 0];
      if (S[0].fight !== S[1].fight) return [S[0].fight > S[1].fight ? 1 : 0, 1, 0];
      return [elfEdge, 0, 1];
    };
    const canAct = (i, st, used, passed, w) => S[i].banner && !used[i] && !passed[i] && !st[i].none &&
      (i === 0 ? w < 1 : w > 0); // a side already certain to win doesn't re-roll
    const memo = new Map();
    // Value of a position when both sides use banners well. Side 0 maximises its
    // chance to win, side 1 minimises it. prio = who chooses first on a full tie.
    function V(st, used, passed, prio) {
      const key = `${st[0].best},${st[0].single},${st[0].rm}|${st[1].best},${st[1].single},${st[1].rm}|${+!!used[0]}${+!!used[1]}${+!!passed[0]}${+!!passed[1]}${prio}`;
      if (memo.has(key)) return memo.get(key);
      const base = settle(st[0], st[1]);
      const c = [prio, 1 - prio].find(i => canAct(i, st, used, passed, base[0]));
      let res = base;
      if (c !== undefined) {
        const keep = V(st, used, { ...passed, [c]: true }, prio);
        const rr = [0, 0, 0];
        for (let raw = 1; raw <= 6; raw++) {
          const x = score(raw, st[c].rm);
          const ns = st.slice();
          ns[c] = { ...st[c], best: st[c].single ? x : Math.max(st[c].best, x) };
          const v = V(ns, { ...used, [c]: true }, {}, prio);
          for (let j = 0; j < 3; j++) rr[j] += v[j] / 6;
        }
        const better = c === 0 ? rr[0] > keep[0] + 1e-12 : rr[0] < keep[0] - 1e-12;
        res = better ? rr : keep;
      }
      memo.set(key, res);
      return res;
    }
    const A = sideStates(S[0]), B = sideStates(S[1]);
    const out = [0, 0, 0];
    for (const a of A) for (const b of B) for (const prio of [0, 1]) {
      const v = V([a, b], {}, {}, prio), p = a.p * b.p / 2;
      for (let j = 0; j < 3; j++) out[j] += v[j] * p;
    }
    return { win0: out[0], tieFight: out[1], tieRoll: out[2] };
  }

  // ---- Strikes and Fate -----------------------------------------------------
  // Chance one strike wounds: a 1 always fails; the modifier applies to both rolls.
  function strikeChance(need, mod) {
    if (!need) return 0;
    let p = 1;
    for (const t of need) {
      if (!t) break;
      let ok = 0;
      for (let raw = 2; raw <= 6; raw++) if (raw + mod >= t) ok++;
      p *= ok / 6;
    }
    return p;
  }
  // Distribution of unsaved wounds (capped at the target's Wounds) when side W wins.
  function woundDist(W, Lo, tgt = Lo.target) {
    const mult = Lo.trapped ? 2 : 1;
    let hits = [1]; // hits[k] = P(k successful strikes)
    for (const m of W.models) {
      if (m.shielding) continue;
      const p = strikeChance(woundNeed(m.strength, tgt.defence), m.woundMod);
      for (let k = 0; k < m.strikes * mult; k++) {
        const next = new Array(hits.length + 1).fill(0);
        hits.forEach((q, j) => { next[j] += q * (1 - p); next[j + 1] += q * p; });
        hits = next;
      }
    }
    // Fate: each wound may be saved on a 4+, one roll per Fate point, until none left.
    const dist = new Array(tgt.wounds + 1).fill(0);
    hits.forEach((q, k) => {
      if (!q) return;
      // state[fateLeft][taken]
      let st = new Map([[`${tgt.fate}|0`, 1]]);
      for (let w = 0; w < k; w++) {
        const next = new Map();
        const add = (f, t, v) => { const kk = `${f}|${t}`; next.set(kk, (next.get(kk) || 0) + v); };
        for (const [key, v] of st) {
          const [f, t] = key.split('|').map(Number);
          if (t >= tgt.wounds) { add(f, t, v); continue; } // already dead
          for (let j = 1; j <= f; j++) add(f - j, t, v * 0.5 ** j); // saved on the j-th roll
          add(0, t + 1, v * 0.5 ** f);                             // not saved
        }
        st = next;
      }
      for (const [key, v] of st) dist[+key.split('|')[1]] += q * v;
    });
    return dist;
  }

  // ---- Strikes in list order ------------------------------------------------
  // The winner's models strike top to bottom of their list, one strike at a time
  // (a doubled strike is a pair, rolled together at the same target). Every strike
  // goes at the top enemy front model that's still alive. So at any moment only one
  // enemy can be partly wounded: state = [current target, wounds on it, its Fate left].
  function strikePhase(Wside, Lo) {
    const mult = Lo.trapped ? 2 : 1, T = Lo.front, nT = T.length;
    // afterWounds(j, taken, fate, k) -> [[taken, fate, prob]...]
    function afterWounds(j, taken, fate, k) {
      let st = new Map([[`${taken},${fate}`, 1]]);
      for (let w = 0; w < k; w++) {
        const next = new Map();
        const add = (t, f, v) => { const kk = `${t},${f}`; next.set(kk, (next.get(kk) || 0) + v); };
        for (const [kk, v] of st) {
          const [t, f] = kk.split(',').map(Number);
          if (t >= T[j].wounds) { add(t, f, v); continue; } // already dead: extra wounds wasted
          for (let i = 1; i <= f; i++) add(t, f - i, v * 0.5 ** i); // saved on the i-th Fate roll
          add(t + 1, 0, v * 0.5 ** f);                              // not saved
        }
        st = next;
      }
      return [...st].map(([kk, v]) => [...kk.split(',').map(Number), v]);
    }
    // state key "j,taken,fate" -> probability
    let st = new Map([[`0,0,${nT ? T[0].fate : 0}`, 1]]);
    const add = (m, j, t, f, v) => { const k = `${j},${t},${f}`; m.set(k, (m.get(k) || 0) + v); };
    for (const m of Wside.models) {
      if (m.shielding) continue;
      for (let u = 0; u < m.strikes; u++) {
        const next = new Map();
        for (const [key, v] of st) {
          const [j, taken, fate] = key.split(',').map(Number);
          if (j >= nT) { add(next, j, taken, fate, v); continue; } // everyone is dead
          const p = strikeChance(woundNeed(m.strength, T[j].defence), m.woundMod);
          for (let h = 0; h <= mult; h++) {
            const ph = (mult === 2 ? [1, 2, 1][h] : 1) * p ** h * (1 - p) ** (mult - h);
            if (!ph) continue;
            for (const [t2, f2, q] of afterWounds(j, taken, fate, h)) {
              if (t2 >= T[j].wounds) add(next, j + 1, 0, j + 1 < nT ? T[j + 1].fate : 0, v * ph * q); // dead: move on
              else add(next, j, t2, f2, v * ph * q);
            }
          }
        }
        st = next;
      }
    }
    const killsDist = new Array(nT + 1).fill(0);
    const perTarget = T.map(t => new Array(t.wounds + 1).fill(0));
    for (const [key, v] of st) {
      const [j, taken] = key.split(',').map(Number);
      killsDist[j] += v;
      T.forEach((t, x) => { perTarget[x][x < j ? t.wounds : x === j ? taken : 0] += v; });
    }
    return { killsDist, perTarget };
  }

  function calculate(input) {
    const S = [prep(input.a), prep(input.b)];
    const d = duel(S);
    const wins = [d.win0, 1 - d.win0];
    const dist = [0, 1].map(i => woundDist(S[i], S[1 - i]).map(p => p * wins[i]));
    // Strikes in list order, scaled by the chance of winning.
    const strikes = [0, 1].map(i => {
      const sp = strikePhase(S[i], S[1 - i]);
      return {
        killsDist: sp.killsDist.map(p => p * wins[i]),     // [won & killed none, killed 1, ...]
        perTarget: sp.perTarget.map(x => x.map(p => p * wins[i])), // [model][wounds taken]
      };
    });
    return {
      runs: 1, wins, tieFight: d.tieFight, tieRoll: d.tieRoll, dist, strikes,
      kills: dist.map(x => x[x.length - 1]),
      // needs[side][model][enemy front model] = what it needs to wound
      needs: [0, 1].map(i => S[i].models.map(m => S[1 - i].front.map(t =>
        m.shielding ? 'shielding' : needLabel(woundNeed(m.strength, t.defence), m.woundMod)))),
      shieldBlocked: [0, 1].map(i => S[i].models.some(m => m.shield && !m.shielding && !m.support)),
    };
  }

  const api = { calculate, woundNeed, needLabel };
  if (typeof module !== 'undefined') module.exports = api; else root.MESBG = api;
})(this);
