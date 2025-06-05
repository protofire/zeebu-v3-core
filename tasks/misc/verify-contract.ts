import { task } from 'hardhat/config';

// How to execute this task:
// npx hardhat verify-contract --network baseSepolia --contract-address 0x8686a84D6AD72a771ADC02612624416CE3a0A9FB --constructor-arguments 0x5606a320da1aB8a5f110aB97664c1ea16C08A110,0x2ffD717C6EB8d59796550901Fea793c607F4c23D

task(`verify-contract`)
  .addParam('contractAddress', 'Address of the contract to verify')
  .addParam('constructorArguments', 'Constructor arguments')
  .setAction(async ({ contractAddress, constructorArguments }, hre) => {
    const args = constructorArguments ? constructorArguments.split(',') : [];
    const address = contractAddress as string;

    console.log(`Verifying contract at address: ${address}`);
    console.log(`Constructor arguments: ${args}`);

    try {
      await hre.run('verify:verify', {
        address: address,
        constructorArguments: args,
      });
      console.log('Contract verification successful!');
    } catch (error) {
      console.error('Contract verification failed:', error);
    }
  });
