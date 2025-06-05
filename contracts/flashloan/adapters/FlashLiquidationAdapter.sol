// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {FlashLoanReceiverBase} from '../base/FlashLoanReceiverBase.sol';
import {IPoolAddressesProvider} from '../../interfaces/IPoolAddressesProvider.sol';
import {ISwapRouter} from '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {DataTypes} from '../../protocol/libraries/types/DataTypes.sol';
import {Helpers} from '../../protocol/libraries/helpers/Helpers.sol';
import {IPriceOracleGetter} from '../../interfaces/IPriceOracleGetter.sol';
import {IAToken} from '../../interfaces/IAToken.sol';
import {ReserveConfiguration} from '../../protocol/libraries/configuration/ReserveConfiguration.sol';
import {IPool} from '../../interfaces/IPool.sol';

contract FlashLiquidationAdapterV3 is FlashLoanReceiverBase {
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  struct LiquidationParams {
    address collateralAsset;
    address borrowedAsset;
    address user;
    uint256 debtToCover;
    bool useEthPath;
  }

  struct LiquidationCallLocalVars {
    uint256 initFlashBorrowedBalance;
    uint256 diffFlashBorrowedBalance;
    uint256 initCollateralBalance;
    uint256 diffCollateralBalance;
    uint256 flashLoanDebt;
    uint256 soldAmount;
    uint256 remainingTokens;
    uint256 borrowedAssetLeftovers;
  }

  ISwapRouter public immutable SWAP_ROUTER;

  constructor(
    IPoolAddressesProvider addressesProvider,
    ISwapRouter swapRouter
  ) FlashLoanReceiverBase(addressesProvider) {
    SWAP_ROUTER = swapRouter;
  }

  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(POOL), 'CALLER_MUST_BE_POOL');

    LiquidationParams memory decodedParams = _decodeParams(params);

    require(assets.length == 1 && assets[0] == decodedParams.borrowedAsset, 'INCONSISTENT_PARAMS');

    _liquidateAndSwap(
      decodedParams.collateralAsset,
      decodedParams.borrowedAsset,
      decodedParams.user,
      decodedParams.debtToCover,
      decodedParams.useEthPath,
      amounts[0],
      premiums[0],
      initiator
    );

    return true;
  }

  function _liquidateAndSwap(
    address collateralAsset,
    address borrowedAsset,
    address user,
    uint256 debtToCover,
    bool useEthPath,
    uint256 flashBorrowedAmount,
    uint256 premium,
    address initiator
  ) internal {
    LiquidationCallLocalVars memory vars;
    vars.initCollateralBalance = IERC20(collateralAsset).balanceOf(address(this));

    if (collateralAsset != borrowedAsset) {
      vars.initFlashBorrowedBalance = IERC20(borrowedAsset).balanceOf(address(this));
      vars.borrowedAssetLeftovers = vars.initFlashBorrowedBalance - flashBorrowedAmount;
    }

    vars.flashLoanDebt = flashBorrowedAmount + premium;

    IERC20(borrowedAsset).approve(address(POOL), debtToCover);
    POOL.liquidationCall(collateralAsset, borrowedAsset, user, debtToCover, false);

    uint256 collateralBalanceAfter = IERC20(collateralAsset).balanceOf(address(this));
    vars.diffCollateralBalance = collateralBalanceAfter - vars.initCollateralBalance;

    if (collateralAsset != borrowedAsset) {
      uint256 flashBorrowedAssetAfter = IERC20(borrowedAsset).balanceOf(address(this));
      vars.diffFlashBorrowedBalance = flashBorrowedAssetAfter - vars.borrowedAssetLeftovers;

      IERC20(collateralAsset).approve(address(SWAP_ROUTER), vars.diffCollateralBalance);

      ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
        tokenIn: collateralAsset,
        tokenOut: borrowedAsset,
        fee: 3000,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: vars.diffCollateralBalance,
        amountOutMinimum: vars.flashLoanDebt - vars.diffFlashBorrowedBalance,
        sqrtPriceLimitX96: 0
      });

      vars.soldAmount = SWAP_ROUTER.exactInputSingle(params);
      vars.remainingTokens = vars.diffCollateralBalance - vars.soldAmount;
    } else {
      vars.remainingTokens = vars.diffCollateralBalance - premium;
    }

    IERC20(borrowedAsset).approve(address(POOL), vars.flashLoanDebt);

    uint256 contractCollateralBalance = IERC20(collateralAsset).balanceOf(address(this));
    if (contractCollateralBalance > 0) {
      IERC20(collateralAsset).transfer(initiator, contractCollateralBalance);
    }
  }

  function _decodeParams(bytes memory params) internal pure returns (LiquidationParams memory) {
    (
      address collateralAsset,
      address borrowedAsset,
      address user,
      uint256 debtToCover,
      bool useEthPath
    ) = abi.decode(params, (address, address, address, uint256, bool));

    return LiquidationParams(collateralAsset, borrowedAsset, user, debtToCover, useEthPath);
  }
}
