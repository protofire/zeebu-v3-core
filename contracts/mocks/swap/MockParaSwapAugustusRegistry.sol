// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IParaSwapAugustusRegistry} from '../../interfaces/IParaSwapAugustusRegistry.sol';

contract MockParaSwapAugustusRegistry is IParaSwapAugustusRegistry {
  address immutable AUGUSTUS;

  constructor(address augustus) {
    AUGUSTUS = augustus;
  }

  function isValidAugustus(address augustus) external view override returns (bool) {
    return augustus == AUGUSTUS;
  }

  function getAugustusAddresses() external view override returns (address[] memory) {
    address[] memory augustusAddresses = new address[](1);
    augustusAddresses[0] = AUGUSTUS;
    return augustusAddresses;
  }
}
