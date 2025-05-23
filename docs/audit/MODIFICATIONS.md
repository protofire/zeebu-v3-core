# Aave V3 Core Modifications Documentation

This document tracks all modifications made to the Aave V3 Core codebase for audit purposes.

## Overview

This document serves as a comprehensive record of changes made to the original Aave V3 Core implementation. It is intended to help auditors understand the modifications and their impact on the system's security and functionality.

## Contract Modifications

### FlashLiquidationAdapterV3

- **File Path**: contracts/flashloan/adapters/FlashLiquidationAdapter.sol
- **Original Version**: N/A (new contract)
- **Modification Date**: Added on [Date]
- **Description**: New contract. Implements a flash loan liquidation adapter for Aave V3, enabling liquidation and asset swaps via Uniswap V3 in a single transaction.

### IFaucetInteractor

- **File Path**: contracts/interfaces/IFaucetInteractor.sol
- **Original Version**: N/A (new contract)
- **Modification Date**: Added on [Date]
- **Description**: New contract. Interface for contracts that interact with a token faucet, allowing minting of tokens for testing purposes.

### MockFaucetInteractor

- **File Path**: contracts/mocks/faucet/MockFaucetInteractor.sol
- **Original Version**: N/A (new contract)
- **Modification Date**: Added on [Date]
- **Description**: New contract. Mock implementation of IFaucetInteractor for testing, allows minting and transferring of tokens from a faucet.

### MockUniswapV3Router

- **File Path**: contracts/mocks/uniswap/MockUniswapV3Router.sol
- **Original Version**: N/A (new contract)
- **Modification Date**: Added on [Date]
- **Description**: New contract. Mock implementation of Uniswap V3 router for testing swaps and price logic in a controlled environment.

_This document should be updated whenever significant changes are made to the codebase._
