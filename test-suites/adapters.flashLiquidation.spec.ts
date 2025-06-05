import { makeSuite, TestEnv } from './helpers/make-suite';
import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { getEthersSigners, MAX_UINT_AMOUNT, ZERO_ADDRESS } from '@aave/deploy-v3';
import {
  MockUniswapV3Router,
  MockFaucetInteractor,
  MockFaucetInteractor__factory,
  MockUniswapV3Router__factory,
  FlashLiquidationAdapterV3__factory,
} from '../types';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { buildFlashLiquidationAdapterParams } from './helpers/contracts-helpers';
const { expect } = require('chai');
import { HardhatRuntimeEnvironment } from 'hardhat/types';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Testnet adapters', (testEnv: TestEnv) => {
  let mockUniswapRouter: MockUniswapV3Router;
  let faucetInteractor: MockFaucetInteractor;
  let userWallet = 0;

  describe('FlashLiquidationAdapter', () => {
    before('Before LendingPool liquidation: set config', () => {
      BigNumber.config({ DECIMAL_PLACES: 0, ROUNDING_MODE: BigNumber.ROUND_DOWN });
    });

    after('After LendingPool liquidation: reset config', () => {
      BigNumber.config({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
    });

    describe('constructor', () => {
      it('should deploy with correct parameters', async () => {
        const { deployer } = testEnv;
        faucetInteractor = await new MockFaucetInteractor__factory(deployer.signer).deploy();
        mockUniswapRouter = await new MockUniswapV3Router__factory(deployer.signer).deploy(
          faucetInteractor.address
        );
        expect(mockUniswapRouter.address).to.not.equal(ZERO_ADDRESS);
      });
    });

    describe('UniswapV2RouterTestnet operations', () => {
      it('should correctly set token prices', async () => {
        const { weth, aave } = testEnv;

        const tokens = [weth.address, aave.address];
        const prices = [ethers.utils.parseEther('1'), ethers.utils.parseEther('0.5')];
        const isMintable = [true, true];

        await expect(mockUniswapRouter.setTokenPrices(tokens, prices, isMintable))
          .to.emit(mockUniswapRouter, 'TokenPricesSet')
          .withArgs(tokens, prices, isMintable);
      });

      it('should correctly handle swapTokensForExactTokens', async () => {
        userWallet += 1;
        const { weth, aave, users } = testEnv;
        const user = users[userWallet];

        const path = [aave.address, weth.address];
        const prices = [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')];
        const isMintable = [false, false];

        await mockUniswapRouter.setTokenPrices(path, prices, isMintable);

        const routerAmount = parseEther('10000');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, routerAmount);
        await weth.connect(user.signer).transfer(mockUniswapRouter.address, routerAmount);

        const amountIn = parseEther('1000');
        const expectedAmountOut = parseEther('1');

        await aave
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, amountIn);
        await aave.connect(user.signer).approve(mockUniswapRouter.address, amountIn);

        await expect(
          mockUniswapRouter.connect(user.signer).exactOutputSingle({
            tokenIn: aave.address,
            tokenOut: weth.address,
            fee: 3000,
            recipient: user.address,
            deadline: MAX_UINT_AMOUNT,
            amountOut: expectedAmountOut,
            amountInMaximum: amountIn,
            sqrtPriceLimitX96: 0,
          })
        )
          .to.emit(mockUniswapRouter, 'Swapped')
          .withArgs(aave.address, weth.address, amountIn, expectedAmountOut);
      });

      it('should correctly handle exactOutputSingle', async () => {
        userWallet += 1;
        const { weth, aave, users } = testEnv;
        const user = users[userWallet];
        const tokens = [aave.address, weth.address];
        const prices = [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')];
        const isMintable = [false, false];

        await mockUniswapRouter.setTokenPrices(tokens, prices, isMintable);

        const routerAmount = parseEther('10000');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, routerAmount);
        await weth.connect(user.signer).transfer(mockUniswapRouter.address, routerAmount);

        const amountIn = parseEther('1000');
        const expectedAmountOut = parseEther('1');

        await aave
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, amountIn);
        await aave.connect(user.signer).approve(mockUniswapRouter.address, amountIn);

        const tx = await mockUniswapRouter.connect(user.signer).exactInputSingle({
          tokenIn: aave.address,
          tokenOut: weth.address,
          fee: 3000,
          recipient: user.address,
          deadline: MAX_UINT_AMOUNT,
          amountIn: amountIn,
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0,
        });

        await expect(tx, 'Swap event is not emitted or not correct')
          .to.emit(mockUniswapRouter, 'Swapped')
          .withArgs(aave.address, weth.address, amountIn, expectedAmountOut);
      });

      it('should revert if token prices not set', async () => {
        userWallet += 1;
        const { weth, aave, users } = testEnv;
        const user = users[userWallet];

        const tokens = [weth.address, aave.address];
        const prices = [0, 0];
        const isMintable = [false, false];

        await mockUniswapRouter.setTokenPrices(tokens, prices, isMintable);

        const routerAmount = parseEther('10000');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](mockUniswapRouter.address, routerAmount);
        await aave
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](mockUniswapRouter.address, routerAmount);

        const amountIn = parseEther('1');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, amountIn);
        await weth.connect(user.signer).approve(mockUniswapRouter.address, amountIn);

        await expect(
          mockUniswapRouter.connect(user.signer).exactOutputSingle({
            tokenIn: weth.address,
            tokenOut: aave.address,
            fee: 3000,
            recipient: user.address,
            deadline: MAX_UINT_AMOUNT,
            amountOut: 0,
            amountInMaximum: amountIn,
            sqrtPriceLimitX96: 0,
          })
        ).to.be.revertedWith('Price not set');
      });

      it('should handle different token decimals correctly (exactOutputSingle)', async () => {
        userWallet += 1;
        const { weth, usdc, users } = testEnv;
        const user = users[userWallet];

        const tokens = [usdc.address, weth.address];
        const prices = [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')];
        const isMintable = [true, true];

        await mockUniswapRouter.setTokenPrices(tokens, prices, isMintable);

        const routerAmount = parseEther('10000');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](mockUniswapRouter.address, routerAmount);

        const amountOut = parseEther('1');
        const expectedAmountIn = parseUnits('1000', 6);

        await usdc
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, expectedAmountIn);
        await usdc.connect(user.signer).approve(mockUniswapRouter.address, expectedAmountIn);

        const tx = await mockUniswapRouter.connect(user.signer).exactOutputSingle({
          tokenIn: usdc.address,
          tokenOut: weth.address,
          fee: 3000,
          recipient: user.address,
          deadline: MAX_UINT_AMOUNT,
          amountOut: amountOut,
          amountInMaximum: expectedAmountIn,
          sqrtPriceLimitX96: 0,
        });

        await expect(tx)
          .to.emit(mockUniswapRouter, 'Swapped')
          .withArgs(usdc.address, weth.address, expectedAmountIn, amountOut);

        const wethBalance = await weth.balanceOf(user.address);
        expect(wethBalance, 'WETH balance is not correct').to.equal(amountOut);
      });

      it('should handle different token decimals correctly (swapTokensForExactTokens)', async () => {
        userWallet += 1;
        const { weth, usdc, users } = testEnv;
        const user = users[userWallet];
        const tokens = [usdc.address, weth.address];
        const prices = [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')];

        const isMintable = [true, true];
        await mockUniswapRouter.setTokenPrices(tokens, prices, isMintable);

        const routerAmount = parseEther('10000');
        await weth
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, routerAmount);
        await weth.connect(user.signer).transfer(mockUniswapRouter.address, routerAmount);

        const amountOut = parseEther('1');
        const expectedAmountIn = parseUnits('1000', 6);

        await usdc
          .connect(testEnv.deployer.signer)
          .functions['mint(address,uint256)'](user.address, expectedAmountIn);
        await usdc.connect(user.signer).approve(mockUniswapRouter.address, expectedAmountIn);

        const tx = await mockUniswapRouter.connect(user.signer).exactOutputSingle({
          tokenIn: usdc.address,
          tokenOut: weth.address,
          fee: 3000,
          recipient: user.address,
          deadline: MAX_UINT_AMOUNT,
          amountOut: amountOut,
          amountInMaximum: expectedAmountIn,
          sqrtPriceLimitX96: 0,
        });

        await expect(tx, 'Swap event is not emitted or not correct')
          .to.emit(mockUniswapRouter, 'Swapped')
          .withArgs(usdc.address, weth.address, expectedAmountIn, amountOut);
      });
    });

    describe('FlashLiquidationAdapterV3', () => {
      let flashLiquidationAdapter: any;
      let router: MockUniswapV3Router;

      beforeEach(async () => {
        const { deployer, pool, addressesProvider } = testEnv;
        router = await new MockUniswapV3Router__factory(deployer.signer).deploy(
          faucetInteractor.address
        );
        flashLiquidationAdapter = await new FlashLiquidationAdapterV3__factory(
          deployer.signer
        ).deploy(addressesProvider.address, router.address);
      });

      it('should not execute liquidation when health factor is not below threshold', async () => {
        const {
          weth,
          usdc,
          users: [user],
          deployer,
          pool,
        } = testEnv;

        await mockUniswapRouter.setTokenPrices(
          [usdc.address, weth.address],
          [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')],
          [true, true]
        );
        const collateralAmount = parseUnits('1000', 6);
        await usdc
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](flashLiquidationAdapter.address, collateralAmount);
        const flashBorrowedAmount = parseEther('1');
        await weth
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](flashLiquidationAdapter.address, flashBorrowedAmount);
        const params = buildFlashLiquidationAdapterParams(
          usdc.address,
          weth.address,
          user.address,
          flashBorrowedAmount,
          false
        );

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [pool.address],
        });
        const poolImpersonatedSigner = await hre.ethers.getSigner(pool.address);

        await expect(
          flashLiquidationAdapter
            .connect(poolImpersonatedSigner)
            .executeOperation([weth.address], [flashBorrowedAmount], [0], user.address, params)
        ).to.be.revertedWith('45');
      });

      it('should not execute liquidation when caller is not pool', async () => {
        const {
          weth,
          usdc,
          users: [user],
          deployer,
          pool,
        } = testEnv;

        await mockUniswapRouter.setTokenPrices(
          [usdc.address, weth.address],
          [ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1')],
          [true, true]
        );
        const collateralAmount = parseUnits('1000', 6);
        await usdc
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](flashLiquidationAdapter.address, collateralAmount);
        const flashBorrowedAmount = parseEther('1');
        await weth
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](flashLiquidationAdapter.address, flashBorrowedAmount);
        const params = buildFlashLiquidationAdapterParams(
          usdc.address,
          weth.address,
          user.address,
          flashBorrowedAmount,
          false
        );

        await expect(
          flashLiquidationAdapter
            .connect(deployer.signer)
            .executeOperation([weth.address], [flashBorrowedAmount], [0], user.address, params)
        ).to.be.revertedWith('CALLER_MUST_BE_POOL');
      });
    });
  });
});
