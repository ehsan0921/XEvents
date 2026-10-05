import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export class Store {
  constructor(dir) { this.dir = dir; this.file = join(dir, 'events.json'); }
  async load() {
    await mkdir(this.dir, { recursive: true });
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.data = { events: {}, sessions: {}, offset: 0 }; }
    return this;
  }
  async save() {
    await writeFile(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
  }
}
