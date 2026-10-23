// ELK's bundled FakeWorker expects Node's `global` alias while beautiful-mermaid
// temporarily removes `self` during initialization. Workers expose globalThis
// instead. This constant environment alias contains no request state.
if (typeof globalThis.global === 'undefined') {
  Object.defineProperty(globalThis, 'global', { value: globalThis, configurable: true, writable: true })
}
