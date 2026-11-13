export function b64DecodeUtf8(b64) {
  const clean = (b64 || "").replace(/\s/g, "");
  const binString = atob(clean);
  const bytes = Uint8Array.from(binString, m => m.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binString = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString);
}

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
