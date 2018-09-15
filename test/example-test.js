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

const { mysql, pg } = require('../index.js');

describe('example code', () => {
  describe('README.md', () => {
    // These mirror example code in ../README.md so if you modify this,
    // be sure to reflect changes there.

    describe('SELECT various', () => {
      it('mysql', () => {
        const table = 'table';
        const ids = [ 'x', 'y', 'z' ];
        const str = 'foo\'"bar';

        const query = mysql`SELECT * FROM \`${ table }\` WHERE id IN (${ ids }) AND s=${ str }`;

        expect(query.content).to.equal(
          'SELECT * FROM `table` WHERE id IN (\'x\', \'y\', \'z\') AND s=\'foo\\\'\\"bar\'');
      });
      it('pg', () => {
        const table = 'table';
        const ids = [ 'x', 'y', 'z' ];
        const str = 'foo\'"bar';

        const query = pg`SELECT * FROM "${ table }" WHERE id IN (${ ids }) AND s=${ str }`;

        expect(query.content).to.equal(
          String.raw`SELECT * FROM "table" WHERE id IN ('x', 'y', 'z') AND s=e'foo''\"bar'`);
      });
    });
    it('UPDATE obj', () => {
      const column = 'users';
      const userId = 1;
      const data = {
        email: 'foobar@example.com',
        modified: mysql`NOW()`,
      };
      const query = mysql`UPDATE \`${ column }\` SET ${ data } WHERE \`id\` = ${ userId }`;

      expect(query.content).to.equal(
        'UPDATE `users` SET `email` = \'foobar@example.com\', `modified` = NOW() WHERE `id` = 1');
    });
    it('chains', () => {
      const data = { a: 1 };
      const whereClause = mysql`WHERE ${ data }`;
      expect(mysql`SELECT * FROM TABLE ${ whereClause }`.content).to.equal(
        'SELECT * FROM TABLE WHERE `a` = 1');
    });
    it('no excess quotes', () => {
      expect(mysql`SELECT '${ 'foo' }' `.content).to.equal('SELECT \'foo\' ');
      expect(mysql`SELECT ${ 'foo' } `.content).to.equal('SELECT \'foo\' ');
    });
    it('backtick delimited', () => {
      expect(mysql`SELECT \`${ 'id' }\` FROM \`TABLE\``.content).to.equal(
        'SELECT `id` FROM `TABLE`');
    });
    it('raw escapes', () => {
      expect(mysql`SELECT "\n"`.content)
        .to.equal(String.raw`SELECT "\n"`);
    });
    it('dates', () => {
      const timeZone = 'GMT';
      const date = new Date(Date.UTC(2000, 0, 1)); // eslint-disable-line no-magic-numbers
      expect(mysql({ timeZone })`SELECT ${ date }`.content)
        .to.equal('SELECT \'2000-01-01 00:00:00.000\'');
    });
  });
});
