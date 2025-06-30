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
    $._html_start_tag_name,
    $._html_script_start_tag_name,
    $._html_style_start_tag_name,
    $._html_end_tag_name,
    $.html_erroneous_end_tag_name,
    '/>',
    $._html_implicit_end_tag,
    $.html_raw_text,
    $.html_comment,
  ],

  rules: {
    document: $ => repeat($._html_node),

    html_doctype: $ => seq(
      '<!',
      alias($._html_doctype, 'doctype'),
      /[^>]+/,
      '>',
    ),

    _html_doctype: _ => /[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/,

    _html_node: $ => choice(
      $.html_doctype,
      $.html_entity,
      $.html_text,
      $.html_element,
      $.html_script_element,
      $.html_style_element,
      $.html_erroneous_end_tag,
    ),

    html_element: $ => choice(
      seq(
        $.html_start_tag,
        repeat($._html_node),
        choice($.html_end_tag, $._html_implicit_end_tag),
      ),
      $.html_self_closing_tag,
    ),

    html_script_element: $ => seq(
      alias($.html_script_start_tag, $.html_start_tag),
      optional($.html_raw_text),
      $.html_end_tag,
    ),

    html_style_element: $ => seq(
      alias($.html_style_start_tag, $.html_start_tag),
      optional($.html_raw_text),
      $.html_end_tag,
    ),

    html_start_tag: $ => seq(
      '<',
      alias($._html_start_tag_name, $.tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_script_start_tag: $ => seq(
      '<',
      alias($._html_script_start_tag_name, $.tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_style_start_tag: $ => seq(
      '<',
      alias($._html_style_start_tag_name, $.tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_self_closing_tag: $ => seq(
      '<',
      alias($._html_start_tag_name, $.tag_name),
      repeat($.html_attribute),
      '/>',
    ),

    html_end_tag: $ => seq(
      '</',
      alias($._html_end_tag_name, $.tag_name),
      '>',
    ),

    html_erroneous_end_tag: $ => seq(
      '</',
      $.html_erroneous_end_tag_name,
      '>',
    ),

    html_attribute: $ => seq(
      $.html_attribute_name,
      optional(seq(
        '=',
        choice(
          $.html_attribute_value,
          $.html_quoted_attribute_value,
        ),
      )),
    ),

    html_attribute_name: _ => /[^<>"'/=\s]+/,

    html_attribute_value: _ => /[^<>"'=\s]+/,

    // An entity can be named, numeric (decimal), or numeric (hexacecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    html_entity: _ => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});?/,

    html_quoted_attribute_value: $ => choice(
      seq('\'', optional(alias(/[^']+/, $.html_attribute_value)), '\''),
      seq('"', optional(alias(/[^"]+/, $.html_attribute_value)), '"'),
    ),

    html_text: _ => /[^<>&\s]([^<>&]*[^<>&\s])?/,
  },
});
