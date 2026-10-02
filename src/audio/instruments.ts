/**
 * Tiny synthesized UI sound. The score and battle effects are pre-rendered samples
 * (src/audio/assets, built by tools/audio/build_assets.py) — see engine.ts.
 */
export interface Out {
  dest: AudioNode;
}

/** Short soft blip confirming the sound toggle. */
export function click(ctx: BaseAudioContext, out: Out, t: number) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(out.dest);
  o.start(t);
  o.stop(t + 0.08);
}
