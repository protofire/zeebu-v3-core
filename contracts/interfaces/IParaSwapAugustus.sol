// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.10;
pragma experimental ABIEncoderV2;

interface IParaSwapAugustus {
  function getTokenTransferProxy() external view returns (address);
}
