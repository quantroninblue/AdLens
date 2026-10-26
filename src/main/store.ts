import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { chatMessageSchema, reportSchema, settingsSchema, type ChatMessage, type Report, type Settings } from '../shared/schema';

const draftKey = 'draft';
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private async read(name: string): Promise<unknown> {
    try {return JSON.parse(await readFile(path.join(this.root, name), 'utf8'));}
    catch (e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error(`Cannot read ${name}. Your saved data has been left intact.`);}
  }
  private async write(name: string, value: unknown) {
    await mkdir(this.root, {recursive: true, mode: 0o700});
    const file = path.join(this.root, name), temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), {mode: 0o600});
    await rename(temp, file);
  }
  // Serialize read-modify-write cycles so concurrent saves cannot drop entries.
  private serial<T>(work: () => Promise<T>) {const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next;}
  async settings(): Promise<Settings> {
    const saved = settingsSchema.safeParse(await this.read('settings.json') ?? {});
    return saved.success ? saved.data : settingsSchema.parse({});
  }
  async saveSettings(settings: Settings) {await this.write('settings.json', settingsSchema.parse(settings));}
  // Reports from older AdLens versions stay in the file but are not shown.
  private async rawReports() {const raw = await this.read('reports.json') ?? []; if (!Array.isArray(raw)) throw new Error('Cannot read reports.json. Your saved data has been left intact.'); return raw;}
  async history(): Promise<Report[]> {return (await this.rawReports()).flatMap(r => {const p = reportSchema.safeParse(r); return p.success ? [p.data] : [];});}
  add(report: Report) {return this.serial(async () => {const raw = await this.rawReports(); await this.write('reports.json', [reportSchema.parse(report), ...raw.filter(r => r?.id !== report.id)].slice(0, 200));});}
  async remove(id: string) {await this.serial(async () => this.write('reports.json', (await this.rawReports()).filter(r => r?.id !== id))); await this.clearChat(id);}
  private async chats() {const parsed = z.record(z.string(), z.array(chatMessageSchema)).safeParse(await this.read('chats.json') ?? {}); return parsed.success ? parsed.data : {};}
  async chat(reportId: string | null): Promise<ChatMessage[]> {return (await this.chats())[reportId ?? draftKey] ?? [];}
  saveChat(reportId: string | null, messages: ChatMessage[]) {return this.serial(async () => {const all = await this.chats(); all[reportId ?? draftKey] = messages.slice(-60); await this.write('chats.json', all);});}
  clearChat(reportId: string | null) {return this.serial(async () => {const all = await this.chats(); delete all[reportId ?? draftKey]; await this.write('chats.json', all);});}
}
