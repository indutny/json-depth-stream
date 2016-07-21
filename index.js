'use strict';

const util = require('util');
const Writable = require('stream').Writable;

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
  Writable.call(this);

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
  this.quote = 0;

  // Collect object key value
  this.key = '';

  // Array value index
  this.index = 0;

  // Path to the current value
  this.path = [];

  // Backlog of states
  this.backlog = [];
}
util.inherits(StreamIndexer, Writable);
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
  var last = this.backlog.pop();
  this.state = last.state;
  return this.state;
};

StreamIndexer.prototype._visit = function _visit(offset) {
  var last = this.backlog[this.backlog.length - 1];
  this.emit('visit', this.path.slice(), last.offset + 1, offset);
};

StreamIndexer.prototype._split = function _split(index) {
  this.emit('split', this.path.slice(), index);
};

StreamIndexer.prototype.update = function update(chunk, start, end) {
  var state = this.state;
  var offset = this.offset;
  var key = this.key;
  var index = this.index;
  var escape = this.escape;
  var nonws = this.nonws;
  var curly = this.curly;
  var square = this.square;
  var quote = this.quote;

  const maxDepth = this.maxDepth;

  const limit = end === undefined ? chunk.length : end;

  var keyStart = start || 0;
  for (let i = start || 0; i < limit; i++, offset++) {
    const c = chunk[i];

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
      if (curly === 0 && square === 0 && quote === 0 &&
          (c === 0x2c /* ',' */ ||
           c === 0x7d /* '}' */ ||
           c === 0x5d /* ']' */)) {
        state = this._leave(STATE_SKIP);
        // Re-execute
        i--;
        offset--;
      } else if (c === 0x22 /* '"' */) {
        quote ^= 1;
      } else if (quote !== 0) {
        // Parsing string
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
        key += chunk.slice(keyStart, i);
        state = this._leave(STATE_OBJECT_KEY);
        state = this._enter(STATE_OBJECT_VALUE, offset);

        this.path.push(JSON.parse(key));
        key = '';

        this._split(i + 1);
      }
      continue;
    } else if (state === STATE_OBJECT) {
      if (c === 0x7d /* '}' */) {
        state = this._leave(STATE_OBJECT);
        continue;
      } else if (c === 0x22 /* '"' */) {
        state = this._enter(STATE_OBJECT_KEY, offset);
        keyStart = i;

        key = '';
        continue;
      }
    } else if (state === STATE_OBJECT_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._split(i);
        this._visit(offset);

        state = this._leave(STATE_OBJECT_VALUE);
        state = this._enter(STATE_OBJECT_KEY, offset);
        keyStart = i + 1;

        key = '';
        this.path.pop();
        continue;
      } else if (c === 0x7d /* '}' */) {
        this._split(i);
        this._visit(offset);

        state = this._leave(STATE_OBJECT_VALUE);
        state = this._leave(STATE_OBJECT);

        this.path.pop();
        continue;
      }
    } else if (state === STATE_ARRAY_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._split(i);
        this._visit(offset);

        state = this._leave(STATE_ARRAY_VALUE);
        state = this._enter(STATE_ARRAY_VALUE, offset);

        this.path[this.path.length - 1] = ++index;
        this._split(i + 1);
        // no-op
        continue;
      } else if (c === 0x5d /* ']' */) {
        if (nonws !== 1) {
          this._visit(offset);
          this._split(i);
        }

        state = this._leave(STATE_ARRAY_VALUE);
        state = this._leave(STATE_ARRAY);

        this.path.pop();
        continue;
      } else if (nonws === 1) {
        this._split(i);
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

  if (state === STATE_OBJECT_KEY)
    key += chunk.slice(keyStart, limit);

  this.state = state;
  this.offset = offset;
  this.key = key;
  this.index = index;
  this.escape = escape;
  this.nonws = nonws;
  this.curly = curly;
  this.square = square;
  this.quote = quote;
};

StreamIndexer.prototype._write = function _write(chunk, encoding, cb) {
  this.update(chunk, 0, chunk.length);
  cb(null);
};
