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

/* eslint no-inline-comments: 0 */

'use strict';

require('module-keys/cjs').polyfill(module, require, 'safesql/id.js');

const { TypedString } = require('template-tag-common');

class SqlId extends TypedString {}

// Define and export symbols before requiring escapers which require
// SqlId.
let mintId = null;
let escapeId = null;

function escape(str) {
  const escaped = escapeId(str, /* forbidQualified */ true);
  return mintId(escaped.substring(1, escaped.length - 1));
}

Object.defineProperties(
  SqlId,
  {
    'contractKey': {
      value: 'safesql/id',
      enumerable: true,
    },
    'escape': {
      value: escape,
      enumerable: true,
    },
  });

module.exports.SqlId = SqlId;

const escapers = require('./lib/escapers.js');
const { Mintable } = require('node-sec-patterns');

({ escapeId } = escapers);
mintId = require.keys.unbox(
  Mintable.minterFor(SqlId),
  () => true,
  (x) => x);
