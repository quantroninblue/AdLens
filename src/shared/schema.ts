import { z } from 'zod';

export { metricKeys, metricLabels, metricWeights, type MetricKey } from './metrics';

export const llmProviders = ['ollama', 'codex', 'claude-code', 'openai', 'anthropic'] as const;
export type LLMProvider = typeof llmProviders[number];
export const llmProviderLabels: Record<LLMProvider, string> = {
  ollama: 'Local model (Ollama)', codex: 'ChatGPT account (Codex CLI)', 'claude-code': 'Claude account (Claude Code)',
  openai: 'OpenAI API key', anthropic: 'Anthropic API key',
};

const timeSchema = z.number().nonnegative().max(36000);
export const metricSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  evidence: z.string().min(1).max(1500),
});
export const assessmentSchema = z.object({
  summary: z.string().min(1).max(3000),
  virality: z.object({
    score: z.number().min(0).max(100).nullable(),
    band: z.enum(['low', 'moderate', 'high', 'breakout']).nullable(),
    confidence: z.enum(['low', 'medium', 'high']),
    rationale: z.string().min(1).max(3000),
  }),
  metrics: z.object({hook: metricSchema, retention: metricSchema, emotion: metricSchema, visual: metricSchema, audio: metricSchema,
    clarity: metricSchema, shareability: metricSchema, cta: metricSchema, audience: metricSchema}),
  neuralReading: z.object({
    summary: z.string().min(1).max(3000),
    moments: z.array(z.object({time: timeSchema, observation: z.string().min(1).max(600), implication: z.string().min(1).max(600)})).max(12),
  }).nullable(),
  strengths: z.array(z.string().min(1).max(1500)).max(10),
  weaknesses: z.array(z.string().min(1).max(1500)).max(10),
  recommendations: z.array(z.object({title: z.string().min(1).max(200), detail: z.string().min(1).max(1500), time: timeSchema.nullable().optional()})).max(10),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const settingsSchema = z.object({
  llm: z.object({
    provider: z.enum(llmProviders).nullable().default(null),
    model: z.string().max(200).default(''),
    ollamaUrl: z.string().max(2000).default('http://127.0.0.1:11434'),
  }).prefault({}),
  tribe: z.object({
    enabled: z.boolean().default(true),
    // Empty means "use the first environment found by the scan".
    python: z.string().max(4096).default(''),
    checkpoint: z.string().min(1).max(4096).default('facebook/tribev2'),
    device: z.enum(['auto', 'cuda', 'cpu']).default('auto'),
  }).prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;

export const platforms = ['Instagram', 'TikTok', 'YouTube Shorts', 'LinkedIn', 'General'] as const;
export const inputSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(160),
  text: z.string().max(20000), audience: z.string().max(1500),
  platform: z.enum(platforms),
  assetIds: z.array(z.string().uuid()).max(8).default([]),
});
export type AnalysisInput = z.input<typeof inputSchema>;
export type AssetKind = 'video' | 'image' | 'audio';
export type Asset = {id: string; name: string; mime: string; size: number; kind: AssetKind; preview?: string; url?: string};
// A dropped .txt/.md file becomes copy, not an asset.
export type ImportedItem = {type: 'asset'; asset: Asset} | {type: 'text'; name: string; text: string};
export const frameSchema = z.object({time: timeSchema, image: z.string().startsWith('data:image/').max(1_500_000)});
export const framesSchema = z.object({
  duration: z.number().positive().max(36000), width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384),
  frames: z.array(frameSchema).max(16),
});
export type Frames = z.infer<typeof framesSchema>;

// What was prepared locally and given to the language model.
export const mediaSchema = z.object({
  assets: z.array(z.object({name: z.string(), kind: z.enum(['video', 'image', 'audio']), duration: z.number().optional(),
    width: z.number().optional(), height: z.number().optional(), frameTimes: z.array(z.number()).max(16)})),
  transcript: z.string().max(30000).optional(),
  transcriptSource: z.string().max(200).optional(),
  imagesSent: z.number().int().nonnegative(),
});
export type Media = z.infer<typeof mediaSchema>;

// Bounded summary of a TRIBE v2 prediction. The full time × vertex array never leaves the bridge.
export const neuralSchema = z.object({
  source: z.literal('tribe'), model: z.string().min(1).max(200), checkpoint: z.string().max(4096), device: z.string().max(40),
  asset: z.string().max(500), inputKind: z.enum(['video', 'audio']),
  tr: z.number().positive(), timesteps: z.number().int().positive(), vertices: z.number().int().positive(),
  duration: z.number().nonnegative(),
  timeConvention: z.string().min(1).max(1000), method: z.string().min(1).max(3000), atlas: z.string().max(300).nullable(),
  global: z.array(z.object({t: z.number(), activity: z.number(), change: z.number().nullable()})).max(600),
  regions: z.array(z.object({id: z.string().max(60), label: z.string().max(120), vertices: z.number().int().nonnegative(),
    mean: z.number(), peakTime: z.number(), peakZ: z.number(), hookZ: z.number().nullable(), trend: z.number()})).max(16),
  moments: z.array(z.object({time: z.number(), kind: z.enum(['peak', 'shift', 'dip']), detail: z.string().max(400)})).max(24),
  words: z.array(z.object({time: z.number(), text: z.string().max(200)})).max(3000).optional(),
  runtimeSeconds: z.number().nonnegative(),
  warnings: z.array(z.string().max(500)).max(10),
});
export type NeuralSignal = z.infer<typeof neuralSchema>;

export type Stage = 'prepare' | 'neural' | 'reasoning' | 'report';
export type Progress = {id: string; stage: Stage; state: 'running' | 'done' | 'skipped' | 'failed'; detail: string; at: string};
export type ProviderStatus = {id: 'llm' | 'tribe'; name: string; state: 'unconfigured' | 'available' | 'unavailable'; detail: string};

export const reportSchema = z.object({
  id: z.string().uuid(), createdAt: z.string(), title: z.string(), input: inputSchema,
  assets: z.array(z.object({name: z.string(), mime: z.string(), size: z.number(), kind: z.enum(['video', 'image', 'audio'])})),
  assessment: assessmentSchema, basis: z.enum(['heuristic', 'model']),
  overall: z.number().min(0).max(100).nullable(),
  media: mediaSchema, neural: neuralSchema.optional(),
  metadata: z.object({
    llm: z.object({provider: z.enum(llmProviders), model: z.string()}).nullable(),
    models: z.array(z.string()), limitations: z.array(z.string()),
    neuralContextProvided: z.boolean(),
    contributions: z.record(z.string(), z.number()),
    providers: z.array(z.object({name: z.string(), state: z.enum(['used', 'skipped', 'failed']), detail: z.string()})),
  }),
});
export type Report = z.infer<typeof reportSchema>;

export type TribeCandidate = {python: string; label: string; version: string | null; checkpointCached: boolean | null; source: 'setting' | 'environment' | 'scan'};
export type LLMStatus = {provider: LLMProvider; available: boolean; detail: string; account?: string; models: {id: string; name: string}[]; keyStored?: 'encrypted' | 'session' | 'environment'};
export const chatMessageSchema = z.object({role: z.enum(['user', 'assistant']), content: z.string().min(1).max(40000)});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatRequestSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid().nullable(),
  messages: z.array(chatMessageSchema).min(1).max(60),
  draft: z.object({title: z.string().max(160), text: z.string().max(20000), audience: z.string().max(1500), platform: z.string().max(40), assets: z.array(z.string().max(500)).max(8)}).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatEvent = {id: string; delta?: string; done?: boolean; error?: string};

export type DesktopAPI = {
  importAssets: () => Promise<ImportedItem[]>;
  importDropped: (files: File[]) => Promise<ImportedItem[]>;
  setFrames: (assetId: string, frames: Frames) => Promise<void>;
  analyze: (input: AnalysisInput) => Promise<Report>;
  cancel: (id: string) => Promise<void>;
  history: () => Promise<Report[]>;
  removeReport: (id: string) => Promise<void>;
  exportReport: (id: string) => Promise<boolean>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  status: () => Promise<ProviderStatus[]>;
  scanTribe: () => Promise<TribeCandidate[]>;
  chooseTribePython: () => Promise<TribeCandidate | null>;
  llmStatus: () => Promise<LLMStatus[]>;
  setApiKey: (provider: 'openai' | 'anthropic', key: string, remember: boolean) => Promise<void>;
  removeApiKey: (provider: 'openai' | 'anthropic') => Promise<void>;
  chat: (request: ChatRequest) => Promise<void>;
  cancelChat: (id: string) => Promise<void>;
  chatHistory: (reportId: string | null) => Promise<ChatMessage[]>;
  clearChat: (reportId: string | null) => Promise<void>;
  onChat: (callback: (event: ChatEvent) => void) => () => void;
  onProgress: (callback: (progress: Progress) => void) => () => void;
  window: (action: 'minimize' | 'maximize' | 'close') => void;
};
