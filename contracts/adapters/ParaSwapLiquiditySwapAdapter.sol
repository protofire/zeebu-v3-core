// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.10;

import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {BaseParaSwapSellAdapter} from './BaseParaSwapSellAdapter.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {IParaSwapAugustusRegistry} from '../interfaces/IParaSwapAugustusRegistry.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {IERC20WithPermit} from '../interfaces/IERC20WithPermit.sol';
import {IParaSwapAugustus} from '../interfaces/IParaSwapAugustus.sol';
import {console} from 'hardhat/console.sol';

/**
 * @title ParaSwapLiquiditySwapAdapter
 * @notice Adapter to swap liquidity using ParaSwap.
 */
contract ParaSwapLiquiditySwapAdapter is BaseParaSwapSellAdapter {
  using SafeERC20 for IERC20;

  constructor(
    IPoolAddressesProvider addressesProvider,
    IParaSwapAugustusRegistry augustusRegistry
  ) BaseParaSwapSellAdapter(addressesProvider, augustusRegistry) {}

  /**
   * @dev Swaps the received reserve amount from the flash loan into the asset specified in the params.
   * The received funds from the swap are then deposited into the protocol on behalf of the user.
   * The user should give this contract allowance to pull the ZTokens in order to withdraw the underlying asset and repay the flash loan.
   * @param assets Address of the underlying asset to be swapped from
   * @param amounts Amount of the flash loan i.e. maximum amount to swap
   * @param premiums Fee of the flash loan
   * @param initiator Account that initiated the flash loan
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   address assetToSwapTo Address of the underlying asset to be swapped to and deposited
   *   uint256 minAmountToReceive Min amount to be received from the swap
   *   uint256 swapAllBalanceOffset Set to offset of fromAmount in Augustus calldata if wanting to swap all balance, otherwise 0
   *   bytes swapCalldata Calldata for ParaSwap's AugustusSwapper contract
   *   address augustus Address of ParaSwap's AugustusSwapper contract
   *   PermitSignature permitParams Struct containing the permit signatures, set to all zeroes if not used
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(POOL), 'CALLER_MUST_BE_POOL');

    require(
      assets.length == 1 && amounts.length == 1 && premiums.length == 1,
      'FLASHLOAN_MULTIPLE_ASSETS_NOT_SUPPORTED'
    );

    uint256 flashLoanAmount = amounts[0];
    uint256 premium = premiums[0];
    address initiatorLocal = initiator;
    IERC20 assetToSwapFrom = IERC20(assets[0]);
    (
      IERC20 assetToSwapTo,
      uint256 minAmountToReceive,
      uint256 swapAllBalanceOffset,
      bytes memory swapCalldata,
      IParaSwapAugustus augustus,
      PermitSignature memory permitParams
    ) = abi.decode(params, (IERC20, uint256, uint256, bytes, IParaSwapAugustus, PermitSignature));

    _swapLiquidity(
      swapAllBalanceOffset,
      swapCalldata,
      augustus,
      permitParams,
      flashLoanAmount,
      premium,
      initiatorLocal,
      assetToSwapFrom,
      assetToSwapTo,
      minAmountToReceive
    );

    return true;
  }

  /**
   * @dev Swaps an amount of an asset to another and deposits the new asset amount on behalf of the user without using a flash loan.
   * This method can be used when the temporary transfer of the collateral asset to this contract does not affect the user position.
   * The user should give this contract allowance to pull the ZTokens in order to withdraw the underlying asset and perform the swap.
   * @param assetToSwapFrom Address of the underlying asset to be swapped from
   * @param assetToSwapTo Address of the underlying asset to be swapped to and deposited
   * @param amountToSwap Amount to be swapped, or maximum amount when swapping all balance
   * @param minAmountToReceive Minimum amount to be received from the swap
   * @param swapAllBalanceOffset Set to offset of fromAmount in Augustus calldata if wanting to swap all balance, otherwise 0
   * @param swapCalldata Calldata for ParaSwap's AugustusSwapper contract
   * @param augustus Address of ParaSwap's AugustusSwapper contract
   * @param permitParams Struct containing the permit signatures, set to all zeroes if not used
   */
  function swapAndDeposit(
    IERC20 assetToSwapFrom,
    IERC20 assetToSwapTo,
    uint256 amountToSwap,
    uint256 minAmountToReceive,
    uint256 swapAllBalanceOffset,
    bytes calldata swapCalldata,
    IParaSwapAugustus augustus,
    PermitSignature calldata permitParams
  ) external {
    IERC20WithPermit aToken = IERC20WithPermit(
      _getReserveData(address(assetToSwapFrom)).aTokenAddress
    );

    if (swapAllBalanceOffset != 0) {
      uint256 balance = aToken.balanceOf(msg.sender);
      require(balance <= amountToSwap, 'INSUFFICIENT_AMOUNT_TO_SWAP');
      amountToSwap = balance;
    }

    _pullATokenAndWithdraw(
      address(assetToSwapFrom),
      aToken,
      msg.sender,
      amountToSwap,
      permitParams
    );

    uint256 amountReceived = _sellOnParaSwap(
      swapAllBalanceOffset,
      swapCalldata,
      augustus,
      assetToSwapFrom,
      assetToSwapTo,
      amountToSwap,
      minAmountToReceive
    );

    IERC20(address(assetToSwapTo)).safeApprove(address(POOL), 0);
    IERC20(address(assetToSwapTo)).safeApprove(address(POOL), amountReceived);
    POOL.deposit(address(assetToSwapTo), amountReceived, msg.sender, 0);
  }

  /**
   * @dev Swaps an amount of an asset to another and deposits the funds on behalf of the initiator.
   * @param swapAllBalanceOffset Set to offset of fromAmount in Augustus calldata if wanting to swap all balance, otherwise 0
   * @param swapCalldata Calldata for ParaSwap's AugustusSwapper contract
   * @param augustus Address of ParaSwap's AugustusSwapper contract
   * @param permitParams Struct containing the permit signatures, set to all zeroes if not used
   * @param flashLoanAmount Amount of the flash loan i.e. maximum amount to swap
   * @param premium Fee of the flash loan
   * @param initiator Account that initiated the flash loan
   * @param assetToSwapFrom Address of the underyling asset to be swapped from
   * @param assetToSwapTo Address of the underlying asset to be swapped to and deposited
   * @param minAmountToReceive Min amount to be received from the swap
   */
  function _swapLiquidity(
    uint256 swapAllBalanceOffset,
    bytes memory swapCalldata,
    IParaSwapAugustus augustus,
    PermitSignature memory permitParams,
    uint256 flashLoanAmount,
    uint256 premium,
    address initiator,
    IERC20 assetToSwapFrom,
    IERC20 assetToSwapTo,
    uint256 minAmountToReceive
  ) internal {
    IERC20WithPermit aToken = IERC20WithPermit(
      _getReserveData(address(assetToSwapFrom)).aTokenAddress
    );
    uint256 amountToSwap = flashLoanAmount;

    uint256 balance = aToken.balanceOf(initiator);
    if (swapAllBalanceOffset != 0) {
      uint256 balanceToSwap = balance - premium;
      require(balanceToSwap <= amountToSwap, 'INSUFFICIENT_AMOUNT_TO_SWAP');
      amountToSwap = balanceToSwap;
    } else {
      require(balance >= amountToSwap + premium, 'INSUFFICIENT_ATOKEN_BALANCE');
    }

    uint256 amountReceived = _sellOnParaSwap(
      swapAllBalanceOffset,
      swapCalldata,
      augustus,
      assetToSwapFrom,
      assetToSwapTo,
      amountToSwap,
      minAmountToReceive
    );

    IERC20(address(assetToSwapTo)).safeApprove(address(POOL), 0);
    IERC20(address(assetToSwapTo)).safeApprove(address(POOL), amountReceived);
    POOL.deposit(address(assetToSwapTo), amountReceived, initiator, 0);

    _pullATokenAndWithdraw(
      address(assetToSwapFrom),
      aToken,
      initiator,
      amountToSwap + premium,
      permitParams
    );

    assetToSwapFrom.safeApprove(address(POOL), 0);
    assetToSwapFrom.safeApprove(address(POOL), flashLoanAmount + premium);
  }
}
