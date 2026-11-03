import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const log = process.env.THREECORE_SIM_NETWORK_LOG;
if (!log) throw Error('SIM_GUARD_LOG_MISSING');
function deny(kind) { return function (...args) { const candidate = typeof args[0] === 'string' ? args[0] : args[0]?.path; const category = typeof candidate === 'string' && candidate.startsWith('\\\\?\\pipe\\') ? 'windows-named-pipe' : 'network'; appendFileSync(log, JSON.stringify({ kind, pid:process.pid, category })+'\n'); throw Error('SIMULATION_NETWORK_BLOCKED:'+kind); }; }
net.Socket.prototype.connect = deny('net.Socket.connect');
net.connect = deny('net.connect'); net.createConnection = deny('net.createConnection');
http.request = deny('http.request'); http.get = deny('http.get');
https.request = deny('https.request'); https.get = deny('https.get');
tls.connect = deny('tls.connect');
globalThis.fetch = deny('fetch');
syncBuiltinESMExports();
