import { assessmentSchema, inputSchema, reportSchema, type AnalysisInput, type Asset, type Assessment, type Frames, type Media, type NeuralSignal, type Progress, type Report, type Settings } from '../shared/schema';
import { assessCopy, fuse } from './heuristics';
import { analysisInstructions, extractJson } from './prompts';
import type { LLMClient, LLMImage, LLMRequest } from './llm';

export type PreparedAsset = Asset & {path: string; frames?: Frames; still?: {data: string; width: number; height: number}};
export interface NeuralProvider { analyze(asset: {path: string; name: string; kind: 'video' | 'audio'}, signal: AbortSignal, progress: (detail: string) => void): Promise<NeuralSignal> }
export type Providers = {llm?: LLMClient; llmInfo?: {provider: NonNullable<Settings['llm']['provider']>; model: string}; tribe?: NeuralProvider; tribeDisabledReason?: string};
export type NeuralContext = {status: 'available'; summary: Omit<NeuralSignal, 'words'>} | {status: 'unavailable' | 'disabled'; reason: string};
const maxImages = 12;
const base64 = (dataUrl: string) => ({mime: dataUrl.slice(5, dataUrl.indexOf(';')) as LLMImage['mime'], data: dataUrl.slice(dataUrl.indexOf(',') + 1)});

// The primary video gets most of the image budget; extra files get a few frames each.
export function selectImages(assets: PreparedAsset[]): LLMImage[] {
  const images: LLMImage[] = [];
  const primary = assets.find(a => a.kind === 'video');
  for (const asset of assets) {
    if (asset.kind === 'image' && asset.still) images.push({mime: 'image/jpeg', data: asset.still.data, label: `${asset.name} (still image)`});
    if (asset.kind === 'video' && asset.frames) {
      const quota = asset === primary ? 8 : 3, frames = asset.frames.frames;
      const step = Math.max(1, frames.length / quota);
      for (let i = 0; i < frames.length && i / step < quota; i += step) {
        const frame = frames[Math.floor(i)];
        images.push({...base64(frame.image), label: `${asset.name} frame at ${frame.time.toFixed(1)} s`});
      }
    }
  }
  return images.slice(0, maxImages);
}
const transcriptFrom = (words: NeuralSignal['words']) => {
  if (!words?.length) return undefined;
  // Mark the time every ~5 seconds so the model can place speech on the timeline.
  const lines: string[][] = [];
  let last = -Infinity;
  for (const word of words) {
    if (word.time - last >= 5) {lines.push([`[${word.time.toFixed(1)}s]`]); last = word.time;}
    lines[lines.length - 1].push(word.text);
  }
  return lines.map(line => line.join(' ')).join('\n').slice(0, 30000);
};

export async function analyze(raw: AnalysisInput, assets: PreparedAsset[], providers: Providers, signal: AbortSignal, publish: (event: Progress) => void): Promise<Report> {
  const input = inputSchema.parse(raw);
  if (!input.text.trim() && !assets.length) throw new Error('Add a video, image or some copy first.');
  const emit = (stage: Progress['stage'], state: Progress['state'], detail: string) => {signal.throwIfAborted(); publish({id: input.id, stage, state, detail, at: new Date().toISOString()});};
  const limitations: string[] = [], used: Report['metadata']['providers'] = [], models: string[] = [];
  emit('prepare', 'running', 'Preparing frames and context');
  const images = selectImages(assets);
  for (const asset of assets) if (asset.kind === 'video' && !asset.frames?.frames.length) limitations.push(`No frames could be sampled from ${asset.name}; its visuals were not assessed.`);
  emit('prepare', 'done', assets.length ? `${assets.length} file${assets.length > 1 ? 's' : ''} · ${images.length} image${images.length === 1 ? '' : 's'} prepared` : 'Copy and context ready');

  let neural: NeuralSignal | undefined, neuralContext: NeuralContext;
  const primary = assets.find(a => a.kind === 'video') ?? assets.find(a => a.kind === 'audio');
  if (providers.tribe && primary) {
    emit('neural', 'running', `Starting TRIBE v2 on ${primary.name}`);
    try {
      neural = await providers.tribe.analyze({path: primary.path, name: primary.name, kind: primary.kind as 'video' | 'audio'}, signal, detail => emit('neural', 'running', detail));
      models.push(`TRIBE v2 (${neural.checkpoint}, ${neural.device})`);
      used.push({name: 'TRIBE v2', state: 'used', detail: `${neural.timesteps} time steps · ${neural.vertices.toLocaleString()} vertices · ${neural.runtimeSeconds.toFixed(0)} s`});
      for (const warning of neural.warnings) limitations.push(`TRIBE: ${warning}`);
      const {words: _, ...summary} = neural;
      neuralContext = {status: 'available', summary};
      emit('neural', 'done', `Predicted response over ${neural.duration.toFixed(0)} s`);
    } catch (error) {
      signal.throwIfAborted();
      const reason = (error as Error).message.slice(0, 600);
      limitations.push(`TRIBE did not complete: ${reason.split('\n')[0]}`);
      used.push({name: 'TRIBE v2', state: 'failed', detail: reason});
      neuralContext = {status: 'unavailable', reason: 'TRIBE failed on this file; no neural evidence is available.'};
      emit('neural', 'failed', 'TRIBE failed; continuing without the neural signal');
    }
  } else {
    const reason = !primary ? 'TRIBE needs a video or audio file' : providers.tribeDisabledReason ?? 'TRIBE is not connected';
    used.push({name: 'TRIBE v2', state: 'skipped', detail: reason});
    neuralContext = {status: 'disabled', reason: `${reason}; no neural evidence is available.`};
    emit('neural', 'skipped', reason);
  }
  const transcript = transcriptFrom(neural?.words);
  const media: Media = {
    assets: assets.map(a => ({name: a.name, kind: a.kind, duration: a.frames?.duration, width: a.frames?.width ?? a.still?.width, height: a.frames?.height ?? a.still?.height,
      frameTimes: a.frames?.frames.map(f => Math.round(f.time * 10) / 10) ?? []})),
    transcript, transcriptSource: transcript ? 'TRIBE event pipeline (WhisperX word timings)' : undefined,
    imagesSent: providers.llm?.vision ? images.length : 0,
  };
  if (providers.llm && !providers.llm.vision && images.length) limitations.push(`${providers.llm.name} cannot see images, so frames were not sent and visuals were not assessed.`);
  if (primary?.kind === 'video' && !transcript) limitations.push('No timed transcript was available (it comes from TRIBE’s speech pipeline).');

  let assessment: Assessment = assessCopy(input, transcript), basis: Report['basis'] = 'heuristic';
  if (providers.llm) {
    emit('reasoning', 'running', `Waiting for ${providers.llm.name}`);
    const context = {input: {title: input.title, platform: input.platform, copy: input.text, audience: input.audience}, media: {...media, imagesVisible: providers.llm.vision}, neural: neuralContext};
    const request: LLMRequest = {system: analysisInstructions(), json: true, images: providers.llm.vision ? images : [],
      messages: [{role: 'user', content: `Assess this content and return the JSON report.\n\nCONTEXT:\n${JSON.stringify(context)}`}]};
    try {
      let received = 0, last = 0;
      const onDelta = (text: string) => {received += text.length; if (received - last > 400) {last = received; emit('reasoning', 'running', `Receiving report · ${received.toLocaleString()} characters`);}};
      let reply = await providers.llm.complete(request, signal, onDelta);
      let parsed = assessmentSchema.safeParse(safeJson(reply));
      if (!parsed.success) {
        // One repair round with the validation errors, then give up.
        emit('reasoning', 'running', 'Asking the model to fix its report format');
        const issues = parsed.error.issues.slice(0, 12).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        reply = await providers.llm.complete({...request, images: [], messages: [...request.messages, {role: 'assistant', content: reply.slice(0, 60000)},
          {role: 'user', content: `That reply did not match the schema (${issues}). Return only the corrected JSON object.`}]}, signal, onDelta);
        parsed = assessmentSchema.safeParse(safeJson(reply));
      }
      if (!parsed.success) throw new Error('The model’s report did not match the expected format.');
      assessment = parsed.data; basis = 'model';
      models.push(providers.llm.name);
      used.push({name: 'Language model', state: 'used', detail: `${providers.llm.name}${neural ? ' · TRIBE summary supplied' : ''}${media.imagesSent ? ` · ${media.imagesSent} images` : ''}`});
      emit('reasoning', 'done', 'Report received');
    } catch (error) {
      signal.throwIfAborted();
      limitations.push(`The language model failed (${(error as Error).message.slice(0, 300)}). The report falls back to limited copy rules.`);
      used.push({name: 'Language model', state: 'failed', detail: (error as Error).message.slice(0, 300)});
      emit('reasoning', 'failed', 'Model failed; applying copy rules');
    }
  } else {
    used.push({name: 'Language model', state: 'skipped', detail: 'No model connected'});
    emit('reasoning', 'skipped', 'No language model connected; using copy rules');
  }

  // Enforce evidence rules regardless of what the model claims.
  const m = assessment.metrics;
  if (!input.text.trim() && !media.imagesSent && !transcript && !neural) for (const metric of Object.values(m)) {metric.score = null; metric.evidence = 'No copy, frames, transcript or TRIBE summary were available for this dimension.';}
  if (!media.imagesSent) m.visual = {score: null, evidence: 'No images were shown to the model, so visual quality was not assessed.'};
  if (!transcript && !neural) m.audio = {score: null, evidence: 'No transcript or TRIBE auditory response was available.'};
  if (!input.audience.trim()) m.audience = {score: null, evidence: 'No target audience supplied.'};
  if (!neural) assessment.neuralReading = null;
  if (basis === 'heuristic') {assessment.virality = assessCopy(input).virality; limitations.push('English-language copy rules only. No virality, visual, emotional or audience assessment was performed.');}
  if (basis === 'model' && neural) limitations.push('The language model’s interpretation of the TRIBE summary is qualitative; TRIBE has no validated mapping to engagement or virality.');
  limitations.push('Virality potential is a model estimate from the content and predicted brain responses, not a forecast of views, reach or sales.');
  emit('report', 'running', 'Validating and saving the report');
  const scores = fuse(m);
  return reportSchema.parse({
    id: input.id, createdAt: new Date().toISOString(), title: input.title, input,
    assets: assets.map(a => ({name: a.name, mime: a.mime, size: a.size, kind: a.kind})),
    assessment, basis, overall: scores.overall, media, neural,
    metadata: {llm: providers.llmInfo ?? null, models, limitations, contributions: scores.contributions, providers: used, neuralContextProvided: basis === 'model' && !!neural},
  });
}
function safeJson(text: string) {try {return extractJson(text);} catch {return undefined;}}
