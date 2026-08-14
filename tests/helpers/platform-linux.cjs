// Test-harness platform fixture (v0.1.0 Linux-only disposition):
// the installer/doctor child processes spawned by the unit suite run on
// the host platform (darwin on this physical evidence host); the
// supported lane under test is Linux x86_64. This preload redefines
// process.platform/process.arch to the supported lane BEFORE the product
// entry runs. It is a TEST-ONLY seam — never referenced by product code,
// never shipped, never honored by any production invocation.
Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
