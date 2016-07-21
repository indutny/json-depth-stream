'use strict';

const assert = require('assert');

const async = require('async');

const Stream = require('../');

describe('JSON depth stream', () => {
  function withStream(json, depth, body, callback) {
    const input = JSON.stringify(json);

    // Try various steps
    let step = input.length;
    async.doWhilst((callback) => {
      const stepCopy = step;
      const s = new Stream(depth);

      body(s, callback);

      for (let i = 0; i < input.length; i += stepCopy)
        s.write(input.slice(i, i + stepCopy));

      s.end();
    }, () => {
      return --step > 0;
    }, callback);
  }

  function test(json, depth, expected, callback) {
    const input = JSON.stringify(json);

    withStream(json, depth, (s, callback) => {
      const visits = [];
      s.on('visit', (key, start, end) => {
        const data = JSON.parse(input.slice(start, end));
        visits.push({ key: key, start: start, end: end, data: data });
      });

      s.on('finish', () => {
        assert.deepEqual(visits, expected);
        callback(null);
      });
    }, callback);
  }

  function testQuery(json, depth, target, expected, callback) {
    withStream(json, depth, (s, callback) => {
      const visits = [];

      let chunks = '';
      const q = s.query(target);
      q.on('data', chunk => chunks += chunk)
      q.on('end', () => {
        if (expected instanceof Error)
          return callback(new Error('Unexpected end'));

        assert.deepEqual(JSON.parse(chunks), expected);
        callback(null);
      });
      q.once('error', (err) => {
        if (expected instanceof Error)
          assert.equal(err.message, expected.message);
        else
          return callback(err);
        callback(null);
      });
    }, callback);
  }

  it('should work with object, depth=1', (cb) => {
    test({
      a: { b: { c: 3 } },
      d: [ 1, 2, { e: 5 } ],
      f: []
    }, 1, [
      { key: [ 'a' ], start: 5, end: 18, data: { b: { c: 3 } } },
      { key: [ 'd' ], start: 23, end: 36, data: [ 1, 2, { e: 5 } ] },
      { key: [ 'f' ], start: 41, end: 43, data: [] }
    ], cb);
  });

  it('should work with object, depth=2', (cb) => {
    test({
      a: { b: { c: 3 } },
      d: [ 1, 2, { e: 5 } ],
      f: []
    }, 2, [
      { key: [ 'a', 'b' ], start: 10, end: 17, data: { c: 3 } },
      { key: [ 'a' ], start: 5, end: 18, data: { b: { c: 3 } } },
      { key: [ 'd', 0 ], start: 24, end: 25, data: 1 },
      { key: [ 'd', 1 ], start: 26, end: 27, data: 2 },
      { key: [ 'd', 2 ], start: 28, end: 35, data: { e: 5 } },
      { key: [ 'd' ], start: 23, end: 36, data: [ 1, 2, { e: 5 } ] },
      { key: [ 'f' ], start: 41, end: 43, data: [] }
    ], cb);
  });

  it('should work with array, depth=1', (cb) => {
    test([
      { b: { c: 3 } },
      [ 1, 2, { e: 5 } ],
      []
    ], 1, [
      { key: [ 0 ], start: 1, end: 14, data: { b: { c: 3 } } },
      { key: [ 1 ], start: 15, end: 28, data: [ 1, 2, { e: 5 } ] },
      { key: [ 2 ], start: 29, end: 31, data: [] }
    ], cb);
  });

  it('should work with null, depth=1', (cb) => {
    test([
      null
    ], 1, [
      { key: [ 0 ], start: 1, end: 5, data: null },
    ], cb);
  });

  it('should work with skipped escaped string, depth=1', (cb) => {
    test([
      { b: { c: 3 } },
      [ 1, 2, { e: '\t' } ],
      []
    ], 1, [
      { key: [ 0 ], start: 1, end: 14, data: { b: { c: 3 } } },
      { key: [ 1 ], start: 15, end: 31, data: [ 1, 2, { e: '\t' } ] },
      { key: [ 2 ], start: 32, end: 34, data: [] }
    ], cb);
  });

  it('should work with skipped string with `}`, depth=1', (cb) => {
    test([
      { b: { c: 3 } },
      [ 1, 2, { e: '}' } ],
      []
    ], 1, [
      { key: [ 0 ], start: 1, end: 14, data: { b: { c: 3 } } },
      { key: [ 1 ], start: 15, end: 30, data: [ 1, 2, { e: '}' } ] },
      { key: [ 2 ], start: 31, end: 33, data: [] }
    ], cb);
  });

  it('should query shallow key', (cb) => {
    testQuery({
      a: 1
    }, 1, [ 'a' ], 1, cb);
  });

  it('should query key', (cb) => {
    testQuery([
      { b: { c: 3 } },
      [ 1, 2, { e: '}' } ],
      []
    ], 3, [ 0, 'b', 'c' ], 3, cb);
  });

  it('should query key with subkeys', (cb) => {
    testQuery([
      { b: { c: { e: 'f' } } },
      [ 1, 2, { e: '}' } ],
      []
    ], 4, [ 0, 'b', 'c' ], { e: 'f' }, cb);
  });

  it('should fail if key not found', (cb) => {
    testQuery([
      { b: { c: 3 } },
      [ 1, 2, { e: '}' } ],
      []
    ], 3, [ 1, 'b' ], new Error('Not found'), cb);
  });
});
