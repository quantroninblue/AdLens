import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reportSchema, settingsSchema, type Report, type Settings } from '../shared/schema';
export class Store {
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
  async settings(): Promise<Settings> {return settingsSchema.parse(await this.read('settings.json') ?? {});}
  async saveSettings(settings: Settings) {await this.write('settings.json', settingsSchema.parse(settings));}
  async history(): Promise<Report[]> {return reportSchema.array().parse(await this.read('reports.json') ?? []);}
  async add(report: Report) {const history = await this.history(); await this.write('reports.json', [report, ...history.filter(r => r.id !== report.id)].slice(0, 100));}
  async remove(id: string) {await this.write('reports.json', (await this.history()).filter(r => r.id !== id));}
}
