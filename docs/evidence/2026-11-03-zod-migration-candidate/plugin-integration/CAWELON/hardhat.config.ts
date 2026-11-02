import hardhatNodeTestRunnerPlugin from '@nomicfoundation/hardhat-node-test-runner';
import hardhatKeystorePlugin from '@nomicfoundation/hardhat-keystore';
import hardhatViemPlugin from '@nomicfoundation/hardhat-viem';
import {defineConfig} from 'hardhat/config';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export default defineConfig({plugins:[hardhatViemPlugin,hardhatNodeTestRunnerPlugin,hardhatKeystorePlugin],solidity:{profiles:{default:{version:'0.8.34',path:require.resolve('solc/soljson.js')}}},networks:{hardhatOp:{type:'edr-simulated',chainType:'op'}}});
