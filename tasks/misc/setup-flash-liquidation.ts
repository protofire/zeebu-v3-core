import { task } from 'hardhat/config';
import { isAddress } from 'ethers/lib/utils';
import { getEthersSigners } from '@aave/deploy-v3';

// #########################################################
// Description:
// This task sets up token prices for the testnet UniswapV3 mock router.
// Without this, the flash liquidation adapter fail with "Token price not set" error.
// Usage:
// npx hardhat setup-flash-liquidation --network <network> --type <paraswap|uniswap> --router <router-address> --pool <pool-address>
// #########################################################
// Bnb Testnet:
// npx hardhat setup-flash-liquidation --network bscTestnet --type uniswap --router 0x52efDd3a7DF0B897529fc26C801d11E5b3B7D239 --pool 0x1De2BCDA867593a156E025950c63f63bd5dC163E
// #########################################################
// Sepolia:
// npx hardhat setup-flash-liquidation --network sepolia --type uniswap --router 0x41031c198E369424Cf2F7Dc745Dfb347EE38fCC0 --pool 0x283B3211781f939337A40b95F70114B050cF3051
// #########################################################
// Supported router types and their ABI names
const ROUTER_ABIS: Record<string, string> = {
  paraswap: 'MockParaSwapAugustusTestnet',
  uniswap: 'MockUniswapV3Router',
};

task('setup-flash-liquidation', 'Sets up token prices for the testnet swap adapter')
  .addParam('type', 'Type of the Adapter (paraswap, uniswap)')
  .addParam('router', 'Address of the Router')
  .addParam('pool', 'Address of the Pool contract')
  .setAction(async ({ type, router, pool }, hre) => {
    if (!['paraswap', 'uniswap'].includes(type)) {
      throw new Error('Invalid type. Supported: paraswap, uniswap');
    }
    if (!isAddress(router)) {
      throw new Error('Invalid router address provided.');
    }
    if (!isAddress(pool)) {
      throw new Error('Invalid pool address provided.');
    }

    const [signer] = await getEthersSigners();
    const network = hre.network.name;
    console.log(`Setting up flash liquidation for type: ${type} on network: ${network}`);

    // Attach to the router contract
    const routerContract = await hre.ethers.getContractAt(ROUTER_ABIS[type], router, signer);

    // Attach to the Pool contract
    const poolContract = await hre.ethers.getContractAt('Pool', pool, signer);
    const reserves = await poolContract.getReservesList();
    console.log('Reserves:', reserves);

    // Get the addresses provider
    const addressesProviderAddr = await poolContract.ADDRESSES_PROVIDER();
    const addressesProvider = await hre.ethers.getContractAt(
      'PoolAddressesProvider',
      addressesProviderAddr,
      signer
    );

    // Get the AaveOracle
    const aaveOracleAddr = await addressesProvider.getPriceOracle();
    const aaveOracle = await hre.ethers.getContractAt('AaveOracle', aaveOracleAddr, signer);

    // Prepare token price data
    const addresses: string[] = [];
    const prices: string[] = [];
    const isMintable: boolean[] = [];

    for (const reserve of reserves) {
      const erc20 = await hre.ethers.getContractAt('IERC20Detailed', reserve, signer);
      const symbol = await erc20.symbol();
      const decimals = await erc20.decimals();
      const price = await aaveOracle.getAssetPrice(reserve);
      const source = await aaveOracle.getSourceOfAsset(reserve);
      addresses.push(reserve);
      prices.push(price.toString());
      isMintable.push(true);
      console.log(
        `Token: ${symbol} (${reserve}) | Price: ${price.toString()} | Decimals: ${decimals} | Source: ${source}`
      );
      try {
        console.log(`  Price in ETH:`, hre.ethers.utils.formatUnits(price, decimals));
      } catch (e) {
        // fallback if decimals is not a number
      }
    }

    // Set token prices on the router
    console.log('Setting token prices on router...');
    try {
      const tx = await routerContract.setTokenPrices(addresses, prices, isMintable);
      console.log('Token prices set. Tx hash:', tx.hash);
      await tx.wait();
      console.log('Prices set finished for router:', router);
    } catch (error) {
      console.error('Error setting token prices:', error);
    }
  });
