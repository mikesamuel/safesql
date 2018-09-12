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

/* eslint "id-length": 0, "id-blacklist": 0 */

'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');

const { sql } = require('../index.js');
const { SqlId } = require('../id.js');

describe('example code', () => {
  describe('README.md', () => {
    // These mirror example code in ../README.md so if you modify this,
    // be sure to reflect changes there.

    it('SELECT various', () => {
      const ids = [ SqlId.escape('x'), SqlId.escape('y') ];
      const table = 'table';
      const id = 'foo\'"bar';

      const query = sql`SELECT (${ ids }) FROM \`${ table }\` WHERE id=${ id }`;

      expect(query.content).to.equal(
        'SELECT (`x`, `y`) FROM `table` WHERE id=\'foo\\\'\\"bar\'');
    });
    it('UPDATE obj', () => {
      const column = 'users';
      const userId = 1;
      const data = {
        email: 'foobar@example.com',
        modified: sql`NOW()`,
      };
      const query = sql`UPDATE \`${ column }\` SET ${ data } WHERE \`id\` = ${ userId }`;

      expect(query.content).to.equal(
        'UPDATE `users` SET `email` = \'foobar@example.com\', `modified` = NOW() WHERE `id` = 1');
    });
    it('chains', () => {
      const data = { a: 1 };
      const whereClause = sql`WHERE ${ data }`;
      expect(sql`SELECT * FROM TABLE ${ whereClause }`.content).to.equal(
        'SELECT * FROM TABLE WHERE `a` = 1');
    });
    it('no excess quotes', () => {
      expect(sql`SELECT '${ 'foo' }' `.content).to.equal('SELECT \'foo\' ');
      expect(sql`SELECT ${ 'foo' } `.content).to.equal('SELECT \'foo\' ');
    });
    it('backtick delimited', () => {
      expect(sql`SELECT \`${ 'id' }\` FROM \`TABLE\``.content).to.equal(
        'SELECT `id` FROM `TABLE`');
    });
    it('raw escapes', () => {
      expect(sql`SELECT "\n"`.content).to.equal(
        String.raw`SELECT "\n"`);
    });
  });
});
