import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  convertToCurrencyDecimals,
  buildPermitParams,
  getSignatureFromTypedData,
  buildParaSwapLiquiditySwapParams,
} from '../helpers/contracts-helpers';
import { Zero } from '@ethersproject/constants';
import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import {
  AToken,
  aave,
  eContractid,
  evmRevert,
  evmSnapshot,
  getAToken,
  getContract,
  getFirstSigner,
} from '@aave/deploy-v3';
import { tEthereumAddress } from '../helpers/types';
const { parseEther } = ethers.utils;
import {
  ParaSwapLiquiditySwapAdapter,
  ParaSwapLiquiditySwapAdapter__factory,
  MockParaSwapAugustus,
  MockParaSwapAugustusRegistry,
  MockParaSwapAugustus__factory,
  MockParaSwapAugustusRegistry__factory,
} from '../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
declare var hre: HardhatRuntimeEnvironment;

const { expect } = require('chai');

export const deployParaSwapLiquiditySwapAdapter = async (
  addressesProvider: tEthereumAddress,
  augustusRegistry: tEthereumAddress
) =>
  await new ParaSwapLiquiditySwapAdapter__factory(await getFirstSigner()).deploy(
    addressesProvider,
    augustusRegistry
  );

makeSuite('ParaSwap adapters', (testEnv: TestEnv) => {
  let mockAugustus: MockParaSwapAugustus;
  let mockAugustusRegistry: MockParaSwapAugustusRegistry;
  let paraswapLiquiditySwapAdapter: ParaSwapLiquiditySwapAdapter;
  let evmSnapshotId: string;

  before(async () => {
    const signer = await getFirstSigner();
    mockAugustus = await new MockParaSwapAugustus__factory(signer).deploy();
    mockAugustusRegistry = await new MockParaSwapAugustusRegistry__factory(signer).deploy(
      mockAugustus.address
    );
    console.log('Deployed mockAugustus and mockAugustusRegistry...');
    console.log('mockAugustus', mockAugustus.address);
    console.log('mockAugustusRegistry', mockAugustusRegistry.address);
    paraswapLiquiditySwapAdapter = await deployParaSwapLiquiditySwapAdapter(
      testEnv.addressesProvider.address,
      mockAugustusRegistry.address
    );
    console.log('Deployed paraswapLiquiditySwapAdapter...');
    console.log('paraswapLiquiditySwapAdapter', paraswapLiquiditySwapAdapter.address);
  });

  beforeEach(async () => {
    evmSnapshotId = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(evmSnapshotId);
  });

  describe('ParaSwapLiquiditySwapAdapter', () => {
    describe('executeOperation', () => {
      beforeEach(async () => {
        const {
          users: [user],
          weth,
          aave,
          pool,
          deployer,
        } = testEnv;
        const userAddress = user.address;

        const aaveAmount = await convertToCurrencyDecimals(aave.address, '20000');
        await aave
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](deployer.address, aaveAmount);
        await aave.connect(deployer.signer).approve(pool.address, aaveAmount);
        await pool.connect(deployer.signer).deposit(aave.address, aaveAmount, deployer.address, 0);

        const wethAmount = await convertToCurrencyDecimals(weth.address, '10000');
        await weth
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](deployer.address, wethAmount);
        await weth.connect(deployer.signer).approve(pool.address, wethAmount);
        await pool.connect(deployer.signer).deposit(weth.address, wethAmount, deployer.address, 0);

        const userWethAmount = await convertToCurrencyDecimals(weth.address, '100');
        await weth
          .connect(user.signer)
          .functions['mint(address,uint256)'](userAddress, userWethAmount);
        await weth.connect(user.signer).approve(pool.address, userWethAmount);
        await pool.connect(user.signer).deposit(weth.address, userWethAmount, userAddress, 0);
      });

      it('should correctly swap tokens and deposit the out tokens in the pool', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aAave,
          aWETH,
        } = testEnv;
        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);

        const rawExpectedAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        const expectedUsdcAmount = rawExpectedAmount.mul(98).div(100);

        await mockAugustus
          .connect(user.signer)
          .expectSwap(
            weth.address,
            aave.address,
            amountWETHtoSwap,
            amountWETHtoSwap,
            expectedUsdcAmount
          );

        const flashloanPremium = amountWETHtoSwap.mul(9).div(10000);
        const flashloanTotal = amountWETHtoSwap.add(flashloanPremium);

        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, flashloanTotal);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount,
        ]);

        const params = buildParaSwapLiquiditySwapParams(
          aave.address,
          0,
          0,
          mockAugustusCalldata,
          mockAugustus.address,
          0,
          0,
          0,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000'
        );

        await expect(
          pool
            .connect(user.signer)
            .flashLoan(
              paraswapLiquiditySwapAdapter.address,
              [weth.address],
              [amountWETHtoSwap],
              [0],
              userAddress,
              params,
              0
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterAaveBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterAaveBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(flashloanTotal));
        expect(userAEthBalance).to.be.lte(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });

      it('should correctly swap tokens using permit', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aAave,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        const flashloanPremium = amountWETHtoSwap.mul(9).div(10000);
        const flashloanTotal = amountWETHtoSwap.add(flashloanPremium);

        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH.nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          paraswapLiquiditySwapAdapter.address,
          nonce,
          deadline,
          flashloanTotal.toString()
        );

        const ownerPrivateKey = require('../test-wallets.js').accounts[1].secretKey;
        if (!ownerPrivateKey) {
          throw new Error('INVALID_OWNER_PK');
        }

        const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount,
        ]);

        const params = buildParaSwapLiquiditySwapParams(
          aave.address,
          0,
          0,
          mockAugustusCalldata,
          mockAugustus.address,
          flashloanTotal,
          deadline,
          v,
          r,
          s
        );

        await expect(
          pool
            .connect(user.signer)
            .flashLoan(
              paraswapLiquiditySwapAdapter.address,
              [weth.address],
              [amountWETHtoSwap],
              [0],
              userAddress,
              params,
              0
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterAaveBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterAaveBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(flashloanTotal));
        expect(userAEthBalance).to.be.lte(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });

      it('should revert if caller not lending pool', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aAave,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        const flashloanPremium = amountWETHtoSwap.mul(9).div(10000);
        const flashloanTotal = amountWETHtoSwap.add(flashloanPremium);

        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, flashloanTotal);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount,
        ]);

        const params = buildParaSwapLiquiditySwapParams(
          aave.address,
          expectedUsdcAmount,
          0,
          mockAugustusCalldata,
          mockAugustus.address,
          0,
          0,
          0,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000'
        );

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .executeOperation([weth.address], [amountWETHtoSwap], [0], userAddress, params)
        ).to.be.revertedWith('CALLER_MUST_BE_POOL');
      });

      it('should work correctly with tokens of different decimals', async () => {
        const {
          users: [user],
          usdc,
          oracle,
          aave,
          pool,
          deployer,
        } = testEnv;
        const userAddress = user.address;

        const amountUSDCtoSwap = await convertToCurrencyDecimals(usdc.address, '10');
        const liquidity = await convertToCurrencyDecimals(usdc.address, '20000');

        const flashloanPremium = amountUSDCtoSwap.mul(9).div(10000);
        const flashloanTotal = amountUSDCtoSwap.add(flashloanPremium);

        await usdc
          .connect(deployer.signer)
          .functions['mint(address,uint256)'](deployer.address, liquidity);
        await usdc.connect(deployer.signer).approve(pool.address, liquidity);
        await pool.deposit(usdc.address, liquidity, deployer.address, 0);

        await usdc
          .connect(user.signer)
          .functions['mint(address,uint256)'](userAddress, flashloanTotal);
        await usdc.connect(user.signer).approve(pool.address, flashloanTotal);
        await pool.connect(user.signer).deposit(usdc.address, flashloanTotal, userAddress, 0);

        const usdcPrice = await oracle.getAssetPrice(usdc.address);
        const aavePrice = await oracle.getAssetPrice(aave.address);

        const collateralDecimals = await usdc.decimals();
        const principalDecimals = await aave.decimals();

        const expectedAaveAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountUSDCtoSwap.toString())
            .times(usdcPrice.toString())
            .div(aavePrice.toString())
            .times(new BigNumber(10).pow(principalDecimals - collateralDecimals))
            .toFixed(0)
        );

        const swapAmount = amountUSDCtoSwap
          .mul(usdcPrice)
          .div(aavePrice)
          .mul(ethers.BigNumber.from(10).pow(principalDecimals))
          .div(ethers.BigNumber.from(10).pow(collateralDecimals));

        await mockAugustus.expectSwap(
          usdc.address,
          aave.address,
          amountUSDCtoSwap,
          swapAmount,
          expectedAaveAmount
        );

        const reserveData = await pool.getReserveData(usdc.address);
        const aTokenAddress = reserveData.aTokenAddress;
        const aToken = await getContract(eContractid.AToken, aTokenAddress);

        await aToken
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, flashloanTotal);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          usdc.address,
          aave.address,
          amountUSDCtoSwap,
          expectedAaveAmount,
        ]);

        const params = buildParaSwapLiquiditySwapParams(
          aave.address,
          0,
          0,
          mockAugustusCalldata,
          mockAugustus.address,
          0,
          0,
          0,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000'
        );

        await expect(
          pool
            .connect(user.signer)
            .flashLoan(
              paraswapLiquiditySwapAdapter.address,
              [usdc.address],
              [amountUSDCtoSwap],
              [0],
              userAddress,
              params,
              0
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(usdc.address, aave.address, amountUSDCtoSwap, expectedAaveAmount);

        const adapterUsdcBalance = await usdc.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterAaveBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);

        expect(adapterUsdcBalance).to.be.eq(Zero);
        expect(adapterAaveBalance).to.be.eq(Zero);
      });

      it('should revert when min amount to receive exceeds the max slippage amount', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);

        const rawExpectedAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        const maxAllowedAmount = rawExpectedAmount.mul(98).div(100);

        const requestedAmount = rawExpectedAmount.mul(99).div(100);

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          maxAllowedAmount
        );

        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          maxAllowedAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              amountWETHtoSwap,
              requestedAmount,
              0,
              mockAugustusCalldata,
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('MIN_AMOUNT_EXCEEDS_MAX_SLIPPAGE');
      });

      it('should revert if wrong address used for Augustus', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              amountWETHtoSwap,
              expectedUsdcAmount,
              0,
              mockAugustusCalldata,
              oracle.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('INVALID_AUGUSTUS');
      });

      it("should revert if Augustus doesn't swap correct amount", async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const augustusSwapAmount = amountWETHtoSwap.sub(1);

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(augustusSwapAmount.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          augustusSwapAmount,
          augustusSwapAmount,
          expectedUsdcAmount
        );

        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          augustusSwapAmount,
          expectedUsdcAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              amountWETHtoSwap,
              0,
              0,
              mockAugustusCalldata,
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('WRONG_BALANCE_AFTER_SWAP');
      });

      it('should correctly swap all the balance when using a bigger amount', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aAave,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(testEnv.users[1].address, transferAmount);

        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        expect(userAEthBalanceBefore).to.be.eq(amountWETHtoSwap);

        const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, bigAmountToSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          bigAmountToSwap,
          expectedUsdcAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              bigAmountToSwap,
              0,
              4 + 2 * 32,
              mockAugustusCalldata,
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterAaveBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterAaveBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(Zero);
      });

      it('should correctly swap all the balance when using permit', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aAave,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(testEnv.users[1].address, transferAmount);

        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        expect(userAEthBalanceBefore).to.be.eq(amountWETHtoSwap);

        const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH.nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          paraswapLiquiditySwapAdapter.address,
          nonce,
          deadline,
          bigAmountToSwap.toString()
        );

        const ownerPrivateKey = require('../test-wallets.js').accounts[1].secretKey;
        if (!ownerPrivateKey) {
          throw new Error('INVALID_OWNER_PK');
        }

        const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          bigAmountToSwap,
          expectedUsdcAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              bigAmountToSwap,
              0,
              4 + 2 * 32,
              mockAugustusCalldata,
              mockAugustus.address,
              {
                amount: bigAmountToSwap,
                deadline,
                v,
                r,
                s,
              }
            )
        ).to.emit(paraswapLiquiditySwapAdapter, 'Swapped');

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterAaveBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterAaveBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(Zero);
      });

      it('should revert trying to swap all the balance when using a smaller amount', async () => {
        const {
          users: [user, users2],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          expectedUsdcAmount
        );

        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users2.address, transferAmount);

        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        expect(userAEthBalanceBefore).to.be.eq(amountWETHtoSwap);

        const smallAmountToSwap = (await convertToCurrencyDecimals(aWETH.address, '10')).sub(1);
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, smallAmountToSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          smallAmountToSwap,
          expectedUsdcAmount,
        ]);

        await expect(
          paraswapLiquiditySwapAdapter
            .connect(user.signer)
            .swapAndDeposit(
              weth.address,
              aave.address,
              smallAmountToSwap,
              expectedUsdcAmount,
              4 + 2 * 32,
              mockAugustusCalldata,
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('INSUFFICIENT_AMOUNT_TO_SWAP');
      });
    });
  });
});
