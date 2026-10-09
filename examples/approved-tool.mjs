// Explicitly trusted example: /load-tool examples/approved-tool.mjs
// This module has host privileges. Agents cannot load it themselves.
import { Type } from 'typebox';
export default {
  register(registry) {
    registry.register('example_word_count', 'Count words in supplied text without filesystem access.', Type.Object({ text: Type.String({ maxLength: 8000 }) }), 'collaborate', ({ text }) => ({ words: text.trim() ? text.trim().split(/\s+/).length : 0 }), 'example');
  },
};
