/** Explicit loopback-only host. No credentials, env loading or model activation. */
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn } from "node:timers/promises";
import { observeCallbackResult, consumeCallback } from "../src/security-callback.js";
import { captureDataArray, captureDataRecord } from "../src/security-data.js";

const PATH = "/api/agent/proposal";
const HEADERS = Object.freeze({"content-type":"application/json;charset=utf-8","cache-control":"no-store",
  "x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY",
  "content-security-policy":"default-src 'none'; frame-ancestors 'none'","connection":"close"});
const PUBLIC_HEADERS = Object.freeze({...HEADERS,
  "cross-origin-resource-policy":"same-origin",
  "permissions-policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  "content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'none'; worker-src 'none'"});
const PUBLIC_TYPES = new Set(["text/html;charset=utf-8","text/javascript;charset=utf-8","text/css;charset=utf-8"]);
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
// Classify only errors created by the private factory, without invoking
// exception getters/prototype traps. A captured constructor cannot add a brand.
const hostErrors=new WeakMap();
class HostError extends Error {constructor(code,status=503){super(code);this.code=code;this.status=status;}}
const makeHostError=(code,status=503)=>{const error=new HostError(code,status);hostErrors.set(error,{code,status});return error;};
const fail=(code,status)=>{throw makeHostError(code,status);};
const send=(res,status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,HEADERS);res.end(body);}};
const sendError=(res,code,status)=>send(res,status,JSON.stringify({error:code,executed:false}));
const sendPublic=(res,asset)=>{if(!res.destroyed&&!res.writableEnded){
  res.writeHead(200,{...PUBLIC_HEADERS,"content-type":asset.contentType,"content-length":asset.bytes.length});res.end(asset.bytes);}};

// Public text is supplied by the server owner before binding. No filesystem,
// request callback, caller headers, or browser-provided configuration is read.
function capturePublicAssets(input) {
  try {
    const assets=new Map();let total=0;
    for(const value of captureDataArray(input,256,1)) {
      const {path,contentType,body}=captureDataRecord(value,["path","contentType","body"]);
      if(typeof path!=="string"||path.length>256||/[^\x21-\x7e]/.test(path)||
        (path!=="/"&&!/^\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/?$/.test(path))||
        /^\/(?:api|server)(?:\/|$)/i.test(path)||assets.has(path)||
        !PUBLIC_TYPES.has(contentType)||typeof body!=="string")fail("INVALID_PUBLIC_ASSETS");
      const size=Buffer.byteLength(body,"utf8");total+=size;
      if(size>131072||total>4194304)fail("INVALID_PUBLIC_ASSETS");
      assets.set(path,Object.freeze({contentType,bytes:Buffer.from(body,"utf8")}));
    }
    return assets;
  } catch {fail("INVALID_PUBLIC_ASSETS");}
}

/**
 * createService({origin}) runs synchronously after a successful explicit bind.
 * It must return the application-owned service, not a browser-derived factory.
 * register/revoke are private host methods: there are no HTTP bootstrap routes.
 * This host serves no HTML/files and must not replace an existing open demo.
 */
export function createProposalHttpHost(options={}) {
  return createOwnedProposalHost(options,null);
}

/**
 * Opt-in same-origin composition with the same private listener and lifecycle.
 * publicAssets is a nonempty array of exact {path,contentType,body} data records:
 * at most 256 UTF-8 text assets, 128 KiB each and 4 MiB combined. Only the three
 * fixed HTML/JavaScript/CSS MIME types above are accepted. Paths are exact,
 * canonical ASCII targets; /api and /server are reserved. Assets are public:
 * supply no session tokens, private configuration or per-user data in them.
 * This creates no identity/session resolver or browser grant-delivery channel.
 */
export function createProposalApplicationHost({publicAssets,...options}={}) {
  return createOwnedProposalHost(options,capturePublicAssets(publicAssets));
}

function createOwnedProposalHost({enabled=false,createService,port=0,maxConnections=16,
  maxConcurrentRequests=6,requestTimeoutMs=35000}={},publicAssets) {
  if(typeof enabled!=="boolean"||typeof createService!=="function"||!integer(port,0,65535)||
    !integer(maxConnections,1,64)||!integer(maxConcurrentRequests,1,32)||
    maxConcurrentRequests>maxConnections||!integer(requestTimeoutMs,10,60000))fail("INVALID_HTTP_HOST_CONFIG");
  let status="idle",origin=null,service=null,startPromise=null,closePromise=null,serviceDisposed=false;
  const disposeService=()=>{if(service&&!serviceDisposed){serviceDisposed=true;consumeCallback(()=>service.dispose());}};
  const sockets=new Set(),operations=new Set();
  const server=createServer({maxHeaderSize:8192,headersTimeout:requestTimeoutMs,requestTimeout:requestTimeoutMs,
    keepAliveTimeout:1},(req,res)=>{void dispatch(req,res);});
  server.maxHeadersCount=40;server.maxRequestsPerSocket=1;server.maxConnections=maxConnections;
  server.on("connection",socket=>{sockets.add(socket);socket.once("close",()=>sockets.delete(socket));
    socket.setTimeout(requestTimeoutMs+1000,()=>socket.destroy());});
  server.on("clientError",(_error,socket)=>{if(socket.writable)socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");else socket.destroy();});
  server.on("checkContinue",(_req,res)=>sendError(res,"EXPECTATION_REJECTED",417));
  server.on("checkExpectation",(_req,res)=>sendError(res,"EXPECTATION_REJECTED",417));
  server.on("upgrade",(_req,socket)=>socket.destroy());
  server.on("connect",(_req,socket)=>socket.destroy());
  // A late listener error must not expose transport details or become unhandled.
  server.on("error",()=>{if(status==="listening"){status="failed";for(const op of operations)op.abort.abort();disposeService();for(const socket of sockets)socket.destroy();server.close();}});

  function inspect(req) {
    const expected=new URL(origin).host;
    for(const name of ["host","origin","authorization","content-type","content-length","transfer-encoding","sec-fetch-site","content-encoding"])
      if((req.headersDistinct[name]?.length??0)>1)fail("AMBIGUOUS_HEADERS",400);
    if(req.headers.host!==expected||req.headers.origin!==origin)fail("ORIGIN_DENIED",403);
    if(req.headers["sec-fetch-site"]!==undefined&&req.headers["sec-fetch-site"]!=="same-origin")fail("ORIGIN_DENIED",403);
    if(req.url!==PATH)fail("NOT_FOUND",404);
    if(req.method!=="POST")fail("METHOD_NOT_ALLOWED",405);
    if(!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization??""))fail("SESSION_REQUIRED",401);
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"]??""))fail("JSON_REQUIRED",415);
    if(req.headers["content-encoding"]!==undefined&&req.headers["content-encoding"]!=="identity")fail("ENCODING_REJECTED",415);
    const length=req.headers["content-length"];
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>8192))fail("REQUEST_TOO_LARGE",413);
  }
  function inspectPublic(req) {
    for(const name of ["host","origin","authorization","content-type","content-length","transfer-encoding","sec-fetch-site","sec-fetch-dest","content-encoding"])
      if((req.headersDistinct[name]?.length??0)>1)fail("AMBIGUOUS_HEADERS",400);
    if(req.headers.host!==new URL(origin).host||
      (req.headers.origin!==undefined&&req.headers.origin!==origin))fail("ORIGIN_DENIED",403);
    const site=req.headers["sec-fetch-site"];
    if(site!==undefined&&site!=="none"&&site!=="same-origin")fail("ORIGIN_DENIED",403);
    if(["iframe","frame","object","embed"].includes(req.headers["sec-fetch-dest"]))fail("ORIGIN_DENIED",403);
    if(req.headers["content-encoding"]!==undefined&&req.headers["content-encoding"]!=="identity")fail("ENCODING_REJECTED",415);
    const length=req.headers["content-length"];
    if(req.headers["transfer-encoding"]!==undefined||
      (length!==undefined&&(!/^\d+$/.test(length)||Number(length)!==0)))fail("REQUEST_BODY_NOT_ALLOWED",400);
  }
  function body(req,signal) {
    return new Promise((resolve,reject)=>{
      const chunks=[];let bytes=0;
      const cleanup=()=>{req.off("data",data);req.off("end",end);req.off("error",error);signal.removeEventListener("abort",abort);};
      const stop=e=>{cleanup();req.pause();reject(e);};
      const data=chunk=>{bytes+=chunk.length;if(bytes>8192)stop(makeHostError("REQUEST_TOO_LARGE",413));else chunks.push(chunk);};
      const end=()=>{cleanup();resolve(Buffer.concat(chunks,bytes));};
      const error=()=>stop(makeHostError("REQUEST_CANCELLED",499));
      const abort=()=>stop(makeHostError("REQUEST_CANCELLED",499));
      req.on("data",data);req.once("end",end);req.once("error",error);signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
    });
  }
  async function dispatch(req,res) {
    let op,timer,remove,response,reader,settled=true,finished=false;
    try {
      if(status!=="listening")fail("SERVICE_UNAVAILABLE");
      // Only an exact declared GET enters the public branch. Every other target
      // retains the protected API's original method, Origin and route checks.
      const asset=req.method==="GET"?publicAssets?.get(req.url):undefined;
      if(asset)inspectPublic(req);else inspect(req);
      if(operations.size>=maxConcurrentRequests)fail("HOST_BUSY",429);
      op={abort:new AbortController()};operations.add(op);
      const deadline=performance.now()+requestTimeoutMs;
      const checkDeadline=()=>{if(performance.now()>=deadline)fail("HOST_REQUEST_TIMEOUT",504);};
      const cancel=()=>op.abort.abort();const closed=()=>{if(!res.writableFinished)cancel();};
      req.once("aborted",cancel);res.once("close",closed);
      remove=()=>{req.off("aborted",cancel);res.off("close",closed);};
      const aborted=new Promise((_,reject)=>op.abort.signal.addEventListener("abort",()=>reject(makeHostError("REQUEST_CANCELLED",499)),{once:true}));
      aborted.catch(()=>{});
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(makeHostError("HOST_REQUEST_TIMEOUT",504));cancel();},requestTimeoutMs);});
      timeout.catch(()=>{});
      const bounded=promise=>Promise.race([promise,aborted,timeout]);
      if(asset) {
        checkDeadline();
        if(op.abort.signal.aborted||status!=="listening")fail("REQUEST_CANCELLED",499);
        sendPublic(res,asset);return;
      }
      const bytes=await bounded(body(req,op.abort.signal));
      checkDeadline();
      if(op.abort.signal.aborted||status!=="listening")fail("REQUEST_CANCELLED",499);
      const request=new Request(origin+PATH,{method:"POST",headers:req.headers,body:bytes,signal:op.abort.signal});
      // Hold admission until a non-cooperative service actually settles.
      settled=false;
      const work=Promise.resolve().then(()=>{
        if(op.abort.signal.aborted||status!=="listening")fail("REQUEST_CANCELLED",499);
        return service.handle(request);
      });
      const release=()=>{settled=true;if(finished)operations.delete(op);};
      work.then(value=>{release();if(finished||op.abort.signal.aborted)consumeCallback(()=>value?.body?.cancel());},release);
      response=await bounded(work);
      checkDeadline();
      if(!(response instanceof Response)||response.status<200||response.status>599||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")??""))fail("INVALID_SERVICE_RESPONSE",502);
      // Service is host-owned; still bound response bytes and never forward cookies/CORS.
      reader=response.body?.getReader();if(!reader)fail("INVALID_SERVICE_RESPONSE",502);
      let total=0,parts=0;const chunks=[];
      while(true){const part=await bounded(reader.read());checkDeadline();if(part.done)break;
        total+=part.value.byteLength;if(total>131072)fail("INVALID_SERVICE_RESPONSE",502);
        if(part.value.byteLength!==0)chunks.push(part.value);
        // Prompt chunks must let timeout and disconnect events reach the host.
        if(++parts%64===0){await bounded(nextTurn());checkDeadline();}}
      if(op.abort.signal.aborted||status!=="listening")fail("REQUEST_CANCELLED",499);
      send(res,response.status,Buffer.concat(chunks,total));
    } catch(e) {const detail=hostErrors.get(e);sendError(res,detail?.code??"HTTP_HOST_ERROR",detail?.status??502);}
    finally {finished=true;clearTimeout(timer);remove?.();op?.abort.abort();
      consumeCallback(()=>reader?reader.cancel():response?.body?.cancel());if(settled&&op)operations.delete(op);}
  }
  const host=Object.freeze({
    get state(){return Object.freeze({status,origin,activeRequests:operations.size});},
    start(){
      if(!enabled)return Promise.reject(makeHostError("HTTP_HOST_DISABLED"));
      if(startPromise)return status==="closed"||status==="closing"||status==="failed"?Promise.reject(makeHostError("HTTP_HOST_CLOSED")):startPromise;
      if(status!=="idle")return Promise.reject(makeHostError("HTTP_HOST_CLOSED"));
      status="starting";
      startPromise=new Promise((resolve,reject)=>{
        const failed=()=>{status="failed";reject(makeHostError("HTTP_BIND_FAILED"));};server.once("error",failed);
        server.listen({host:"127.0.0.1",port,exclusive:true},()=>{
          server.off("error",failed);
          if(status!=="starting"){server.close();reject(makeHostError("HTTP_HOST_CLOSED"));return;}
          try {
            origin=`http://127.0.0.1:${server.address().port}`;
            const created=createService({origin});service=created;
            if(observeCallbackResult(created,late=>consumeCallback(()=>late?.dispose()))!=="synchronous"||
              !created||["handle","register","revoke","dispose"].some(k=>typeof created[k]!=="function"))fail("INVALID_HTTP_SERVICE");
            if(status!=="starting")fail("HTTP_HOST_CLOSED");
            status="listening";resolve(Object.freeze({origin,endpoint:origin+PATH}));
          }catch{status="failed";disposeService();server.close(()=>reject(makeHostError("HTTP_START_FAILED")));}
        });
      });
      return startPromise;
    },
    register(input){if(status!=="listening")fail("HTTP_HOST_NOT_READY");return service.register(input);},
    revoke(agent){if(status!=="listening")fail("HTTP_HOST_NOT_READY");service.revoke(agent);},
    close(){
      if(closePromise)return closePromise;
      const pending=startPromise;status="closing";
      for(const op of operations)op.abort.abort();disposeService();
      closePromise=(async()=>{
        if(pending)await pending.catch(()=>{});
        for(const op of operations)op.abort.abort();disposeService();
        await new Promise(resolve=>{server.close(()=>resolve());for(const socket of sockets)socket.destroy();});
        status="closed";
      })();
      return closePromise;
    },
  });
  return host;
}
