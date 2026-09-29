// Tenkai-Oh's first-person hammer (FirstPerson.ts FP_HAMMER): the keyed haft poses must line up with the gameplay clock
// (the hit lands 0.24 s into a 0.96 s swing), chain without jumps (swing -> hold -> next swing / recovery) and come home.
import { FP_HAMMER as FH, FP_STYLE } from '../../src/render/FirstPerson';
import { HERO } from '../../src/data/heroes';

type K = number[];
const near = (a: K, b: K, eps = 1e-6) => a.slice(1).every((x, i) => Math.abs(x - b[i + 1]) < eps);

describe('first-person hammer choreography', () => {
  const sets: Record<string, K[]> = { SWING_RL: FH.SWING_RL, SWING_LR: FH.SWING_LR, RECOVER: FH.RECOVER, SHATTER: FH.SHATTER, JAB: FH.JAB, RAISE: FH.RAISE };

  it('keys run forward in time', () => {
    for (const [n, K] of Object.entries(sets)) for (let i = 1; i < K.length; i++) expect([n, i, K[i][0] > K[i - 1][0]]).toEqual([n, i, true]);
  });

  it('the head crosses the reticle on the hit (0.24 s after the button, as the damage)', () => {
    const delay = (HERO.tenkai.primary as { delay?: number }).delay ?? 0.24;
    for (const K of [FH.SWING_RL, FH.SWING_LR]) {
      // haft yaw 0 = straight ahead: the crossing sits within a frame or two of the damage
      let tc = -1;
      for (let t = 0.1; t < 0.4; t += 0.002) if (Math.sign(FH.at(K, t)[4]) !== Math.sign(FH.at(K, t + 0.002)[4])) { tc = t; break; }
      expect(Math.abs(tc - delay)).toBeLessThan(0.03);
      // and it's up in the middle of the view when it does (pitch up, the head above the grip)
      expect(FH.at(K, tc)[5]).toBeGreaterThan(0.2);
    }
  });

  it('swings chain: right-to-left ends on the hold the left-to-right starts from, and the recovery picks it up', () => {
    const endRL = FH.SWING_RL[FH.SWING_RL.length - 1];
    expect(near(endRL, FH.SWING_LR[0])).toBe(true);
    expect(near(endRL, FH.RECOVER[0])).toBe(true);
    expect(FH.RECOVER[0][0]).toBeCloseTo(endRL[0]);
    // the swing's own clock: hold until the next 0.96 s swing
    expect(endRL[0]).toBeCloseTo(0.96);
  });

  it('every move starts and ends in the rest pose, which is the viewmodel style', () => {
    for (const K of [FH.SWING_LR, FH.RECOVER, FH.SHATTER, FH.JAB, FH.RAISE]) expect(near(K[K.length - 1], FH.REST)).toBe(true);
    for (const K of [FH.SWING_RL, FH.SHATTER, FH.JAB, FH.RAISE]) expect(near(K[0], FH.REST)).toBe(true);
    const st = FP_STYLE.tenkai, R = FH.REST, H = FH.dir(R as never);
    expect(st.R).toEqual([R[1], R[2], R[3]]);
    st.L!.forEach((x, i) => expect(x).toBeCloseTo(st.R[i] + H[i] * R[6], 2));
  });
});
