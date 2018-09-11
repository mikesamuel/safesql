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

require('module-keys/cjs').polyfill(module, require, 'safe-sql/index.js');

const { escape, escapeId } = require('./lib/escapers.js');
const { makeLexer } = require('./lib/lexer.js');
const { SqlFragment } = require('./fragment.js');

const { Mintable } = require('node-sec-patterns');
const {
  calledAsTemplateTagQuick,
  memoizedTagFunction,
  trimCommonWhitespaceFromLines,
} = require('template-tag-common');

const LITERAL_BACKTICK_FIXUP_PATTERN = /((?:[^\\]|\\[^`])+)|\\(`)(?!`)/g;

const mintSqlFragment = require.keys.unbox(
  Mintable.minterFor(SqlFragment),
  () => true,
  (x) => `${ x }`);

/**
 * Trims common whitespace and converts escaped backticks
 * to backticks as appropriate.
 *
 * @param {!Array.<string>} strings a valid TemplateObject.
 * @return {!Array.<string>} the adjusted raw strings.
 */
function prepareStrings(strings) {
  const raw = trimCommonWhitespaceFromLines(strings).raw.slice();
  for (let i = 0, len = raw.length; i < len; ++i) {
    // Convert \` to ` but leave  \\` alone.
    raw[i] = raw[i].replace(LITERAL_BACKTICK_FIXUP_PATTERN, '$1$2');
  }
  return raw;
}

/**
 * Analyzes the static parts of the tag content.
 *
 * @param {!Array.<string>} strings a valid TemplateObject.
 * @return { !{
 *       delimiters : !Array.<string>,
 *       chunks: !Array.<string>
 *     } }
 *     A record like { delimiters, chunks }
 *     where delimiter is a contextual cue and chunk is
 *     the adjusted raw text.
 */
function computeStatic(strings) {
  const chunks = prepareStrings(strings);
  const lexer = makeLexer();

  const delimiters = [];
  let delimiter = null;
  for (let i = 0, len = chunks.length; i < len; ++i) {
    const chunk = String(chunks[i]);
    const newDelimiter = lexer(chunk);
    delimiters.push(newDelimiter);
    delimiter = newDelimiter;
  }

  if (delimiter) {
    throw new Error(`Unclosed quoted string: ${ delimiter }`);
  }

  return { delimiters, chunks };
}

function escapeDelimitedValue(value, delimiter, timeZone, forbidQualified) {
  if (delimiter === '`') {
    return escapeId(value, forbidQualified).replace(/^`|`$/g, '');
  }
  if (Buffer.isBuffer(value)) {
    value = value.toString('binary');
  }
  const escaped = escape(String(value), true, timeZone);
  return escaped.substring(1, escaped.length - 1);
}

function defangMergeHazard(before, escaped, after) {
  const escapedLast = escaped[escaped.length - 1];
  if ('"\'`'.indexOf(escapedLast) < 0) {
    // Not a merge hazard.
    return escaped;
  }

  let escapedSetOff = escaped;
  const lastBefore = before[before.length - 1];
  if (escapedLast === escaped[0] && escapedLast === lastBefore) {
    escapedSetOff = ` ${ escapedSetOff }`;
  }
  if (escapedLast === after[0]) {
    escapedSetOff += ' ';
  }
  return escapedSetOff;
}

function interpolateSqlIntoFragment(
  { stringifyObjects, timeZone, forbidQualified },
  { delimiters, chunks },
  strings, values) {
  // A buffer to accumulate output.
  let [ result ] = chunks;
  for (let i = 1, len = chunks.length; i < len; ++i) {
    const chunk = chunks[i];
    // The count of values must be 1 less than the surrounding
    // chunks of literal text.
    const delimiter = delimiters[i - 1];
    const value = values[i - 1];

    const escaped = delimiter ?
      escapeDelimitedValue(value, delimiter, timeZone, forbidQualified) :
      defangMergeHazard(
        result,
        escape(value, stringifyObjects, timeZone),
        chunk);

    result += escaped + chunk;
  }

  return mintSqlFragment(result);
}

/**
 * Template tag function that contextually autoescapes values
 * producing a SqlFragment.
 */
const sql = memoizedTagFunction(computeStatic, interpolateSqlIntoFragment);
sql.calledAsTemplateTagQuick = calledAsTemplateTagQuick;

module.exports = { sql };
