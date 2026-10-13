import './build.mjs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './binary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const files = [];
async function collect(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await collect(resolve(directory, entry.name), `${name}/`);
        else if (entry.isFile()) files.push({ name, data: await readFile(resolve(directory, entry.name)) });
    }
}
await collect(resolve(root, 'extension'));
const local = [], central = [];
let offset = 0;
for (const { name, data } of files) {
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const output = resolve(root, `artifacts/razer-synapse-web-hypershift-unlocker-${version}.zip`);
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await writeFile(output, Buffer.concat([...local, directory, end]));
console.log(`Packaged ${files.length} files: ${output}`);
