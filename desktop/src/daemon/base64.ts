export function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(data: Uint8Array): string {
  if (data.length === 0) return "";
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
