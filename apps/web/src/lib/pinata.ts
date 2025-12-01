const PINATA_PROXY_URL = import.meta.env.VITE_PINATA_PROXY_URL ?? 'http://localhost:4001';

export async function uploadEncryptedPayload(payload: unknown): Promise<{ cid: string; ipfsUrl: string }> {
  const res = await fetch(`${PINATA_PROXY_URL}/api/pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Pinata proxy error: ${res.statusText}`);
  }

  return res.json();
}

export async function fetchFromIPFS(ipfsUrl: string): Promise<any> {
  const res = await fetch(ipfsUrl);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed: ${res.statusText}`);
  }
  return res.json();
}


