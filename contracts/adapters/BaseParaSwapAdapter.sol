// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.10;

import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {IERC20Detailed} from '../dependencies/openzeppelin/contracts/IERC20Detailed.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';
import {IERC20WithPermit} from '../interfaces/IERC20WithPermit.sol';
import {FlashLoanReceiverBase} from '../flashloan/base/FlashLoanReceiverBase.sol';

/**
 * @title BaseParaSwapAdapter
 * @notice Utility functions for adapters using ParaSwap
 */
abstract contract BaseParaSwapAdapter is FlashLoanReceiverBase, Ownable {
  using SafeERC20 for IERC20;
  using SafeERC20 for IERC20Detailed;
  using SafeERC20 for IERC20WithPermit;

  struct PermitSignature {
    uint256 amount;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
  }

  // Max slippage percent allowed
  uint256 public constant MAX_SLIPPAGE_PERCENT = 3000; // 30%

  IPriceOracleGetter public immutable ORACLE;

  event Swapped(
    address indexed fromAsset,
    address indexed toAsset,
    uint256 fromAmount,
    uint256 receivedAmount
  );

  constructor(IPoolAddressesProvider addressesProvider) FlashLoanReceiverBase(addressesProvider) {
    ORACLE = IPriceOracleGetter(addressesProvider.getPriceOracle());
  }

  /**
   * @dev Get the price of the asset from the oracle denominated in eth
   * @param asset address
   * @return eth price for the asset
   */
  function _getPrice(address asset) internal view returns (uint256) {
    return ORACLE.getAssetPrice(asset);
  }

  /**
   * @dev Get the decimals of an asset
   * @return number of decimals of the asset
   */
  function _getDecimals(IERC20Detailed asset) internal view returns (uint8) {
    uint8 decimals = asset.decimals();
    // Ensure 10**decimals won't overflow a uint256
    require(decimals <= 77, 'TOO_MANY_DECIMALS_ON_TOKEN');
    return decimals;
  }

  /**
   * @dev Get the reserve data associated to the asset
   * @return DataTypes.ReserveData memory
   */
  function _getReserveData(address asset) internal view returns (DataTypes.ReserveData memory) {
    return POOL.getReserveData(asset);
  }

  /**
   * @dev Pull the aTokens from the user
   * @param reserve address of the asset
   * @param reserveAToken address of the aToken of the reserve
   * @param user address
   * @param amount of tokens to be transferred to the contract
   * @param permitSignature struct containing the permit signature
   */
  function _pullATokenAndWithdraw(
    address reserve,
    IERC20WithPermit reserveAToken,
    address user,
    uint256 amount,
    PermitSignature memory permitSignature
  ) internal {
    // If deadline is set to zero, assume there is no signature for permit
    if (permitSignature.deadline != 0) {
      reserveAToken.permit(
        user,
        address(this),
        permitSignature.amount,
        permitSignature.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s
      );
    }

    // transfer from user to adapter
    reserveAToken.safeTransferFrom(user, address(this), amount);

    // withdraw reserve
    require(POOL.withdraw(reserve, amount, address(this)) == amount, 'UNEXPECTED_AMOUNT_WITHDRAWN');
  }

  /**
   * @dev Emergency rescue for token stucked on this contract, as failsafe mechanism
   * - Funds should never remain in this contract more time than during transactions
   * - Only callable by the owner
   */
  function rescueTokens(IERC20 token) external onlyOwner {
    token.safeTransfer(owner(), token.balanceOf(address(this)));
  }
}
