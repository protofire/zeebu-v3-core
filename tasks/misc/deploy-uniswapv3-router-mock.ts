import { task } from 'hardhat/config';

// How to execute this task:
// Params:
// --faucetInteractor: The address of the Faucet contract
// Example:
// npx hardhat deploy-uniswapv3-router-mock --faucet-interactor 0xf95FAB4481BeeD26e5B0193CC0a2312B835a1E48 --network sepolia

task('deploy-uniswapv3-router-mock', 'Deploy the MockUniswapV3Router contract')
  .addParam('faucetInteractor', 'The address of the MockFaucetInteractor contract')
  .setAction(async ({ faucetInteractor }, hre) => {
    const { deployments, getNamedAccounts, run } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log('\nDeploying MockUniswapV3Router...');
    console.log('Using MockFaucetInteractor at:', faucetInteractor);

    const mockUniswapV3Router = await deploy('MockUniswapV3Router', {
      from: deployer,
      args: [faucetInteractor],
      log: true,
      waitConfirmations: 1,
    });
    console.log('MockUniswapV3Router deployed to:', mockUniswapV3Router.address);

    console.log('\nDeployment Summary:');
    console.log('-------------------');
    console.log('MockFaucetInteractor:', faucetInteractor);
    console.log('MockUniswapV3Router:', mockUniswapV3Router.address);
    console.log('-------------------\n');

    // Verify contract on Etherscan
    if (process.env.VERIFY_CONTRACTS === 'true') {
      console.log('Verifying contract...');

      try {
        await run('verify:verify', {
          address: mockUniswapV3Router.address,
          constructorArguments: [faucetInteractor],
        });
        console.log('MockUniswapV3Router verified successfully');
      } catch (error) {
        console.error('Error verifying MockUniswapV3Router:', error);
      }
    }
  });
