'use strict';

const Buffer = require('buffer').Buffer;

const JSONStream = require('../');

function big(depth) {
  if (depth === 0)
    return 'str\ti\tng';

  if (depth % 2 === 1) {
    const res = {};
    for (let i = 0; i < 100; i++)
      res[i.toString()] = big(depth - 1);
    return res;
  }
  const res = [];
  for (let i = 0; i < 100; i++)
    res.push(big(depth - 1));
  return res;
}

const input = Buffer.from(JSON.stringify(big(3)), 'utf8');

const ITERATIONS = 10;

const start = process.hrtime();
for (let i = ITERATIONS; i >= 0; i--) {
  const s = new JSONStream(1);
  s.end(input);
  s.resume();
}
const diff = process.hrtime(start);

const time = diff[0] + (diff[1] / 1000000000);
const throughput = input.length * ITERATIONS / time;

console.log('Throughput: %d mb/s', (throughput / (1024 * 1024)).toFixed(2));
