import { task } from 'hardhat/config';
import { isAddress } from 'ethers/lib/utils';
import { getEthersSigners } from '@aave/deploy-v3';
import { SUPPLY_CAPS } from '../../helpers/supply-caps';

interface UpdateResult {
  asset: string;
  address: string;
  supplyCap: string;
  txHash?: string;
  status: 'success' | 'failed';
  error?: string;
}

// Usage: npx hardhat update-supply-caps --network <network> --pool-configurator <pool-configurator-address>
// Example: npx hardhat update-supply-caps --network sepolia --pool-configurator 0x8145eddDf43f50276641b55bd3AD95944510021E

task(
  'update-supply-caps',
  'Update supply caps for all configured assets in the Aave V3 Pool Configurator'
)
  .addParam('poolConfigurator', 'The address of the Aave V3 Pool Configurator')
  .setAction(async ({ poolConfigurator }, hre) => {
    if (!isAddress(poolConfigurator)) {
      throw new Error('Invalid pool configurator address provided.');
    }

    const [signer] = await getEthersSigners();
    const network = hre.network.name;

    // Check if network is configured
    if (!SUPPLY_CAPS[network]) {
      throw new Error(`No supply caps configuration found for network: ${network}`);
    }

    console.log(`Updating supply caps for network: ${network}`);

    // Get the pool configurator contract
    const configuratorContract = await hre.ethers.getContractAt(
      'PoolConfigurator',
      poolConfigurator,
      signer
    );

    const networkConfig = SUPPLY_CAPS[network];
    const results: UpdateResult[] = [];

    // Update supply caps for each asset
    for (const [assetName, config] of Object.entries(networkConfig)) {
      try {
        console.log(`\nProcessing ${assetName}...`);
        console.log(`Asset address: ${config.address}`);
        console.log(`Supply cap: ${config.supplyCap}`);

        // Set the supply cap
        const tx = await configuratorContract.setSupplyCap(config.address, config.supplyCap);
        await tx.wait();
        setTimeout(() => {
          console.log('Waiting for 5 seconds...');
        }, 5000);

        results.push({
          asset: assetName,
          address: config.address,
          supplyCap: config.supplyCap,
          txHash: tx.hash,
          status: 'success',
        });

        console.log(`Successfully updated supply cap for ${assetName}`);
        console.log(`Transaction hash: ${tx.hash}`);
      } catch (error: any) {
        console.error(`Failed to update supply cap for ${assetName}:`, error.message);
        results.push({
          asset: assetName,
          address: config.address,
          supplyCap: config.supplyCap,
          status: 'failed',
          error: error.message,
        });
      }
    }

    // Print summary
    console.log('\n=== Update Summary ===');
    results.forEach((result) => {
      console.log(`\n${result.asset}:`);
      console.log(`Status: ${result.status}`);
      if (result.status === 'success') {
        console.log(`Transaction hash: ${result.txHash}`);
      } else {
        console.log(`Error: ${result.error}`);
      }
    });

    return results;
  });
