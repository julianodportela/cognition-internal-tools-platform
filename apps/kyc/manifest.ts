import { defineApp } from '@platform/actions/define';
import { schema } from './schema';
import { fixtures } from './fixtures';
import { kycActions } from './actions';
import IndexPage from './pages/index';
import DetailPage from './pages/detail';

export const kycManifest = defineApp({
  id: 'kyc',
  name: 'KYC Review Queue',
  icon: '🪪',
  permission: 'kyc.read',
  dataMode: 'sandbox',
  dataClass: 'sensitive',
  sources: ['kyc_reviews'],
  nav: [
    { label: 'Queue', path: '' },
    { label: 'Mine', path: 'mine' },
  ],
  schema,
  fixtures,
  actions: kycActions,
  pages: {
    '': IndexPage,
    mine: IndexPage,
    detail: DetailPage,
  },
});
