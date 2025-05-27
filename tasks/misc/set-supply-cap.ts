import { task } from 'hardhat/config';
import { isAddress } from 'ethers/lib/utils';
import { getEthersSigners } from '@aave/deploy-v3';

// Usage: npx hardhat set-supply-cap --network <network> --asset <asset-address> --pool-configurator <pool-configurator-address> --supply-cap <supply-cap-in-eth>
// Example:
// npx hardhat set-supply-cap --network sepolia --asset 0x1c9b6337b001704d54B13FBA5C06Fe5D43061a8E --pool-configurator 0x8145eddDf43f50276641b55bd3AD95944510021E --supply-cap 0.000000002

task('set-supply-cap', 'Set the supply cap for an asset in the Aave V3 Pool Configurator')
  .addParam('asset', 'The address of the asset to set the supply cap for')
  .addParam('poolConfigurator', 'The address of the Aave V3 Pool Configurator')
  .addParam('supplyCap', 'The new supply cap value in ETH')
  .setAction(async ({ asset, poolConfigurator, supplyCap }, hre) => {
    if (!isAddress(asset)) {
      throw new Error('Invalid asset address provided.');
    }
    if (!isAddress(poolConfigurator)) {
      throw new Error('Invalid pool configurator address provided.');
    }

    const [signer] = await getEthersSigners();
    const network = hre.network.name;

    console.log(`Setting supply cap for asset: ${asset} on network: ${network}`);

    // Get the pool configurator contract
    const configuratorContract = await hre.ethers.getContractAt(
      'PoolConfigurator',
      poolConfigurator,
      signer
    );

    // Convert supply cap from ETH to wei
    // const suppyCapInWei = hre.ethers.utils.parseEther(supplyCap);

    console.log('Supply cap:', supplyCap);

    // Set the supply cap
    const tx = await configuratorContract.setSupplyCap(asset, supplyCap);
    await tx.wait();

    console.log('Asset:', asset);
    console.log('New Supply Cap (in ETH):', supplyCap);
    console.log('Transaction hash:', tx.hash);

    return tx.hash;
  });
