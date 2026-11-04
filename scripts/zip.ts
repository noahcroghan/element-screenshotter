// A small, dependency-free ZIP writer (deflate, no ZIP64). Enough for an
// extension package, which is far below the 4 GiB limit.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

// Fixed timestamp (1980-01-01) so builds are reproducible.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

interface Entry {
  local: Buffer[];
  central: Buffer[];
  size: number;
}

function zipEntry(name: Buffer, data: Buffer, offset: number): Entry {
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(UTF8_NAMES, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);

  return {
    local: [local, name, body],
    central: [central, name],
    size: 30 + name.length + body.length,
  };
}

export async function zipDirectory(dir: string, outFile: string): Promise<void> {
  const entries: Entry[] = [];
  let offset = 0;
  for (const file of await listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'), 'utf8');
    const entry = zipEntry(name, await readFile(file), offset);
    entries.push(entry);
    offset += entry.size;
  }

  const centralDirectory = Buffer.concat(entries.flatMap((entry) => entry.central));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  await writeFile(
    outFile,
    Buffer.concat([...entries.flatMap((entry) => entry.local), centralDirectory, end]),
  );
}
