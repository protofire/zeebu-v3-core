// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IParaSwapAugustus} from '../../interfaces/IParaSwapAugustus.sol';
import {MockParaSwapTokenTransferProxy} from './MockParaSwapTokenTransferProxy.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {MintableERC20} from '../tokens/MintableERC20.sol';
import {SafeMath} from '../../dependencies/openzeppelin/contracts/SafeMath.sol';
import {IFaucetInteractor} from '../../interfaces/IFaucetInteractor.sol';

contract MockParaSwapAugustusTestnet is IParaSwapAugustus {
  using SafeMath for uint256;

  MockParaSwapTokenTransferProxy immutable TOKEN_TRANSFER_PROXY;
  string constant INVALID_SWAP_AMOUNT = 'amount and msg.value mismatch';
  address constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  mapping(address => uint256) private _tokenPricesInETH;
  mapping(address => bool) private _isMintable;
  IFaucetInteractor internal faucetInteractor;

  event TokenPricesSet(address[] tokens, uint256[] prices, bool[] isMintable);
  event Swaped(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

  bool _expectingSwap;
  address _expectedFromToken;
  address _expectedToToken;
  uint256 _expectedFromAmountMin;
  uint256 _expectedFromAmountMax;
  uint256 _receivedAmount;

  constructor(IFaucetInteractor _faucetInteractor) {
    TOKEN_TRANSFER_PROXY = new MockParaSwapTokenTransferProxy();
    faucetInteractor = _faucetInteractor;
  }

  function getTokenTransferProxy() external view override returns (address) {
    return address(TOKEN_TRANSFER_PROXY);
  }

  function getTokenPrice(address token) external view returns (uint256) {
    require(_tokenPricesInETH[token] > 0, 'Price not set');
    return _tokenPricesInETH[token];
  }

  function expectSwap(
    address fromToken,
    address toToken,
    uint256 fromAmountMin,
    uint256 fromAmountMax,
    uint256 receivedAmount
  ) external {
    _expectingSwap = true;
    _expectedFromToken = fromToken;
    _expectedToToken = toToken;
    _expectedFromAmountMin = fromAmountMin;
    _expectedFromAmountMax = fromAmountMax;
    _receivedAmount = receivedAmount;
  }

  function swap(
    address fromToken,
    address toToken,
    uint256 fromAmount,
    uint256 toAmount
  ) external returns (uint256) {
    require(
      _tokenPricesInETH[fromToken] > 0 && _tokenPricesInETH[toToken] > 0,
      'Token price not set'
    );

    uint8 fromDecimals = MintableERC20(fromToken).decimals();
    uint8 toDecimals = MintableERC20(toToken).decimals();

    uint256 receivedAmount = calculateReceivedAmount(
      fromAmount,
      _tokenPricesInETH[fromToken],
      _tokenPricesInETH[toToken],
      fromDecimals,
      toDecimals
    );

    TOKEN_TRANSFER_PROXY.transferFrom(fromToken, msg.sender, address(this), fromAmount);
    if (_isMintable[toToken]) {
      faucetInteractor.allowlistMintSingle(toToken, receivedAmount);
    }
    IERC20(toToken).transfer(msg.sender, receivedAmount);
    _expectingSwap = false;

    emit Swaped(fromToken, toToken, fromAmount, receivedAmount);
    return receivedAmount;
  }

  function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOut,
    address tokenIn,
    address tokenOut
  ) external payable returns (uint256) {
    if (tokenIn == NATIVE_TOKEN) {
      require(msg.value == amountIn, INVALID_SWAP_AMOUNT);
    } else {
      TOKEN_TRANSFER_PROXY.transferFrom(tokenIn, msg.sender, address(this), amountIn);
    }

    if (_isMintable[tokenOut]) {
      faucetInteractor.allowlistMintSingle(tokenOut, amountOut);
    }
    IERC20(tokenOut).transfer(msg.sender, amountOut);
    _expectingSwap = false;

    emit Swaped(tokenIn, tokenOut, amountIn, amountOut);
    return amountOut;
  }

  /**
   * @notice Sets the prices and mintable status for multiple tokens
   * @param tokens Array of token addresses to set prices for
   * @param pricesInETH Array of prices in ETH for each token (with 18 decimals)
   * @param isMintable Array of booleans indicating if each token can be minted
   * @dev All input arrays must be the same length
   * @dev Token addresses cannot be zero address
   * @dev Prices must be greater than 0
   */
  function setTokenPrices(
    address[] calldata tokens,
    uint256[] calldata pricesInETH,
    bool[] calldata isMintable
  ) external {
    require(
      tokens.length == pricesInETH.length && tokens.length == isMintable.length,
      'Arrays length mismatch'
    );

    for (uint256 i = 0; i < tokens.length; i++) {
      require(tokens[i] != address(0), 'Invalid token address');
      _tokenPricesInETH[tokens[i]] = pricesInETH[i];
      _isMintable[tokens[i]] = isMintable[i];
    }

    emit TokenPricesSet(tokens, pricesInETH, isMintable);
  }

  /**
   * @notice Calculates the received amount when swapping between tokens
   * @dev If tokens have different decimals, delegates to calculateDifferentDecimals
   * @param amountIn The input amount of source token
   * @param priceTokenIn The price of input token in ETH (18 decimals)
   * @param priceTokenOut The price of output token in ETH (18 decimals)
   * @param fromDecimals The decimal places of the input token
   * @param toDecimals The decimal places of the output token
   * @return The calculated output amount in target token decimals
   */
  function calculateReceivedAmount(
    uint256 amountIn,
    uint256 priceTokenIn,
    uint256 priceTokenOut,
    uint8 fromDecimals,
    uint8 toDecimals
  ) internal returns (uint256) {
    if (fromDecimals != toDecimals) {
      return
        calculateDifferentDecimals(amountIn, priceTokenIn, priceTokenOut, fromDecimals, toDecimals);
    }
    return amountIn.mul(priceTokenIn).div(priceTokenOut);
  }

  /**
   * @notice Calculates the received amount when swapping between tokens with different decimals
   * @dev Normalizes token amounts to 18 decimals for calculation, then adjusts back to target decimals
   * @param amountIn The input amount of source token
   * @param priceTokenIn The price of input token in ETH (18 decimals)
   * @param priceTokenOut The price of output token in ETH (18 decimals)
   * @param fromDecimals The decimal places of the input token
   * @param toDecimals The decimal places of the output token
   * @return The calculated output amount in target token decimals
   */
  function calculateDifferentDecimals(
    uint256 amountIn,
    uint256 priceTokenIn,
    uint256 priceTokenOut,
    uint8 fromDecimals,
    uint8 toDecimals
  ) internal returns (uint256) {
    uint256 normalizedAmount = amountIn;
    if (fromDecimals < 18) {
      uint256 decimalsDifference = 18 - fromDecimals;
      normalizedAmount = amountIn.mul(10 ** decimalsDifference);
    }

    uint256 transferAmount = normalizedAmount.mul(priceTokenIn).div(priceTokenOut);

    uint256 finalAmount = transferAmount;
    if (toDecimals < 18) {
      uint256 decimalsDifference = 18 - toDecimals;
      finalAmount = transferAmount.div(10 ** decimalsDifference);
    }

    return finalAmount;
  }

  function getFaucetAddress() public view returns (address) {
    return address(faucetInteractor);
  }

  // It is used to accept Native oken
  receive() external payable {}
}
