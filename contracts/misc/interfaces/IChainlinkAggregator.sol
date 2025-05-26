// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

// Full interface for Chainlink Aggregator
interface IChainlinkAggregator {
  function decimals() external view returns (uint8);

  function latestAnswer() external view returns (int256);

  function latestTimestamp() external view returns (uint256);

  function latestRound() external view returns (uint256);

  function getAnswer(uint256 roundId) external view returns (int256);

  function getTimestamp(uint256 roundId) external view returns (uint256);

  function description() external view returns (string memory);
}
