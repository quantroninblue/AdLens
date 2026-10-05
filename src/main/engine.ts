import { inputSchema, reportSchema, assessmentSchema, representationSchema, neuralSchema, type AnalysisInput, type Asset, type Progress, type Report, type Settings, type Representation, type NeuralSignal } from '../shared/schema';
import { assessCopy, fuse } from './heuristics';
import type { ReasoningProvider, MediaProvider, EngagementProvider, ReasoningContext } from './providers';

export type Providers = {reasoning?: ReasoningProvider; media?: MediaProvider; tribe?: EngagementProvider; reasoningName?: string};
export async function analyze(raw: AnalysisInput, asset: (Asset & {path: string}) | undefined, settings: Settings, providers: Providers, signal: AbortSignal, publish: (event: Progress) => void): Promise<Report> {
  const input = inputSchema.parse(raw);
  if (!input.text.trim() && !asset) throw new Error('Add some copy or an image/video first.');
  const emit = (stage: Progress['stage'], state: Progress['state'], detail: string) => {signal.throwIfAborted(); publish({id: input.id, stage, state, detail, at: new Date().toISOString()});};
  const limitations: string[] = [];
  const used: Report['metadata']['providers'] = [];
  const models: string[] = [];
  let representation: Representation | undefined, neural: NeuralSignal | undefined;
  emit('prepare', 'running', 'Reading content and context');
  emit('prepare', 'done', asset ? `${asset.name} · ${(asset.size / 1024 / 1024).toFixed(1)} MB` : 'Copy and context ready');
  if (asset && providers.media) {
    emit('media', 'running', asset.mime.startsWith('video/') ? 'Remote video processing: frames, audio, and transcript' : 'Analyzing image on media server');
    try {
      representation = representationSchema.parse(await providers.media.represent(asset, signal));
      const expected = asset.mime.startsWith('video/') ? 'video' : 'image';
      if (!representation.modalities.includes(expected)) throw new Error('Media response omitted the uploaded modality.');
      models.push(...representation.models);
      used.push({name: 'Media analysis', state: 'used', detail: representation.models.join(', ')});
      emit('media', 'done', `${representation.observations.length} observations received`);
    } catch {
      signal.throwIfAborted(); representation = undefined;
      limitations.push('Media analysis failed. Visual and audio content were not assessed. Check the media endpoint and its response schema.');
      used.push({name: 'Media analysis', state: 'failed', detail: 'Connection, processing, or response validation failed.'});
      emit('media', 'failed', 'Media provider failed; continuing with supplied copy');
    }
  } else {
    if (asset) limitations.push('No media provider configured. The uploaded asset has not been visually or audibly analyzed.');
    used.push({name: 'Media analysis', state: 'skipped', detail: asset ? 'No endpoint configured' : 'No asset supplied'});
    emit('media', 'skipped', asset ? 'No media endpoint configured' : 'No media supplied');
  }
  const context = {input, representation};
  if (providers.tribe) {
    emit('neural', 'running', 'Requesting neural-response signal');
    try {
      neural = neuralSchema.parse(await providers.tribe.analyze(context, signal, asset));
      models.push(neural.model);
      used.push({name: 'TRIBE', state: 'used', detail: `${neural.inputModalities.join(', ')} neural-response ${neural.score === null ? 'summary' : 'proxy'}`});
      emit('neural', 'done', neural.score === null ? 'Neural-response summary received' : 'Neural-response proxy received');
    } catch {
      signal.throwIfAborted();
      limitations.push('TRIBE signal unavailable: connection, input, or response validation failed. It was excluded from scoring.');
      used.push({name: 'TRIBE', state: 'failed', detail: 'No valid neural signal received'});
      emit('neural', 'failed', 'TRIBE unavailable; continuing without neural signal');
    }
  } else {
    used.push({name: 'TRIBE', state: 'skipped', detail: 'No endpoint configured'});
    emit('neural', 'skipped', 'TRIBE not connected');
  }
  let assessment = assessCopy(input, representation?.transcript), basis: Report['basis'] = 'heuristic';
  const reasoningContext: ReasoningContext = {...context, neural: neural
    ? {status: 'available', signal: neural, fusionWeight: settings.weights.tribe}
    : providers.tribe
      ? {status: 'unavailable', reason: 'TRIBE request failed or returned invalid output; no neural evidence is available.'}
      : {status: 'disabled', reason: 'No TRIBE endpoint configured; no neural evidence is available.'}};
  if (providers.reasoning && (input.text.trim() || representation || neural)) {
    emit('reasoning', 'running', 'Waiting for reasoning server');
    try {
      let last = 0;
      const candidate = await providers.reasoning.analyze(reasoningContext, signal, count => {
        if (count - last > 200) {last = count; emit('reasoning', 'running', `Receiving analysis · ${count.toLocaleString()} characters`);}
      });
      assessment = assessmentSchema.parse(candidate);
      basis = 'model';
      models.push(providers.reasoningName ?? 'Compatible reasoning provider');
      used.push({name: 'Reasoning model', state: 'used', detail: `${providers.reasoningName || 'Configured model'}${neural ? ' · TRIBE context supplied' : ''}`});
      emit('reasoning', 'done', 'Structured assessment received');
    } catch {
      signal.throwIfAborted();
      limitations.push('Reasoning provider failed or returned invalid output. The report uses limited copy rules instead.');
      used.push({name: 'Reasoning model', state: 'failed', detail: 'Connection or structured-output validation failed'});
      emit('reasoning', 'failed', 'Reasoning unavailable; applying copy rules');
    }
  } else {
    used.push({name: 'Reasoning model', state: 'skipped', detail: providers.reasoning ? 'No analyzed content available' : 'No endpoint configured'});
    emit('reasoning', 'skipped', 'Using local copy rules');
  }
  // Enforce evidence constraints independently of a model's claims.
  if (!input.text.trim() && !representation) {
    for (const metric of Object.values(assessment.metrics)) {
      metric.score = null;
      metric.evidence = 'No copy or semantic media observations were available. A neural response alone does not establish this marketing dimension.';
    }
  }
  if (!representation?.modalities.some(m => m === 'video' || m === 'image') || !representation.observations.length) assessment.metrics.visual = {score: null, evidence: 'No visual observations were available for this assessment.'};
  if (!input.audience.trim()) assessment.metrics.audience = {score: null, evidence: 'No target audience supplied.'};
  if (basis === 'heuristic') limitations.push('English-language copy rules only. No semantic, emotional, or audience-fit model assessment was performed.');
  if (basis === 'model' && neural) limitations.push('The reasoning model received TRIBE context. Its interpretation may be influenced by that context even when the direct neural fusion weight is zero; score contributions describe arithmetic weights, not causal influence.');
  limitations.push('Scores are uncalibrated content estimates, not predicted reach, conversions, or a probability of virality. No external engagement data was used.');
  emit('report', 'running', 'Validating report and combining available signals');
  const scores = fuse(assessment.metrics, settings.weights, neural && neural.score !== null ? {score: neural.score, weight: settings.weights.tribe} : undefined);
  const report = reportSchema.parse({
    id: input.id, createdAt: new Date().toISOString(), title: input.title, input,
    asset: asset ? {name: asset.name, mime: asset.mime, size: asset.size} : undefined,
    assessment, basis, ...scores, representation, neural,
    metadata: {models, modalities: [...new Set([...(input.text.trim() ? ['text'] : []), ...(representation?.modalities ?? []), ...(neural?.inputModalities ?? [])])], limitations,
      weights: settings.weights, contributions: scores.contributions, providers: used,
      neuralContextProvided: basis === 'model' && neural !== undefined},
  });
  return report;
}
