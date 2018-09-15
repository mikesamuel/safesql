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

/* eslint id-length: 0, complexity: ["error", { "max": 15 }] */

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

const QUAL_GLOBAL_REGEXP = /\./g;
const DQ_GLOBAL_REGEXP = /"/g;
const SQ_GLOBAL_REGEXP = /'/g;
const PG_ID_REGEXP = /^(?:"(?:[^"]|"")+"|u&"(?:[^"\\]|""|\\.)+")$/i;
const PG_QUAL_ID_REGEXP = /^(?:(?:"(?:[^"]|"")+"|u&"(?:[^"\\]|""|\\.)+")(?:[.](?!$)|$))+$/;

const PG_E_CHARS_ESCAPE_MAP = {
  __proto__: null,
  // Avoid octal merge hazard.
  '\0': '\\x00',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\x1a',
  '"': '\\"',
  '$': '\\$',
  // This fails safe when we pick the wrong escaping convention for a
  // single-quote delimited string.
  // Empirically, from a psql10 client,
  // # SELECT e'foo''bar';
  //  ?column?
  // ----------
  //  foo'bar
  '\'': '\'\'',
  '\\': '\\\\',
};

const PG_U_CHARS_ESCAPE_MAP = {
  __proto__: null,
  '\0': '\\0000',
  '\b': '\\0008',
  '\t': '\\0009',
  '\n': '\\000a',
  '\r': '\\000d',
  '\x1a': '\\001a',
  '"': '\\0022',
  '$': '\\0024',
  '\'': '\\0027',
  '\\': '\\005c',
};

const HEX_GLOBAL_REGEXP = /[0-9A-Fa-f]/g;
const HEX_TO_BINARY_TABLE = {
  __proto__: null,
  '0': '0000',
  '1': '0001',
  '2': '0010',
  '3': '0011',
  '4': '0100',
  '5': '0101',
  '6': '0110',
  '7': '0111',
  '8': '1000',
  '9': '1001',
  'A': '1010',
  'B': '1011',
  'C': '1100',
  'D': '1101',
  'E': '1110',
  'F': '1111',
  'a': '1010',
  'b': '1011',
  'c': '1100',
  'd': '1101',
  'e': '1110',
  'f': '1111',
};

function hexDigitToBinary(digit) {
  return HEX_TO_BINARY_TABLE[digit];
}

function hexToBinary(str) {
  return str.replace(HEX_GLOBAL_REGEXP, hexDigitToBinary);
}

function pgEscapeStringBody(str, escapeMap) {
  let chunkIndex = 0;
  let escapedVal = '';

  CHARS_GLOBAL_REGEXP.lastIndex = 0;
  for (let match; (match = CHARS_GLOBAL_REGEXP.exec(str));) {
    escapedVal += str.substring(chunkIndex, match.index) + escapeMap[match[0]];
    chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex;
  }

  if (chunkIndex === 0) {
    // Nothing was escaped
    return str;
  }

  if (chunkIndex < str.length) {
    escapedVal += str.substring(chunkIndex);
  }

  return escapedVal;
}

function pgEscapeId(val, forbidQualified, unicode) {
  if (isSqlFragment(val)) {
    const { content } = val;
    if ((forbidQualified ? PG_ID_REGEXP : PG_QUAL_ID_REGEXP).test(content)) {
      return content;
    }
    throw new Error(`Expected id, got ${ content }`);
  }
  if (isSeries(val)) {
    return escapeSeries(val, (element) => pgEscapeId(element, forbidQualified, unicode), false);
  }
  let escaped = unicode ?
    pgEscapeStringBody(`${ val }`, PG_U_CHARS_ESCAPE_MAP) :
    `${ val }`.replace(DQ_GLOBAL_REGEXP, '""');
  if (!forbidQualified) {
    escaped = escaped.replace(QUAL_GLOBAL_REGEXP, unicode ? '".u&"' : '"."');
  }
  return `${ unicode ? 'u&"' : '"' }${ escaped }"`;
}

const PG_ID_DELIMS_REGEXP = /^(?:[Uu]&)?"|"$/g;

function pgEscapeString(val) {
  const str = `${ val }`;

  const escapedVal = pgEscapeStringBody(val, PG_E_CHARS_ESCAPE_MAP);

  if (escapedVal === str) {
    return `'${ escapedVal }'`;
  }

  // If there are any backslashes or quotes, we use e'...' style strings since
  // those allow a consistent scheme for escaping all string meta-characters so entail
  // the fewest assumptions.
  return `e'${ escapedVal }'`;
}

const pgEscape = makeEscaper(pgEscapeId, pgEscapeString);

function pgEscapeDelimitedString(strValue, delimiter) {
  switch (delimiter) {
    case '\'':
    case 'b\'':
    case 'x\'':
      return strValue.replace(SQ_GLOBAL_REGEXP, '\'\'');
    case 'e\'':
      return pgEscapeStringBody(strValue, PG_E_CHARS_ESCAPE_MAP);
    case 'e':
      return `'${ pgEscapeStringBody(strValue, PG_E_CHARS_ESCAPE_MAP) }'`;
    case 'u&\'':
      return pgEscapeStringBody(strValue, PG_U_CHARS_ESCAPE_MAP);
    default:
      break;
  }

  if (delimiter[0] === '$' && delimiter.indexOf('$', 1) === delimiter.length - 1) {
    // Handle literal strings like $tag$...$tag$
    let embedHazard = strValue.indexOf(delimiter) >= 0;
    if (!embedHazard) {
      const lastDollar = strValue.lastIndexOf('$');
      if (lastDollar >= 0) {
        const tail = strValue.substring(lastDollar);
        embedHazard = (tail === delimiter.substring(0, tail.length));
      }
    }
    if (embedHazard) {
      throw new Error(`Cannot embed ${ JSON.stringify(strValue) } between ${ delimiter }`);
    }
    return strValue;
  }
  throw new Error(`Cannot escape with ${ delimiter }`);
}

function pgEscapeDelimited(value, delimiter, timeZone, forbidQualified) {
  if (delimiter === '"') {
    return pgEscapeId(value, forbidQualified, false).replace(PG_ID_DELIMS_REGEXP, '');
  } else if (delimiter === 'u&"') {
    return pgEscapeId(value, forbidQualified, true).replace(PG_ID_DELIMS_REGEXP, '');
  }

  let strValue = value;
  if (isBuffer(value)) {
    const wantsBinaryDigits = delimiter === 'b\'';
    const encoding = wantsBinaryDigits || delimiter === 'x\'' ? 'hex' : 'binary';
    strValue = apply(bufferProtoToString, value, [ encoding ]);
    if (wantsBinaryDigits) {
      // encoding='binary' to buffer means something very different from binary
      // encoding in PGSql.
      strValue = hexToBinary(strValue);
    }
  }
  return pgEscapeDelimitedString(`${ strValue }`, delimiter);
}

module.exports = Object.freeze({
  escape: pgEscape,
  escapeId: pgEscapeId,
  escapeDelimited: pgEscapeDelimited,
});
