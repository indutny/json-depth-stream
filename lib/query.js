'use strict';

const util = require('util');
const Readable = require('stream').Readable;

function Query(target) {
  Readable.call(this);

  this.target = target;
  this._targetDepth = target.length;

  // Current object key
  this.backlog = [];

  // Last chunk
  this._chunk = null;
  // Last index in chunk
  this._last = 0;
  // Limit of the last chunk
  this._limit = 0;

  // `0` if `this.backlog` is equal to `target`
  this._waiting = this._targetDepth;
  // `true` if `this.push(null)` was called
  this._ended = false;
}
module.exports = Query;
util.inherits(Query, Readable);

Query.prototype._chunkStart = function chunkStart(chunk, start, end) {
  if (this._ended)
    return;

  this._chunk = chunk;
  this._last = start;
  this._limit = end;
};

Query.prototype._chunkEnd = function chunkEnd() {
  if (this._ended)
    return;

  if (this._last !== this._limit)
    this._process(this._chunk.slice(this._last, this._limit));
  this._chunk = null;
};

Query.prototype._split = function _split(key, index) {
  if (this._ended)
    return;

  this._process(this._chunk.slice(this._last, index));

  if (key.length > this.backlog.length) {
    const next = key[key.length - 1];

    // Match - decrement _waiting
    if (this._waiting > 0 &&
        this._waiting + this.backlog.length === this._targetDepth &&
        next === this.target[this._targetDepth - this._waiting]) {
      this._waiting--;
    }

    // Enter key
    this.backlog.push(key[key.length - 1]);
  } else {
    // Emit 'end'
    if (this._waiting === 0 && this.backlog.length === this._targetDepth) {
      this._ended = true;
      this.push(null);
    }

    // Leave key
    this.backlog.pop();

    if (!this._ended &&
        this.backlog.length === 0 &&
        this._waiting !== this._targetDepth) {
      this._ended = true;
      this.emit('error', new Error('Not found'));
    }
  }
  this._last = index;
};

Query.prototype._process = function _process(chunk) {
  if (this._waiting === 0)
    this.push(chunk);
};

Query.prototype._read = function _read() {
  // No-op
};
