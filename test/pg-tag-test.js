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
const { pg, SqlFragment, SqlId } = require('../index.js');

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

describe('pg template tag', () => {
  it('numbers', () => {
    runTagTest(
      'SELECT 2',
      () => pg`SELECT ${ 1 + 1 }`);
  });
  it('date', () => {
    const date = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
    runTagTest(
      'SELECT \'2000-01-01 00:00:00.000\'',
      () => pg({ timeZone: 'GMT' })`SELECT ${ date }`);
  });
  it('string', () => {
    runTagTest(
      'SELECT e\'Hello, World!\\n\'',
      () => pg`SELECT ${ 'Hello, World!\n' }`);
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
      () => pg({ stringifyObjects: true })`SELECT ${ obj }`);
    runTagTest(
      'SELECT * FROM t WHERE "Hello" = \'World!\'',
      () => pg({ stringifyObjects: false })`SELECT * FROM t WHERE ${ obj }`);
  });
  describe('identifier', () => {
    const str = 'O\'Reilly the "Unescaped"';
    const id = mintSqlId(str);
    it('bare id', () => {
      runTagTest('SELECT "O\'Reilly the ""Unescaped"""', () => pg`SELECT ${ id }`);
    });
    it('dq str', () => {
      runTagTest('SELECT "O\'Reilly the ""Unescaped"""', () => pg`SELECT "${ str }"`);
    });
    it('dq id', () => {
      runTagTest('SELECT "O\'Reilly the ""Unescaped"""', () => pg`SELECT "${ id }"`);
    });
    it('U&dq str', () => {
      runTagTest('SELECT U&"O\\0027Reilly the \\0022Unescaped\\0022"', () => pg`SELECT U&"${ str }"`);
    });
    it('U&dq id', () => {
      runTagTest('SELECT U&"O\\0027Reilly the \\0022Unescaped\\0022"', () => pg`SELECT U&"${ id }"`);
    });
  });
  describe('blob', () => {
    const blob = Buffer.from('1f3870be274f6c49b3e31a0c6728957f', 'hex');
    it('x', () => {
      runTagTest(
        'SELECT x\'1f3870be274f6c49b3e31a0c6728957f\'',
        () => pg`SELECT x'${ blob }'`
      );
    });
    it('b', () => {
      runTagTest(
        'SELECT b\'000111110011100001110000101111100010011101001111011011000100' +
        '10011011001111100011000110100000110001100111001010001001010101111111\'',
        () => pg`SELECT b'${ blob }'`
      );
    });
    it('e', () => {
      runTagTest(
        'SELECT e\'\x1f8p\xbe\'\'OlI\xb3\xe3\\x1a\x0cg(\x95\x7f\'',
        () => pg`SELECT e'${ blob }'`
      );
    });
    it('u&', () => {
      runTagTest(
        'SELECT u&\'\x1f8p\xbe\\0027OlI\xb3\xe3\\001a\x0cg(\x95\x7f\'',
        () => pg`SELECT u&'${ blob }'`
      );
    });
    it('raw', () => {
      runTagTest(
        'SELECT \'\x1f8p\xbe\'\'OlI\xb3\xe3\x1a\x0cg(\x95\x7f\'',
        () => pg`SELECT '${ blob }'`
      );
    });
    it('$$', () => {
      runTagTest(
        'SELECT $$\x1f8p\xbe\'OlI\xb3\xe3\x1a\x0cg(\x95\x7f$$',
        () => pg`SELECT $$${ blob }$$`
      );
    });
  });
  it('null', () => {
    runTagTest(
      'SELECT NULL',
      () =>
        pg`SELECT ${ null }`
    );
  });
  it('undefined', () => {
    runTagTest(
      'SELECT NULL',
      () =>
        pg`SELECT ${ undefined }` // eslint-disable-line no-undefined
    );
  });
  it('negative zero', () => {
    runTagTest(
      'SELECT (1 / 0)',
      () =>
        pg`SELECT (1 / ${ -0 })`
    );
  });
  it('raw', () => {
    const raw = mintSqlFragment('1 + 1');
    runTagTest(
      'SELECT 1 + 1',
      () => pg`SELECT ${ raw }`);
  });
  it('string in dq string', () => {
    runTagTest(
      'SELECT "Hello, World!\\n"',
      () => pg`SELECT "Hello, ${ 'World!' }\n"`);
  });
  it('string in sq string', () => {
    runTagTest(
      'SELECT \'Hello, World!\\n\'',
      () => pg`SELECT 'Hello, ${ 'World!' }\n'`);
  });
  it('string after string in string', () => {
    // The following tests check obliquely that '?' is not
    // interpreted as a prepared statement meta-character
    // internally.
    runTagTest(
      'SELECT \'Hello\', "World?"',
      () => pg`SELECT '${ 'Hello' }', "World?"`);
  });
  it('string before string in string', () => {
    runTagTest(
      'SELECT \'Hello?\', \'World?\'',
      () => pg`SELECT 'Hello?', '${ 'World?' }'`);
  });
  it('number after string in string', () => {
    runTagTest(
      'SELECT \'Hello?\', 123',
      () => pg`SELECT '${ 'Hello?' }', ${ 123 }`);
  });
  it('number before string in string', () => {
    runTagTest(
      'SELECT 123, \'World?\'',
      () => pg`SELECT ${ 123 }, '${ 'World?' }'`);
  });
  it('string in identifier', () => {
    runTagTest(
      'SELECT "foo"',
      () => pg`SELECT "${ 'foo' }"`);
  });
  it('identifier in identifier', () => {
    runTagTest(
      'SELECT "foo"',
      () => pg`SELECT "${ mintSqlId('foo') }"`);
  });
  it('plain quoted identifier', () => {
    runTagTest(
      'SELECT "ID"',
      () => pg`SELECT "ID"`);
  });
  it('dqs in identifier', () => {
    runTagTest(
      'SELECT "\\\\"',
      () => pg`SELECT "\\"`);
    const strings = [ 'SELECT "\\\\"' ];
    strings.raw = strings.slice();
    runTagTest('SELECT "\\\\"', () => pg(strings));
  });
  it('backquotes in strings', () => {
    runTagTest(
      'SELECT "\\`\\\\", \'\\`\\\\\'',
      () => pg`SELECT "\`\\", '\`\\'`);
  });
  it('number in identifier', () => {
    runTagTest(
      'SELECT "foo_123"',
      () => pg`SELECT "foo_${ 123 }"`);
  });
  it('array', () => {
    const id = mintSqlId('foo');
    const frag = mintSqlFragment('1 + 1');
    const values = [ 123, 'foo', id, frag ];
    runTagTest(
      'SELECT X FROM T WHERE X IN (123, \'foo\', "foo", 1 + 1)',
      () => pg`SELECT X FROM T WHERE X IN (${ values })`);
  });
  it('unclosed-sq', () => {
    expect(() => pg`SELECT '${ 'foo' }`).to.throw();
  });
  it('unclosed-dq', () => {
    expect(() => pg`SELECT "foo`).to.throw();
  });
  it('unclosed-dq-interp', () => {
    expect(() => pg`SELECT "${ 'foo' }`).to.throw();
  });
  it('unclosed-comment', () => {
    // Ending in a comment is a concatenation hazard.
    // See comments in lib/es6/Lexer.js.
    expect(() => pg`SELECT (${ 0 }) -- comment`).to.throw();
  });
  it('merge-word-string', () => {
    runTagTest(
      'SELECT utf8\'foo\'',
      () => pg`SELECT utf8${ 'foo' }`);
  });
  it('merge-string-string', () => {
    runTagTest(
      // Adjacent string tokens are concatenated, but 'a''b' is a
      // 3-char string with a single-quote in the middle.
      'SELECT \'a\' \'b\'',
      () => pg`SELECT ${ 'a' }${ 'b' }`);
  });
  it('merge-id-id', () => {
    runTagTest(
      'SELECT "a" "b"',
      () => pg`SELECT ${ mintSqlId('a') }${ mintSqlId('b') }`);
  });
  it('merge-static-string-string', () => {
    runTagTest(
      'SELECT \'a\' \'b\'',
      () => pg`SELECT 'a'${ 'b' }`);
  });
  it('merge-string-static-string', () => {
    runTagTest(
      'SELECT \'a\' \'b\'',
      () => pg`SELECT ${ 'a' }'b'`);
  });
  it('not-a-merge-hazard', () => {
    runTagTest(
      'SELECT \'a\'\'b\'',
      () => pg`SELECT 'a''b'`);
  });
  describe('literal-string-corner-cases', () => {
    it('$$', () => {
      runTagTest(
        'SELECT $$x$$',
        () => pg`SELECT $$${ 'x' }$$`);
    });
    it('$$ hazard', () => {
      expect(() => pg`SELECT $$${ '$$' }$$`).to.throw(Error, 'Cannot embed ');
      expect(() => pg`SELECT $$${ 'x$$x' }$$`).to.throw(Error, 'Cannot embed ');
      expect(() => pg`SELECT $$${ 'x$' }$$`).to.throw(Error, 'Cannot embed ');
    });
    it('$foo$', () => {
      runTagTest(
        'SELECT $foo$x$foo$',
        () => pg`SELECT $foo$${ 'x' }$foo$`);
      runTagTest(
        'SELECT $foo$x$foox$foo$',
        () => pg`SELECT $foo$${ 'x$foox' }$foo$`);
      runTagTest(
        'SELECT $foo$x$bar$x$foo$',
        () => pg`SELECT $foo$${ 'x$bar$x' }$foo$`);
      runTagTest(
        'SELECT $foo$$bar$x$foo$',
        () => pg`SELECT $foo$${ '$bar$x' }$foo$`);
      runTagTest(
        'SELECT $foo$$$x$foo$',
        () => pg`SELECT $foo$${ '$$x' }$foo$`);
    });
    it('$foo$ hazard', () => {
      expect(() => pg`SELECT $foo$${ '$foo$' }$foo$`).to.throw(Error, 'Cannot embed ');
      expect(() => pg`SELECT $foo$${ 'x$foo$x' }$foo$`).to.throw(Error, 'Cannot embed ');
      expect(() => pg`SELECT $foo$${ 'x$fo' }$foo$`).to.throw(Error, 'Cannot embed ');

      expect(() => pg`SELECT $foo$${ '$fOo$x' }$foo$`).to.not.throw();
    });
    it('mixed case hazard', () => {
      // OK
      runTagTest(
        'SELECT $foo$ $foo$, e\'\\$foo\\$\', "$foo$--"\n',
        () => pg`SELECT $foo$ $foo$, ${ '$foo$' }, "$foo$--"
`);
      // Mixed case matters
      expect(() => pg`SELECT $foo$ $Foo$, ${ '$foo$' } "$foo$--"
`)
        .to.throw(Error, 'Cannot embed ');
    });
  });
  describe('continued-strings', () => {
    const line = [ 'haven\'t', 'have too', 'have not! n\'t!' ];
    it('e', () => {
      runTagTest(
        'SELECT e\'\' \'haven\'\'t\'\n  \'have too\'\n  \'have not! n\'\'t!\'',
        () =>
          pg`SELECT e'' ${ line[0] }
  ${ line[1] }
  ${ line[2] }`);
    });
    it('ambiguity', () => {
      expect(
        () =>
          pg`SELECT ${ line[0] }
  ${ line[1] }
  ${ line[2] }`)
        .to.throw(Error, 'Potential for ambiguous string continuation');
    });
  });
  describe('meta-chars', () => {
    const cases = [
      {
        metachar: '\'',
        want: String.raw`SELECT '''', u&'${ '\\' }0027', e''''`,
      },
      {
        metachar: '"',
        want: String.raw`SELECT '"', u&'${ '\\' }0022', e'\"'`,
      },
      {
        metachar: '\0',
        want: String.raw`SELECT '', u&'', e''`,
      },
      {
        metachar: '\\',
        want: String.raw`SELECT '\', u&'${ '\\' }005c', e'\\'`,
      },
      {
        metachar: '\n',
        want: String.raw`SELECT '${ '\n' }', u&'${ '\\' }000a', e'\n'`,
      },
      {
        metachar: '',
        want: String.raw`SELECT '', u&'', e''`,
      },
    ];
    for (const { metachar, want } of cases) {
      it(`Escaping of ${ JSON.stringify(metachar) }`, () => {
        const got = pg`SELECT '${ metachar }', u&'${ metachar }', e'${ metachar }'`;
        expect(got.content).to.equal(want, metachar);
        // TODO: maybe try to actually issue queries and check the results.
        // 15 Nov 2019 - manually checked the wanted SQL against psql (PostgreSQL) 10.5
        // conencted to a server with the default configuration produced by initdb.
      });
    }
  });
});
