import { defineApp } from '@platform/actions/define';
import { schema } from './schema';
import { fixtures } from './fixtures';
import { refundsActions } from './actions';
import IndexPage from './pages/index';
import RefundsPage from './pages/refunds';
import DetailPage from './pages/detail';

export const refundsManifest = defineApp({
  id: 'refunds',
  name: 'Refunds Dashboard',
  icon: 'refund',
  description: 'Refund settled card payments. Refunds of $100 or more route to finance for approval.',
  permission: 'refunds.read',
  dataMode: 'sandbox',
  dataClass: 'sensitive',
  sources: ['transactions', 'refunds'],
  nav: [
    { label: 'Queue', path: '' },
    { label: 'Refunds', path: 'refunds' },
  ],
  schema,
  fixtures,
  actions: refundsActions,
  pages: {
    '': IndexPage,
    refunds: RefundsPage,
    detail: DetailPage,
  },
});
