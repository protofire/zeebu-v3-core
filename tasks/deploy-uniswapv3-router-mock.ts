import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

// How to execute this task:
// npx hardhat deploy --tags MockUniswapV3Router

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const mockFaucetInteractor = await deploy('MockFaucetInteractor', {
    from: deployer,
    log: true,
    waitConfirmations: 1,
  });

  await deploy('MockUniswapV3Router', {
    from: deployer,
    args: [mockFaucetInteractor.address],
    log: true,
    waitConfirmations: 1,
  });
};

func.tags = ['MockUniswapV3Router'];

export default func;
