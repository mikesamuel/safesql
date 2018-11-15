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

/* eslint "id-length": 0, "id-blacklist": 0, "no-magic-numbers": 0 */

'use strict';

require('module-keys/cjs').polyfill(module, require, 'safesql/test/escaper-test.js');

const { expect } = require('chai');
const { describe, it } = require('mocha');

const { mysql, pg } = require('../index.js');
const mysqlEscaper = require('../lib/mysql-escaper.js');
const pgEscaper = require('../lib/pg-escaper.js');
const escapers = {
  mysql: mysqlEscaper,
  pg: pgEscaper,
};

describe('escapers', () => {
  for (const target of [ 'mysql', 'pg' ]) {
    // eslint-disable-next-line no-use-before-define
    describe(target, () => testEscapes(target, escapers[target]));
  }
});

function testEscapes(target, { escape, escapeId }) {
  describe('escapeId', () => {
    it('value is quoted', () => {
      expect(escapeId('id')).to.equal(
        {
          mysql: '`id`',
          pg: '"id"',
        }[target]);
    });

    it('value can be a number', () => {
      expect(escapeId(42)).to.equal({
        mysql: '`42`',
        pg: '"42"',
      }[target]);
    });

    it('value can be an object', () => {
      expect(escapeId({})).to.equal({
        mysql: '`[object Object]`',
        pg: '"[object Object]"',
      }[target]);
    });

    it('value toString is called', () => {
      expect(escapeId({ toString() {
        return 'foo';
      } })).to.equal({
        mysql: '`foo`',
        pg: '"foo"',
      }[target]);
    });

    it('value toString is quoted', () => {
      expect(escapeId({
        toString() {
          return 'f`"oo';
        },
      })).to.equal({
        mysql: '`f``"oo`',
        pg: '"f`""oo"',
      }[target]);
    });

    it('value containing escapes is quoted', () => {
      expect(escapeId('i`"d')).to.equal({
        mysql: '`i``"d`',
        pg: '"i`""d"',
      }[target]);
    });

    it('value containing separator is quoted', () => {
      expect(escapeId('id1.id2')).to.equal({
        mysql: '`id1`.`id2`',
        pg: '"id1"."id2"',
      }[target]);
    });

    it('value containing separator and escapes is quoted', () => {
      expect(escapeId('id`1.i"d2')).to.equal({
        mysql: '`id``1`.`i"d2`',
        pg: '"id`1"."i""d2"',
      }[target]);
    });

    it('value containing separator is fully escaped when forbidQualified', () => {
      expect(escapeId('id1.id2', true)).to.equal({
        mysql: '`id1.id2`',
        pg: '"id1.id2"',
      }[target]);
    });

    it('arrays are turned into lists', () => {
      expect(escapeId([ 'a', 'b', 't.c' ])).to.equal({
        mysql: '`a`, `b`, `t`.`c`',
        pg: '"a", "b", "t"."c"',
      }[target]);
    });

    it('nested arrays are flattened', () => {
      expect(escapeId([ 'a', [ 'b', [ 't.c' ] ] ])).to.equal({
        mysql: '`a`, `b`, `t`.`c`',
        pg: '"a", "b", "t"."c"',
      }[target]);
    });

    describe('qualified id to escapeId', () => {
      const qualifiedId = {
        mysql: mysql`\`id1\`.\`id2\``,
        pg: pg`"id1"."id2"`,
      }[target];
      it('rejects', () => {
        expect(() => escapeId(qualifiedId, true)).to.throw();
      });
      it('allow', () => {
        expect(() => escapeId(qualifiedId, false)).to.not.throw();
      });
    });
  });

  describe('escape', () => {
    it('undefined -> NULL', () => {
      expect(escape(void 0)).to.equal('NULL');
    });

    it('null -> NULL', () => {
      expect(escape(null)).to.equal('NULL');
    });

    it('booleans convert to strings', () => {
      expect(escape(false)).to.equal('false');
      expect(escape(true)).to.equal('true');
    });

    it('numbers convert to strings', () => {
      expect(escape(5)).to.equal('5');
    });

    it('raw not escaped', () => {
      expect(escape(mysql`NOW()`)).to.equal('NOW()');
    });

    it('objects are turned into key value pairs', () => {
      expect(escape({ a: 'b', c: 'd' })).to.equal({
        mysql: '`a` = \'b\', `c` = \'d\'',
        pg: '"a" = \'b\', "c" = \'d\'',
      }[target]);
    });

    it('objects function properties are ignored', () => {
      // eslint-disable-next-line no-empty-function
      expect(escape({ a: 'b', c() {} })).to.equal({
        mysql: '`a` = \'b\'',
        pg: '"a" = \'b\'',
      }[target]);
    });

    it('nested toSqlString is not trusted', () => {
      expect(escape({ id: { toSqlString() {
        return 'LAST_INSERT_ID()';
      } } })).to.equal({
        mysql: '`id` = \'[object Object]\'',
        pg: '"id" = \'[object Object]\'',
      }[target]);
    });

    it('objects toSqlString is not trusted', () => {
      expect(escape({ toSqlString() {
        return '@foo_id';
      } })).to.equal('');
    });

    it('fragment is not quoted', () => {
      expect(escape(mysql`CURRENT_TIMESTAMP()`)).to.equal('CURRENT_TIMESTAMP()');
    });

    it('nested objects are cast to strings', () => {
      expect(escape({ a: { nested: true } })).to.equal({
        mysql: '`a` = \'[object Object]\'',
        pg: '"a" = \'[object Object]\'',
      }[target]);
    });

    it('nested objects use toString', () => {
      expect(escape({ a: { toString() {
        return 'foo';
      } } })).to.equal(
        {
          mysql: '`a` = \'foo\'',
          pg: '"a" = \'foo\'',
        }[target]);
    });

    it('nested objects use toString is quoted', () => {
      expect(escape({ a: { toString() {
        return 'f\'oo';
      } } })).to.equal({
        mysql: '`a` = \'f\\\'oo\'',
        pg: '"a" = e\'f\'\'oo\'',
      }[target]);
    });

    it('arrays are turned into lists', () => {
      expect(escape([ 1, 2, 'c' ])).to.equal('1, 2, \'c\'');
    });

    it('series are turned into lists', () => {
      function * items() {
        yield 1;
        yield 2;
        yield 'c';
      }
      expect(escape(items())).to.equal('1, 2, \'c\'');
    });

    it('nested arrays are turned into grouped lists', () => {
      function * items() {
        yield [ 1, 2, 3 ];
        yield (
          function * nested() {
            yield 4;
            yield 5;
            yield 6;
          }());
        yield [ 'a', 'b', { nested: true } ];
      }

      expect(escape(items())).to.equal('(1, 2, 3), (4, 5, 6), (\'a\', \'b\', \'[object Object]\')');
    });

    it('nested series are turned into grouped lists', () => {
      function * items() {
        yield 4;
        yield 5;
        yield 6;
      }
      expect(escape([ [ 1, 2, 3 ], items(), [ 'a', 'b', { nested: true } ] ]))
        .to.equal('(1, 2, 3), (4, 5, 6), (\'a\', \'b\', \'[object Object]\')');
    });

    it('nested objects inside arrays are cast to strings', () => {
      expect(escape([ 1, { nested: true }, 2 ])).to.equal('1, \'[object Object]\', 2');
    });

    it('nested objects inside arrays use toString', () => {
      expect(escape([
        1,
        { toString() {
          return 'foo';
        } },
        2,
      ])).to.equal('1, \'foo\', 2');
    });

    it('strings are quoted', () => {
      expect(escape('Super')).to.equal('\'Super\'');
    });

    it('\\0 gets escaped', () => {
      expect(escape('Sup\u0000er')).to.equal({
        mysql: '\'Sup\\0er\'',
        pg: 'e\'Super\'',
      }[target]);

      expect(escape('Super\u0000')).to.equal({
        mysql: '\'Super\\0\'',
        pg: 'e\'Super\'',
      }[target]);

      expect(escape('Super\u000012')).to.equal({
        mysql: '\'Super\\012\'',
        pg: 'e\'Super12\'',
      }[target]);
    });

    it('\\b gets escaped', () => {
      expect(escape('Sup\ber')).to.equal({
        mysql: '\'Sup\\ber\'',
        pg: 'e\'Sup\\ber\'',
      }[target]);

      expect(escape('Super\b')).to.equal({
        mysql: '\'Super\\b\'',
        pg: 'e\'Super\\b\'',
      }[target]);
    });

    it('\\n gets escaped', () => {
      expect(escape('Sup\ner')).to.equal({
        mysql: '\'Sup\\ner\'',
        pg: 'e\'Sup\\ner\'',
      }[target]);

      expect(escape('Super\n')).to.equal({
        mysql: '\'Super\\n\'',
        pg: 'e\'Super\\n\'',
      }[target]);
    });

    it('\\r gets escaped', () => {
      expect(escape('Sup\rer')).to.equal({
        mysql: '\'Sup\\rer\'',
        pg: 'e\'Sup\\rer\'',
      }[target]);

      expect(escape('Super\r')).to.equal({
        mysql: '\'Super\\r\'',
        pg: 'e\'Super\\r\'',
      }[target]);
    });

    it('\\t gets escaped', () => {
      expect(escape('Sup\ter')).to.equal({
        mysql: '\'Sup\\ter\'',
        pg: 'e\'Sup\\ter\'',
      }[target]);

      expect(escape('Super\t')).to.equal({
        mysql: '\'Super\\t\'',
        pg: 'e\'Super\\t\'',
      }[target]);
    });

    it('\\ gets escaped', () => {
      expect(escape('Sup\\er')).to.equal({
        mysql: '\'Sup\\\\er\'',
        pg: 'e\'Sup\\\\er\'',
      }[target]);

      expect(escape('Super\\')).to.equal({
        mysql: '\'Super\\\\\'',
        pg: 'e\'Super\\\\\'',
      }[target]);
    });

    it('\\u001a (ascii 26 - Windows EOF) gets replaced', () => {
      expect(escape('Sup\u001aer')).to.equal({
        mysql: '\'Sup\\Zer\'',
        pg: 'e\'Sup\\x1aer\'',
      }[target]);

      expect(escape('Super\u001a')).to.equal({
        mysql: '\'Super\\Z\'',
        pg: 'e\'Super\\x1a\'',
      }[target]);
    });

    it('single quotes get escaped', () => {
      expect(escape('Sup\'er')).to.equal({
        mysql: '\'Sup\\\'er\'',
        pg: 'e\'Sup\'\'er\'',
      }[target]);

      expect(escape('Super\'')).to.equal({
        mysql: '\'Super\\\'\'',
        pg: 'e\'Super\'\'\'',
      }[target]);
    });

    it('double quotes get escaped', () => {
      expect(escape('Sup"er')).to.equal({
        mysql: '\'Sup\\"er\'',
        pg: 'e\'Sup\\"er\'',
      }[target]);

      expect(escape('Super"')).to.equal({
        mysql: '\'Super\\"\'',
        pg: 'e\'Super\\"\'',
      }[target]);
    });

    it('dollar signs get escaped', () => {
      expect(escape('foo$$; DELETE')).to.equal({
        mysql: String.raw`'foo\$\$; DELETE'`,
        pg: String.raw`e'foo\$\$; DELETE'`,
      }[target]);
    });

    it('dates are converted to YYYY-MM-DD HH:II:SS.sss', () => {
      const expected = '2012-05-07 11:42:03.002';
      const date = new Date(2012, 4, 7, 11, 42, 3, 2);
      const string = escape(date);

      expect(string).to.equal(`'${ expected }'`);
    });

    it('dates are converted to specified time zone "Z"', () => {
      const expected = '2012-05-07 11:42:03.002';
      const date = new Date(Date.UTC(2012, 4, 7, 11, 42, 3, 2));
      const string = escape(date, false, 'Z');

      expect(string).to.equal(`'${ expected }'`);
    });

    it('dates are converted to specified time zone "+01"', () => {
      const expected = '2012-05-07 12:42:03.002';
      const date = new Date(Date.UTC(2012, 4, 7, 11, 42, 3, 2));
      const string = escape(date, false, '+01');

      expect(string).to.equal(`'${ expected }'`);
    });

    it('dates are converted to specified time zone "+0200"', () => {
      const expected = '2012-05-07 13:42:03.002';
      const date = new Date(Date.UTC(2012, 4, 7, 11, 42, 3, 2));
      const string = escape(date, false, '+0200');

      expect(string).to.equal(`'${ expected }'`);
    });

    it('dates are converted to specified time zone "-05:00"', () => {
      const expected = '2012-05-07 06:42:03.002';
      const date = new Date(Date.UTC(2012, 4, 7, 11, 42, 3, 2));
      const string = escape(date, false, '-05:00');

      expect(string).to.equal(`'${ expected }'`);
    });

    it('dates are converted to UTC for unknown time zone', () => {
      const date = new Date(Date.UTC(2012, 4, 7, 11, 42, 3, 2));
      const expected = escape(date, false, 'Z');
      const string = escape(date, false, 'foo');

      expect(string).to.equal(expected);
    });

    it('invalid dates are converted to null', () => {
      const date = new Date(NaN);
      const string = escape(date);

      expect(string).to.equal('NULL');
    });

    it('buffers are converted to hex', () => {
      const buffer = Buffer.from([ 0, 1, 254, 255 ]);
      const string = escape(buffer);

      expect(string).to.equal('X\'0001feff\'');
    });

    it('buffers object cannot inject SQL', () => {
      const buffer = Buffer.from([ 0, 1, 254, 255 ]);
      buffer.toString = () => '00\' OR \'1\'=\'1';
      const string = escape(buffer);

      expect(string).to.equal('X\'0001feff\'');
    });

    it('NaN -> NaN', () => {
      expect(escape(NaN)).to.equal('NaN');
    });

    it('Infinity -> Infinity', () => {
      expect(escape(Infinity)).to.equal('Infinity');
    });
  });
}

describe('all delimiters', () => {
  const { escapeDelimited } = escapers.pg;
  it('ok', () => {
    for (const okDelim of [ '\'', '"', 'u&"', 'u&\'', 'b\'', 'x\'', 'e\'', '$$', '$foo$' ]) {
      expect(() => escapeDelimited('x', okDelim, null, false)).to.not.throw();
    }
  });
  it('bad', () => {
    for (const badDelim of [ '', '?', '$x', '$$$', 'z\'' ]) {
      expect(() => escapeDelimited('x', badDelim, null, false)).to.throw(Error, 'Cannot escape');
    }
  });
});
