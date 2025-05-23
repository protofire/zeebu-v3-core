// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IFaucetInteractor} from '../../interfaces/IFaucetInteractor.sol';
import {MintableERC20} from '../tokens/MintableERC20.sol';
import {console} from 'hardhat/console.sol';

contract MockFaucetInteractor is IFaucetInteractor {
  event FaucetInteractorDeployed(address indexed token);
  event FaucetInteractorMinted(address indexed token, uint256 amount);

  constructor() public {
    emit FaucetInteractorDeployed(msg.sender);
  }

  function allowlistMintSingle(address token, uint256 amount) external override {
    MintableERC20(token).mint(msg.sender, amount);
    emit FaucetInteractorMinted(token, amount);
  }
}
