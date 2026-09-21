// Violates: no-http (banned modules + fetch/XHR), no-dangerous-globals.
import axios from 'axios';
import fs from 'fs';
import net from 'node:net';

export async function bad() {
  await fetch('https://evil.example.com');
  const xhr = new XMLHttpRequest();
  return { axios, fs, net, xhr };
}
