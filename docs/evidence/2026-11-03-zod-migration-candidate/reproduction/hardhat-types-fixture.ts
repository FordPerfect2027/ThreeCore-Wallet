import { defineConfig } from 'hardhat/config';
const fixture=defineConfig({solidity:{profiles:{default:{version:'0.8.34'}}},networks:{demo:{type:'http',url:'https://example.invalid',chainType:'op'}}});
void fixture;
