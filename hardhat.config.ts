import path from 'path';
import fs from 'fs';
import { HardhatUserConfig } from 'hardhat/types';
// @ts-ignore
import { accounts } from './test-wallets.js';
import {
  eAvalancheNetwork,
  eEthereumNetwork,
  eNetwork,
  ePolygonNetwork,
  eXDaiNetwork,
} from './helpers/types';
import { BUIDLEREVM_CHAINID, COVERAGE_CHAINID } from './helpers/constants';
import {
  NETWORKS_RPC_URL,
  NETWORKS_DEFAULT_GAS,
  BLOCK_TO_FORK,
  buildForkConfig,
} from './helper-hardhat-config';

require('dotenv').config();

import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-deploy';
import '@tenderly/hardhat-tenderly';
import 'hardhat-contract-sizer';
import 'hardhat-dependency-compiler';
import '@nomicfoundation/hardhat-chai-matchers';
import 'hardhat-gas-reporter';
import 'solidity-coverage';

import { DEFAULT_NAMED_ACCOUNTS } from '@aave/deploy-v3';

const SKIP_LOAD = process.env.SKIP_LOAD === 'true';
const DEFAULT_BLOCK_GAS_LIMIT = 12450000;
const DEFAULT_GAS_MUL = 5;
const HARDFORK = 'london';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || '';
const MNEMONIC_PATH = "m/44'/60'/0'/0";
const MNEMONIC = process.env.MNEMONIC || '';
const UNLIMITED_BYTECODE_SIZE = process.env.UNLIMITED_BYTECODE_SIZE === 'true';
const INFURA_KEY = process.env.INFURA_KEY || '';
const PRIVATE_KEY1 = process.env.PRIVATE_KEY1 || '';
const PRIVATE_KEY2 = process.env.PRIVATE_KEY2 || '';

// Prevent to load scripts before compilation and typechain
if (!SKIP_LOAD) {
  ['misc', 'migrations', 'dev', 'full', 'verifications', 'deployments', 'helpers'].forEach(
    (folder) => {
      const tasksPath = path.join(__dirname, 'tasks', folder);
      fs.readdirSync(tasksPath)
        .filter((pth) => pth.includes('.ts'))
        .forEach((task) => {
          require(`${tasksPath}/${task}`);
        });
    }
  );
}

const getCommonNetworkConfig = (networkName: eNetwork, networkId: number) => ({
  url: NETWORKS_RPC_URL[networkName as keyof typeof NETWORKS_RPC_URL],
  hardfork: HARDFORK,
  blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
  gasMultiplier: DEFAULT_GAS_MUL,
  gasPrice: NETWORKS_DEFAULT_GAS[networkName as keyof typeof NETWORKS_DEFAULT_GAS],
  chainId: networkId,
  accounts: {
    mnemonic: MNEMONIC,
    path: MNEMONIC_PATH,
    initialIndex: 0,
    count: 20,
  },
});

const hardhatConfig: HardhatUserConfig = {
  gasReporter: {
    enabled: true,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  solidity: {
    version: '0.8.10',
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000,
      },
      evmVersion: 'london',
    },
  },
  typechain: {
    outDir: 'types',
    target: 'ethers-v5',
  },
  etherscan: {
    apiKey: {
      polygonMumbai: process.env.ETHERSCAN_POLYGON_KEY || '',
      goerli: process.env.ETHERSCAN_KEY || '',
      mainnet: process.env.ETHERSCAN_KEY || '',
      polygon: process.env.ETHERSCAN_POLYGON_KEY || '',
      avalanche: process.env.ETHERSCAN_SNOWTRACE_KEY || '',
      sepolia: process.env.ETHERSCAN_KEY || '',
      baseSepolia: process.env.ETHERSCAN_KEY || '',
      bscTestnet: process.env.ETHERSCAN_KEY || '',
    },
    customChains: [
      {
        network: eEthereumNetwork.baseSepolia,
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org/',
        },
      },
      {
        network: eEthereumNetwork.bscTestnet,
        chainId: 97,
        urls: {
          apiURL: 'https://api-testnet.bscscan.com/api',
          browserURL: 'https://testnet.bscscan.com/',
        },
      },
    ],
  },
  mocha: {
    timeout: 0,
    bail: true,
  },
  tenderly: {
    project: process.env.TENDERLY_PROJECT || '',
    username: process.env.TENDERLY_USERNAME || '',
    forkNetwork: '1',
  },
  networks: {
    coverage: {
      url: 'http://localhost:8555',
      chainId: COVERAGE_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
    },
    main: getCommonNetworkConfig(eEthereumNetwork.main, 1),
    sepolia: getCommonNetworkConfig(eEthereumNetwork.sepolia, 11155111),
    baseSepolia: getCommonNetworkConfig(eEthereumNetwork.baseSepolia, 84532),
    bscTestnet: getCommonNetworkConfig(eEthereumNetwork.bscTestnet, 97),
    hardhat: {
      hardfork: HARDFORK,
      blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
      gas: DEFAULT_BLOCK_GAS_LIMIT,
      gasPrice: 8000000000,
      chainId: BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      forking: buildForkConfig(),
      allowUnlimitedContractSize: UNLIMITED_BYTECODE_SIZE,
      accounts: accounts.map(({ secretKey, balance }: { secretKey: string; balance: string }) => ({
        privateKey: secretKey,
        balance,
      })),
    },
    buidlerevm_docker: {
      hardfork: 'berlin',
      blockGasLimit: 9500000,
      gas: 9500000,
      gasPrice: 8000000000,
      chainId: BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      url: 'http://localhost:8545',
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
  },
  namedAccounts: {
    ...DEFAULT_NAMED_ACCOUNTS,
  },
  external: {
    contracts: [
      {
        artifacts: './temp-artifacts',
        deploy: 'node_modules/@aave/deploy-v3/dist/deploy',
      },
    ],
  },
};

export default hardhatConfig;
