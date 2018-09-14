/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint no-magic-numbers: 0 */

'use strict';

require('module-keys/cjs').polyfill(module, require, 'safesql/test/safesql-test.js');

const { expect } = require('chai');
const { describe, it } = require('mocha');
const { mysql } = require('../index.js');
const { SqlFragment } = require('../fragment.js');
const { SqlId } = require('../id.js');

const { Mintable } = require('node-sec-patterns');

const isSqlFragment = Mintable.verifierFor(SqlFragment);

function unwrapMinterFor(MintableType) {
  return require.keys.unbox(
    Mintable.minterFor(MintableType),
    () => true,
    () => {
      throw new Error('Cannot mint');
    });
}
const mintSqlFragment = unwrapMinterFor(SqlFragment);
const mintSqlId = unwrapMinterFor(SqlId);

function runTagTest(golden, test) {
  // Run multiply to test memoization bugs.
  for (let i = 3; --i >= 0;) {
    let result = test();
    if (result && isSqlFragment(result)) {
      result = result.content;
    } else {
      throw new Error(`Expected raw not ${ result }`);
    }
    expect(result).to.equal(golden);
  }
}

describe('mysql template tag', () => {
  it('numbers', () => {
    runTagTest(
      'SELECT 2',
      () => mysql`SELECT ${ 1 + 1 }`);
  });
  it('date', () => {
    const date = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
    runTagTest(
      'SELECT \'2000-01-01 00:00:00.000\'',
      () => mysql({ timeZone: 'GMT' })`SELECT ${ date }`);
  });
  it('string', () => {
    runTagTest(
      'SELECT \'Hello, World!\\n\'',
      () => mysql`SELECT ${ 'Hello, World!\n' }`);
  });
  it('stringify', () => {
    const obj = {
      Hello: 'World!',
      toString() {
        return 'Hello, World!';
      },
    };
    runTagTest(
      'SELECT \'Hello, World!\'',
      () => mysql({ stringifyObjects: true })`SELECT ${ obj }`);
    runTagTest(
      'SELECT * FROM t WHERE `Hello` = \'World!\'',
      () => mysql({ stringifyObjects: false })`SELECT * FROM t WHERE ${ obj }`);
  });
  it('identifier', () => {
    runTagTest(
      'SELECT `foo`',
      () => mysql`SELECT ${ mintSqlId('foo') }`);
  });
  it('blob', () => {
    runTagTest(
      'SELECT "\x1f8p\xbe\\\'OlI\xb3\xe3\\Z\x0cg(\x95\x7f"',
      () =>
        mysql`SELECT "${ Buffer.from('1f3870be274f6c49b3e31a0c6728957f', 'hex') }"`
    );
  });
  it('null', () => {
    runTagTest(
      'SELECT NULL',
      () =>
        mysql`SELECT ${ null }`
    );
  });
  it('undefined', () => {
    runTagTest(
      'SELECT NULL',
      () =>
        mysql`SELECT ${ undefined }` // eslint-disable-line no-undefined
    );
  });
  it('negative zero', () => {
    runTagTest(
      'SELECT (1 / 0)',
      () =>
        mysql`SELECT (1 / ${ -0 })`
    );
  });
  it('raw', () => {
    const raw = mintSqlFragment('1 + 1');
    runTagTest(
      'SELECT 1 + 1',
      () => mysql`SELECT ${ raw }`);
  });
  it('string in dq string', () => {
    runTagTest(
      'SELECT "Hello, World!\\n"',
      () => mysql`SELECT "Hello, ${ 'World!' }\n"`);
  });
  it('string in sq string', () => {
    runTagTest(
      'SELECT \'Hello, World!\\n\'',
      () => mysql`SELECT 'Hello, ${ 'World!' }\n'`);
  });
  it('string after string in string', () => {
    // The following tests check obliquely that '?' is not
    // interpreted as a prepared statement meta-character
    // internally.
    runTagTest(
      'SELECT \'Hello\', "World?"',
      () => mysql`SELECT '${ 'Hello' }', "World?"`);
  });
  it('string before string in string', () => {
    runTagTest(
      'SELECT \'Hello?\', \'World?\'',
      () => mysql`SELECT 'Hello?', '${ 'World?' }'`);
  });
  it('number after string in string', () => {
    runTagTest(
      'SELECT \'Hello?\', 123',
      () => mysql`SELECT '${ 'Hello?' }', ${ 123 }`);
  });
  it('number before string in string', () => {
    runTagTest(
      'SELECT 123, \'World?\'',
      () => mysql`SELECT ${ 123 }, '${ 'World?' }'`);
  });
  it('string in identifier', () => {
    runTagTest(
      'SELECT `foo`',
      () => mysql`SELECT \`${ 'foo' }\``);
  });
  it('identifier in identifier', () => {
    runTagTest(
      'SELECT `foo`',
      () => mysql`SELECT \`${ mintSqlId('foo') }\``);
  });
  it('plain quoted identifier', () => {
    runTagTest(
      'SELECT `ID`',
      () => mysql`SELECT \`ID\``);
  });
  it('backquotes in identifier', () => {
    runTagTest(
      'SELECT `\\\\`',
      () => mysql`SELECT \`\\\``);
    const strings = [ 'SELECT `\\\\`' ];
    strings.raw = strings.slice();
    runTagTest('SELECT `\\\\`', () => mysql(strings));
  });
  it('backquotes in strings', () => {
    runTagTest(
      'SELECT "`\\\\", \'`\\\\\'',
      () => mysql`SELECT "\`\\", '\`\\'`);
  });
  it('number in identifier', () => {
    runTagTest(
      'SELECT `foo_123`',
      () => mysql`SELECT \`foo_${ 123 }\``);
  });
  it('array', () => {
    const id = mintSqlId('foo');
    const frag = mintSqlFragment('1 + 1');
    const values = [ 123, 'foo', id, frag ];
    runTagTest(
      'SELECT X FROM T WHERE X IN (123, \'foo\', `foo`, 1 + 1)',
      () => mysql`SELECT X FROM T WHERE X IN (${ values })`);
  });
  it('unclosed-sq', () => {
    expect(() => mysql`SELECT '${ 'foo' }`).to.throw();
  });
  it('unclosed-dq', () => {
    expect(() => mysql`SELECT "foo`).to.throw();
  });
  it('unclosed-bq', () => {
    expect(() => mysql`SELECT \`${ 'foo' }`).to.throw();
  });
  it('unclosed-comment', () => {
    // Ending in a comment is a concatenation hazard.
    // See comments in lib/es6/Lexer.js.
    expect(() => mysql`SELECT (${ 0 }) -- comment`).to.throw();
  });
  it('merge-word-string', () => {
    runTagTest(
      'SELECT utf8\'foo\'',
      () => mysql`SELECT utf8${ 'foo' }`);
  });
  it('merge-string-string', () => {
    runTagTest(
      // Adjacent string tokens are concatenated, but 'a''b' is a
      // 3-char string with a single-quote in the middle.
      'SELECT \'a\' \'b\'',
      () => mysql`SELECT ${ 'a' }${ 'b' }`);
  });
  it('merge-bq-bq', () => {
    runTagTest(
      'SELECT `a` `b`',
      () => mysql`SELECT ${ mintSqlId('a') }${ mintSqlId('b') }`);
  });
  it('merge-static-string-string', () => {
    runTagTest(
      'SELECT \'a\' \'b\'',
      () => mysql`SELECT 'a'${ 'b' }`);
  });
  it('merge-string-static-string', () => {
    runTagTest(
      'SELECT \'a\' \'b\'',
      () => mysql`SELECT ${ 'a' }'b'`);
  });
  it('not-a-merge-hazard', () => {
    runTagTest(
      'SELECT \'a\'\'b\'',
      () => mysql`SELECT 'a''b'`);
  });
});
