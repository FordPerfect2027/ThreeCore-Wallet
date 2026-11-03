/** Fast test-only startup check. Static dependencies are fetched, never evaluated.
 * Runtime/dynamic imports remain covered by the actual browser suite.
 */
export function browserModuleDependencies(source) {
  const specs = new Set();
  for (const match of source.matchAll(/^[ \t]*import\s+(?:[\w*$,\s{}]+?\s+from\s*)?["']([^"'\n]+)["']/gm)) specs.add(match[1]);
  for (const match of source.matchAll(/^[ \t]*export\s*(?:\{[^}]*\}|\*)\s*from\s*["']([^"'\n]+)["']/gm)) specs.add(match[1]);
  return [...specs];
}

export async function checkBrowserModuleRoutes(origin, {fetcher = globalThis.fetch, entry = '/test/browser/ui-tests.js'} = {}) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Expected isolated loopback test server');
  const pathFor = (specifier, parent) => {
    if (!specifier.startsWith('/') && !specifier.startsWith('./') && !specifier.startsWith('../')) throw Error('Unsupported browser module specifier: ' + specifier);
    const url = new URL(specifier, parent);
    if (url.origin !== base.origin || url.search || url.hash || !/^\/(?:src|examples|test\/browser|test\/helpers)\/[^?#]+\.js$/.test(url.pathname)) throw Error('Test module is outside local source routes: ' + specifier);
    return url.href;
  };
  const queue = [pathFor(entry,base)],seen = new Set(),abort = new AbortController(),timer = setTimeout(()=>abort.abort(),30000);let totalBytes = 0;
  try {
    while(queue.length){
      const url=queue.shift();if(seen.has(url))continue;if(seen.size>=512)throw Error('Browser module graph exceeds 512 files');seen.add(url);
      const response=await fetcher(url,{signal:abort.signal,redirect:'error'});
      if(response.status!==200 || !/^(?:text|application)\/javascript(?:;|$)/i.test(response.headers.get('content-type')??'')) { await response.body?.cancel();throw Error('Browser module unavailable: '+new URL(url).pathname+' (HTTP '+response.status+')'); }
      const source=await response.text();totalBytes+=new TextEncoder().encode(source).byteLength;if(totalBytes>16*1024*1024)throw Error('Browser module graph exceeds 16 MiB');
      for(const dependency of browserModuleDependencies(source))queue.push(pathFor(dependency,url));
    }
    return Object.freeze({modules:seen.size,bytes:totalBytes});
  } finally {clearTimeout(timer);abort.abort();}
}
