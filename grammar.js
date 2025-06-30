/**
 * @file HTML grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'html',

  extras: $ => [
    $.html_comment,
    /\s+/,
  ],

  externals: $ => [
    $._start_html_tag_name,
    $._script_start_html_tag_name,
    $._style_start_html_tag_name,
    $._end_html_tag_name,
    $.erroneous_end_html_tag_name,
    '/>',
    $._implicit_end_html_tag,
    // $.html_raw_text,
    $.html_comment,
    // TODO: fixup
    $._start_mustache_tag_name,
    $._end_mustache_tag_name,
    $._erroneous_end_mustache_tag_name,
    $.start_mustache_delimiter,
    $.end_mustache_delimiter,
    $._mustache_identifier,
    $._set_start_mustache_tag_name,
    $._set_end_mustache_tag_name,
    $._old_end_mustache_tag_name,
    $._mustache_comment,
    $.mustache_text,
    // Merged node types
    $.raw_text,
  ],

  rules: {
    document: $ => repeat($._node),

    doctype: $ => seq(
      '<!',
      alias($._doctype, 'doctype'),
      /[^>]+/,
      '>',
    ),

    _doctype: _ => /[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/,

    _node: $ => choice(
      // Handle Mustache statements first
      $._mustache_node,
      $._html_node,
    ),

    _html_node: $ => choice(
      $.doctype,
      $.entity,
      $.text,
      $.element,
      $.script_html_element,
      $.style_html_element,
      $.erroneous_end_html_tag,
    ),

    element: $ => choice(
      seq(
        $.start_tag,
        repeat($._node),
        choice($.end_html_tag, $._implicit_end_html_tag),
      ),
      $.self_closing_tag,
    ),

    script_html_element: $ => seq(
      alias($.script_start_tag, $.start_html_tag),
      optional($.raw_text),
      $.end_html_tag,
    ),

    style_html_element: $ => seq(
      alias($.style_start_tag, $.start_tag),
      optional($.raw_text),
      $.end_html_tag,
    ),

    start_html_tag: $ => seq(
      '<',
      alias($._start_html_tag_name, $.tag_name),
      repeat($.attribute),
      '>',
    ),

    script_start_tag: $ => seq(
      '<',
      alias($._script_start_html_tag_name, $.tag_name),
      repeat($.attribute),
      '>',
    ),

    style_start_tag: $ => seq(
      '<',
      alias($._style_start_html_tag_name, $.tag_name),
      repeat($.attribute),
      '>',
    ),

    self_closing_tag: $ => seq(
      '<',
      alias($._start_html_tag_name, $.tag_name),
      repeat($.attribute),
      '/>',
    ),

    end_html_tag: $ => seq(
      '</',
      alias($._end_html_tag_name, $.tag_name),
      '>',
    ),

    erroneous_end_html_tag: $ => seq(
      '</',
      $.erroneous_end_html_tag_name,
      '>',
    ),

    attribute: $ => seq(
      $.attribute_name,
      optional(seq(
        '=',
        choice(
          $.attribute_value,
          $.quoted_attribute_value,
        ),
      )),
    ),

    attribute_name: _ => /[^<>"'/=\s]+/,

    attribute_value: _ => /[^<>"'=\s]+/,

    // An entity can be named, numeric (decimal), or numeric (hexacecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    entity: _ => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});?/,

    quoted_attribute_value: $ => choice(
      seq('\'', optional(alias(/[^']+/, $.attribute_value)), '\''),
      seq('"', optional(alias(/[^"]+/, $.attribute_value)), '"'),
    ),

    text: _ => /[^<>&\s]([^<>&]*[^<>&\s])?/,
  
    // Mustache
    _mustache_node: ($) => choice(
      $.comment_statement,
      $._statement,
    ),

    comment_statement: ($) =>
      seq(
        alias($.start_mustache_delimiter, $._start_mustache_tag_name),
        "!",
        $._mustache_comment,
        alias($.end_mustache_delimiter, $._end_mustache_tag_name),
      ),

    _statement: ($) =>
      choice(
        $.triple_statement,
        $.ampersand_statement,
        $.section,
        $.inverted_section,
        $.interpolation_statement,
        $.set_delimiter_statement,
        $.partial_statement,
        $.mustache_text,
      ),
    interpolation_statement: ($) =>
      seq($.start_mustache_delimiter, $._expression, $.end_mustache_delimiter),
    triple_statement: ($) =>
      seq($.start_mustache_delimiter, "{", $._expression, "}", $.end_mustache_delimiter),
    ampersand_statement: ($) =>
      seq($.start_mustache_delimiter, "&", $._expression, $.end_mustache_delimiter),
    set_delimiter_statement: ($) =>
      seq(
        $.start_mustache_delimiter,
        "=",
        $._set_start_mustache_tag_name,
        /\s/,
        $._set_end_mustache_tag_name,
        "=",
        alias($._old_end_mustache_tag_name, $.end_mustache_delimiter),
      ),
    partial_statement: ($) =>
      seq(
        $.start_mustache_delimiter,
        ">",
        alias($._mustache_comment, $.partial_content),
        $.end_mustache_delimiter,
      ),

    section: ($) =>
      seq(
        $.section_begin,
        repeat($._statement),
        alias($._section_end, $.section_end),
      ),

    _section_end: ($) =>
      seq(
        $.start_mustache_delimiter,
        "/",
        choice(
          alias($._end_mustache_tag_name, $.tag_name),
          alias($._erroneous_end_mustache_tag_name, $.erroneous_tag_name),
        ),
        $.end_mustache_delimiter,
      ),

    section_begin: ($) =>
      seq(
        $.start_mustache_delimiter,
        "#",
        alias($._start_mustache_tag_name, $.tag_name),
        $.end_mustache_delimiter,
      ),

    inverted_section: ($) =>
      seq(
        $.inverted_section_begin,
        repeat($._statement),
        alias($._section_end, $.inverted_section_end),
      ),
    inverted_section_begin: ($) =>
      seq(
        $.start_mustache_delimiter,
        "^",
        alias($._start_mustache_tag_name, $.tag_name),
        $.end_mustache_delimiter,
      ),

    _expression: ($) => choice($.path_expression, $.identifier, "."),

    identifier: ($) => $._mustache_identifier,
    path_expression: ($) => seq($.identifier, repeat1(seq(".", $.identifier))),
  },
});
