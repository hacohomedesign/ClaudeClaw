import type { MailAccount } from './types.js';

export const MAIL_ACCOUNTS: MailAccount[] = [
  { id: '360sc', label: '360SC', email: 'rm@360sc.io', fetchVia: 'mcp', active: true },
  { id: 'gs1', label: 'GS1', email: 'rm+gs1@360sc.io', fetchVia: 'mcp', active: true },
  { id: 'rorworld', label: 'RoRWorld', email: 'rolland.melet@rorworld.eu', fetchVia: 'mcp', active: true },
  { id: 'personal', label: 'Personnel', email: 'rolland.melet@gmail.com', fetchVia: 'gog', gogAccount: 'rolland.melet@gmail.com', active: false },
  { id: 'sci', label: 'SCI', email: 'scipetitbois83@gmail.com', fetchVia: 'gog', gogAccount: 'scipetitbois83@gmail.com', active: false },
];

export function getActiveAccounts(): MailAccount[] {
  return MAIL_ACCOUNTS.filter(a => a.active);
}

export function getAccountById(id: string): MailAccount | undefined {
  return MAIL_ACCOUNTS.find(a => a.id === id);
}
