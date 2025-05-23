// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IFaucetInteractor
/// @notice Interface for interacting with a Token Faucet
interface IFaucetInteractor {
  /// @notice Mints tokens through the faucet
  /// @dev Contract must be allowlisted in the faucet
  /// @param token The token address to mint
  /// @param amount Amount of tokens to mint
  function allowlistMintSingle(address token, uint256 amount) external;
}
