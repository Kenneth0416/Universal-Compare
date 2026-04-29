import type { AddressInfo } from 'node:net';

export function createAddressInfo(address: string | AddressInfo | null) {
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on a TCP address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}
