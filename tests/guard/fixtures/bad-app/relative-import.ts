// Violates: only-platform-imports ('..' traversal + a non-allowlisted package).
import { escape } from '../outside';
import { anything } from 'some-random-package';

export const bad = { escape, anything };
