// @ts-ignore
import { HardhatNetworkForkingUserConfig, HardhatUserConfig } from 'hardhat/types';
import { eEthereumNetwork, iParamsPerNetwork } from './helpers/types';

require('dotenv').config();

const INFURA_KEY = process.env.INFURA_KEY || '';
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
const TENDERLY_VNET_URL = process.env.TENDERLY_VNET_URL || '';
const TENDERLY_FORK_ID = process.env.TENDERLY_FORK_ID || '';
const FORK = process.env.FORK || '';
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER
  ? parseInt(process.env.FORK_BLOCK_NUMBER)
  : 0;

const GWEI = 1000 * 1000 * 1000;
const FORK_URL = process.env.FORK_URL || false;

export const buildForkConfig = (): HardhatNetworkForkingUserConfig | undefined => {
  let forkMode: any;
  if (FORK) {
    forkMode = {
      url: NETWORKS_RPC_URL[FORK as keyof typeof NETWORKS_RPC_URL],
    };
    if (FORK_BLOCK_NUMBER || BLOCK_TO_FORK[FORK as keyof typeof BLOCK_TO_FORK]) {
      (forkMode as any).blockNumber =
        FORK_BLOCK_NUMBER || BLOCK_TO_FORK[FORK as keyof typeof BLOCK_TO_FORK];
    }
  }
  return forkMode;
};

export const NETWORKS_RPC_URL: iParamsPerNetwork<string> = {
  [eEthereumNetwork.main]: TENDERLY_VNET_URL || `https://mainnet.infura.io/v3/${INFURA_KEY}`,
  [eEthereumNetwork.hardhat]: 'http://localhost:8545',
  [eEthereumNetwork.sepolia]: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
  [eEthereumNetwork.baseSepolia]: `https://base-sepolia.infura.io/v3/${INFURA_KEY}`,
  [eEthereumNetwork.bscTestnet]: `https://bsc-testnet.infura.io/v3/${INFURA_KEY}`,
};

export const NETWORKS_DEFAULT_GAS: iParamsPerNetwork<number> = {
  [eEthereumNetwork.main]: 65 * GWEI,
  [eEthereumNetwork.hardhat]: 65 * GWEI,
  [eEthereumNetwork.sepolia]: 85 * GWEI,
  [eEthereumNetwork.baseSepolia]: 65 * GWEI,
  [eEthereumNetwork.bscTestnet]: 65 * GWEI,
};

export const BLOCK_TO_FORK: iParamsPerNetwork<number | undefined> = {
  [eEthereumNetwork.main]: undefined, //12406069,
  [eEthereumNetwork.sepolia]: undefined,
  [eEthereumNetwork.baseSepolia]: undefined,
  [eEthereumNetwork.bscTestnet]: undefined,
  [eEthereumNetwork.hardhat]: undefined,
};
