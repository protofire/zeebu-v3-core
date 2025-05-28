import { task } from 'hardhat/config';

// How to execute this task:
// Params:
// --poolAddressesProvider: The address of the PoolAddressesProvider contract
// --sourceOracle: The address of the Source Oracle contract
// Example:
// npx hardhat deploy-oracle-gateway  --network sepolia --pool-addresses-provider 0x7a3DB50a655B722017f73A50835Dde9695efa9e5 --source-oracle 0xa774E6fd62dF21DeB9b9DEceca773dD81629Becb

// source-oracles
// Sepolia - 0xa774E6fd62dF21DeB9b9DEceca773dD81629Becb
// Base Sepolia - 0x862fe40C02CBF5894DEb20B44eA1d76eAFAe625C
// BSC Testnet - 0xAd62Fdd1424e06B0C9b2BEa7096756B275C98B0F

task('deploy-oracle-gateway', 'Deploy the WstZBUOracleGateway contract')
  .addParam('poolAddressesProvider', 'The address of the PoolAddressesProvider contract')
  .addParam('sourceOracle', 'The address of the Source Oracle contract')
  .setAction(async ({ poolAddressesProvider, sourceOracle }, hre) => {
    const { deployments, getNamedAccounts, run } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('\nDeploying WstZBUOracleGateway...');
    console.log('Using PoolAddressesProvider at:', poolAddressesProvider);
    console.log('Using Source Oracle at:', sourceOracle);

    const deployment = await deploy('WstZBUOracleGateway', {
      from: deployer,
      args: [sourceOracle, poolAddressesProvider],
      log: true,
      waitConfirmations: 1,
    });
    console.log('WstZBUOracleGateway deployed to:', deployment.address);

    console.log('\nDeployment Summary:');
    console.log('-------------------');
    console.log('PoolAddressesProvider:', poolAddressesProvider);
    console.log('Source Oracle:', sourceOracle);
    console.log('WstZBUOracleGateway:', deployment.address);
    console.log('-------------------\n');

    // Verify contract on Etherscan
    if (process.env.VERIFY_CONTRACTS === 'true') {
      console.log('Verifying contract...');

      try {
        await run('verify:verify', {
          address: deployment.address,
          constructorArguments: [sourceOracle, poolAddressesProvider],
        });
        console.log('WstZBUOracleGateway verified successfully');
      } catch (error) {
        console.error('Error verifying WstZBUOracleGateway:', error);
      }
    }
  });
