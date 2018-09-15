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

const {
  CHARS_GLOBAL_REGEXP,
  escapeSeries,
  isSeries,
  isSqlFragment,
  makeEscaper,
} = require('./escapers.js');

const { toString: bufferProtoToString } = Buffer.prototype;
const { isBuffer } = Buffer;
const { apply } = Reflect;

const BT_GLOBAL_REGEXP = /`/g;
const QUAL_GLOBAL_REGEXP = /\./g;
const MYSQL_ID_REGEXP = /^`(?:[^`]|``)+`$/;
const MYSQL_QUAL_ID_REGEXP = /^`(?:[^`]|``)+`(?:[.]`(?:[^`]|``)+`)*$/;

const MYSQL_CHARS_ESCAPE_MAP = {
  __proto__: null,
  '\0': '\\0',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  // Windows end-of-file
  '\x1a': '\\Z',
  '"': '\\"',
  '$': '\\$',
  '\'': '\\\'',
  '\\': '\\\\',
};


function mysqlEscapeId(val, forbidQualified) {
  if (isSqlFragment(val)) {
    const { content } = val;
    if ((forbidQualified ? MYSQL_ID_REGEXP : MYSQL_QUAL_ID_REGEXP).test(content)) {
      return content;
    }
    throw new Error(`Expected id, got ${ content }`);
  }
  if (isSeries(val)) {
    return escapeSeries(val, (element) => mysqlEscapeId(element, forbidQualified), false);
  }
  if (forbidQualified) {
    return `\`${ String(val).replace(BT_GLOBAL_REGEXP, '``') }\``;
  }
  return `\`${ String(val).replace(BT_GLOBAL_REGEXP, '``').replace(QUAL_GLOBAL_REGEXP, '`.`') }\``;
}

function mysqlEscapeString(val) {
  const str = `${ val }`;

  let chunkIndex = 0;
  let escapedVal = '';

  CHARS_GLOBAL_REGEXP.lastIndex = 0;
  for (let match; (match = CHARS_GLOBAL_REGEXP.exec(str));) {
    escapedVal += str.substring(chunkIndex, match.index) + MYSQL_CHARS_ESCAPE_MAP[match[0]];
    chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex;
  }

  if (chunkIndex === 0) {
    // Nothing was escaped
    return `'${ str }'`;
  }

  if (chunkIndex < str.length) {
    return `'${ escapedVal }${ str.substring(chunkIndex) }'`;
  }

  return `'${ escapedVal }'`;
}

const mysqlEscape = makeEscaper(mysqlEscapeId, mysqlEscapeString);

function mysqlEscapeDelimited(value, delimiter, timeZone, forbidQualified) {
  if (delimiter === '`') {
    return mysqlEscapeId(value, forbidQualified).replace(/^`|`$/g, '');
  }
  if (isBuffer(value)) {
    value = apply(bufferProtoToString, value, [ 'binary' ]);
  }
  const escaped = mysqlEscape(String(value), true, timeZone);
  return escaped.substring(1, escaped.length - 1);
}

module.exports = Object.freeze({
  escape: mysqlEscape,
  escapeId: mysqlEscapeId,
  escapeDelimited: mysqlEscapeDelimited,
});
