import { task } from 'hardhat/config';
import { getEthersSigners } from '@aave/deploy-v3';
import { SUPPLY_CAPS } from '../../helpers/supply-caps';
import { BigNumber } from 'ethers';

// Usage: npx hardhat get-all-supply-caps --network <network> --data-provider <data-provider-address>
// Example: npx hardhat get-all-supply-caps --network sepolia --data-provider 0xd82A72832502A69180efB6182b657C2A889Ac82D

task(
  'get-all-supply-caps',
  'Get the supply caps for all assets from the Aave V3 Protocol Data Provider'
)
  .addParam('dataProvider', 'The address of the Aave V3 Protocol Data Provider')
  .setAction(async ({ dataProvider }, hre) => {
    const [signer] = await getEthersSigners();
    const network = hre.network.name;

    console.log(`Getting supply caps for all assets on network: ${network}`);

    // Get the data provider contract
    const dataProviderContract = await hre.ethers.getContractAt(
      'AaveProtocolDataProvider',
      dataProvider,
      signer
    );

    // Get network assets from SUPPLY_CAPS
    const networkAssets = SUPPLY_CAPS[network];
    if (!networkAssets) {
      throw new Error(`No assets configured for network: ${network}`);
    }

    // Iterate over all assets and get their supply caps
    for (const [assetSymbol, assetConfig] of Object.entries(networkAssets)) {
      const { address: assetAddress, supplyCap: configCap } = assetConfig;

      console.log(`\nChecking ${assetSymbol}:`);
      console.log('Asset Address:', assetAddress);
      console.log('Config Supply Cap:', configCap);

      try {
        const { borrowCap, supplyCap } = (await dataProviderContract.getReserveCaps(
          assetAddress
        )) as { borrowCap: BigNumber; supplyCap: BigNumber };
        console.log(
          'Current Supply Cap:',
          supplyCap.toString(),
          BigNumber.from(0).eq(supplyCap) ? '(ZERO) <======================================' : ''
        );
        console.log('Current Supply Cap (in ETH):', hre.ethers.utils.formatEther(supplyCap));
      } catch (error) {
        console.error(`Error getting supply cap for ${assetSymbol}:`, error.message);
      }
    }
  });
