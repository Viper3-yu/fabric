import type { AppUser, UserRole } from '@jixin/shared';

export interface DemoAccount {
  user: AppUser;
  password: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    user: {
      id: 'shipper-demo',
      username: 'shipper',
      displayName: '星河商贸',
      role: 'shipper',
      mspId: 'Org1MSP',
    },
    password: 'shipper123',
  },
  {
    user: {
      id: 'carrier-demo',
      username: 'carrier',
      displayName: '迅达物流',
      role: 'carrier',
      mspId: 'Org2MSP',
    },
    password: 'carrier123',
  },
  {
    user: {
      id: 'receiver-demo',
      username: 'receiver',
      displayName: '演示收货人',
      role: 'receiver',
      mspId: 'Org1MSP',
    },
    password: 'receiver123',
  },
  {
    user: {
      id: 'auditor-demo',
      username: 'auditor',
      displayName: '课程审计员',
      role: 'auditor',
      mspId: 'ReadOnly',
    },
    password: 'auditor123',
  },
] as const;

export const USERS_BY_USERNAME = new Map(
  DEMO_ACCOUNTS.map((account) => [account.user.username, account]),
);
export const USERS_BY_ID = new Map(DEMO_ACCOUNTS.map((account) => [account.user.id, account.user]));

export function roleToMsp(role: UserRole): 'Org1MSP' | 'Org2MSP' {
  return role === 'carrier' ? 'Org2MSP' : 'Org1MSP';
}
