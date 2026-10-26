import { metricKeys, metricWeights, type AnalysisInput, type Assessment, type MetricKey } from '../shared/schema';

// Transparent English-language copy checks, used only when no language model is connected.
export function assessCopy(input: Pick<AnalysisInput, 'text' | 'audience'>, transcript = ''): Assessment {
  const text = [input.text.trim(), transcript.trim()].filter(Boolean).join('\n');
  const words = text.match(/[\p{L}\p{N}’'-]+/gu) ?? [];
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim());
  const opening = sentences[0] ?? '';
  const cta = /\b(shop|buy|try|join|subscribe|sign up|book|download|learn more|visit|order|discover|start|get yours|save this|follow|link in bio|comment)\b/i.exec(text);
  const concrete = /\d|\b(save|minutes|hours|days|free|without|less|faster)\b/i.test(opening);
  const metrics = Object.fromEntries(metricKeys.map(k => [k, {score: null, evidence: 'Needs a connected language model; copy rules cannot assess this.'}])) as Assessment['metrics'];
  metrics.visual.evidence = 'Needs a language model that can see the sampled frames.';
  metrics.audience.evidence = input.audience?.trim() ? 'Audience fit cannot be established by copy rules alone.' : 'No target audience supplied.';
  const virality: Assessment['virality'] = {score: null, band: null, confidence: 'low', rationale: 'Virality potential needs a connected language model. Copy rules alone cannot estimate it.'};
  if (!words.length) return {summary: 'Files are recorded. Connect a language model in Connections to assess them.', virality, metrics, neuralReading: null, strengths: [], weaknesses: [],
    recommendations: [{title: 'Connect a language model', detail: 'Choose Ollama, your ChatGPT or Claude account, or an API key in Connections, then analyze again.'}]};
  const sentenceLength = words.length / Math.max(1, sentences.length);
  metrics.hook = {score: Math.min(85, 30 + (opening.split(/\s+/).length <= 14 ? 20 : 0) + (concrete ? 20 : 0) + (/\?/.test(text.slice(0, opening.length + 1)) ? 15 : 0)), evidence: `Opening: “${opening.slice(0, 180)}”. ${concrete ? 'Contains a number or a concrete benefit cue.' : 'No numeric or concrete benefit cue detected.'} This is a copy rule, not an attention measurement.`};
  metrics.clarity = {score: Math.max(20, Math.min(85, Math.round(90 - Math.max(0, sentenceLength - 12) * 2 - (words.length < 5 ? 25 : 0)))), evidence: `${words.length} words across ${sentences.length} sentence(s), averaging ${Math.round(sentenceLength)} words per sentence. Readability proxy only.`};
  metrics.cta = {score: cta ? 75 : 25, evidence: cta ? `Action phrase detected: “${cta[0]}”. Placement and effectiveness are unverified.` : 'No explicit action phrase detected in the supplied copy.'};
  const strengths = [sentenceLength <= 18 ? 'The copy uses relatively short sentences.' : '', concrete ? 'The opening includes a concrete benefit cue.' : '', cta ? 'An explicit next action appears in the copy.' : ''].filter(Boolean);
  const weaknesses = [!cta ? 'The copy does not state a clear next action.' : '', !concrete ? 'The opening could make the benefit more specific.' : '', sentenceLength > 18 ? 'Long sentences may make the copy harder to scan.' : ''].filter(Boolean);
  const recommendations: Assessment['recommendations'] = [];
  if (!cta) recommendations.push({title: 'Give the viewer a next step', detail: 'Add one action that fits the platform, such as “Save this for later” or “Comment your answer”.'});
  if (!concrete) recommendations.push({title: 'Make the opening specific', detail: 'Lead with a concrete outcome, a recognisable problem or a surprising fact. Avoid inventing performance claims.'});
  if (sentenceLength > 18) recommendations.push({title: 'Shorten the sentences', detail: 'Split the benefit, the detail and the action so each reads on its own.'});
  recommendations.push({title: 'Connect a language model', detail: 'A full virality assessment of the video, frames and TRIBE response needs a model. Set one up in Connections.'});
  return {summary: 'A limited copy assessment based on sentence length, opening cues and explicit calls to action.', virality, metrics, neuralReading: null, strengths, weaknesses, recommendations};
}

export function fuse(metrics: Assessment['metrics'], weights: Record<MetricKey, number> = metricWeights) {
  const usable = metricKeys.filter(k => metrics[k].score !== null && weights[k] > 0);
  const total = usable.reduce((sum, k) => sum + weights[k], 0);
  if (!total) return {overall: null, contributions: {}};
  return {
    overall: Math.round(usable.reduce((sum, k) => sum + metrics[k].score! * weights[k] / total, 0)),
    contributions: Object.fromEntries(usable.map(k => [k, weights[k] / total])),
  };
}
