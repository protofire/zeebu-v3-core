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
import { evmRevert, evmSnapshot, getAToken, getFirstSigner } from '@aave/deploy-v3';
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

        // Provide liquidity
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

        // Make a deposit for user
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
        console.log('aavePrice:', aavePrice.toString());
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

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

        // User will swap liquidity aEth to zUsdc
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

        console.log('From test:');
        console.log('userAddress:', userAddress);
        console.log('paraswapLiquiditySwapAdapter.address:', paraswapLiquiditySwapAdapter.address);
        console.log('weth.address:', weth.address);
        console.log('amountWETHtoSwap:', amountWETHtoSwap);
        console.log('expectedUsdcAmount:', expectedUsdcAmount);
        console.log('params:', params);

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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        // N.B. will get some portion of flashloan premium back from the pool
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
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

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
          expectedUsdcAmount,
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        // N.B. will get some portion of flashloan premium back from the pool
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
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

        // User will swap liquidity aEth to zUsdc
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
        ).to.be.revertedWith('CALLER_MUST_BE_LENDING_POOL');
      });

      it('should work correctly with tokens of different decimals', async () => {
        const {
          users: [user],
          aave,
          oracle,
          weth,
          pool,
          deployer,
          aAave,
        } = testEnv;

        const userAddress = user.address;

        const amountUSDCtoSwap = await convertToCurrencyDecimals(aave.address, '10');
        const liquidity = await convertToCurrencyDecimals(aave.address, '20000');

        const flashloanPremium = amountUSDCtoSwap.mul(9).div(10000);
        const flashloanTotal = amountUSDCtoSwap.add(flashloanPremium);

        // Provider liquidity
        await aave.functions['mint(address,uint256)'](deployer.address, liquidity);
        await aave.approve(pool.address, liquidity);
        await pool.deposit(aave.address, liquidity, deployer.address, 0);

        // Make a deposit for user
        await aave
          .connect(user.signer)
          .functions['mint(address,uint256)'](userAddress, flashloanTotal);
        await aave.connect(user.signer).approve(pool.address, flashloanTotal);
        await pool.connect(user.signer).deposit(aave.address, flashloanTotal, userAddress, 0);

        const aavePrice = await oracle.getAssetPrice(aave.address);

        const collateralDecimals = (await aave.decimals()).toString();
        const principalDecimals = (await aave.decimals()).toString();

        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountUSDCtoSwap.toString())
            .times(
              new BigNumber(aavePrice.toString()).times(new BigNumber(10).pow(principalDecimals))
            )
            .div(
              new BigNumber(aavePrice.toString()).times(new BigNumber(10).pow(collateralDecimals))
            )
            .div(new BigNumber(10).pow(principalDecimals))
            .toFixed(0)
        );

        await mockAugustus.expectSwap(
          aave.address,
          aave.address,
          amountUSDCtoSwap,
          amountUSDCtoSwap,
          expectedUsdcAmount
        );

        const zUSDC = await getAToken(aave.address);

        // User will swap liquidity zUSDC to zUsdc
        const userzUSDCBalanceBefore = await zUSDC.balanceOf(userAddress);
        await zUSDC
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, flashloanTotal);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          aave.address,
          aave.address,
          amountUSDCtoSwap,
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
          pool
            .connect(user.signer)
            .flashLoan(
              paraswapLiquiditySwapAdapter.address,
              [aave.address],
              [amountUSDCtoSwap],
              [0],
              userAddress,
              params,
              0
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(aave.address, aave.address, amountUSDCtoSwap, expectedUsdcAmount);

        const adapterUsdcBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userzUSDCBalance = await zUSDC.balanceOf(userAddress);

        // N.B. will get some portion of flashloan premium back from the pool
        expect(adapterUsdcBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userzUSDCBalance).to.be.gte(userzUSDCBalanceBefore.sub(flashloanTotal));
        expect(userzUSDCBalance).to.be.lte(userzUSDCBalanceBefore.sub(amountUSDCtoSwap));
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

        const smallexpectedUsdcAmount = expectedUsdcAmount.div(2);

        // User will swap liquidity aEth to zUsdc
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
              smallexpectedUsdcAmount,
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

        // User will swap liquidity aEth to zUsdc
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
          paraswapLiquiditySwapAdapter.connect(user.signer).swapAndDeposit(
            weth.address,
            aave.address,
            amountWETHtoSwap,
            expectedUsdcAmount,
            0,
            mockAugustusCalldata,
            oracle.address, // using arbitrary contract instead of mock Augustus
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

      it('should bubble up errors from Augustus', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

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

        // User will swap liquidity aEth to zUsdc
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        // Add 1 to expected amount so it will fail
        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount.add(1),
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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('Received amount of tokens are less than expected');
      });

      it('should revert if Augustus swaps for less than minimum to receive', async () => {
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
        const actualZbuAmount = expectedUsdcAmount.sub(1);

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          actualZbuAmount
        );

        // User will swap liquidity aEth to zUsdc
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          actualZbuAmount,
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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('INSUFFICIENT_AMOUNT_RECEIVED');
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

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        const augustusSwapAmount = amountWETHtoSwap.sub(1);

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          augustusSwapAmount,
          augustusSwapAmount,
          expectedUsdcAmount
        );

        // User will swap liquidity aEth to zUsdc
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
              expectedUsdcAmount,
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
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
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        expect(userAEthBalanceBefore).to.be.eq(amountWETHtoSwap);

        const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
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

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
              expectedUsdcAmount,
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(Zero);
      });

      it('should revert trying to swap all the balance when using a smaller amount', async () => {
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
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

      it('should not touch any token balance already in the adapter', async () => {
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

        // Put token balances in the adapter
        const adapterWethBalanceBefore = await convertToCurrencyDecimals(weth.address, '123');
        await weth.functions['mint(address,uint256)'](
          paraswapLiquiditySwapAdapter.address,
          adapterWethBalanceBefore
        );
        await weth.transfer(paraswapLiquiditySwapAdapter.address, adapterWethBalanceBefore);
        const adapterZbuBalanceBefore = await convertToCurrencyDecimals(aave.address, '234');
        await aave.functions['mint(address,uint256)'](
          paraswapLiquiditySwapAdapter.address,
          adapterZbuBalanceBefore
        );
        await aave.transfer(paraswapLiquiditySwapAdapter.address, adapterZbuBalanceBefore);

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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(adapterWethBalanceBefore);
        expect(adapterZbuBalance).to.be.eq(adapterZbuBalanceBefore);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });
    });

    describe('executeOperation with borrowing', () => {
      beforeEach(async () => {
        const {
          users: [user],
          weth,
          aave,
          pool,
          deployer,
        } = testEnv;
        const userAddress = user.address;
        const borrower = users[1].signer;
        const borrowerAddress = users[1].address;

        // Provide liquidity
        const usdcAmount = await convertToCurrencyDecimals(aave.address, '20000');
        await aave.functions['mint(address,uint256)'](deployer.address, usdcAmount);
        await aave.approve(pool.address, usdcAmount);
        await pool.deposit(aave.address, usdcAmount, deployer.address, 0);

        const wethAmount = await convertToCurrencyDecimals(weth.address, '10000');
        await weth.functions['mint(address,uint256)'](deployer.address, wethAmount);
        await weth.approve(pool.address, wethAmount);
        await pool.deposit(weth.address, wethAmount, deployer.address, 0);

        // Make a deposit for user
        const userWethAmount = await convertToCurrencyDecimals(weth.address, '100');
        await weth.functions['mint(address,uint256)'](userAddress, userWethAmount);
        await weth.approve(pool.address, userWethAmount);
        await pool.deposit(weth.address, userWethAmount, userAddress, 0);

        // Add borrowing
        const collateralAmount = parseEther('10000000');
        await aave.functions['mint(address,uint256)'](borrowerAddress, collateralAmount);
        await aave.approve(pool.address, collateralAmount);
        await pool.deposit(aave.address, collateralAmount, borrowerAddress, 0);
        await pool
          .connect(borrower)
          .borrow(weth.address, parseEther('5000'), 2, 0, borrowerAddress);
      });

      it('should correctly swap tokens and deposit the out tokens in the pool', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
          aAave,
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

        // User will swap liquidity aEth to zUsdc
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.gt(userAEthBalanceBefore.sub(flashloanTotal));
        expect(userAEthBalance).to.be.lt(
          userAEthBalanceBefore.mul(10001).div(10000).sub(amountWETHtoSwap)
        );
      });

      it('should correctly swap tokens using permit', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
          aAave,
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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          paraswapLiquiditySwapAdapter.address,
          nonce,
          deadline,
          amountWETHtoSwap.toString()
        );

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
              mockAugustus.address,
              {
                amount: amountWETHtoSwap,
                deadline,
                v,
                r,
                s,
              }
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.gt(userAEthBalanceBefore.sub(amountWETHtoSwap));
        expect(userAEthBalance).to.be.lt(
          userAEthBalanceBefore.mul(10001).div(10000).sub(amountWETHtoSwap)
        );
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
          amountWETHtoSwap.add(1),
          amountWETHtoSwap.mul(10001).div(10000),
          expectedUsdcAmount
        );

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
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
        ).to.emit(paraswapLiquiditySwapAdapter, 'Swapped');

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
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
          amountWETHtoSwap.add(1),
          amountWETHtoSwap.mul(10001).div(10000),
          expectedUsdcAmount
        );

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
        const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
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

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
              expectedUsdcAmount,
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(Zero);
      });
    });

    describe('swapAndDeposit', () => {
      beforeEach(async () => {
        const {
          users: [user],
          weth,
          aave,
          pool,
          deployer,
        } = testEnv;
        const userAddress = user.address;

        // Provide liquidity
        const usdcAmount = await convertToCurrencyDecimals(aave.address, '20000');
        await aave.functions['mint(address,uint256)'](deployer.address, usdcAmount);
        await aave.approve(pool.address, usdcAmount);
        await pool.deposit(aave.address, usdcAmount, deployer.address, 0);

        const wethAmount = await convertToCurrencyDecimals(weth.address, '10000');
        await weth.functions['mint(address,uint256)'](deployer.address, wethAmount);
        await weth.approve(pool.address, wethAmount);
        await pool.deposit(weth.address, wethAmount, deployer.address, 0);

        // Make a deposit for user
        const userWethAmount = await convertToCurrencyDecimals(weth.address, '100');
        await weth.functions['mint(address,uint256)'](userAddress, userWethAmount);
        await weth.approve(pool.address, userWethAmount);
        await pool.deposit(weth.address, userWethAmount, userAddress, 0);
      });

      it('should correctly swap tokens and deposit the out tokens in the pool', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
          aAave,
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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });

      it('should correctly swap tokens using permit', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
          aAave,
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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          paraswapLiquiditySwapAdapter.address,
          nonce,
          deadline,
          amountWETHtoSwap.toString()
        );

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
              mockAugustus.address,
              {
                amount: amountWETHtoSwap,
                deadline,
                v,
                r,
                s,
              }
            )
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });

      it('should revert when trying to swap more than balance', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

        const userAddress = user.address;

        const amountWETHtoSwap = (await convertToCurrencyDecimals(weth.address, '100')).add(1);

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

        // User will swap liquidity aEth to zUsdc
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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('SafeERC20: low-level call failed');
      });

      it('should revert when trying to swap more than allowance', async () => {
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

        // User will swap liquidity aEth to zUsdc
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap.sub(1));

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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('SafeERC20: low-level call failed');
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

        const smallexpectedUsdcAmount = expectedUsdcAmount.div(2);

        // User will swap liquidity aEth to zUsdc
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
              smallexpectedUsdcAmount,
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

        // User will swap liquidity aEth to zUsdc
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
          paraswapLiquiditySwapAdapter.connect(user.signer).swapAndDeposit(
            weth.address,
            aave.address,
            amountWETHtoSwap,
            expectedUsdcAmount,
            0,
            mockAugustusCalldata,
            oracle.address, // using arbitrary contract instead of mock Augustus
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

      it('should bubble up errors from Augustus', async () => {
        const {
          users: [user],
          weth,
          oracle,
          aave,
          pool,
          aWETH,
        } = testEnv;

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

        // User will swap liquidity aEth to zUsdc
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        // Add 1 to expected amount so it will fail
        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          expectedUsdcAmount.add(1),
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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('Received amount of tokens are less than expected');
      });

      it('should revert if Augustus swaps for less than minimum to receive', async () => {
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
        const actualZbuAmount = expectedUsdcAmount.sub(1);

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          amountWETHtoSwap,
          amountWETHtoSwap,
          actualZbuAmount
        );

        // User will swap liquidity aEth to zUsdc
        await aWETH
          .connect(user.signer)
          .approve(paraswapLiquiditySwapAdapter.address, amountWETHtoSwap);

        const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
          weth.address,
          aave.address,
          amountWETHtoSwap,
          actualZbuAmount,
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
              mockAugustus.address,
              {
                amount: 0,
                deadline: 0,
                v: 0,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000',
                s: '0x0000000000000000000000000000000000000000000000000000000000000000',
              }
            )
        ).to.be.revertedWith('INSUFFICIENT_AMOUNT_RECEIVED');
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

        const aavePrice = await oracle.getAssetPrice(aave.address);
        const expectedUsdcAmount = await convertToCurrencyDecimals(
          aave.address,
          new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
        );

        const augustusSwapAmount = amountWETHtoSwap.sub(1);

        await mockAugustus.expectSwap(
          weth.address,
          aave.address,
          augustusSwapAmount,
          augustusSwapAmount,
          expectedUsdcAmount
        );

        // User will swap liquidity aEth to zUsdc
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
              expectedUsdcAmount,
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
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
        )
          .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
          .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

        const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        expect(userAEthBalanceBefore).to.be.eq(amountWETHtoSwap);

        const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');

        const chainId = hre.network.config.chainId || 31337;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
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

        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
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
              expectedUsdcAmount,
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterZbuBalance).to.be.eq(Zero);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(Zero);
      });

      it('should revert trying to swap all the balance when using a smaller amount', async () => {
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

        // Remove other balance
        const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
        await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

        // User will swap liquidity aEth to zUsdc
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

      it('should not touch any token balance already in the adapter', async () => {
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

        // Put token balances in the adapter
        const adapterWethBalanceBefore = await convertToCurrencyDecimals(weth.address, '123');
        await weth.functions['mint(address,uint256)'](
          paraswapLiquiditySwapAdapter.address,
          adapterWethBalanceBefore
        );
        await weth.transfer(paraswapLiquiditySwapAdapter.address, adapterWethBalanceBefore);
        const adapterZbuBalanceBefore = await convertToCurrencyDecimals(aave.address, '234');
        await aave.functions['mint(address,uint256)'](
          paraswapLiquiditySwapAdapter.address,
          adapterZbuBalanceBefore
        );
        await aave.transfer(paraswapLiquiditySwapAdapter.address, adapterZbuBalanceBefore);

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

        // User will swap liquidity aEth to zUsdc
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
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
        const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
        const userzUsdcBalance = await aAave.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(adapterWethBalance).to.be.eq(adapterWethBalanceBefore);
        expect(adapterZbuBalance).to.be.eq(adapterZbuBalanceBefore);
        expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
        expect(userAEthBalance).to.be.eq(userAEthBalanceBefore.sub(amountWETHtoSwap));
      });
    });

    // describe('swapAndDeposit with borrowing', () => {
    //   beforeEach(async () => {
    //     const { users: [user], weth, aave, pool, deployer } = testEnv;
    //     const userAddress = user.address;
    //     const borrower = users[1].signer;
    //     const borrowerAddress = users[1].address;

    //     // Provide liquidity
    //     const usdcAmount = await convertToCurrencyDecimals(aave.address, '20000');
    //     await aave.functions['mint(address,uint256)'](deployer.address, usdcAmount);
    //     await aave.approve(pool.address, usdcAmount);
    //     await pool.deposit(aave.address, usdcAmount, deployer.address, 0);

    //     const wethAmount = await convertToCurrencyDecimals(weth.address, '10000');
    //     await weth.functions['mint(address,uint256)'](deployer.address, wethAmount);
    //     await weth.approve(pool.address, wethAmount);
    //     await pool.deposit(weth.address, wethAmount, deployer.address, 0);

    //     // Make a deposit for user
    //     const userWethAmount = await convertToCurrencyDecimals(weth.address, '100');
    //     await weth.functions['mint(address,uint256)'](userAddress, userWethAmount);
    //     await weth.approve(pool.address, userWethAmount);
    //     await pool.deposit(weth.address, userWethAmount, userAddress, 0);

    //     // Add borrowing
    //     const collateralAmount = parseEther('10000000');
    //     await aave.functions['mint(address,uint256)'](borrowerAddress, collateralAmount);
    //     await aave.approve(pool.address, collateralAmount);
    //     await pool.deposit(aave.address, collateralAmount, borrowerAddress, 0);
    //     await pool
    //       .connect(borrower)
    //       .borrow(weth.address, parseEther('5000'), 2, 0, borrowerAddress);
    //   });

    //   it('should correctly swap tokens and deposit the out tokens in the pool', async () => {
    //     const { users: [user], weth, oracle, aave, pool, aWETH, aAave } = testEnv;

    //     const userAddress = user.address;

    //     const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

    //     const aavePrice = await oracle.getAssetPrice(aave.address);
    //     const expectedUsdcAmount = await convertToCurrencyDecimals(
    //       aave.address,
    //       new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
    //     );

    //     await mockAugustus.expectSwap(
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap,
    //       amountWETHtoSwap,
    //       expectedUsdcAmount
    //     );

    //     const flashloanPremium = amountWETHtoSwap.mul(9).div(10000);
    //     const flashloanTotal = amountWETHtoSwap.add(flashloanPremium);

    //     // User will swap liquidity aEth to zUsdc
    //     const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
    //     await aWETH.connect(user.signer).approve(paraswapLiquiditySwapAdapter.address, flashloanTotal);

    //     const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap,
    //       expectedUsdcAmount,
    //     ]);

    //     const params = buildParaSwapLiquiditySwapParams(
    //       aave.address,
    //       expectedUsdcAmount,
    //       0,
    //       mockAugustusCalldata,
    //       mockAugustus.address,
    //       0,
    //       0,
    //       0,
    //       '0x0000000000000000000000000000000000000000000000000000000000000000',
    //       '0x0000000000000000000000000000000000000000000000000000000000000000'
    //     );

    //     await expect(
    //       pool
    //         .connect(user.signer)
    //         .flashLoan(
    //           paraswapLiquiditySwapAdapter.address,
    //           [weth.address],
    //           [amountWETHtoSwap],
    //           [0],
    //           userAddress,
    //           params,
    //           0
    //         )
    //     )
    //       .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
    //       .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

    //     const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const userzUsdcBalance = await aAave.balanceOf(userAddress);
    //     const userAEthBalance = await aWETH.balanceOf(userAddress);

    //     expect(adapterWethBalance).to.be.eq(Zero);
    //     expect(adapterZbuBalance).to.be.eq(Zero);
    //     expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
    //     expect(userAEthBalance).to.be.gt(userAEthBalanceBefore.sub(flashloanTotal));
    //     expect(userAEthBalance).to.be.lt(
    //       userAEthBalanceBefore.mul(10001).div(10000).sub(amountWETHtoSwap)
    //     );
    //   });

    //   it('should correctly swap tokens using permit', async () => {
    //     const { users: [user], weth, oracle, aave, pool, aWETH, aAave } = testEnv;

    //     const userAddress = user.address;

    //     const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

    //     const aavePrice = await oracle.getAssetPrice(aave.address);
    //     const expectedUsdcAmount = await convertToCurrencyDecimals(
    //       aave.address,
    //       new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
    //     );

    //     await mockAugustus.expectSwap(
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap,
    //       amountWETHtoSwap,
    //       expectedUsdcAmount
    //     );

    //     const flashloanPremium = amountWETHtoSwap.mul(9).div(10000);
    //     const flashloanTotal = amountWETHtoSwap.add(flashloanPremium);

    //     // User will swap liquidity aEth to zUsdc
    //     const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

    //     const chainId = hre.network.config.chainId || 31337;
    //     const deadline = MAX_UINT_AMOUNT;
    //     const nonce = (await aWETH._nonces(userAddress)).toNumber();
    //     const msgParams = buildPermitParams(
    //       chainId,
    //       aWETH.address,
    //       '1',
    //       await aWETH.name(),
    //       userAddress,
    //       paraswapLiquiditySwapAdapter.address,
    //       nonce,
    //       deadline,
    //       amountWETHtoSwap.toString()
    //     );

    //     const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
    //     if (!ownerPrivateKey) {
    //       throw new Error('INVALID_OWNER_PK');
    //     }

    //     const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    //     const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap,
    //       expectedUsdcAmount,
    //     ]);

    //     await expect(
    //       paraswapLiquiditySwapAdapter
    //         .connect(user.signer)
    //         .swapAndDeposit(
    //           weth.address,
    //           aave.address,
    //           amountWETHtoSwap,
    //           expectedUsdcAmount,
    //           0,
    //           mockAugustusCalldata,
    //           mockAugustus.address,
    //           {
    //             amount: amountWETHtoSwap,
    //             deadline,
    //             v,
    //             r,
    //             s,
    //           }
    //         )
    //     )
    //       .to.emit(paraswapLiquiditySwapAdapter, 'Swapped')
    //       .withArgs(weth.address, aave.address, amountWETHtoSwap, expectedUsdcAmount);

    //     const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const userzUsdcBalance = await aAave.balanceOf(userAddress);
    //     const userAEthBalance = await aWETH.balanceOf(userAddress);

    //     expect(adapterWethBalance).to.be.eq(Zero);
    //     expect(adapterZbuBalance).to.be.eq(Zero);
    //     expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
    //     expect(userAEthBalance).to.be.gt(userAEthBalanceBefore.sub(amountWETHtoSwap));
    //     expect(userAEthBalance).to.be.lt(
    //       userAEthBalanceBefore.mul(10001).div(10000).sub(amountWETHtoSwap)
    //     );
    //   });

    //   it('should correctly swap all the balance when using a bigger amount', async () => {
    //     const { users: [user], weth, oracle, aave, pool, aAave, aWETH } = testEnv;

    //     const userAddress = user.address;

    //     const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

    //     const aavePrice = await oracle.getAssetPrice(aave.address);
    //     const expectedUsdcAmount = await convertToCurrencyDecimals(
    //       aave.address,
    //       new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
    //     );

    //     await mockAugustus.expectSwap(
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap.add(1),
    //       amountWETHtoSwap.mul(10001).div(10000),
    //       expectedUsdcAmount
    //     );

    //     // Remove other balance
    //     const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
    //     await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

    //     // User will swap liquidity aEth to zUsdc
    //     const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');
    //     await aWETH.connect(user.signer).approve(paraswapLiquiditySwapAdapter.address, bigAmountToSwap);

    //     const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
    //       weth.address,
    //       aave.address,
    //       bigAmountToSwap,
    //       expectedUsdcAmount,
    //     ]);

    //     await expect(
    //       paraswapLiquiditySwapAdapter
    //         .connect(user.signer)
    //         .swapAndDeposit(
    //           weth.address,
    //           aave.address,
    //           bigAmountToSwap,
    //           expectedUsdcAmount,
    //           4 + 2 * 32,
    //           mockAugustusCalldata,
    //           mockAugustus.address,
    //           {
    //             amount: 0,
    //             deadline: 0,
    //             v: 0,
    //             r: '0x0000000000000000000000000000000000000000000000000000000000000000',
    //             s: '0x0000000000000000000000000000000000000000000000000000000000000000',
    //           }
    //         )
    //     ).to.emit(paraswapLiquiditySwapAdapter, 'Swapped');

    //     const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const userzUsdcBalance = await aAave.balanceOf(userAddress);
    //     const userAEthBalance = await aWETH.balanceOf(userAddress);

    //     expect(adapterWethBalance).to.be.eq(Zero);
    //     expect(adapterZbuBalance).to.be.eq(Zero);
    //     expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
    //     expect(userAEthBalance).to.be.eq(Zero);
    //   });

    //   it('should correctly swap all the balance when using permit', async () => {
    //     const { users: [user], weth, oracle, aave, pool, aAave, aWETH } = testEnv;

    //     const userAddress = user.address;

    //     const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

    //     const aavePrice = await oracle.getAssetPrice(aave.address);
    //     const expectedUsdcAmount = await convertToCurrencyDecimals(
    //       aave.address,
    //       new BigNumber(amountWETHtoSwap.toString()).div(aavePrice.toString()).toFixed(0)
    //     );

    //     await mockAugustus.expectSwap(
    //       weth.address,
    //       aave.address,
    //       amountWETHtoSwap.add(1),
    //       amountWETHtoSwap.mul(10001).div(10000),
    //       expectedUsdcAmount
    //     );

    //     // Remove other balance
    //     const transferAmount = await convertToCurrencyDecimals(aWETH.address, '90');
    //     await aWETH.connect(user.signer).transfer(users[1].address, transferAmount);

    //     // User will swap liquidity aEth to zUsdc
    //     const bigAmountToSwap = await convertToCurrencyDecimals(aWETH.address, '11');

    //     const chainId = hre.network.config.chainId || 31337;
    //     const deadline = MAX_UINT_AMOUNT;
    //     const nonce = (await aWETH._nonces(userAddress)).toNumber();
    //     const msgParams = buildPermitParams(
    //       chainId,
    //       aWETH.address,
    //       '1',
    //       await aWETH.name(),
    //       userAddress,
    //       paraswapLiquiditySwapAdapter.address,
    //       nonce,
    //       deadline,
    //       bigAmountToSwap.toString()
    //     );

    //     const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
    //     if (!ownerPrivateKey) {
    //       throw new Error('INVALID_OWNER_PK');
    //     }

    //     const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    //     const mockAugustusCalldata = mockAugustus.interface.encodeFunctionData('swap', [
    //       weth.address,
    //       aave.address,
    //       bigAmountToSwap,
    //       expectedUsdcAmount,
    //     ]);

    //     await expect(
    //       paraswapLiquiditySwapAdapter
    //         .connect(user.signer)
    //         .swapAndDeposit(
    //           weth.address,
    //           aave.address,
    //           bigAmountToSwap,
    //           expectedUsdcAmount,
    //           4 + 2 * 32,
    //           mockAugustusCalldata,
    //           mockAugustus.address,
    //           {
    //             amount: bigAmountToSwap,
    //             deadline,
    //             v,
    //             r,
    //             s,
    //           }
    //         )
    //     ).to.emit(paraswapLiquiditySwapAdapter, 'Swapped');

    //     const adapterWethBalance = await weth.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const adapterZbuBalance = await aave.balanceOf(paraswapLiquiditySwapAdapter.address);
    //     const userzUsdcBalance = await aAave.balanceOf(userAddress);
    //     const userAEthBalance = await aWETH.balanceOf(userAddress);

    //     expect(adapterWethBalance).to.be.eq(Zero);
    //     expect(adapterZbuBalance).to.be.eq(Zero);
    //     expect(userzUsdcBalance).to.be.eq(expectedUsdcAmount);
    //     expect(userAEthBalance).to.be.eq(Zero);
    //   });
    // });
  });
});
