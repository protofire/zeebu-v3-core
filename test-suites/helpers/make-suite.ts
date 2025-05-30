import { Signer } from 'ethers';
import { BigNumber } from '@ethersproject/bignumber';
import {
  getPool,
  getPoolAddressesProvider,
  getAaveProtocolDataProvider,
  getAToken,
  getMintableERC20,
  getPoolConfiguratorProxy,
  getPoolAddressesProviderRegistry,
  getWETHMocked,
  getVariableDebtToken,
  getStableDebtToken,
  getAaveOracle,
  getACLManager,
} from '@aave/deploy-v3/dist/helpers/contract-getters';
import {
  waitForTx,
  evmSnapshot,
  evmRevert,
  getEthersSigners,
  deployPriceOracle,
  Faucet,
  getFaucet,
} from '@aave/deploy-v3';
import { Pool } from '../../types/Pool';
import { AaveProtocolDataProvider } from '../../types/AaveProtocolDataProvider';
import { MintableERC20 } from '../../types/MintableERC20';
import { AToken } from '../../types/AToken';
import { PoolConfigurator } from '../../types/PoolConfigurator';
import { PriceOracle } from '../../types/PriceOracle';
import { PoolAddressesProvider } from '../../types/PoolAddressesProvider';
import { PoolAddressesProviderRegistry } from '../../types/PoolAddressesProviderRegistry';
import { WETH9Mocked } from '../../types/WETH9Mocked';
import { AaveOracle, ACLManager, StableDebtToken, VariableDebtToken } from '../../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { tEthereumAddress } from '../../helpers/types';
import { FlashLiquidationAdapter } from '../../types/FlashLiquidationAdapter';
declare var hre: HardhatRuntimeEnvironment;

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}
export interface TestEnv {
  deployer: SignerWithAddress;
  poolAdmin: SignerWithAddress;
  emergencyAdmin: SignerWithAddress;
  riskAdmin: SignerWithAddress;
  users: SignerWithAddress[];
  pool: Pool;
  configurator: PoolConfigurator;
  oracle: PriceOracle;
  aaveOracle: AaveOracle;
  helpersContract: AaveProtocolDataProvider;
  weth: WETH9Mocked;
  aWETH: AToken;
  zeebu: MintableERC20;
  aZBU: AToken;
  faucetMintable: Faucet;
  dai: MintableERC20;
  aDai: AToken;
  aAave: AToken;
  variableDebtDai: VariableDebtToken;
  stableDebtDai: StableDebtToken;
  aUsdc: AToken;
  usdc: MintableERC20;
  aave: MintableERC20;
  addressesProvider: PoolAddressesProvider;
  registry: PoolAddressesProviderRegistry;
  aclManager: ACLManager;
  flashLiquidationAdapter: FlashLiquidationAdapter;
}

let HardhatSnapshotId: string = '0x1';
const setHardhatSnapshotId = (id: string) => {
  HardhatSnapshotId = id;
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  poolAdmin: {} as SignerWithAddress,
  emergencyAdmin: {} as SignerWithAddress,
  riskAdmin: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  pool: {} as Pool,
  configurator: {} as PoolConfigurator,
  helpersContract: {} as AaveProtocolDataProvider,
  oracle: {} as PriceOracle,
  aaveOracle: {} as AaveOracle,
  weth: {} as WETH9Mocked,
  aWETH: {} as AToken,
  faucetMintable: {} as Faucet,
  dai: {} as MintableERC20,
  aDai: {} as AToken,
  aZBU: {} as AToken,
  variableDebtDai: {} as VariableDebtToken,
  stableDebtDai: {} as StableDebtToken,
  aUsdc: {} as AToken,
  usdc: {} as MintableERC20,
  aave: {} as MintableERC20,
  addressesProvider: {} as PoolAddressesProvider,
  registry: {} as PoolAddressesProviderRegistry,
  aclManager: {} as ACLManager,
  zeebu: {} as MintableERC20,
} as TestEnv;

export async function initializeMakeSuite() {
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }
  testEnv.deployer = deployer;
  testEnv.poolAdmin = deployer;
  testEnv.emergencyAdmin = testEnv.users[1];
  testEnv.riskAdmin = testEnv.users[2];
  testEnv.pool = await getPool();
  testEnv.configurator = await getPoolConfiguratorProxy();

  testEnv.addressesProvider = await getPoolAddressesProvider();

  testEnv.registry = await getPoolAddressesProviderRegistry();
  testEnv.aclManager = await getACLManager();

  testEnv.oracle = await deployPriceOracle();
  testEnv.aaveOracle = await getAaveOracle();

  testEnv.helpersContract = await getAaveProtocolDataProvider();

  // Initialize ZBU as a reserve ***********************************************************

  // Deploy and initialize zeebu token for tests
  // const zeebuFactory = await hre.ethers.getContractFactory('MintableERC20');
  // const zeebu = await zeebuFactory.deploy('Zeebu', 'ZBU', 18);
  // await zeebu.deployed();
  // testEnv.zeebu = zeebu as MintableERC20;

  // // Deploy aToken, stable debt, and variable debt token implementations for ZBU
  // const aTokenFactory = await hre.ethers.getContractFactory('AToken');
  // const aTokenImpl = await aTokenFactory.deploy(testEnv.pool.address);
  // await aTokenImpl.initialize(testEnv.pool.address, testEnv.pool.address, testEnv.pool.address, 0, 'ATOKEN_IMPL', 'ATOKEN_IMPL', '0x10');

  // const stableDebtTokenFactory = await hre.ethers.getContractFactory('StableDebtToken');
  // const stableDebtTokenImpl = await stableDebtTokenFactory.deploy();
  // await stableDebtTokenImpl.deployed();

  // const variableDebtTokenFactory = await hre.ethers.getContractFactory('VariableDebtToken');
  // const variableDebtTokenImpl = await variableDebtTokenFactory.deploy();
  // await variableDebtTokenImpl.deployed();

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();
  // const daiReserve = reservesTokens.find((token) => token.symbol === 'DAI');
  // const { interestRateStrategyAddress } = await testEnv.helpersContract.getReserveTokensAddresses(daiReserve.tokenAddress);

  // await testEnv.configurator.initReserve(
  //   zeebu.address,
  //   aTokenImpl.address,
  //   stableDebtTokenImpl.address,
  //   variableDebtTokenImpl.address,
  //   interestRateStrategyAddress
  // );
  // ***************************************************************************************

  const allTokens = await testEnv.helpersContract.getAllATokens();
  console.log('All aTokens:', allTokens);
  const aDaiAddress = allTokens.find((aToken) => aToken.symbol.includes('DAI'))?.tokenAddress;
  const aUsdcAddress = allTokens.find((aToken) => aToken.symbol.includes('USDC'))?.tokenAddress;
  const aWEthAddress = allTokens.find((aToken) => aToken.symbol.includes('WETH'))?.tokenAddress;
  const aZBUAddress = allTokens.find((aToken) => aToken.symbol.includes('ZBU'))?.tokenAddress;
  const aAaveAddress = allTokens.find((aToken) => aToken.symbol.includes('AAVE'))?.tokenAddress;

  const daiAddress = reservesTokens.find((token) => token.symbol === 'DAI')?.tokenAddress;
  const {
    variableDebtTokenAddress: variableDebtDaiAddress,
    stableDebtTokenAddress: stableDebtDaiAddress,
  } = await testEnv.helpersContract.getReserveTokensAddresses(daiAddress || '');
  const usdcAddress = reservesTokens.find((token) => token.symbol === 'USDC')?.tokenAddress;
  const aaveAddress = reservesTokens.find((token) => token.symbol === 'AAVE')?.tokenAddress;
  const wethAddress = reservesTokens.find((token) => token.symbol === 'WETH')?.tokenAddress;

  if (!aDaiAddress || !aWEthAddress) {
    throw 'Missing mandatory atokens';
  }
  if (!daiAddress || !usdcAddress || !aaveAddress || !wethAddress) {
    throw 'Missing mandatory tokens (DAI or USDC or AAVE or WETH)';
  }

  testEnv.faucetMintable = await getFaucet();
  testEnv.aDai = await getAToken(aDaiAddress);
  testEnv.variableDebtDai = await getVariableDebtToken(variableDebtDaiAddress);
  testEnv.stableDebtDai = await getStableDebtToken(stableDebtDaiAddress);
  testEnv.aUsdc = await getAToken(aUsdcAddress);
  testEnv.aWETH = await getAToken(aWEthAddress);
  testEnv.aAave = await getAToken(aAaveAddress);

  testEnv.aave = await getMintableERC20(aaveAddress);
  testEnv.usdc = await getMintableERC20(usdcAddress);
  testEnv.dai = await getMintableERC20(daiAddress);
  testEnv.weth = await getWETHMocked(wethAddress);

  // // Now fetch all aTokens (aZBU will be included)
  // const allTokensAfter = await testEnv.helpersContract.getAllATokens();
  // console.log('All aTokens:', allTokensAfter);
  // const aDaiAddressAfter = allTokensAfter.find((aToken) => aToken.symbol.includes('DAI'))?.tokenAddress;
  // const aZBUAddressAfter = allTokensAfter.find((aToken) => aToken.symbol.includes('ZBU'))?.tokenAddress;
  // const aUsdcAddressAfter = allTokensAfter.find((aToken) => aToken.symbol.includes('USDC'))?.tokenAddress;
  // const aWEthAddressAfter = allTokensAfter.find((aToken) => aToken.symbol.includes('WETH'))?.tokenAddress;
  // const aAaveAddressAfter = allTokensAfter.find((aToken) => aToken.symbol.includes('AAVE'))?.tokenAddress;

  // Support direct minting
  const testReserves = reservesTokens.map((x) => x.tokenAddress);
  await waitForTx(await testEnv.faucetMintable.setProtectedOfChild(testReserves, false));

  // Setup Fallback Oracle and feed up with current AaveOracle prices
  for (const testReserve of testReserves) {
    const price = await testEnv.aaveOracle.getAssetPrice(testReserve);
    await waitForTx(await testEnv.oracle.setAssetPrice(testReserve, price));
  }
  await waitForTx(await testEnv.aaveOracle.setFallbackOracle(testEnv.oracle.address));

  // Setup admins
  await waitForTx(await testEnv.aclManager.addRiskAdmin(testEnv.riskAdmin.address));
  await waitForTx(await testEnv.aclManager.addEmergencyAdmin(testEnv.emergencyAdmin.address));
}

const setSnapshot = async () => {
  if (usingTenderly()) {
    setHardhatSnapshotId((await hre.tenderlyNetwork.getHead()) || '0x1');
    return;
  }
  setHardhatSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (usingTenderly()) {
    await hre.tenderlyNetwork.setHead(HardhatSnapshotId);
    return;
  }
  await evmRevert(HardhatSnapshotId);
};

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      await setSnapshot();
    });
    tests(testEnv);
    after(async () => {
      await revertHead();
    });
  });
}
