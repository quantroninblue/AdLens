export const metricKeys = ['hook', 'retention', 'emotion', 'visual', 'audio', 'clarity', 'shareability', 'cta', 'audience'] as const;
export type MetricKey = typeof metricKeys[number];
export const metricLabels: Record<MetricKey, string> = {
  hook: 'Hook strength', retention: 'Pacing & retention', emotion: 'Emotional pull', visual: 'Visual quality',
  audio: 'Sound & speech', clarity: 'Message clarity', shareability: 'Shareability', cta: 'Call to action', audience: 'Audience fit',
};
// Fixed project heuristics for the content score. Missing dimensions are renormalized away.
export const metricWeights: Record<MetricKey, number> = {
  hook: .2, retention: .15, emotion: .12, visual: .1, audio: .08, clarity: .1, shareability: .12, cta: .05, audience: .08,
};
