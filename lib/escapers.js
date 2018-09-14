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

/* eslint id-length: 0, complexity: ["error", { "max": 15 }] */

const { Mintable } = require('node-sec-patterns');
const { SqlFragment } = require('../fragment.js');
const { SqlId } = require('../id.js');

const isSqlId = Mintable.verifierFor(SqlId);
const isSqlFragment = Mintable.verifierFor(SqlFragment);

const iteratorSymbol = Symbol.iterator;
const { isArray } = Array;
const { apply } = Reflect;
const { toString: bufferProtoToString } = Buffer.prototype;
const { isBuffer } = Buffer;

const BT_GLOBAL_REGEXP = /`/g;
const QUAL_GLOBAL_REGEXP = /\./g;
const DQ_GLOBAL_REGEXP = /"/g;
const SQ_GLOBAL_REGEXP = /'/g;
const CHARS_GLOBAL_REGEXP = /[\0\b\t\n\r\x1a"'\\$]/g; // eslint-disable-line no-control-regex
const TZ_REGEXP = /([+\-\s])(\d\d):?(\d\d)?/;
const MYSQL_ID_REGEXP = /^`(?:[^`]|``)+`$/;
const MYSQL_QUAL_ID_REGEXP = /^`(?:[^`]|``)+`(?:[.]`(?:[^`]|``)+`)*$/;
const PG_ID_REGEXP = /^(?:"(?:[^"]|"")+"|u&"(?:[^"\\]|""|\\.)+")$/i;
const PG_QUAL_ID_REGEXP = /^(?:(?:"(?:[^"]|"")+"|u&"(?:[^"\\]|""|\\.)+")(?:[.](?!$)|$))+$/;

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
  '\'': '\\\'',
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

function isSeries(val) {
  // The typeof val === 'object' check prevents treating strings as series.
  // Per (6.1.5.1 Well-Known Symbols),
  //   "Unless otherwise specified, well-known symbols values are shared by all realms"
  // so the iteratorSymbol check below should work cross-realm.
  // TODO: It's possible that a function might implement iterator.
  return val && typeof val !== 'string' && (isArray(val) || typeof val[iteratorSymbol] === 'function');
}

function pad(val, template) {
  const str = `${ val >>> 0 }`; // eslint-disable-line no-bitwise
  return `${ template.substring(str.length) }${ str }`;
}

function convertTimezone(tz) {
  if (tz === 'Z') {
    return 0;
  }

  const m = TZ_REGEXP.exec(tz);
  if (m) {
    // eslint-disable-next-line no-magic-numbers
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) + ((m[3] ? parseInt(m[3], 10) : 0) / 60)) * 60;
  }
  return false;
}

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

function escapeSeries(series, escapeOne, nests) {
  let sql = '';

  if (isArray(series)) {
    for (let i = 0, len = series.length; i < len; ++i) {
      const val = series[i];
      if (nests && isSeries(val)) {
        sql += `${ (i ? ', (' : '(') }${ escapeSeries(val, escapeOne, true) })`;
      } else {
        sql += `${ (i ? ', ' : '') }${ escapeOne(val) }`;
      }
    }
  } else {
    let wrote = false;
    for (const val of series) {
      if (nests && isSeries(val)) {
        sql += `${ (wrote ? ', (' : '(') }${ escapeSeries(val, escapeOne, true) })`;
      } else {
        sql += `${ (wrote ? ', ' : '') }${ escapeOne(val) }`;
      }
      wrote = true;
    }
  }

  return sql;
}

function bufferToString(buffer) {
  return `X'${ apply(bufferProtoToString, buffer, [ 'hex' ]) }'`;
}


function makeEscaper(escapeId, escapeString) {
  // eslint-disable-next-line max-params
  function formatDate(year, month, day, hour, minute, second, millis) {
    // YYYY-MM-DD HH:mm:ss.mmm
    return escapeString(`${ pad(year, '0000') }-${ pad(month, '00') }-${ pad(day, '00') } ${ pad(hour, '00')
    }:${ pad(minute, '00') }:${ pad(second, '00') }.${ pad(millis, '000') }`);
  }

  function dateToString(date, timeZone) {
    const dt = new Date(date);

    if (isNaN(dt.getTime())) {
      return 'NULL';
    }

    if (timeZone === 'local') {
      return formatDate(
        dt.getFullYear(),
        dt.getMonth() + 1,
        dt.getDate(),
        dt.getHours(),
        dt.getMinutes(),
        dt.getSeconds(),
        dt.getMilliseconds());
    }

    const tz = convertTimezone(timeZone);

    if (tz !== false && tz !== 0) {
      // eslint-disable-next-line no-magic-numbers
      dt.setTime(dt.getTime() + (tz * 60000));
    }

    return formatDate(
      dt.getUTCFullYear(),
      dt.getUTCMonth() + 1,
      dt.getUTCDate(),
      dt.getUTCHours(),
      dt.getUTCMinutes(),
      dt.getUTCSeconds(),
      dt.getUTCMilliseconds());
  }

  function escape(val, stringifyObjects, timeZone) {
    if (val === void 0 || val === null) {
      return 'NULL';
    }

    switch (typeof val) {
      case 'boolean':
        return (val) ? 'true' : 'false';
      case 'number':
        return `${ val }`;
      case 'object':
        break;
      default:
        return escapeString(val);
    }
    if (isSqlFragment(val)) {
      return val.content;
    }
    if (isSqlId(val)) {
      return escapeId(val.content);
    }
    if (val instanceof Date) {
      return dateToString(val, timeZone || 'local');
    }
    if (isBuffer(val)) {
      return bufferToString(val);
    }
    if (isSeries(val)) {
      return escapeSeries(val, (element) => escape(element, true, timeZone), true);
    }
    if (stringifyObjects) {
      return escapeString(val.toString());
    }
    // eslint-disable-next-line no-use-before-define
    return objectToValues(val, timeZone);
  }

  function objectToValues(obj, timeZone) {
    let sql = '';

    for (const key in obj) {
      const val = obj[key];

      if (typeof val === 'function') {
        continue;
      }

      sql += `${ (sql.length === 0 ? '' : ', ') + escapeId(key) } = ${ escape(val, true, timeZone) }`;
    }

    return sql;
  }

  return escape;
}

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
    const lcStrValue = strValue.toLowerCase();
    let embedHazard = lcStrValue.indexOf(delimiter) >= 0;
    if (!embedHazard) {
      const lastDollar = strValue.lastIndexOf('$');
      if (lastDollar >= 0) {
        const tail = lcStrValue.substring(lastDollar);
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
  mysql: Object.freeze({
    escape: mysqlEscape,
    escapeId: mysqlEscapeId,
    escapeDelimited: mysqlEscapeDelimited,
  }),
  pg: Object.freeze({
    escape: pgEscape,
    escapeId: pgEscapeId,
    escapeDelimited: pgEscapeDelimited,
  }),
});
