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
const mysqlLexer = require('../lib/mysql-lexer');

function tokens(...chunks) {
  const { makeLexer } = mysqlLexer;
  const lexer = makeLexer();
  const out = [];
  for (let i = 0, len = chunks.length; i < len; ++i) {
    out.push(lexer(chunks[i]) || '_');
  }
  return out.join(',');
}

describe('template lexer', () => {
  it('empty string', () => {
    expect(tokens('')).to.equal('_');
  });
  it('hash comments', () => {
    expect(tokens(' # "foo\n', '')).to.equal('_,_');
  });
  it('dash comments', () => {
    expect(tokens(' -- \'foo\n', '')).to.equal('_,_');
  });
  it('dash dash participates in number literal', () => {
    expect(tokens('SELECT (1--1) + "', '"')).to.equal('",_');
  });
  it('block comments', () => {
    expect(tokens(' /* `foo */', '')).to.equal('_,_');
  });
  it('dq', () => {
    expect(tokens('SELECT "foo"')).to.equal('_');
    expect(tokens('SELECT `foo`, "foo"')).to.equal('_');
    expect(tokens('SELECT "', '"')).to.equal('",_');
    expect(tokens('SELECT "x', '"')).to.equal('",_');
    expect(tokens('SELECT "\'', '"')).to.equal('",_');
    expect(tokens('SELECT "`', '"')).to.equal('",_');
    expect(tokens('SELECT """', '"')).to.equal('",_');
    expect(tokens('SELECT "\\"', '"')).to.equal('",_');
  });
  it('sq', () => {
    expect(tokens('SELECT \'foo\'')).to.equal('_');
    expect(tokens('SELECT `foo`, \'foo\'')).to.equal('_');
    expect(tokens('SELECT \'', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'x', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'"', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'`', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'\'\'', '\'')).to.equal('\',_');
    expect(tokens('SELECT \'\\\'', '\'')).to.equal('\',_');
  });
  it('bq', () => {
    expect(tokens('SELECT `foo`')).to.equal('_');
    expect(tokens('SELECT "foo", `foo`')).to.equal('_');
    expect(tokens('SELECT `', '`')).to.equal('`,_');
    expect(tokens('SELECT `x', '`')).to.equal('`,_');
    expect(tokens('SELECT `\'', '`')).to.equal('`,_');
    expect(tokens('SELECT `"', '`')).to.equal('`,_');
    expect(tokens('SELECT ```', '`')).to.equal('`,_');
    expect(tokens('SELECT `\\`', '`')).to.equal('`,_');
  });
  it('replay error', () => {
    const lexer = mysqlLexer.makeLexer();
    expect(lexer('SELECT ')).to.equal(null);
    expect(() => lexer(' # ')).to.throw(
      Error, null, 'Expected delimiter at " # "');
    // Providing more input throws the same error.
    expect(() => lexer(' ')).to.throw(
      Error, null, 'Expected delimiter at " # "');
  });
  it('unfinished escape squence', () => {
    const lexer = mysqlLexer.makeLexer();
    expect(() => lexer('SELECT "\\')).to.throw(
      Error, null, 'Expected "\\\\" at "\\\\"');
  });
});
