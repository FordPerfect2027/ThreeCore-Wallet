import { defineConfig } from 'hardhat/config';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default defineConfig({
  solidity:{profiles:{default:{version:'0.8.34',path:require.resolve('solc/soljson.js')}}},
  networks:{}
});
