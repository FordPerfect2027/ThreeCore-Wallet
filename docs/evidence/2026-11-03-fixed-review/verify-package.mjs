import assert from 'node:assert/strict';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyPackage(directory) {
  const root=await realpath(resolve(directory));
  const manifest=await readFile(resolve(root,'SHA256SUMS.txt'));
  assert(manifest.length<128*1024,'MANIFEST_TOO_LARGE');
  const rows=manifest.toString('utf8').trimEnd().split(/\r?\n/),names=[],identities=new Set();
  assert(rows.length>0&&rows.length<=128,'ENTRY_COUNT');let totalBytes=0;
  for(const line of rows) {
    const match=/^([a-f0-9]{64})  ([A-Za-z0-9._ /-]+)$/.exec(line);assert(match,'MANIFEST_FORMAT');
    const [,expected,name]=match,parts=name.split('/');
    assert(parts.every(part=>part&&part!=='.'&&part!=='..'),'UNSAFE_PATH');
    const target=resolve(root,...parts),within=relative(root,target);
    assert(within&&within!=='..'&&!within.startsWith('..'+sep)&&!isAbsolute(within),'OUTSIDE_PACKAGE');
    assert(!identities.has(name.toLowerCase()),'DUPLICATE_PATH');identities.add(name.toLowerCase());
    assert.equal(await realpath(target),target,'LINKED_PATH');
    const info=await lstat(target);assert(info.isFile()&&!info.isSymbolicLink(),'NOT_REGULAR_FILE');
    assert(info.size<=64*1024*1024,'FILE_TOO_LARGE');totalBytes+=info.size;assert(totalBytes<=256*1024*1024,'PACKAGE_TOO_LARGE');
    const bytes=await readFile(target);assert.equal(bytes.length,info.size,'FILE_CHANGED');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,'CHECKSUM_MISMATCH: '+name);
    names.push(name);
  }
  const actual=[],queue=[''];let entries=0;
  while(queue.length) {
    const prefix=queue.pop();assert(prefix.split('/').length<=8,'PATH_DEPTH');
    for(const entry of await readdir(resolve(root,prefix),{withFileTypes:true})) {
      assert(++entries<=256,'EXTRA_ENTRY_LIMIT');const name=prefix+entry.name;
      assert(!entry.isSymbolicLink(),'LINKED_ENTRY');
      if(entry.isDirectory())queue.push(name+'/');else {assert(entry.isFile(),'NOT_REGULAR_ENTRY');actual.push(name);}
    }
  }
  assert.deepEqual(actual.filter(name=>name!=='SHA256SUMS.txt').sort(),names.toSorted(),'UNLISTED_OR_MISSING_FILES');
  return {entries:names.length,totalBytes,allMatched:true,manifestSha256:createHash('sha256').update(manifest).digest('hex')};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  assert(process.argv.length<=3,'Expected at most one package directory');
  console.log(JSON.stringify(await verifyPackage(process.argv[2]??dirname(fileURLToPath(import.meta.url))),null,2));
}
