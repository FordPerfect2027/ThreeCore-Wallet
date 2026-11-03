import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {createPublicBaseRpcReader}=await import(pathToFileURL(resolve(process.argv[2],'src/public-base-rpc.js')));
const controller=new AbortController();let calls=0;
const signal=new Proxy(controller.signal,{get(target,key){if(typeof key==='symbol'&&String(key).includes('kEvents'))throw Error('PRIVATE_SIGNAL_REGISTRATION');return Reflect.get(target,key,target);}});
try{
 const reader=createPublicBaseRpcReader({rpcUrl:'https://mainnet.base.org',signal,fetchImpl:async()=>{calls++;throw Error('unexpected transport');}});
 await reader('eth_chainId');console.log(JSON.stringify({unexpectedSuccess:true,calls}));
}catch(error){console.log(JSON.stringify({code:error.code??null,message:error.message,calls}));}
