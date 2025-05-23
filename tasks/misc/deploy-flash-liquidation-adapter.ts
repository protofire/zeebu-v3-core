import { task } from 'hardhat/config';

// How to execute this task:
// Params:
// --swapRouter: The address of the SwapRouter contract
// --poolAddressesProvider: The address of the PoolAddressesProvider contract
// Example:
// npx hardhat deploy-flash-liquidation-adapter --swapRouter <swapt-router-address> --poolAddressesProvider <pool-addresses-provider-address>

task('deploy-flash-liquidation-adapter', 'Deploy the FlashLiquidationAdapterV3 contract')
  .addParam('swapRouter', 'The address of the SwapRouter contract')
  .addParam('poolAddressesProvider', 'The address of the PoolAddressesProvider contract')
  .setAction(async ({ swapRouter, poolAddressesProvider }, hre) => {
    const { deployments, getNamedAccounts, run } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('Starting deployment of FlashLiquidationAdapterV3...');
    console.log('Deployer address:', deployer);
    console.log('SwapRouter address:', swapRouter);
    console.log('PoolAddressesProvider address:', poolAddressesProvider);

    console.log('Deploying FlashLiquidationAdapterV3...');
    const deployment = await deploy('FlashLiquidationAdapterV3', {
      from: deployer,
      args: [poolAddressesProvider, swapRouter],
      log: true,
      waitConfirmations: 1,
    });

    console.log('Deployment completed!');
    console.log('Contract address:', deployment.address);
    console.log('Transaction hash:', deployment.transactionHash);
    console.log('Gas used:', deployment.receipt?.gasUsed.toString());

    // Verify the contract
    if (deployment.newlyDeployed) {
      console.log('\nStarting contract verification...');
      try {
        await run('verify:verify', {
          address: deployment.address,
          constructorArguments: [poolAddressesProvider, swapRouter],
        });
        console.log('Contract verified successfully on Etherscan');
      } catch (error) {
        console.error('Error verifying contract:', error);
      }
    } else {
      console.log('\nContract was already deployed, skipping verification');
    }
  });
