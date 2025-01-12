import { sha1 } from "js-sha1";

export function randomBytes(size: number) {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return {
    toString: (encoding: string) => {
      if (encoding !== "base64") {
        throw new Error("Unsupported encoding");
      }
      return btoa(String.fromCharCode(...arr));
    },
  };
}

export function createHash(algorithm: "sha1") {
  if (algorithm !== "sha1") {
    throw new Error("Unsupported algorithm");
  }
  return {
    update: (data: string) => {
      return {
        digest: () => {
          // this returns the bytes - we need to convert to base64
          const hash = sha1.digest(data);
          return btoa(String.fromCharCode(...hash));
        },
      };
    },
  };
}

export function randomFillSync(
  buffer: Uint8Array,
  offset: number,
  length: number
) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  buffer.set(arr, offset);
}
