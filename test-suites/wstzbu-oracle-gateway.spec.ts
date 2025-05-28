import { makeSuite, TestEnv } from './helpers/make-suite';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { ZERO_ADDRESS } from '@aave/deploy-v3';
import {
  WstZBUOracleGateway,
  WstZBUOracleGateway__factory,
  MockChainlinkOraclePriceAggregator,
  MockChainlinkOraclePriceAggregator__factory,
} from '../types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('WSTZBU Oracle Gateway', (testEnv: TestEnv) => {
  let wstzbuOracle: WstZBUOracleGateway;
  let mockSourceOracle: MockChainlinkOraclePriceAggregator;

  before('Deploy contracts', async () => {
    const { deployer, addressesProvider } = testEnv;

    mockSourceOracle = await new MockChainlinkOraclePriceAggregator__factory(
      deployer.signer
    ).deploy(18, parseEther('1.5'));

    wstzbuOracle = await new WstZBUOracleGateway__factory(deployer.signer).deploy(
      mockSourceOracle.address,
      addressesProvider.address
    );
  });

  it('should deploy with correct parameters', async () => {
    expect(wstzbuOracle.address).to.not.equal(ZERO_ADDRESS);
    expect(await wstzbuOracle.SOURCE_ORACLE()).to.equal(mockSourceOracle.address);
    expect(await wstzbuOracle.decimals()).to.equal(8);
    expect(await wstzbuOracle.description()).to.equal('wstZBU / USD');
  });

  it('should correctly convert price from 18 to 8 decimals', async () => {
    const sourcePrice = parseUnits('5.18', 18);
    await mockSourceOracle.setLatestAnswer(sourcePrice);

    const expectedPrice = sourcePrice.div(BigNumber.from(10).pow(10));
    const actualPrice = await wstzbuOracle.latestAnswer();

    expect(actualPrice).to.equal(expectedPrice);
  });

  it('should revert if source oracle returns invalid price', async () => {
    await mockSourceOracle.setLatestAnswer(0);
    await expect(wstzbuOracle.latestAnswer()).to.be.revertedWith('Invalid price');
  });

  it('should handle fake price setting correctly', async () => {
    const { deployer } = testEnv;
    const fakePrice = parseEther('10');

    await expect(wstzbuOracle.connect(deployer.signer).setFakePrice(fakePrice))
      .to.emit(wstzbuOracle, 'AnswerUpdated')
      .withArgs(fakePrice, 1);
  });

  it('should reset to real price correctly', async () => {
    const { deployer } = testEnv;
    const sourcePrice = parseUnits('5.18', 18);
    await mockSourceOracle.connect(deployer.signer).setLatestAnswer(sourcePrice);
    await wstzbuOracle.connect(deployer.signer).resetToRealPrice();

    const expectedPrice = sourcePrice.div(BigNumber.from(10).pow(10));
    expect(await wstzbuOracle.latestAnswer(), 'latestAnswer not equal to source price').to.equal(
      expectedPrice
    );
  });

  it('should track rounds correctly', async () => {
    const { deployer } = testEnv;
    const fakePrice = parseUnits('15', 8);

    await wstzbuOracle.connect(deployer.signer).setFakePrice(fakePrice);

    expect(await wstzbuOracle.latestRound()).to.equal(3);
    expect(await wstzbuOracle.getAnswer(3)).to.equal(fakePrice);
  });

  it('should emit correct events for new rounds', async () => {
    const { deployer } = testEnv;
    const fakePrice = parseUnits('20', 8);

    await expect(wstzbuOracle.connect(deployer.signer).setFakePrice(fakePrice))
      .to.emit(wstzbuOracle, 'AnswerUpdated')
      .withArgs(fakePrice, 3);

    await expect(wstzbuOracle.connect(deployer.signer).setFakePrice(fakePrice))
      .to.emit(wstzbuOracle, 'NewRound')
      .withArgs(5, deployer.address);
  });

  it('should only allow admin to set fake price', async () => {
    const { users } = testEnv;
    const nonAdmin = users[1];
    const fakePrice = parseUnits('25', 8);

    await expect(wstzbuOracle.connect(nonAdmin.signer).setFakePrice(fakePrice)).to.be.revertedWith(
      'Only pool admin can call this function'
    );
  });

  it('should only allow admin to reset to real price', async () => {
    const { users } = testEnv;
    const nonAdmin = users[1];

    await expect(wstzbuOracle.connect(nonAdmin.signer).resetToRealPrice()).to.be.revertedWith(
      'Only pool admin can call this function'
    );
  });

  it('should only allow admin to set source oracle', async () => {
    const { users } = testEnv;
    const nonAdmin = users[1];
    const newSourceOracle = await new MockChainlinkOraclePriceAggregator__factory(
      nonAdmin.signer
    ).deploy(18, parseEther('1.5'));

    await expect(
      wstzbuOracle.connect(nonAdmin.signer).setSourceOracle(newSourceOracle.address)
    ).to.be.revertedWith('Only pool admin can call this function');
  });

  it('should allow admin to update source oracle', async () => {
    const { deployer } = testEnv;
    const newSourceOracle = await new MockChainlinkOraclePriceAggregator__factory(
      deployer.signer
    ).deploy(18, parseEther('2.0'));

    await expect(wstzbuOracle.connect(deployer.signer).setSourceOracle(newSourceOracle.address))
      .to.emit(wstzbuOracle, 'NewSourceOracle')
      .withArgs(newSourceOracle.address);

    expect(await wstzbuOracle.SOURCE_ORACLE()).to.equal(newSourceOracle.address);
    mockSourceOracle = newSourceOracle;
  });

  it('should revert when setting invalid source oracle', async () => {
    const { deployer } = testEnv;

    await expect(
      wstzbuOracle.connect(deployer.signer).setSourceOracle(ZERO_ADDRESS)
    ).to.be.revertedWith('Invalid source oracle');

    await expect(
      wstzbuOracle.connect(deployer.signer).setSourceOracle(mockSourceOracle.address)
    ).to.be.revertedWith('New source oracle must be different');
  });

  it('should correctly handle updated source oracle with different decimals', async () => {
    const { deployer } = testEnv;

    const sourcePrice = parseUnits('5.18', 18);
    const newSourceOracle = await new MockChainlinkOraclePriceAggregator__factory(
      deployer.signer
    ).deploy(18, sourcePrice);

    await wstzbuOracle.connect(deployer.signer).setSourceOracle(newSourceOracle.address);
    await wstzbuOracle.connect(deployer.signer).resetToRealPrice();

    const expected = sourcePrice.div(BigNumber.from(10).pow(10));
    const actual = await wstzbuOracle.latestAnswer();

    expect(actual).to.equal(expected);
  });
});
