import { z } from 'zod';

export { metricKeys, metricLabels, type MetricKey } from './metrics';
export const metricSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  evidence: z.string().min(1).max(1500),
});
export const assessmentSchema = z.object({
  summary: z.string().min(1).max(3000),
  metrics: z.object({hook: metricSchema, clarity: metricSchema, audience: metricSchema,
    emotion: metricSchema, visual: metricSchema, cta: metricSchema}),
  strengths: z.array(z.string().min(1).max(1500)).max(10),
  weaknesses: z.array(z.string().min(1).max(1500)).max(10),
  recommendations: z.array(z.object({title: z.string().min(1).max(200), detail: z.string().min(1).max(1500)})).max(10),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export const settingsSchema = z.object({
  reasoningUrl: z.string().max(2000).default(''), model: z.string().max(200).default(''),
  mediaUrl: z.string().max(2000).default(''), tribeUrl: z.string().max(2000).default(''),
  weights: z.object({hook: z.number().min(0).max(1), clarity: z.number().min(0).max(1),
    audience: z.number().min(0).max(1), emotion: z.number().min(0).max(1), visual: z.number().min(0).max(1), cta: z.number().min(0).max(1),
    tribe: z.number().min(0).max(1)}).default({hook: .25, clarity: .25, audience: .15, emotion: .1, visual: .1, cta: .15, tribe: 0}),
});
export type Settings = z.infer<typeof settingsSchema>;
export const inputSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(160),
  text: z.string().max(20000), audience: z.string().max(1500),
  platform: z.enum(['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'General']),
  assetId: z.string().uuid().optional(),
});
export type AnalysisInput = z.infer<typeof inputSchema>;
export type Asset = {id: string; name: string; mime: string; size: number; preview?: string};
export const representationSchema = z.object({
  summary: z.string().min(1).max(12000), transcript: z.string().max(30000).optional(),
  observations: z.array(z.object({time: z.number().nonnegative().optional(), description: z.string().min(1).max(2000)})).max(24),
  modalities: z.array(z.enum(['image', 'video', 'audio', 'text'])).min(1),
  models: z.array(z.string().min(1).max(200)).min(1).max(12),
  duration: z.number().positive().optional(),
});
export type Representation = z.infer<typeof representationSchema>;
export const neuralSchema = z.object({
  source: z.literal('tribe'), model: z.string().min(1).max(200), score: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1).nullable(), interpretation: z.string().min(1).max(3000),
  method: z.string().min(1).max(3000),
  inputModalities: z.array(z.enum(['text', 'image', 'video', 'audio'])).min(1),
});
export type NeuralSignal = z.infer<typeof neuralSchema>;
export type Stage = 'prepare' | 'media' | 'neural' | 'reasoning' | 'report';
export type Progress = {id: string; stage: Stage; state: 'running' | 'done' | 'skipped' | 'failed'; detail: string; at: string};
export type ProviderStatus = {id: 'reasoning' | 'media' | 'tribe'; name: string; state: 'unconfigured' | 'available' | 'unavailable'; detail: string};
export const reportSchema = z.object({
  id: z.string().uuid(), createdAt: z.string(), title: z.string(), input: inputSchema,
  asset: z.object({name: z.string(), mime: z.string(), size: z.number()}).optional(),
  assessment: assessmentSchema, basis: z.enum(['heuristic', 'model']),
  overall: z.number().min(0).max(100).nullable(), engagement: z.number().min(0).max(100).nullable(),
  representation: representationSchema.optional(), neural: neuralSchema.optional(),
  metadata: z.object({models: z.array(z.string()), modalities: z.array(z.string()), limitations: z.array(z.string()),
    neuralContextProvided: z.boolean().default(false),
    weights: settingsSchema.shape.weights, contributions: z.record(z.string(), z.number()),
    providers: z.array(z.object({name: z.string(), state: z.enum(['used', 'skipped', 'failed']), detail: z.string()})),
  }),
});
export type Report = z.infer<typeof reportSchema>;
export type DesktopAPI = {
  importAsset: () => Promise<Asset | null>;
  importDropped: (file: File) => Promise<Asset>;
  analyze: (input: AnalysisInput) => Promise<Report>;
  cancel: (id: string) => Promise<void>;
  history: () => Promise<Report[]>;
  removeReport: (id: string) => Promise<void>;
  exportReport: (id: string) => Promise<boolean>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  models: () => Promise<ProviderStatus[]>;
  onProgress: (callback: (progress: Progress) => void) => () => void;
  window: (action: 'minimize' | 'maximize' | 'close') => void;
};
