import { defineApp } from '@platform/actions/define';
import { schema } from './schema';
import { fixtures } from './fixtures';
import { flagsActions } from './actions';
import IndexPage from './pages/index';
import StalePage from './pages/stale';
import HistoryPage from './pages/history';
import DetailPage from './pages/detail';

export const flagsManifest = defineApp({
  id: 'flags',
  name: 'Feature Flags',
  icon: '🚩',
  permission: 'flags.read',
  dataMode: 'sandbox',
  dataClass: 'internal',
  sources: ['flags', 'flag_changes'],
  nav: [
    { label: 'Flags', path: '' },
    { label: 'Stale', path: 'stale' },
    { label: 'History', path: 'history' },
  ],
  schema,
  fixtures,
  actions: flagsActions,
  pages: {
    '': IndexPage,
    stale: StalePage,
    history: HistoryPage,
    detail: DetailPage,
  },
});
