// Custom Jest sequencer: runs services_step3 (Redis-only) BEFORE auth_step2 (full server),
// preventing the shared ioredis singleton from being quit() too early.
const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
  sort(tests) {
    const ORDER = ['validators', 'services_step3', 'auth_step2', 'hub'];
    return [...tests].sort((a, b) => {
      const ai = ORDER.findIndex((n) => a.path.includes(n));
      const bi = ORDER.findIndex((n) => b.path.includes(n));
      // Files not in the list go last
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }
}

module.exports = CustomSequencer;
