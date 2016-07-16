'use strict';

const util = require('util');
const Transform = require('stream').Transform;

const STATE_VALUE = 0;
const STATE_STRING = 1;
const STATE_NUMBER = 2;
const STATE_OBJECT = 3;
const STATE_OBJECT_KEY = 4;
const STATE_OBJECT_VALUE = 5;
const STATE_ARRAY = 6;
const STATE_ARRAY_VALUE = 7;
const STATE_SKIP = 8;
const STATE_ERROR = 9;

function StreamIndexer(depth) {
  Transform.call(this);

  // Maximum depth
  this.maxDepth = depth || 1;

  // Current state
  this.state = STATE_VALUE;

  // Number of characters to skip in escape sequence
  this.escape = 0;

  // Current byte offset in an input
  this.offset = 0;

  // Number of non-ws characters (needed for parsing of `[whitespace]`)
  this.nonws = 0;

  // Count braces when skipping value
  this.curly = 0;
  this.square = 0;

  // Collect object key value
  this.key = '';
  this.collect = false;

  // Path to the current value
  this.path = [];

  // Backlog of states
  this.backlog = [];
}
util.inherits(StreamIndexer, Transform);
module.exports = StreamIndexer;

function BacklogEntry(state, offset) {
  this.state = state;
  this.offset = offset;
}

StreamIndexer.prototype._enter = function _enter(state, offset) {
  this.backlog.push(new BacklogEntry(this.state, offset));
  this.state = state;
  return state;
};

StreamIndexer.prototype._leave = function _leave(state) {
  const last = this.backlog.pop();
  this.state = last.state;
  return this.state;
};

StreamIndexer.prototype._visit = function _visit(offset) {
  const last = this.backlog[this.backlog.length - 1];
  this.emit('visit', this.path.slice(), last.offset + 1, offset);
};

StreamIndexer.prototype._transform = function _transform(chunk, encoding, cb) {
  let state = this.state;
  let offset = this.offset;
  let collect = this.collect;
  let key = this.key;
  let index = this.index;
  let escape = this.escape;
  let nonws = this.nonws;
  let curly = this.curly;
  let square = this.square;

  const maxDepth = this.maxDepth;

  for (let i = 0; i < chunk.length; i++, offset++) {
    const c = chunk[i];

    // TODO(indutny): optimize me
    if (collect === true)
      key += String.fromCharCode(c);

    // Handle escape sequences (they are allowed only in strings, but we don't
    // care)
    if (escape !== 0) {
      escape--;
      nonws++;
      continue;
    } else if (c === 0x5c /* '\\' */) {
      escape = 1;
      nonws++;
      continue;
    }

    if (c === 0x20 /* ' ' */ || c === 0x09 /* '\t' */ ||
        c === 0x0a /* '\n' */ || c === 0x0d /* '\r' */) {
      // Skip whitespace
      continue;
    }

    nonws++;

    // Skip deep object completely
    if (state === STATE_SKIP) {
      if (curly === 0 && square === 0 &&
          (c === 0x2c /* ',' */ ||
           c === 0x7d /* '}' */ ||
           c === 0x5d /* ']' */)) {
        state = this._leave(STATE_SKIP);
        // Re-execute
        i--;
        offset--;
      } else if (c === 0x7b /* '{' */) {
        curly++;
      } else if (c === 0x5b /* '[' */) {
        square++;
      } else if (c === 0x7d /* '}' */) {
        curly--;
      } else if (c === 0x5d /* ']' */) {
        square--;
      }
      continue;
    }

    if (state === STATE_STRING || state === STATE_OBJECT_KEY) {
      if (state === STATE_STRING && c === 0x22 /* '"' */) {
        state = this._leave(STATE_STRING);
      } else if (this.state === STATE_OBJECT_KEY && c === 0x3a /* ':' */) {
        state = this._leave(STATE_OBJECT_KEY);
        state = this._enter(STATE_OBJECT_VALUE, offset);

        this.path.push(JSON.parse(key.slice(0, -1)));
        key = '';
        collect = false;
      }
      continue;
    } else if (state === STATE_OBJECT) {
      if (c === 0x7d /* '}' */) {
        state = this._leave(STATE_OBJECT);
        continue;
      } else if (c === 0x22 /* '"' */) {
        state = this._enter(STATE_OBJECT_KEY, offset);

        key = '"';
        collect = true;
        continue;
      }
    } else if (state === STATE_OBJECT_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._visit(offset);

        state = this._leave(STATE_OBJECT_VALUE);
        state = this._enter(STATE_OBJECT_KEY, offset);

        collect = true;
        key = '';
        this.path.pop();
        continue;
      } else if (c === 0x7d /* '}' */) {
        this._visit(offset);

        state = this._leave(STATE_OBJECT_VALUE);
        state = this._leave(STATE_OBJECT);

        this.path.pop();
        continue;
      }
    } else if (state === STATE_ARRAY_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._visit(offset);

        state = this._leave(STATE_ARRAY_VALUE);
        state = this._enter(STATE_ARRAY_VALUE, offset);

        this.path[this.path.length - 1] = ++index;
        // no-op
        continue;
      } else if (c === 0x5d /* ']' */) {
        if (nonws !== 1)
          this._visit(offset);

        state = this._leave(STATE_ARRAY_VALUE);
        state = this._leave(STATE_ARRAY);

        this.path.pop();
        continue;
      }
    }

    if (this.path.length === maxDepth &&
        (c === 0x7b /* '{' */ || c === 0x5b /* '[' */)) {
      state = this._enter(STATE_SKIP, offset);

      // Reexecute
      i--;
      offset--;
      continue;
    }

    // Intentional fall-through fall all values
    if (c === 0x7b /* '{' */) {
      state = this._enter(STATE_OBJECT, offset);
    } else if (c === 0x5b /* '[' */) {
      this._enter(STATE_ARRAY, offset);
      state = this._enter(STATE_ARRAY_VALUE, offset);
      this.path.push(0);
      index = 0;
      nonws = 0;
    } else if (c === 0x22 /* '"' */) {
      state = this._enter(STATE_STRING, offset);
    } else {
      // We don't care about particular value
    }
  }

  this.state = state;
  this.offset = offset;
  this.collect = collect;
  this.key = key;
  this.index = index;
  this.escape = escape;
  this.nonws = nonws;
  this.curly = curly;
  this.square = square;

  cb(null, chunk);
};
