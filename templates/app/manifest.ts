import { defineApp } from '@platform/actions/define';
import { schema } from './schema';
import { fixtures } from './fixtures';
import { templateActions } from './actions';
import IndexPage from './pages/index';
import DetailPage from './pages/detail';

export const templateManifest = defineApp({
  id: 'template',
  name: 'Expense Requests',
  icon: '🧾',
  permission: 'template.read',
  dataMode: 'sandbox',
  dataClass: 'sensitive',
  kind: 'template',
  sources: ['expense_requests'],
  nav: [
    { label: 'Queue', path: '' },
    { label: 'Mine', path: 'mine' },
  ],
  schema,
  fixtures,
  actions: templateActions,
  pages: {
    '': IndexPage,
    mine: IndexPage,
    detail: DetailPage,
  },
});
