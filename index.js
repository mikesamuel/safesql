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

require('module-keys/cjs').polyfill(module, require);

const { SqlFragment } = require('./lib/fragment.js');
const { SqlId } = require('./lib/id.js');
const { makeSqlTagFunction } = require('./lib/tag-fn.js');
const { Mintable } = require('node-sec-patterns');

const mintSqlFragment = require.moduleKeys.unbox(
  Mintable.minterFor(SqlFragment),
  () => true,
  String);

let mysql = null;
let pg = null; // eslint-disable-line id-length

Object.defineProperties(module.exports, {
  mysql: {
    // Lazily load MySQL machinery since
    // PG users are unlikely to use MySQL and vice-versa.
    get() {
      if (!mysql) {
        // eslint-disable-next-line global-require
        const lexer = require('./lib/mysql-lexer.js');
        // eslint-disable-next-line global-require
        const { escape, escapeDelimited } = require('./lib/mysql-escaper.js');
        mysql = makeSqlTagFunction(
          lexer, escape, escapeDelimited, true, mintSqlFragment);
      }
      return mysql;
    },
    enumerable: true,
  },
  pg: {
    get() {
      if (!pg) {
        // eslint-disable-next-line global-require
        const lexer = require('./lib/pg-lexer.js');
        // eslint-disable-next-line global-require
        const { escape, escapeDelimited } = require('./lib/pg-escaper.js');
        pg = makeSqlTagFunction(
          lexer, escape, escapeDelimited, false, mintSqlFragment);
      }
      return pg;
    },
    enumerable: true,
  },
  SqlId: {
    value: SqlId,
    enumerable: true,
  },
  SqlFragment: {
    value: SqlFragment,
    enumerable: true,
  },
});
