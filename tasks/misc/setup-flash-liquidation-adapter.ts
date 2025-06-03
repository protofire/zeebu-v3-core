import { task } from 'hardhat/config';

import {
  MockUniswapV3Router__factory,
  AaveOracle__factory,
  IERC20Detailed__factory,
  Pool__factory,
  PoolAddressesProvider__factory,
} from '../../types';
import { getFirstSigner } from '@aave/deploy-v3/dist/helpers/utilities/signer';
import { formatUnits, getContractAddress } from 'ethers/lib/utils';

// How to execute this task:
// Params:
// --router: The address of the Router contract
// --pool: The address of the Pool contract
// Example:
// npx hardhat setup-flash-liquidation-adapter --network baseSepolia --router 0xE06E64B1DEE3803ca57e5e5bde94Cc2Dcf76EF37 --pool 0x3ae17858FfD0225201Ab7c2005FAF55764CfB44e

type TokenPrice = {
  address: string;
  symbol: string;
  priceInWei: string;
  priceInEth: string;
  source: string;
};

task(`setup-flash-liquidation-adapter`, `Sets the flash loan adapter`)
  .addParam('router', 'Address of the Router')
  .addParam('pool', 'Address of the Pool')
  .setAction(async ({ router, pool }, hre) => {
    console.log('\nConnecting to MockUniswapV3Router...');
    const contract = MockUniswapV3Router__factory.connect(router, await getFirstSigner());
    console.log('Connected to MockUniswapV3Router.');

    const tokenPrices: TokenPrice[] = await getOraclePrices(pool);

    const addresses: string[] = [];
    const prices: string[] = [];
    const isMintable: boolean[] = [];

    console.log('Token Prices:', tokenPrices);

    for (const tokenPrice of tokenPrices) {
      console.log(`Token Address: ${tokenPrice.address}`);
      console.log(`Symbol: ${tokenPrice.symbol}`);
      console.log(`Price in wei: ${tokenPrice.priceInWei}`);
      console.log(`Price in ETH: ${tokenPrice.priceInEth}`);
      console.log(`\n\n`);

      addresses.push(tokenPrice.address);
      prices.push(tokenPrice.priceInWei);
      isMintable.push(true);
    }

    console.log('Setting token prices...');
    try {
      const tx = await contract.setTokenPrices(addresses, prices, isMintable);
      console.log('Token prices set.');
      console.log(`Transaction hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Prices set finished for router: ${router}`);
    } catch (error) {
      console.error('Error setting token prices:', error);
    }
  });

async function getOraclePrices(pool: string): Promise<TokenPrice[]> {
  try {
    const tokenPrices: TokenPrice[] = [];

    console.log('\nFetching Lending Pool...');
    const lendingPool = Pool__factory.connect(pool, await getFirstSigner());

    const reserves = await lendingPool.getReservesList();
    console.log('\nReserves list fetched:', reserves);

    const addressesProvider = PoolAddressesProvider__factory.connect(
      await lendingPool.ADDRESSES_PROVIDER(),
      await getFirstSigner()
    );

    const aaveOracleAddr = await addressesProvider.getPriceOracle();
    const aaveOracle = AaveOracle__factory.connect(aaveOracleAddr, await getFirstSigner());

    for (const reserve of reserves) {
      const tokenSymbol = await IERC20Detailed__factory.connect(
        reserve,
        await getFirstSigner()
      ).symbol();
      const price = await aaveOracle.getAssetPrice(reserve);
      const source = await aaveOracle.getSourceOfAsset(reserve);
      const erc20Token = await IERC20Detailed__factory.connect(reserve, await getFirstSigner());
      const decimals = await erc20Token.decimals();

      tokenPrices.push({
        address: reserve,
        symbol: tokenSymbol,
        priceInWei: price.toString(),
        priceInEth: formatUnits(price.toString(), decimals),
        source: source,
      });
    }
    console.log('\nReserve prices fetched.');
    return tokenPrices;
  } catch (error) {
    console.error('Error in getOraclePrices:', error);
    throw error;
  }
}
