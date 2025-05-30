export interface SupplyCapConfig {
  [network: string]: {
    [asset: string]: {
      address: string;
      supplyCap: string; // in ETH units
    };
  };
}

export const SUPPLY_CAPS: SupplyCapConfig = {
  sepolia: {
    USDC: {
      address: '0x1c9b6337b001704d54B13FBA5C06Fe5D43061a8E',
      supplyCap: '2290000000', // 2.29B USDC
    },
    WBTC: {
      address: '0x4647044B0B264C771510FdB2764587B1fc7B599B',
      supplyCap: '817634', // 8,176.34 WBTC
    },
    WETH: {
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
      supplyCap: '357840', // 357.84K WETH
    },
    USDOX: {
      address: '0x8C97603960783e5EbaA727E50c02821C833de5b0',
      supplyCap: '2290000000', // 2.29B USDOX
    },
    WSTZBU: {
      address: '0xCB2693c8503F51fA42Cfd5952dc078951389448E',
      supplyCap: '640550', // 640.55K wstZBU
    },
    ZBU: {
      address: '0x6098Bc6CA2fDFDa186847878726AFBad1d01f13D',
      supplyCap: '640550', // 640.55K ZBU
    },
  },
  baseSepolia: {
    USDC: {
      address: '0xC30752a94e043DDcb9DCf313e8CAEADF5Ad5Aa36',
      supplyCap: '2290000000', // 2.29B USDC
    },
    WBTC: {
      address: '0x7d226DcE7B3D201B3FC5e73b8114EFd7c7b8E84B',
      supplyCap: '817634', // 8,176.34 WBTC
    },
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      supplyCap: '357840', // 357.84K WETH
    },
    USDOX: {
      address: '0x1825CF470a297aE6355a284330723d7224aA80CE',
      supplyCap: '2290000000', // 2.29B USDOX
    },
    WSTZBU: {
      address: '0x2A81f942c5DA841dA04964B03e28286800735782',
      supplyCap: '640550', // 640.55K wstZBU
    },
    ZBU: {
      address: '0x28f915a466a5D4b66e98f5878fCA1d4254F4DA04',
      supplyCap: '640550', // 640.55K ZBU
    },
  },
  bscTestnet: {
    USDC: {
      address: '0xBA959085D18a436e38C49dfBB4dE1577A04Cfc82',
      supplyCap: '2290000000', // 2.29B USDC
    },
    WBTC: {
      address: '0xb5F8e2C38b25D914d7E87562A8fE5f379EfbF720',
      supplyCap: '817634', // 8,176.34 WBTC
    },
    WETH: {
      address: '0x24C9184c7DA6CA2F3B5cF55E646E9CD581b89dA7',
      supplyCap: '357840', // 357.84K WETH
    },
    USDOX: {
      address: '0x18Aa55A2192058f4e207ad0029523e83486E757F',
      supplyCap: '2290000000', // 2.29B USDOX
    },
    WSTZBU: {
      address: '0x19f59C5bAabaEf87E1bc1Df1ec8868711ADC22e6',
      supplyCap: '640550', // 640.55K wstZBU
    },
    ZBU: {
      address: '0xb9494eE5c37A44df967dc2826df9c9D2269aBB4A',
      supplyCap: '640550', // 640.55K ZBU
    },
  },
};
