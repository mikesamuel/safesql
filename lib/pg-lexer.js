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

// A simple lexer for Postgres SQL.
//
// https://www.postgresql.org/docs/9.0/static/sql-syntax-lexical.html
//
// -- line chars   line comment
// /* block */     block comment.  may nest: /* /* */ still in comment */
//
// "..."           identifier literal
// U&"..."         identifier literal with unicode escapes
// UESCAPE symbol  may follow U& string to override \ as escape character
//
// '...'           string literal
// E'...'          supports C-style escape sequences
// U&'...'         string literal with unicode escapes
// UESCAPE symbol  ditto
// B'...'          binary literal
// X'...'          hex literal
//
// $$...$$         string literal with no escaping convention
// $foo$...$foo$   string literal where "foo" may be any run of identifier chars


// eslint-disable-next-line no-use-before-define
exports.makeLexer = makeLexer;


const TOP_LEVEL_DELIMITER = new RegExp(
  // Line comment
  '--' +
  // or a block comment start
  '|/[*]' +
  // or an unescaped string start
  // Tag has the form of an unquoted identifier without embedded '$'.
  // TODO: should allow non-ascii identifiers.  Might need to normalize.
  '|[$](?:[a-zA-Z_][a-zA-Z_0-9]*)?[$]' +
  // or an identifier start
  '|(?:[Uu]&)?"' +
  // or an escaped string start
  '|(?:[Uu]&|[EeBbXx])?\'');

const LINE_COMMENT_BODY = /^[^\r\n]*/;

const BLOCK_COMMENT_TOKEN = /[*][/]|[/][*]/;

const ESC_DQ_STRING_BODY = /^(?:[^"\\]|""|\\.)*(")?/;
const ESC_SQ_STRING_BODY = /^(?:[^'\\]|''|\\.)*(')?/;

const SIMPLE_DQ_STRING_BODY = /^(?:[^"]|"")*(")?/;
const SIMPLE_SQ_STRING_BODY = /^(?:[^']|'')*(')?/;

const ESC_STRING_CONTINUATION = /^[\t\n\r ]*([/][*]|--|')?/;

const STRING_BODIES = {
  __proto__: null,
  '"': SIMPLE_DQ_STRING_BODY,
  'u&"': ESC_DQ_STRING_BODY,
  '\'': SIMPLE_SQ_STRING_BODY,
  'b\'': SIMPLE_SQ_STRING_BODY,
  'e\'': ESC_SQ_STRING_BODY,
  'u&\'': ESC_SQ_STRING_BODY,
  'x\'': SIMPLE_SQ_STRING_BODY,
};

const LAST_DELIMITER_CHARACTER_TO_HANDLER = {
  '-': (delimiter, chunk) => {
    // delimiter is --
    const match = LINE_COMMENT_BODY.exec(chunk);
    const remainder = chunk.substring(match[0].length);
    if (remainder) {
      return [ null, remainder ];
    }
    throw new Error(`Unterminated line comment: --${ chunk }`);
  },
  '*': (delimiter, chunk) => {
    // delimiter is '/*'.
    let depth = delimiter.length / 2;
    let remainder = chunk;
    while (remainder) {
      const match = BLOCK_COMMENT_TOKEN.exec(remainder);
      if (!match) {
        break;
      }
      remainder = remainder.substring(match.index + 2);
      if (match[0] === '/*') {
        ++depth;
      } else {
        // */
        --depth;
        if (!depth) {
          break;
        }
      }
    }
    if (depth) {
      throw new Error(`Unterminated block comment: /*${ chunk }`);
    }
    return [ null, remainder ];

    // TODO: Do we need to take into account nested "--".
    // soc.if.usp.br/manual/postgresql-doc-7.4/html/plpgsql-structure.html says
    // "double dash comments can be enclosed into a block comment and
    //  a double dash can hide the block comment delimiters /* and */."
  },
  '"': (delimiter, chunk) => {
    const match = STRING_BODIES[delimiter].exec(chunk);
    const remainder = chunk.substring(match[0].length);
    if (match[1]) {
      return [ null, remainder ];
    }
    if (match[0]) {
      return [ delimiter, remainder ];
    }
    throw new Error(`Incomplete escape sequence in ${ delimiter } delimited string at \`${ chunk }\``);
  },
  '\'': (delimiter, chunk) => {
    const match = STRING_BODIES[delimiter].exec(chunk);
    const remainder = chunk.substring(match[0].length);
    if (match[1]) {
      return [
        // 4.1.2.2. String Constants with C-style Escapes
        // (When continuing an escape string constant across lines,
        //  write E only before the first opening quote.)
        (delimiter === 'e\'' || delimiter === 'E\'') ? 'e' : null, // eslint-disable-line array-element-newline
        remainder,
      ];
    }
    if (match[0]) {
      return [ delimiter, remainder ];
    }
    throw new Error(`Incomplete escape sequence in ${ delimiter } delimited string at \`${ chunk }\``);
  },
  '$': (delimiter, chunk) => {
    // TODO: should this match be case insensitive?  $x$...$X$
    const i = chunk.indexOf(delimiter);
    if (i >= 0) {
      return [ null, chunk.substring(i + delimiter.length) ];
    }
    const lastDollar = chunk.lastIndexOf('$');
    if (lastDollar >= 0) {
      const suffix = chunk.substring(lastDollar);
      if (delimiter.indexOf(suffix) === 0) {
        // merge hazard
        throw new Error(`merge hazard '${ suffix }' at end of ${ delimiter } delimited string`);
      }
    }
    return [ delimiter, '' ];
  },
  // Special handler to detect e'...' continuations.  See 'e' case above.
  'e': (delimiter, chunk) => {
    let remainder = chunk;
    while (remainder) {
      const match = ESC_STRING_CONTINUATION.exec(remainder);
      let [ consumed, subdelim ] = match; // eslint-disable-line prefer-const
      if (!consumed) {
        return [ null, remainder ];
      }
      remainder = remainder.substring(consumed.length);
      if (subdelim) {
        if (subdelim === '\'') {
          return [ 'e\'', remainder ];
        }
        while (remainder && subdelim) {
          const handler = LAST_DELIMITER_CHARACTER_TO_HANDLER[subdelim[subdelim.length - 1]];
          [ subdelim, remainder ] = handler(subdelim, remainder);
        }
      }
    }
    return [ delimiter, remainder ];
  },
};

function replayError(fun) {
  let message = null;
  return (...args) => {
    if (message !== null) {
      throw new Error(message);
    }
    try {
      return fun(...args);
    } catch (exc) {
      message = `${ exc.message }`;
      throw exc;
    }
  };
}

function makeLexer() {
  let delimiter = null;
  let continuationAmbiguity = false;
  let chunkIndex = -1;

  function consumeFromLeft(remainder) {
    if (delimiter) {
      const lastChar = delimiter[delimiter.length - 1];
      if (lastChar !== '*' && lastChar !== '-') {
        continuationAmbiguity = false;
      }
      const handler = LAST_DELIMITER_CHARACTER_TO_HANDLER[lastChar];
      ([ delimiter, remainder ] = handler(delimiter, remainder));
    } else {
      const match = TOP_LEVEL_DELIMITER.exec(remainder);
      if (continuationAmbiguity) {
        const end = match ? match.index : remainder.length;
        if (/[^\t\n\r ]/.test(remainder.substring(0, end))) {
          continuationAmbiguity = false;
        }
      }
      if (!match) {
        return '';
      }
      [ delimiter ] = match;
      if (delimiter[0] !== '$') {
        // Empirically,
        // postgres=# SELECT $foo$bar$Foo$;
        // postgres$# $foo$;
        // ?column?
        // -----------
        //  bar$Foo$;+
        delimiter = delimiter.toLowerCase();
      }
      remainder = remainder.substring(match.index + delimiter.length);
    }
    return remainder;
  }

  function lexer(chunk) {
    if (chunk === null) {
      if (delimiter && delimiter !== 'e') {
        throw new Error(`Unclosed quoted string: ${ delimiter }`);
      }
      return delimiter;
    }

    ++chunkIndex;

    if (continuationAmbiguity && chunkIndex > 1) {
      // If any chunk besides the last contains a newline and
      // does not contain any non-whitespace or comment content,
      // then we have a continuation ambiguity.
      //
      // For example,
      //   pg`SELECT ${ x }
      //        ${ y }`
      // then we would have to know how ${ x } was escaped to
      // determine how to escape ${ y } because of a string
      // continuation corner-case:
      //
      // From https://www.postgresql.org/docs/9.0/static/sql-syntax-lexical.html
      //   "Two string constants that are only separated by whitespace with at
      //    least one newline are concatenated and effectively treated as if the
      //    string had been written as one constant."
      //
      //   "When continuing an escape string constant across lines, write E only
      //    before the first opening quote."
      //
      // To decide whether to wrap y using e'...' ${ y } we need to know about
      // ${ x }.
      throw new Error(
        // eslint-disable-next-line no-template-curly-in-string
        'Potential for ambiguous string continuation at `${ chunk }`.' +
        '  If you need string continuation start with an e\'...\' string.');
    }

    let remainder = `${ chunk }`;
    continuationAmbiguity = /[\n\r]/.test(chunk);
    while (remainder) {
      remainder = consumeFromLeft(remainder);
    }
    return delimiter;
  }

  return replayError(lexer);
}

module.exports.makeLexer = makeLexer;
