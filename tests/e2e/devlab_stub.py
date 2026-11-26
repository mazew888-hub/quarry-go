# Face ID stand-in for tests: the passkey calls resolve (or are refused when window.__faceNo is set).
FACE = """
  window.__faceCalls = [];
  const ok = kind => async () => { window.__faceCalls.push(kind);
    if (window.__faceNo) throw new DOMException('no', 'NotAllowedError');
    return { rawId: new Uint8Array([1, 2, 3]).buffer }; };
  Object.defineProperty(navigator, 'credentials', { value: { create: ok('create'), get: ok('get') }, configurable: true });
"""
UNLOCK = "async () => { const D = await import('/js/devlab.js'); await D.unlock(); }"
