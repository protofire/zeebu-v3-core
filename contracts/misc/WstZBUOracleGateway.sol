// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

import {IChainlinkAggregator} from './interfaces/IChainlinkAggregator.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {IACLManager} from '../interfaces/IACLManager.sol';

/**
 * @title WSTZBU Chainlink Price Aggregator
 * @notice Gateway contract for wstZBU oracle that converts price from 18 decimals to 8 decimals
 * @dev Implements Chainlink Aggregator interface to provide price conversion functionality
 */
contract WSTZBUChainlinkPriceAggregator is IChainlinkAggregator {
  int256 public WSTZBU_USD_PRICE = 518000000; // $5.18 USD with 8 decimals
  uint256 public currentRoundId = 1;

  IChainlinkAggregator public SOURCE_ORACLE; // WSTZBU/ETH price aggregator in 18 decimals
  IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

  int256 public fakePrice;

  mapping(uint256 => int256) private roundAnswers;
  mapping(uint256 => uint256) private roundTimestamps;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 timestamp); // Emitted when the answer is updated
  event NewRound(uint256 indexed roundId, address indexed startedBy); // Emitted when a new round is started
  event NewSourceOracle(address indexed newSource); // Emitted when the source oracle is updated

  constructor(address _sourceOracle, IPoolAddressesProvider provider) {
    SOURCE_ORACLE = IChainlinkAggregator(_sourceOracle);
    ADDRESSES_PROVIDER = provider;

    roundAnswers[currentRoundId] = 0;
    roundTimestamps[currentRoundId] = block.timestamp;
  }

  modifier onlyAdmin() {
    require(
      IACLManager(ADDRESSES_PROVIDER.getACLManager()).isPoolAdmin(msg.sender),
      'Only pool admin can call this function'
    );
    _;
  }

  function decimals() external pure override returns (uint8) {
    return 8;
  }

  function description() external pure override returns (string memory) {
    return 'wstZBU / USD';
  }

  /**
   * @notice Sets a fake wstZBU/USD price for testing purposes.
   * @dev This overrides the calculated price.
   */
  function setFakePrice(int256 _fakePrice) external onlyAdmin {
    require(_fakePrice >= 0, 'Fake price must be non-negative');
    fakePrice = _fakePrice;
    emit AnswerUpdated(fakePrice, currentRoundId, block.timestamp);
    _startNewRound(fakePrice);
  }

  /**
   * @notice Resets to the real calculated ZBU/USD price.
   */
  function resetToRealPrice() external onlyAdmin {
    fakePrice = 0;
  }

  /**
   * @notice Returns the latest ZBU/USD price.
   * @dev Multiplies WSTZBU/ETH price by WSTZBU_USD_PRICE and scales to 8 decimals
   */
  function latestAnswer() external view override returns (int256) {
    if (fakePrice > 0) {
      return fakePrice;
    }

    int256 wstZbuEthPrice = SOURCE_ORACLE.latestAnswer();
    require(wstZbuEthPrice > 0, 'Invalid WSTZBU/ETH price');

    uint256 wstZbuEthPriceUint = uint256(wstZbuEthPrice);
    uint256 sourceDecimals = uint256(SOURCE_ORACLE.decimals());
    uint256 scale = 10 ** sourceDecimals;

    uint256 wstZbuUsdPrice = (wstZbuEthPriceUint * uint256(WSTZBU_USD_PRICE)) / scale;

    return int256(wstZbuUsdPrice);
  }

  function latestTimestamp() external view override returns (uint256) {
    return roundTimestamps[currentRoundId];
  }

  function latestRound() external view override returns (uint256) {
    return currentRoundId;
  }

  function getAnswer(uint256 roundId) external view override returns (int256) {
    return roundAnswers[roundId];
  }

  function getTimestamp(uint256 roundId) external view override returns (uint256) {
    return roundTimestamps[roundId];
  }

  function _startNewRound(int256 newPrice) internal {
    currentRoundId++;
    roundAnswers[currentRoundId] = newPrice;
    roundTimestamps[currentRoundId] = block.timestamp;

    emit NewRound(currentRoundId, msg.sender);
  }

  function setSourceOracle(address newSource) external onlyAdmin {
    require(newSource != address(0), 'Invalid source oracle');
    require(newSource != address(SOURCE_ORACLE), 'New source oracle must be different');
    SOURCE_ORACLE = IChainlinkAggregator(newSource);
    emit NewSourceOracle(newSource);
  }
}
