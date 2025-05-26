import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

// How to execute this task:
// npx hardhat deploy --tags WstZBUOracleGateway --network <network> --env POOL_ADDRESSES_PROVIDER=<address> --env SOURCE_ORACLE=<address>

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const poolAddressesProvider = process.env.POOL_ADDRESSES_PROVIDER;
  const sourceOracle = process.env.SOURCE_ORACLE;

  if (!poolAddressesProvider) {
    throw new Error('POOL_ADDRESSES_PROVIDER environment variable is required');
  }

  if (!sourceOracle) {
    throw new Error('SOURCE_ORACLE environment variable is required');
  }

  const deployment = await deploy('WSTZBUChainlinkPriceAggregator', {
    from: deployer,
    args: [sourceOracle, poolAddressesProvider],
    log: true,
    waitConfirmations: 1,
  });

  // Verify the contract
  if (deployment.newlyDeployed) {
    try {
      await hre.run('verify:verify', {
        address: deployment.address,
        constructorArguments: [sourceOracle, poolAddressesProvider],
      });
      console.log('Contract verified successfully');
    } catch (error) {
      console.error('Error verifying contract:', error);
    }
  }
};

func.tags = ['WstZBUOracleGateway'];

export default func;
