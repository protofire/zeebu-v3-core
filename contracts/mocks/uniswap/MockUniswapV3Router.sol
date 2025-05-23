// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISwapRouter} from '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {MintableERC20} from '../tokens/MintableERC20.sol';
import {SafeMath} from '../../dependencies/openzeppelin/contracts/SafeMath.sol';
import {IFaucetInteractor} from '../../interfaces/IFaucetInteractor.sol';
import {console} from 'hardhat/console.sol';

contract MockUniswapV3Router is ISwapRouter {
  using SafeMath for uint256;

  mapping(address => uint256) private _tokenPricesInETH;
  mapping(address => bool) private _isMintable;

  uint256 internal _defaultMockValue;
  IFaucetInteractor internal faucetInteractor;

  event TokenPricesSet(address[] tokens, uint256[] pricesInETH, bool[] isMintable);
  event Swapped(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
  event DebugCalculation(
    uint256 amountOut,
    uint256 priceTokenIn,
    uint256 priceTokenOut,
    uint8 fromDecimals,
    uint8 toDecimals,
    uint256 numerator,
    uint256 denominator,
    uint256 result
  );

  constructor(IFaucetInteractor _faucetInteractor) {
    faucetInteractor = _faucetInteractor;
  }

  function setTokenPrices(
    address[] calldata tokens,
    uint256[] calldata pricesInETH,
    bool[] calldata isMintable
  ) external {
    require(
      tokens.length == pricesInETH.length && tokens.length == isMintable.length,
      'Length mismatch'
    );

    for (uint256 i = 0; i < tokens.length; i++) {
      require(tokens[i] != address(0), 'Invalid token');
      _tokenPricesInETH[tokens[i]] = pricesInETH[i];
      _isMintable[tokens[i]] = isMintable[i];
    }

    emit TokenPricesSet(tokens, pricesInETH, isMintable);
  }

  function exactInputSingle(
    ExactInputSingleParams calldata params
  ) external payable override returns (uint256 amountOut) {
    require(
      _tokenPricesInETH[params.tokenIn] > 0 && _tokenPricesInETH[params.tokenOut] > 0,
      'Price not set'
    );

    uint8 fromDecimals = MintableERC20(params.tokenIn).decimals();
    uint8 toDecimals = MintableERC20(params.tokenOut).decimals();

    amountOut = _calculateAmountOut(
      params.amountIn,
      _tokenPricesInETH[params.tokenIn],
      _tokenPricesInETH[params.tokenOut],
      fromDecimals,
      toDecimals
    );

    IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

    if (_isMintable[params.tokenOut]) {
      faucetInteractor.allowlistMintSingle(params.tokenOut, amountOut);
    }

    IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    emit Swapped(params.tokenIn, params.tokenOut, params.amountIn, amountOut);
  }

  function exactInput(ExactInputParams calldata) external payable override returns (uint256) {
    revert('Not implemented');
  }

  function exactOutputSingle(
    ExactOutputSingleParams calldata params
  ) external payable override returns (uint256 amountIn) {
    require(
      _tokenPricesInETH[params.tokenIn] > 0 && _tokenPricesInETH[params.tokenOut] > 0,
      'Price not set'
    );

    uint8 fromDecimals = MintableERC20(params.tokenIn).decimals();
    uint8 toDecimals = MintableERC20(params.tokenOut).decimals();

    amountIn = _calculateAmountIn(
      params.amountOut,
      _tokenPricesInETH[params.tokenIn],
      _tokenPricesInETH[params.tokenOut],
      fromDecimals,
      toDecimals
    );

    IERC20(params.tokenIn).transferFrom(msg.sender, address(this), amountIn);

    if (_isMintable[params.tokenOut]) {
      faucetInteractor.allowlistMintSingle(params.tokenOut, params.amountOut);
    }

    IERC20(params.tokenOut).transfer(params.recipient, params.amountOut);
    emit Swapped(params.tokenIn, params.tokenOut, amountIn, params.amountOut);
  }

  function exactOutput(ExactOutputParams calldata) external payable override returns (uint256) {
    revert('Not implemented');
  }

  function _calculateAmountIn(
    uint256 amountOut,
    uint256 priceTokenIn,
    uint256 priceTokenOut,
    uint8 fromDecimals,
    uint8 toDecimals
  ) internal returns (uint256 amountIn) {
    uint256 numerator = amountOut.mul(priceTokenOut).mul(10 ** uint256(fromDecimals));
    uint256 denominator = priceTokenIn.mul(10 ** uint256(toDecimals));
    uint256 result = numerator.div(denominator);

    emit DebugCalculation(
      amountOut,
      priceTokenIn,
      priceTokenOut,
      fromDecimals,
      toDecimals,
      numerator,
      denominator,
      result
    );

    return result;
  }

  function _calculateAmountOut(
    uint256 amountIn,
    uint256 priceTokenIn,
    uint256 priceTokenOut,
    uint8 fromDecimals,
    uint8 toDecimals
  ) internal pure returns (uint256 amountOut) {
    uint256 numerator = amountIn.mul(priceTokenIn).mul(10 ** uint256(toDecimals));
    uint256 denominator = priceTokenOut.mul(10 ** uint256(fromDecimals));
    return numerator.div(denominator);
  }

  function setDefaultMockValue(uint256 value) external {
    _defaultMockValue = value;
  }

  function getFaucetAddress() external view returns (address) {
    return address(faucetInteractor);
  }

  receive() external payable {}

  function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
  ) external pure override {
    // This is a mock, so we do nothing here.
    // The uniswapV3SwapCallback is only used when interacting with real Uniswap V3 pools.
  }
}
