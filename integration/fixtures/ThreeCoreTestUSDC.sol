// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Local EVM fixture only. No relationship to the deployed Circle contract.
contract ThreeCoreTestUSDC is ERC20 {
    constructor(address holder) ERC20("USD Coin", "USDC") {
        _mint(holder, 1_000_000 * 10 ** 6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}
