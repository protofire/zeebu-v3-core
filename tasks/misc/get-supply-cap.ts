import { task } from 'hardhat/config';
import { isAddress } from 'ethers/lib/utils';
import { getEthersSigners } from '@aave/deploy-v3';

// Usage: npx hardhat get-supply-cap --network <network> --asset <asset-address> --data-provider <data-provider-address>
// Example: npx hardhat get-supply-cap --network sepolia --asset 0x1c9b6337b001704d54B13FBA5C06Fe5D43061a8E --data-provider 0xd82A72832502A69180efB6182b657C2A889Ac82D

export default task(
  'get-supply-cap',
  'Get the supply cap for an asset from the Aave V3 Protocol Data Provider'
)
  .addParam('asset', 'The address of the asset to get the supply cap for')
  .addParam('dataProvider', 'The address of the Aave V3 Protocol Data Provider')
  .setAction(async ({ asset, dataProvider }, hre) => {
    if (!isAddress(asset)) {
      throw new Error('Invalid asset address provided.');
    }
    if (!isAddress(dataProvider)) {
      throw new Error('Invalid data provider address provided.');
    }

    const [signer] = await getEthersSigners();
    const network = hre.network.name;

    console.log(`Getting supply cap for asset: ${asset} on network: ${network}`);

    // Get the data provider contract
    const dataProviderContract = await hre.ethers.getContractAt(
      'AaveProtocolDataProvider',
      dataProvider,
      signer
    );

    // Get the supply cap
    const { supplyCap } = await dataProviderContract.getReserveCaps(asset);

    console.log('Asset:', asset);
    console.log('Supply Cap:', supplyCap.toString());
    console.log('Supply Cap (in ETH):', hre.ethers.utils.formatEther(supplyCap));

    return supplyCap;
  });
