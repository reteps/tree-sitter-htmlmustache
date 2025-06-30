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
    // Mustache externals
    $._mustache_start_tag_name,
    $._mustache_end_tag_name,
    $._mustache_erroneous_end_tag_name,
  ],

  rules: {
    document: $ => repeat($._node),

    html_doctype: $ => seq(
      '<!',
      alias($._html_doctype, 'doctype'),
      /[^>]+/,
      '>',
    ),

    _html_doctype: _ => /[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/,

    _node: $ => choice(
      $._html_node,
      $._mustache_node,
    ),

    _html_node: $ => choice(
      $.html_doctype,
      $.html_entity,
      $.html_element,
      $.html_script_element,
      $.html_style_element,
      $.html_erroneous_end_tag,
      $.text,
    ),

    _mustache_node: $ => choice(
      $.mustache_triple,
      $.mustache_comment,
      $.mustache_ampersand,
      $.mustache_partial,
      $.mustache_section,
      $.mustache_inverted_section,
      $.mustache_interpolation,
    ),
    // Mustache rules - order matters for parsing precedence
    mustache_triple: $ => seq(
      '{{{',
      $._mustache_expression,
      '}}}',
    ),

    mustache_comment: $ => seq(
      '{{!',
      $.mustache_comment_content,
      '}}',
    ),

    mustache_comment_content: $ => /[^}]*/,

    mustache_ampersand: $ => seq(
      '{{&',
      $._mustache_expression,
      '}}',
    ),

    mustache_partial: $ => seq(
      '{{>',
      /[^}]+/,
      '}}',
    ),

    mustache_interpolation: $ => seq(
      '{{',
      $._mustache_expression,
      '}}',
    ),

    mustache_section: $ => seq(
      $.mustache_section_begin,
      repeat($._node),
      choice($.mustache_section_end, $.mustache_erroneous_section_end),
    ),

    mustache_section_begin: $ => seq(
      '{{#',
      alias($._mustache_start_tag_name, $.mustache_tag_name),
      '}}',
    ),

    mustache_section_end: $ => seq(
      '{{/',
      alias($._mustache_end_tag_name, $.mustache_tag_name),
      '}}',
    ),

    mustache_erroneous_section_end: $ => seq(
      '{{/',
      alias($._mustache_erroneous_end_tag_name, $.mustache_erroneous_tag_name),
      '}}',
    ),

    mustache_inverted_section: $ => seq(
      $.mustache_inverted_section_begin,
      repeat($._node),
      choice($.mustache_inverted_section_end, $.mustache_erroneous_inverted_section_end),
    ),

    mustache_inverted_section_begin: $ => seq(
      '{{^',
      alias($._mustache_start_tag_name, $.mustache_tag_name),
      '}}',
    ),

    mustache_inverted_section_end: $ => seq(
      '{{/',
      alias($._mustache_end_tag_name, $.mustache_tag_name),
      '}}',
    ),

    mustache_erroneous_inverted_section_end: $ => seq(
      '{{/',
      alias($._mustache_erroneous_end_tag_name, $.mustache_erroneous_tag_name),
      '}}',
    ),

    _mustache_expression: $ => choice(
      $.mustache_path_expression,
      $.mustache_identifier,
      '.',
    ),

    mustache_identifier: $ => /[a-zA-Z_][a-zA-Z0-9_-]*/,

    mustache_path_expression: $ => seq(
      $.mustache_identifier,
      repeat1(seq('.', $.mustache_identifier)),
    ),

    html_element: $ => choice(
      seq(
        $.html_start_tag,
        repeat($._node),
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
      alias($._html_start_tag_name, $.html_tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_script_start_tag: $ => seq(
      '<',
      alias($._html_script_start_tag_name, $.html_tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_style_start_tag: $ => seq(
      '<',
      alias($._html_style_start_tag_name, $.html_tag_name),
      repeat($.html_attribute),
      '>',
    ),

    html_self_closing_tag: $ => seq(
      '<',
      alias($._html_start_tag_name, $.html_tag_name),
      repeat($.html_attribute),
      '/>',
    ),

    html_end_tag: $ => seq(
      '</',
      alias($._html_end_tag_name, $.html_tag_name),
      '>',
    ),

    html_erroneous_end_tag: $ => seq(
      '</',
      $.html_erroneous_end_tag_name,
      '>',
    ),

    html_attribute: $ => choice(
      $.mustache_section_attribute,
      $.mustache_inverted_section_attribute,
      seq(
        $.html_attribute_name,
        optional(seq(
          '=',
          choice(
            $.html_attribute_value,
            $.html_quoted_attribute_value,
            $.mustache_interpolation,
          ),
        )),
      ),
    ),

    mustache_inverted_section_attribute: $ => seq(
      $.mustache_inverted_section_begin,
      repeat(choice($._mustache_node, $.text)),
      $.mustache_inverted_section_end,
    ),
    mustache_section_attribute: $ => seq(
      $.mustache_section_begin,
      repeat(choice($._mustache_node, $.text)),
      $.mustache_section_end,
    ),

    html_attribute_name: _ => /[^<>{}"'/=\s]+/,

    html_attribute_value: _ => /[^<>"'=\s]+/,

    // An entity can be named, numeric (decimal), or numeric (hexacecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    html_entity: _ => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});?/,

    html_quoted_attribute_value: $ => choice(
      seq('\'', repeat(choice(
        alias(/[^'{]+/, $.html_attribute_value),
        $.mustache_interpolation,
        // TODO: label this correctly
        seq(
          $.mustache_inverted_section_begin,
          repeat(choice($._mustache_node, alias(/[^'{]+/, $.html_attribute_value))),
          $.mustache_inverted_section_end,
        ),
        seq(
          $.mustache_section_begin,
          repeat(choice($._mustache_node, alias(/[^'{]+/, $.html_attribute_value))),
          $.mustache_section_end,
        ),
      )), '\''),
      seq('"', repeat(choice(
        alias(/[^"{]+/, $.html_attribute_value),
        $.mustache_interpolation,
        seq(
          $.mustache_inverted_section_begin,
          repeat(choice($._mustache_node, alias(/[^"{]+/, $.html_attribute_value))),
          $.mustache_inverted_section_end,
        ),
        seq(
          $.mustache_section_begin,
          repeat(choice($._mustache_node, alias(/[^"{]+/, $.html_attribute_value))),
          $.mustache_section_end,
        ),
      )), '"'),
    ),

    text: _ => /[^<>{}&\s]([^<>{}&]*[^<>{}&\s])?/,
  },
});
