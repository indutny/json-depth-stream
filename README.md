# json-depth-stream

[![NPM version](https://badge.fury.io/js/json-depth-stream.svg)](http://badge.fury.io/js/json-depth-stream)
[![Build Status](https://secure.travis-ci.org/indutny/json-depth-stream.svg)](http://travis-ci.org/indutny/json-depth-stream)

## Why?

It is impossible to parse 1gb JSON file with native node.js primitives.

## How?

Just a streaming parser, nothing really fancy. The only difference between this
parser and the others is that it can skip data that is nested too deeply.

## Installation

```bash
npm install json-depth-stream
```

## Usage


```js
const DepthStream = require('json-depth-stream');

const file = require('fs').createReadStream('/tmp/big.json');
const json = new DepthStream(1 /* desired depth */);

json.on('visit', (path, start, end) => {
  // `path` is a nested JSON key like: `["a", 0, "b"]`, which is equivalent to
  // `obj.a[0].b` (assuming `obj.a` is an Array)

  // `start` and `end` are offsets in the input stream
  // they could be used in `fs.read()` if streaming from file.
  console.log(path, start, end);
});

file.pipe(json);
```

Query:
```js
const json = new DepthStream(1);

const q = json.query([ 'path' ]);
q.pipe(process.stdout);
q.once('end', () => {
  process.stdin.unpipe(json);
});

process.stdin.pipe(json);
```

Stream-once usage:
```js
const json = new DepthStream(1);

process.stdin.on('data', (chunk) => {
  json.update(chunk);
});

// `split` even is emitted when parser enters new object value/array element
// `index` is local to `chunk`.
json.on('split', (path, index) => {
  // `path` is the same as above
  // `index` is an index in a `chunk` that was given to `.update(chunk)`
  console.log(path, index);
});
```

## Speed

Around 78mb/s for JSON with many object keys, faster for array-like JSONs:

```bash
$ node benchmark/throughput.js
Throughput: 78.44 mb/s
```

## LICENSE

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2016.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
