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

const BT_GLOBAL_REGEXP = /`/g;
const QUAL_GLOBAL_REGEXP = /\./g;
const DQ_GLOBAL_REGEXP = /"/g;
const CHARS_GLOBAL_REGEXP = /[\0\b\t\n\r\x1a"'\\$]/g; // eslint-disable-line no-control-regex
const MYSQL_QUAL_ID_FILTER_REGEXP = /^`(?:``|[^`]+)`(?!`|$)/;
const PG_QUAL_ID_FILTER_REGEXP = /^"(?:""|[^"]+)"(?!"|$)/;
const TZ_REGEXP = /([+\-\s])(\d\d):?(\d\d)?/;
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
  '\'': '\\\'',
  '\\': '\\\\',
  '$': '\\$',
};

const PG_CHARS_ESCAPE_MAP = {
  __proto__: null,
  // Avoid octal merge hazard.
  '\0': '\\x00',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\x1a',
  '"': '\\"',
  '\'': '\\\'',
  '\\': '\\\\',
  '$': '\\$',
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
  return `X'${ apply(Buffer.prototype.toString, buffer, [ 'hex' ]) }'`;
}


function makeEscapers(escapeId, escapeString) {
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
    if (Buffer.isBuffer(val)) {
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

  return {
    escape,
    escapeId,
  };
}


function mysqlEscapeId(val, forbidQualified) {
  if (typeof val === 'object') {
    if (isSqlId(val)) {
      const id = val.content;
      if (forbidQualified && MYSQL_QUAL_ID_FILTER_REGEXP.test(id)) {
        throw new Error(`Expected unqualified id, got ${ id }`);
      }
      return id;
    } else if (isSeries(val)) {
      return escapeSeries(val, (element) => mysqlEscapeId(element, forbidQualified), false);
    }
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

function pgEscapeId(val, forbidQualified) {
  if (typeof val === 'object') {
    if (isSqlId(val)) {
      const id = val.content;
      if (forbidQualified && PG_QUAL_ID_FILTER_REGEXP.test(id)) {
        throw new Error(`Expected unqualified id, got ${ id }`);
      }
      return id;
    } else if (isSeries(val)) {
      return escapeSeries(val, (element) => pgEscapeId(element, forbidQualified), false);
    }
  }
  if (forbidQualified) {
    return `"${ String(val).replace(DQ_GLOBAL_REGEXP, '""') }"`;
  }
  return `"${ String(val).replace(DQ_GLOBAL_REGEXP, '""').replace(QUAL_GLOBAL_REGEXP, '"."') }"`;
}

function pgEscapeString(val) {
  const str = `${ val }`;

  let chunkIndex = 0;
  let escapedVal = '';

  CHARS_GLOBAL_REGEXP.lastIndex = 0;
  for (let match; (match = CHARS_GLOBAL_REGEXP.exec(str));) {
    escapedVal += str.substring(chunkIndex, match.index) + PG_CHARS_ESCAPE_MAP[match[0]];
    chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex;
  }

  if (chunkIndex === 0) {
    // Nothing was escaped
    return `'${ str }'`;
  }

  // If there are any backslashes or quotes, we use e'...' style strings since
  // those allow a consistent scheme for escaping all string meta-characters so entail
  // the fewest assumptions.
  if (chunkIndex < str.length) {
    return `e'${ escapedVal }${ str.substring(chunkIndex) }'`;
  }

  return `e'${ escapedVal }'`;
}


module.exports = Object.freeze({
  mysql: Object.freeze(makeEscapers(mysqlEscapeId, mysqlEscapeString)),
  pg: Object.freeze(makeEscapers(pgEscapeId, pgEscapeString)),
});
