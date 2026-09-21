'use client';
// Violates: only-platform-imports (client components may not import server APIs).
import { z } from 'zod';
import { getReadCtx } from '@platform/data/read';

export default function C() {
  return z && getReadCtx;
}
