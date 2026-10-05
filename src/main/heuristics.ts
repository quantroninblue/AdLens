import type { AnalysisInput, Assessment, MetricKey } from '../shared/schema';

// Transparent English-language copy checks, deliberately limited to observable text.
export function assessCopy(input: AnalysisInput, transcript = ''): Assessment {
  const text = [input.text.trim(), transcript.trim()].filter(Boolean).join('\n');
  const words = text.match(/[\p{L}\p{N}’'-]+/gu) ?? [];
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim());
  const opening = sentences[0] ?? '';
  const cta = /\b(shop|buy|try|join|subscribe|sign up|book|download|learn more|visit|order|discover|start|get yours|save this|follow)\b/i.exec(text);
  const concrete = /\d|\b(save|minutes|hours|days|free|without|less|faster)\b/i.test(opening);
  const audienceTerms = [...new Set((input.audience.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !['people', 'with', 'that', 'want', 'their', 'interested', 'looking'].includes(w)))];
  const matches = audienceTerms.filter(term => text.toLowerCase().includes(term));
  const metrics: Assessment['metrics'] = Object.fromEntries(['hook', 'clarity', 'audience', 'emotion', 'visual', 'cta'].map(k => [k, {score: null, evidence: 'Not assessed from the available evidence.'}])) as Assessment['metrics'];
  metrics.visual.evidence = 'Requires a successful visual provider. File properties alone do not establish visual quality.';
  metrics.emotion.evidence = 'Emotional appeal requires contextual interpretation; keyword counts are insufficient.';
  metrics.audience.evidence = input.audience ? 'Audience fit cannot be established by copy rules alone.' : 'No target audience supplied.';
  if (!words.length) return {summary: 'Asset details are recorded. Connect media analysis and reasoning to assess its content.', metrics, strengths: [], weaknesses: [], recommendations: [{title: 'Connect content analysis', detail: 'Configure remote media and reasoning endpoints in Connections, then analyze this asset again.'}]};
  const sentenceLength = words.length / Math.max(1, sentences.length);
  metrics.hook = {score: Math.min(85, 30 + (opening.split(/\s+/).length <= 14 ? 20 : 0) + (concrete ? 20 : 0) + (/\?/.test(text.slice(0, opening.length + 1)) ? 15 : 0)), evidence: `Opening: “${opening.slice(0, 180)}”. ${concrete ? 'Contains a number or a concrete benefit cue.' : 'No numeric or concrete benefit cue detected.'} This is a copy rule, not an attention measurement.`};
  metrics.clarity = {score: Math.max(20, Math.min(85, Math.round(90 - Math.max(0, sentenceLength - 12) * 2 - (words.length < 5 ? 25 : 0)))), evidence: `${words.length} words across ${sentences.length} sentence(s), averaging ${Math.round(sentenceLength)} words per sentence. Readability proxy only; factual clarity is unverified.`};
  metrics.cta = {score: cta ? 75 : 25, evidence: cta ? `Action phrase detected: “${cta[0]}”. Placement, destination, and conversion effectiveness are unverified.` : 'No explicit action phrase detected in the supplied copy.'};
  const strengths = [sentenceLength <= 18 ? 'The copy uses relatively short sentences.' : '', concrete ? 'The opening includes a concrete benefit cue.' : '', cta ? 'An explicit next action appears in the copy.' : ''].filter(Boolean);
  const weaknesses = [!cta ? 'The copy does not state a clear next action.' : '', !concrete ? 'The opening could make the benefit more specific.' : '', sentenceLength > 18 ? 'Long sentences may make the copy harder to scan.' : ''].filter(Boolean);
  const recommendations = [];
  if (!cta) recommendations.push({title: 'Give the reader a next step', detail: 'Add one action tied to the offer, such as “Book a demo” or “Try it free”, and a clear destination.'});
  if (!concrete) recommendations.push({title: 'Make the opening specific', detail: 'Lead with a verifiable outcome, a recognizable problem, or a concrete product benefit. Avoid inventing performance claims.'});
  if (sentenceLength > 18) recommendations.push({title: 'Shorten the sentences', detail: 'Separate the benefit, supporting detail, and action so each can be read independently.'});
  if (audienceTerms.length) recommendations.push({title: 'Check the audience fit', detail: matches.length ? `The copy shares these terms with your brief: ${matches.join(', ')}. Confirm that the benefit addresses the audience’s actual needs.` : 'Connect the product benefit to the needs in your audience brief; shared vocabulary alone would not prove relevance.'});
  if (!recommendations.length) recommendations.push({title: 'Test the opening and CTA', detail: 'Compare two variations with your intended audience. These rules cannot establish which version performs better.'});
  return {summary: 'A limited copy assessment based on sentence length, opening cues, and explicit calls to action.', metrics, strengths, weaknesses, recommendations};
}

export function fuse(metrics: Assessment['metrics'], weights: Record<MetricKey, number>, neural?: {score: number; weight: number}) {
  const usable = (Object.keys(metrics) as MetricKey[]).filter(k => metrics[k].score !== null && weights[k] > 0);
  const total = usable.reduce((sum, k) => sum + weights[k], 0);
  if (!total) return {overall: null, engagement: null, contributions: {}};
  const overall = Math.round(usable.reduce((sum, k) => sum + metrics[k].score! * weights[k] / total, 0));
  const neuralWeight = neural?.weight ?? 0;
  const contributions: Record<string, number> = Object.fromEntries(usable.map(k => [k, weights[k] / total * (1 - neuralWeight)]));
  if (neural && neuralWeight) contributions.tribe = neuralWeight;
  return {overall, engagement: Math.round(overall * (1 - neuralWeight) + (neural?.score ?? 0) * neuralWeight), contributions};
}
