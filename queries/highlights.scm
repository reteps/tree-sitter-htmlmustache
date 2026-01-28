; HTML
(html_tag_name) @tag
(html_erroneous_end_tag_name) @tag.error
(html_doctype) @constant
(html_attribute_name) @attribute
(html_attribute_value) @string
(html_comment) @comment

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

; Mustache
(mustache_tag_name) @variable
(mustache_identifier) @variable
(mustache_comment) @comment

[
  "{{"
  "}}"
  "{{{"
  "}}}"
  "{{!"
  "{{>"
  "{{#"
  "{{/"
  "{{^"
] @keyword
