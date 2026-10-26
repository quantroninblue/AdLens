import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuralSchema, type NeuralSignal, type TribeCandidate } from '../shared/schema';

const windows = process.platform === 'win32';
const interpreter = (prefix: string) => windows ? [path.join(prefix, 'python.exe'), path.join(prefix, 'Scripts', 'python.exe')] : [path.join(prefix, 'bin', 'python3'), path.join(prefix, 'bin', 'python')];
async function children(directory: string) {
  try {return (await readdir(directory, {withFileTypes: true})).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').slice(0, 200).map(e => path.join(directory, e.name));}
  catch {return [];}
}
async function executable(file: string) {
  try {await access(file, windows ? constants.F_OK : constants.X_OK); return (await stat(file)).isFile();} catch {return false;}
}

// The Windows py launcher knows every registered interpreter.
function pyLauncher() {
  return new Promise<string[]>(resolve => execFile('py', ['-0p'], {timeout: 5000, windowsHide: true}, (error, stdout) =>
    resolve(error ? [] : stdout.split(/\r?\n/).map(l => /([A-Za-z]:\\.*python\.exe)\s*$/i.exec(l.trim())?.[1]).filter((p): p is string => !!p).slice(0, 50))));
}

// Common places a Python environment with TRIBE might live. Nothing is installed or modified.
export async function candidatePaths(home = os.homedir(), env = process.env): Promise<{python: string; source: TribeCandidate['source']}[]> {
  const prefixes = new Set<string>();
  for (const value of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) if (value) prefixes.add(value);
  const condaRoots = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge', 'micromamba', '.conda', '.local/share/mamba'].map(d => path.join(home, d));
  if (!windows) condaRoots.push('/opt/conda', '/opt/miniconda3', '/opt/anaconda3', '/opt/miniforge3');
  else for (const base of [env.LOCALAPPDATA, env.ProgramData, env.APPDATA].filter((v): v is string => !!v)) condaRoots.push(...['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge'].map(d => path.join(base, d)));
  if (windows && env.LOCALAPPDATA) for (const install of await children(path.join(env.LOCALAPPDATA, 'Programs', 'Python'))) prefixes.add(install);
  if (windows) for (const python of await pyLauncher()) prefixes.add(path.dirname(python));
  for (const root of condaRoots) {prefixes.add(root); for (const envDir of await children(path.join(root, 'envs'))) prefixes.add(envDir);}
  try {for (const line of (await readFile(path.join(home, '.conda', 'environments.txt'), 'utf8')).split(/\r?\n/).slice(0, 200)) if (line.trim()) prefixes.add(line.trim());} catch {/* No conda registry. */}
  for (const version of await children(path.join(home, '.pyenv', 'versions'))) {prefixes.add(version); for (const envDir of await children(path.join(version, 'envs'))) prefixes.add(envDir);}
  for (const dir of ['.virtualenvs', 'venvs', '.venvs', 'envs', '.local/share/virtualenvs']) for (const envDir of await children(path.join(home, dir))) prefixes.add(envDir);
  // Project-local virtual environments such as ~/tribev2/.venv or ~/Desktop/tribe/venv.
  const projectRoots = [home, ...['Desktop', 'Documents', 'projects', 'Projects', 'code', 'src', 'repos', 'git', 'work', 'dev', 'research'].map(d => path.join(home, d))];
  for (const root of projectRoots) for (const project of [root, ...await children(root)]) for (const name of ['.venv', 'venv', 'env', '.env']) prefixes.add(path.join(project, name));
  const found: {python: string; source: TribeCandidate['source']}[] = [];
  const seen = new Set<string>();
  const add = async (python: string, source: TribeCandidate['source']) => {if (!seen.has(python) && await executable(python)) {seen.add(python); found.push({python, source});}};
  if (env.ADLENS_TRIBE_PYTHON) await add(env.ADLENS_TRIBE_PYTHON, 'environment');
  for (const prefix of prefixes) for (const file of interpreter(prefix)) {if (await executable(file)) {await add(file, 'scan'); break;}}
  for (const dir of (env.PATH ?? '').split(path.delimiter)) if (path.isAbsolute(dir)) for (const name of windows ? ['python.exe'] : ['python3', 'python']) await add(path.join(dir, name), 'scan');
  return found;
}

export function label(python: string) {
  const parts = python.split(/[\\/]/);
  const envs = parts.lastIndexOf('envs');
  if (envs >= 0 && parts[envs + 1]) return `${parts[envs + 1]} (conda)`;
  const venv = parts.findIndex(p => ['.venv', 'venv', 'env', '.env'].includes(p));
  if (venv > 0) return `${parts[venv - 1]}/${parts[venv]}`;
  const versions = parts.lastIndexOf('versions');
  if (versions >= 0 && parts[versions + 1]) return `${parts[versions + 1]} (pyenv)`;
  return python;
}

type Probe = {protocol: number; tribev2: boolean; version: string | null; checkpointCached: boolean | null};
export function probe(python: string, bridge: string, checkpoint: string, timeout = 20000) {
  return new Promise<Probe | null>(resolve => {
    execFile(python, [bridge, 'probe', checkpoint], {timeout, maxBuffer: 65536, windowsHide: true, cwd: os.tmpdir()}, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const result = JSON.parse(stdout.trim().split('\n').pop() ?? '');
        resolve(result && typeof result.tribev2 === 'boolean' ? result : null);
      } catch {resolve(null);}
    });
  });
}

export async function scan(bridge: string, checkpoint: string, preferred = ''): Promise<TribeCandidate[]> {
  const paths = (await candidatePaths()).filter(p => p.python !== preferred);
  if (preferred) paths.unshift({python: preferred, source: 'setting'});
  const results: TribeCandidate[] = [];
  // Probing only checks importlib metadata, so a handful in parallel is cheap.
  for (let i = 0; i < paths.length; i += 6) {
    const batch = await Promise.all(paths.slice(i, i + 6).map(async p => ({...p, result: await probe(p.python, bridge, checkpoint)})));
    for (const item of batch) if (item.result?.tribev2) results.push({python: item.python, source: item.source, label: label(item.python), version: item.result.version, checkpointCached: item.result.checkpointCached});
  }
  return results;
}

// For a chosen folder: accept the interpreter itself, an environment prefix, or a project with .venv/venv.
export async function resolvePython(choice: string) {
  if (await executable(choice) && /python[\d.]*(\.exe)?$/i.test(path.basename(choice))) return choice;
  for (const prefix of [choice, path.join(choice, '.venv'), path.join(choice, 'venv'), path.join(choice, 'env')]) for (const file of interpreter(prefix)) if (await executable(file)) return file;
  return null;
}

export type TribeRequest = {path: string; kind: 'video' | 'audio'; checkpoint: string; device: string; cache: string};
type Pending = {id: string; resolve: (value: NeuralSignal) => void; reject: (error: Error) => void; progress: (detail: string) => void};

// One long-lived bridge process keeps TRIBE loaded between analyses.
export class TribeWorker {
  private child?: ChildProcessWithoutNullStreams;
  private python?: string;
  private ready?: Promise<void>;
  private pending?: Pending;
  private stderr = '';
  private idle?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  constructor(private bridge: string, private idleMs = 15 * 60_000) {}

  private start(python: string, cwd: string) {
    this.stop();
    this.python = python; this.stderr = '';
    const child = spawn(python, ['-u', this.bridge, 'serve'], {cwd, detached: !windows, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', TOKENIZERS_PARALLELISM: 'false'}});
    this.child = child;
    let buffer = '';
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TRIBE bridge did not start. Check the selected Python environment.')), 60_000);
      const line = (text: string) => {
        let message: any;
        try {message = JSON.parse(text);} catch {return;}
        if (message.type === 'ready') {clearTimeout(timer); resolve(); return;}
        const pending = this.pending;
        if (!pending || message.id !== pending.id) return;
        if (message.type === 'progress' && typeof message.detail === 'string') pending.progress(message.detail.slice(0, 200));
        else if (message.type === 'result') {
          this.pending = undefined; this.touch();
          const parsed = neuralSchema.safeParse(message.result);
          if (parsed.success) pending.resolve(parsed.data);
          else pending.reject(new Error('TRIBE bridge returned a summary that failed validation.'));
        } else if (message.type === 'error') {this.pending = undefined; this.touch(); pending.reject(new Error(`TRIBE failed: ${String(message.message).slice(0, 600)}`));}
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 8_000_000) {this.fail('TRIBE bridge output exceeded its size limit.'); return;}
        let index: number;
        while ((index = buffer.indexOf('\n')) !== -1) {line(buffer.slice(0, index)); buffer = buffer.slice(index + 1);}
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {this.stderr = (this.stderr + chunk).slice(-6000);});
      child.stdin.on('error', () => {/* Exit handling reports the failure. */});
      child.once('error', () => {clearTimeout(timer); reject(new Error('The TRIBE Python interpreter could not be started.')); this.fail('The TRIBE Python interpreter could not be started.');});
      child.once('exit', code => {
        clearTimeout(timer);
        if (this.child === child) {this.child = undefined; this.ready = undefined;}
        const tail = this.stderr.trim().split('\n').slice(-6).join('\n').slice(-1200);
        reject(new Error(`TRIBE bridge exited (code ${code}).`));
        this.fail(`TRIBE process exited (code ${code}).${tail ? `\n${tail}` : ''}`);
      });
    });
    this.ready.catch(() => {});
  }
  private fail(message: string) {const pending = this.pending; this.pending = undefined; pending?.reject(new Error(message));}
  private touch() {clearTimeout(this.idle); this.idle = setTimeout(() => void this.stop(), this.idleMs); this.idle.unref?.();}
  // Resolves once the process has exited (Windows keeps its working directory locked until then).
  stop(): Promise<void> {
    clearTimeout(this.idle);
    const child = this.child; this.child = undefined; this.ready = undefined;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}).on('error', () => child.kill());
    else {try {process.kill(-child.pid, 'SIGTERM');} catch {/* Already gone. */} setTimeout(() => {try {process.kill(-child.pid!, 'SIGKILL');} catch {/* Already gone. */}}, 3000).unref();}
    return exited;
  }
  async predict(python: string, request: TribeRequest, signal: AbortSignal, progress: (detail: string) => void): Promise<NeuralSignal> {
    if (this.pending) throw new Error('TRIBE is already running an analysis.');
    if (!this.child || this.python !== python) this.start(python, request.cache);
    await this.ready;
    signal.throwIfAborted();
    const id = `r${++this.sequence}`;
    clearTimeout(this.idle);
    return new Promise<NeuralSignal>((resolve, reject) => {
      // Cancelling kills the process; the next analysis reloads the model.
      const abort = () => {this.fail('TRIBE analysis cancelled.'); void this.stop();};
      signal.addEventListener('abort', abort, {once: true});
      const done = <T,>(fn: (value: T) => void) => (value: T) => {signal.removeEventListener('abort', abort); fn(value);};
      this.pending = {id, resolve: done(resolve), reject: done(reject), progress};
      this.child!.stdin.write(`${JSON.stringify({id, op: 'predict', ...request})}\n`);
    });
  }
}
