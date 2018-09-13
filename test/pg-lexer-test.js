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

'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');
const pgLexer = require('../lib/pg-lexer.js');

function tokens(...chunks) {
  const { makeLexer } = pgLexer;
  const lexer = makeLexer();
  const out = [];
  for (let i = 0, len = chunks.length; i < len; ++i) {
    out.push(lexer(chunks[i]) || '_');
  }
  return out.join(',');
}

describe('pg template lexer', () => {
  it('empty string', () => {
    expect(tokens('')).to.equal('_');
  });
  it('hash comments', () => {
    // Unlike MySQL, postgres does not recognize # comments.
    expect(tokens(' # "foo\n', '')).to.equal('","');
  });
  it('dash comments', () => {
    expect(tokens(' -- \'foo\n', '')).to.equal('_,_');
  });
  it('dash dash in number literal', () => {
    // www.postgresql.org/docs/9.5/static/sql-syntax-lexical.html says
    // "-- and /* cannot appear anywhere in an operator name, since
    //  they will be taken as the start of a comment."
    // so it looks like there is no rule similar to MySQL where "--"
    // when used as a comment delimiter has to not be immediately
    // preceded and followed by numeric or identifier characters.
    expect(() => tokens('SELECT (1--1)'))
      .to.throw(Error, 'Unterminated line comment: --1)');
  });
  it('block comments', () => {
    expect(tokens(' /* `foo */', '')).to.equal('_,_');
    expect(() => tokens(' /* `foo '))
      .to.throw(Error, 'Unterminated block comment: /* `foo');
    expect(tokens(' /* /* foo */ \' */', '')).to.equal('_,_');
  });
  it('dq', () => {
    expect(tokens('SELECT "foo"')).to.equal('_');
    expect(tokens('SELECT `foo`, "foo"')).to.equal('_');
    expect(tokens('SELECT "', '"')).to.equal('",_');
    expect(tokens('SELECT "x', '"')).to.equal('",_');
    expect(tokens('SELECT "\'', '"')).to.equal('",_');
    expect(tokens('SELECT "`', '"')).to.equal('",_');
    expect(tokens('SELECT """', '"')).to.equal('",_');
    // C-style escape sequences not supported in double
    // quoted strings unless U&
    expect(tokens('SELECT "\\"', '"')).to.equal('_,"');
  });
  it('U&dq', () => {
    expect(tokens('SELECT U&"foo"')).to.equal('_');
    expect(tokens('SELECT `foo`, U&"foo"')).to.equal('_');
    expect(tokens('SELECT U&"', '"')).to.equal('U&",_');
    expect(tokens('SELECT U&"x', '"')).to.equal('U&",_');
    expect(tokens('SELECT U&"\'', '"')).to.equal('U&",_');
    expect(tokens('SELECT U&"`', '"')).to.equal('U&",_');
    expect(tokens('SELECT U&"""', '"')).to.equal('U&",_');
    // C-style escape sequences not supported in double
    // quoted strings unless U&
    expect(tokens('SELECT U&"\\"', '"')).to.equal('U&",_');
    expect(() => tokens('SELECT U&"\\')).to.throw();
  });
  it('sq', () => {
    expect(tokens('SELECT \'foo\'')).to.equal('_');
    expect(tokens('SELECT `foo`, \'foo\'')).to.equal('_');
    expect(tokens('SELECT \'', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'x', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'"', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'`', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'\'\'', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'\\\'', '\'')).to.equal('_,\'');
  });
  it('Esq', () => {
    expect(tokens('SELECT E\'foo\'')).to.equal('_');
    expect(tokens('SELECT E\'foo')).to.equal('E\'');
    expect(tokens('SELECT `foo`, E\'foo\'')).to.equal('_');
    expect(tokens('SELECT E\'', '\'')).to.equal('E\',_');
    expect(tokens('SELECT E\'x', '\'')).to.equal('E\',_');
    expect(tokens('SELECT E\'"', '\'')).to.equal('E\',_');
    expect(tokens('SELECT E\'`', '\'')).to.equal('E\',_');
    expect(tokens('SELECT E\'\'\'', '\'')).to.equal('E\',_');
    expect(tokens('SELECT E\'\\\'', '\'')).to.equal('E\',_');
    expect(tokens('SELECT e\'\\\'', '\'')).to.equal('e\',_');
  });
  it('U&sq', () => {
    expect(tokens('SELECT U&\'foo\'')).to.equal('_');
    expect(tokens('SELECT `foo`, U&\'foo\'')).to.equal('_');
    expect(tokens('SELECT U&\'', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT U&\'x', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT U&\'"', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT U&\'`', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT U&\'\'\'', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT U&\'\\\'', '\'')).to.equal('U&\',_');
    expect(tokens('SELECT u&\'\\\'', '\'')).to.equal('u&\',_');
  });
  it('$$', () => {
    expect(tokens('SELECT $$foo$$')).to.equal('_');
    expect(tokens('SELECT $$foo')).to.equal('$$');
    expect(tokens('SELECT $$foo', '$$')).to.equal('$$,_');
    expect(tokens('SELECT $$foo', 'bar$$')).to.equal('$$,_');
    expect(tokens('SELECT $$foo\\', 'bar$$')).to.equal('$$,_');
    expect(tokens('SELECT $foo$')).to.equal('$foo$');
    expect(tokens('SELECT $foo$bar')).to.equal('$foo$');
    expect(tokens('SELECT $foo$bar$foo$')).to.equal('_');
    expect(tokens('SELECT $$foo\\$$')).to.equal('_');
    expect(tokens('SELECT $foo$bar$baz$ ')).to.equal('$foo$');

    expect(() => tokens('SELECT $foo$ $'))
      .to.throw(Error, 'merge hazard \'$\' at end of $foo$ delimited string');
    expect(() => tokens('SELECT $foo$ $f'))
      .to.throw(Error, 'merge hazard \'$f\' at end of $foo$ delimited string');
    expect(() => tokens('SELECT $foo$ $fo'))
      .to.throw(Error, 'merge hazard \'$fo\' at end of $foo$ delimited string');
    expect(() => tokens('SELECT $foo$ $foo'))
      .to.throw(Error, 'merge hazard \'$foo\' at end of $foo$ delimited string');
    expect(() => tokens('SELECT $foo$ $x$'))
      .to.throw(Error, 'merge hazard \'$\' at end of $foo$ delimited string');
    expect(tokens('SELECT $foo$ $foo$')).to.equal('_');
    expect(tokens('SELECT $foo$ $x')).to.equal('$foo$');
  });
  it('wot!', () => {
    expect(() => tokens('SELECT $foo$ $x$'))
      .to.throw(Error, 'merge hazard \'$\' at end of $foo$ delimited string');
  });
  it('replay error', () => {
    const lexer = pgLexer.makeLexer();
    expect(lexer('SELECT ')).to.equal(null);
    expect(() => lexer(' -- ')).to.throw(
      Error, 'Unterminated line comment: -- ');
    // Providing more input throws the same error.
    expect(() => lexer(' ')).to.throw(
      Error, 'Unterminated line comment: -- ');
  });
  it('unfinished escape squence', () => {
    const lexer = pgLexer.makeLexer();
    expect(() => lexer('SELECT E\'\\')).to.throw(
      Error, 'Incomplete escape sequence in E\' delimited string at `\\`');
  });
});
