'use strict';

const util = require('util');
const Transform = require('stream').Transform;

const STATE_VALUE = 'value';
const STATE_STRING = 'string';
const STATE_NUMBER = 'number';
const STATE_OBJECT = 'object';
const STATE_OBJECT_KEY = 'object_key';
const STATE_OBJECT_VALUE = 'object_value';
const STATE_ARRAY = 'array';
const STATE_ARRAY_VALUE = 'array_value';
const STATE_SKIP = 'skip';
const STATE_ERROR = 'error';

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

StreamIndexer.prototype._enter = function _enter(state) {
  this.backlog.push(new BacklogEntry(this.state, this.offset));
  this.state = state;
};

StreamIndexer.prototype._leave = function _leave(state) {
  const last = this.backlog.pop();
  this.state = last.state;
};

StreamIndexer.prototype._visit = function _visit() {
  const last = this.backlog[this.backlog.length - 1];
  this.emit('visit', this.path.slice(), last.offset + 1, this.offset);
};

StreamIndexer.prototype._transform = function _transform(chunk, encoding, cb) {
  for (let i = 0; i < chunk.length; i++, this.offset++) {
    const c = chunk[i];

    // TODO(indutny): optimize me
    if (this.collect === true)
      this.key += String.fromCharCode(c);

    // Handle escape sequences (they are allowed only in strings, but we don't
    // care)
    if (this.escape !== 0) {
      this.escape--;
      this.nonws++;
      continue;
    } else if (c === 0x5c /* '\\' */) {
      this.escape = 1;
      this.nonws++;
      continue;
    }

    if (c === 0x20 /* ' ' */ || c === 0x09 /* '\t' */ ||
        c === 0x0a /* '\n' */ || c === 0x0d /* '\r' */) {
      // Skip whitespace
      continue;
    }

    this.nonws++;

    // Skip deep object completely
    if (this.state === STATE_SKIP) {
      if (this.curly === 0 && this.square === 0 &&
          (c === 0x2c /* ',' */ ||
           c === 0x7d /* '}' */ ||
           c === 0x5d /* ']' */)) {
        this._leave(STATE_SKIP);
        // Re-execute
        i--;
        this.offset--;
      } else if (c === 0x7b /* '{' */) {
        this.curly++;
      } else if (c === 0x5b /* '[' */) {
        this.square++;
      } else if (c === 0x7d /* '}' */) {
        this.curly--;
      } else if (c === 0x5d /* ']' */) {
        this.square--;
      }
      continue;
    }

    if (this.state === STATE_STRING || this.state === STATE_OBJECT_KEY) {
      if (this.state === STATE_STRING && c === 0x22 /* '"' */) {
        this._leave(this.state);
      } else if (this.state === STATE_OBJECT_KEY && c === 0x3a /* ':' */) {
        this._leave(this.state);
        this._enter(STATE_OBJECT_VALUE);

        this.path.push(JSON.parse(this.key.slice(0, -1)));
        this.key = '';
        this.collect = false;
      }
      continue;
    } else if (this.state === STATE_OBJECT) {
      if (c === 0x7d /* '}' */) {
        this._leave(this.state);
        continue;
      } else if (c === 0x22 /* '"' */) {
        this._enter(STATE_OBJECT_KEY);

        this.key = '"';
        this.collect = true;
        continue;
      }
    } else if (this.state === STATE_OBJECT_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._visit();

        this._leave(this.state);
        this._enter(STATE_OBJECT_KEY);

        this.collect = true;
        this.key = '';
        this.path.pop();
        continue;
      } else if (c === 0x7d /* '}' */) {
        this._visit();

        this._leave(this.state);
        this._leave(STATE_OBJECT);

        this.path.pop();
        continue;
      }
    } else if (this.state === STATE_ARRAY_VALUE) {
      if (c === 0x2c /* ',' */) {
        this._visit();

        this._leave(this.state);
        this._enter(STATE_ARRAY_VALUE);

        this.path[this.path.length - 1] = ++this.index;
        // no-op
        continue;
      } else if (c === 0x5d /* ']' */) {
        if (this.nonws !== 1)
          this._visit();

        this._leave(this.state);
        this._leave(STATE_ARRAY);

        this.path.pop();
        continue;
      }
    }

    if (this.path.length === this.maxDepth &&
        (c === 0x7b /* '{' */ || c === 0x5b /* '[' */)) {
      this._enter(STATE_SKIP);

      // Reexecute
      i--;
      this.offset--;
      continue;
    }

    // Intentional fall-through fall all values
    if (c === 0x7b /* '{' */) {
      this._enter(STATE_OBJECT);
    } else if (c === 0x5b /* '[' */) {
      this._enter(STATE_ARRAY);
      this._enter(STATE_ARRAY_VALUE);
      this.path.push(0);
      this.index = 0;
      this.nonws = 0;
    } else if (c === 0x22 /* '"' */) {
      this._enter(STATE_STRING);
    } else {
      // We don't care about particular value
    }
  }

  cb(null, chunk);
};
