<img align="right" src="https://cdn.rawgit.com/mikesamuel/template-tag-common/7f0159bda72d616af30645d49c3c9203c963c0a6/images/logo.png" alt="Sisyphus Logo">

# Safe SQL Template Tag

[![Build Status](https://travis-ci.org/mikesamuel/safesql.svg?branch=master)](https://travis-ci.org/mikesamuel/safesql)
[![Dependencies Status](https://david-dm.org/mikesamuel/safesql/status.svg)](https://david-dm.org/mikesamuel/safesql)
[![npm](https://img.shields.io/npm/v/safesql.svg)](https://www.npmjs.com/package/safesql)
[![Coverage Status](https://coveralls.io/repos/github/mikesamuel/safesql/badge.svg?branch=master)](https://coveralls.io/github/mikesamuel/safesql?branch=master)
[![Install Size](https://packagephobia.now.sh/badge?p=safesql)](https://packagephobia.now.sh/result?p=safesql)
[![Known Vulnerabilities](https://snyk.io/test/github/mikesamuel/safesql/badge.svg?targetFile=package.json)](https://snyk.io/test/github/mikesamuel/safesql?targetFile=package.json)

Provides a string template tag that makes it easy to compose
[MySQL][mysql] and [PostgreSQL][pg] query strings from untrusted
inputs by escaping dynamic values based on the context in which they
appear.

<!-- scripts/make-md-toc.pl replaces the below and test/check-markdown.js keeps this up-to-date. -->

<!-- TOC -->

*  [Installation](#installation)
*  [Usage By Example](#usage)
   *  [`sql` returns a *SqlFragment*](#sql-returns-sqlfragment)
   *  [No excess quotes](#minimal-quotes)
   *  [Escaped backticks delimit SQL identifiers](#escaped-backticks)
   *  [Escape Sequences are Raw](#raw-escapes)
*  [API](#API)
   *  [sql(options)](#sql-options)
   *  [sql\`...\`](#sql-as-tag)
   *  [SqlFragment](#class-SqlFragment)
   *  [SqlId](#class-SqlId)

<!-- /TOC -->

## Installation     <a name="installation"></a>

```bash
$ npm install safesql
```

## Supported Databases     <a name="supported"></a>

**MySQL** via

```js
const { mysql } = require('safesql');
```

**PostgreSQL** via

```js
const { pg } = require('safesql');
```


## Usage By Example        <a name="usage"></a>

<!--

This mirrors a testcase in ./test/example-test.js so if you modify this,
be sure to reflect changes there.

-->

```js
const { mysql, SqlId } = require('safesql');

const table = 'table';
const ids   = [ 'x', 'y', 'z' ];
const str   = 'foo\'\"bar';

const query = mysql`SELECT * FROM \`${ table }\` WHERE id IN (${ ids }) AND s=${ str }`;

console.log(query);
// SELECT * FROM `table` WHERE id IN ('x', 'y', 'z') AND s='foo''"bar'
```

`mysql` functions as a template tag.

Commas separate elements of arrays in the output.

`mysql` treats a `${...}` between backticks (<tt>\\\`</tt>) as a SQL identifier.

A `${...}` outside any quotes will be escaped and wrapped in appropriate quotes if necessary.

----

```js
const { pg, SqlId } = require('safesql');

const table = 'table';
const ids   = [ 'x', 'y', 'z' ];
const str   = 'foo\'\"bar';

const query = pg`SELECT * FROM "${ table }" WHERE id IN (${ ids }) AND s=${ str }`;

console.log(query);
// SELECT * FROM "table" WHERE id IN ('x', 'y', 'z') AND s='foo''"bar'
```

----

```js
const { mysql } = require('safesql');

const column  = 'users';
const userId  = 1;
const data    = {
  email:    'foobar@example.com',
  modified: mysql`NOW()`
};
const query = mysql`UPDATE \`${column}\` SET ${data} WHERE \`id\` = ${userId}`;

console.log(query);
// UPDATE `users` SET `email` = 'foobar@example.com', `modified` = NOW() WHERE `id` = 1
```

You can pass in an object to relate columns to values as in a `SET` clause above.

The output of <tt>mysql\`...\`</tt> has type *SqlFragment* so the
`NOW()` function call is not re-escaped when used in `${data}`.

### `mysql` returns a *SqlFragment*        <a name="sql-returns-sqlfragment"></a>

Since `mysql` returns a *SqlFragment* you can chain uses:

```js
const { mysql } = require('safesql');

const data = { a: 1 };
const whereClause = mysql`WHERE ${data}`;
console.log(mysql`SELECT * FROM TABLE ${whereClause}`);
// SELECT * FROM TABLE WHERE `a` = 1
```

### No excess quotes        <a name="minimal-quotes"></a>

An interpolation in a quoted string will not insert excess quotes:

```js
const { mysql } = require('safesql')

console.log(mysql`SELECT '${ 'foo' }' `)
// SELECT 'foo'
console.log(mysql`SELECT ${ 'foo' } `)
// SELECT 'foo'
```

### Escaped backticks delimit SQL identifiers        <a name="escaped-backticks"></a>

Backticks end a template tag, so you need to escape backticks.

```js
const { mysql } = require('safesql')

console.log(mysql`SELECT \`${ 'id' }\` FROM \`TABLE\``)
// SELECT `id` FROM `TABLE`
```

### Escape Sequences are Raw        <a name="raw-escapes"></a>

Other escape sequences are raw.

```js
const { mysql } = require('safesql')

console.log(mysql`SELECT "\n"`)
// SELECT "\n"
```

## API        <a name="API"></a>

Assuming

```js
const { mysql, pg, SqlFragment, SqlId } = require('safesql')
```

### mysql(options)        <a name="mysql-options"></a>
### pgsql(options)        <a name="pg-options"></a>

When called with an options bundle instead of as a template tag,
`mysql` and `pg` return a template tag that uses those options.

The options object can contain any of
`{ stringifyObjects, timeZone, forbidQualified }` which have the
same meaning as when used with *[sqlstring][]*.

```js
const timeZone = 'GMT'
const date = new Date(Date.UTC(2000, 0, 1))

console.log(mysql({ timeZone })`SELECT ${date}`)
// SELECT '2000-01-01 00:00:00.000'
```

### mysql\`...\`         <a name="mysql-as-tag"></a>

When used as a template tag, chooses an appropriate escaping
convention for each `${...}` based on the context in which it appears.

`mysql` handles `${...}` inside quoted strings as if the template
matched the following grammar:

[![Railroad Diagram](docs/mysql-railroad.svg)](docs/mysql-railroad.svg)

### pg\`...\`         <a name="pg-as-tag"></a>

When used as a template tag, chooses an appropriate escaping
convention for each `${...}` based on the context in which it appears.

`pg` handles `${...}` inside quoted strings as if the template
matched the following grammar:

[![Railroad Diagram](docs/mysql-railroad.svg)](docs/ph-railroad.svg)

### SqlFragment       <a name="class-SqlFragment"></a>

*SqlFragment* is a [Mintable][] class that represents fragments of SQL
that are safe to send to a database.

See [minting][] for example on how to create instances, and why this is a
tad more involved than just using `new`.

### SqlId       <a name="class-SqlId"></a>

*SqlId* is a [Mintable][] class that represents a SQL identifier.

See [minting][] for example on how to create instances, and why this is a
tad more involved than just using `new`.

A `SqlId`'s content must be the raw text of a SQL identifier and
creators should not rely on case folding by the database client.


[mysql]: https://www.npmjs.com/package/mysql
[pg]: https://www.npmjs.com/package/pg
[sqlstring]: https://www.npmjs.com/package/sqlstring
[Mintable]: https://www.npmjs.com/package/node-sec-patterns
[minting]: https://www.npmjs.com/package/node-sec-patterns#creating-mintable-values
