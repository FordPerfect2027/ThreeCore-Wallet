import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const packages=['hardhat','@nomicfoundation/hardhat-zod-utils','@nomicfoundation/hardhat-keystore','zod'];
const results=await Promise.all(packages.map(async name=>{
 const url='https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest',response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Metadata response '+response.status);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('Metadata body limit');chunks.push(chunk);}
 const raw=Buffer.concat(chunks),data=JSON.parse(raw);return {name,url,version:data.version,dependencies:data.dependencies??{},peerDependencies:data.peerDependencies??{},engines:data.engines??{},distIntegrity:data.dist?.integrity,rawResponseSha256:createHash('sha256').update(raw).digest('hex')};
}));
const record={recordedAt:new Date().toISOString(),source:'Public npm registry latest metadata; read-only, no package install or scripts',packages:results};writeFileSync('C:/Users/aseet/Downloads/ThreeCore-toolchain-latest-20261102.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
