// Test-process-only timing control. Preserve the real digest and delay its reply.
const subtle = globalThis.crypto.subtle;
const digest = subtle.digest.bind(subtle);
Object.defineProperty(subtle, 'digest', {
  configurable: true,
  value: async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return digest(...args);
  }
});
