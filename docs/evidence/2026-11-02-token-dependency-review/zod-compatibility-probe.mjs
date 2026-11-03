import {z} from 'zod';
import {validateUserConfigZodType} from './hardhat-zod-utils-original.mjs';
const results=[];
for(const [name,value,schema] of [
 ['valid-config',{name:'fixture'},()=>z.object({name:z.string()})],
 ['invalid-config',{name:123},()=>z.object({name:z.string()})],
 ['record-config',{networks:{fixture:{type:'edr-simulated'}}},()=>z.object({networks:z.record(z.object({type:z.string()}))})]
]){
 try{results.push({name,status:'returned',errors:validateUserConfigZodType(value,schema())});}
 catch(error){results.push({name,status:'threw',errorName:error.name,message:error.message});}
}
console.log(JSON.stringify({results}));
