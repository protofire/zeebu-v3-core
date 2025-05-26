// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import {IChainlinkAggregator} from '../../misc/interfaces/IChainlinkAggregator.sol';

/**
 * @title Mock Chainlink Price Aggregator
 * @notice Simple mock implementation of Chainlink Aggregator interface for testing
 */
contract MockChainlinkOraclePriceAggregator is IChainlinkAggregator {
  int256 private _latestAnswer;
  uint256 private _latestTimestamp;
  uint256 private _latestRoundId;
  uint8 private _decimals;

  mapping(uint256 => int256) private _roundAnswers;
  mapping(uint256 => uint256) private _roundTimestamps;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 timestamp);
  event NewRound(uint256 indexed roundId, address indexed startedBy);

  constructor(uint8 decimals, int256 latestAnswer) {
    _decimals = decimals;
    _latestAnswer = latestAnswer;
    _latestTimestamp = block.timestamp;
    _latestRoundId = 1;
    _roundAnswers[_latestRoundId] = _latestAnswer;
    _roundTimestamps[_latestRoundId] = _latestTimestamp;
  }

  function decimals() external view override returns (uint8) {
    return _decimals;
  }

  function description() external pure override returns (string memory) {
    return 'MOCK / USD';
  }

  function latestAnswer() external view override returns (int256) {
    return _latestAnswer;
  }

  function latestTimestamp() external view override returns (uint256) {
    return _latestTimestamp;
  }

  function latestRound() external view override returns (uint256) {
    return _latestRoundId;
  }

  function getAnswer(uint256 roundId) external view override returns (int256) {
    return _roundAnswers[roundId];
  }

  function getTimestamp(uint256 roundId) external view override returns (uint256) {
    return _roundTimestamps[roundId];
  }

  function updateAnswer(int256 newAnswer) external {
    require(newAnswer > 0, 'Answer must be positive');
    _latestAnswer = newAnswer;
    _latestTimestamp = block.timestamp;
    _latestRoundId++;

    _roundAnswers[_latestRoundId] = newAnswer;
    _roundTimestamps[_latestRoundId] = _latestTimestamp;

    emit AnswerUpdated(newAnswer, _latestRoundId, _latestTimestamp);
    emit NewRound(_latestRoundId, msg.sender);
  }

  function setLatestAnswer(int256 newAnswer) external {
    _latestAnswer = newAnswer;
    _latestTimestamp = block.timestamp;
    _latestRoundId++;

    _roundAnswers[_latestRoundId] = newAnswer;
    _roundTimestamps[_latestRoundId] = _latestTimestamp;
  }
}
