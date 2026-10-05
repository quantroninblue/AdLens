export const metricKeys = ['hook', 'clarity', 'audience', 'emotion', 'visual', 'cta'] as const;
export type MetricKey = typeof metricKeys[number];
export const metricLabels: Record<MetricKey, string> = {
  hook: 'Hook strength', clarity: 'Message clarity', audience: 'Audience relevance',
  emotion: 'Emotional appeal', visual: 'Visual quality', cta: 'Call to action',
};
