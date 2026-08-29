// Standalone reproduction of src/adapters/storage/atomic-write.ts's temp-then-rename algorithm,
// deliberately slowed down with a delay between chunks so
// tests/integration/storage/atomic-write.test.ts can SIGKILL this process mid-write and inspect
// what's left on disk. Not imported from src/ on purpose: this has to run as a real, separate OS
// process — an in-process function call killed by throwing can't reproduce what an actual
// interrupted write leaves behind, which is the entire point of that test — and plain `node`
// can't execute the project's TypeScript directly.
//
// argv: [targetPath, chunkText, chunkCount, delayMsBetweenChunks]
//
// Writes `chunkCount` copies of `chunkText` to a temp file in targetPath's directory, waiting
// `delayMsBetweenChunks` between each. Prints 'writing\n' to stdout right after the FIRST chunk
// is on disk (fsynced) — the earliest point at which a kill sent by the parent test proves
// something about a partial write; killing any earlier would only prove the process could be
// killed before touching disk at all. Only if it survives every chunk does it rename the temp
// file over targetPath and print 'done\n'.
import { open, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [, , targetPath, chunkText, chunkCountArg, delayMsArg] = process.argv;
const chunkCount = Number(chunkCountArg);
const delayMs = Number(delayMsArg);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const dir = path.dirname(targetPath);
const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${randomUUID()}`);

const handle = await open(tempPath, 'w');
try {
  for (let i = 0; i < chunkCount; i++) {
    await handle.write(`${chunkText}\n`);
    await handle.sync();
    if (i === 0) {
      process.stdout.write('writing\n');
    }
    await sleep(delayMs);
  }
} finally {
  await handle.close();
}
await rename(tempPath, targetPath);
process.stdout.write('done\n');
