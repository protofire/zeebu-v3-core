import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { getPoolAddressesProvider } from '@aave/deploy-v3/dist/helpers/contract-getters';

// How to execute this task:
// SWAP_ROUTER_ADDRESS=0x... npx hardhat deploy --tags FlashLiquidationAdapter
// where 0x... is the address of the SwapRouter contract

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const poolAddressesProvider = await getPoolAddressesProvider();

  const swapRouterAddress = process.env.SWAP_ROUTER_ADDRESS;
  if (!swapRouterAddress) {
    throw new Error('Please provide SWAP_ROUTER_ADDRESS environment variable');
  }

  await deploy('FlashLiquidationAdapter', {
    from: deployer,
    args: [poolAddressesProvider.address, swapRouterAddress],
    log: true,
    waitConfirmations: 1,
  });
};

func.tags = ['FlashLiquidationAdapter'];
func.dependencies = ['PoolAddressesProvider'];

export default func;
