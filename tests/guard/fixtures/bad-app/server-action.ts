// Violates: no-server-directives ('use server' inside a function body).
export function sneaky() {
  'use server';
  return 1;
}
