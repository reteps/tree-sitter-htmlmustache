#include "tag.h"
#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    START_HTML_TAG_NAME,
    SCRIPT_START_HTML_TAG_NAME,
    STYLE_START_HTML_TAG_NAME,
    END_HTML_TAG_NAME,
    ERRONEOUS_END_HTML_TAG_NAME,
    SELF_CLOSING_TAG_DELIMITER,
    IMPLICIT_END_HTML_TAG,
    HTML_COMMENT,
    RAW_HTML_TEXT,
    // Mustache
    START_MUSTACHE_TAG_NAME,
    END_MUSTACHE_TAG_NAME,
    ERRONEOUS_END_MUSTACHE_TAG_NAME,
    START_MUSTACHE_DELIMITER,
    END_MUSTACHE_DELIMITER,
    MUSTACHE_COMMENT,
    MUSTACHE_IDENTIFIER,
    SET_START_MUSTACHE_DELIMITER,
    SET_END_MUSTACHE_DELIMITER,
    OLD_END_MUSTACHE_DELIMITER,
    MUSTACHE_TEXT,
    // Merged node types
};

#define DEFAULT_START_DELIMITER '{'
#define DEFAULT_END_DELIMITER '}'
#define DEFAULT_SIZE 2

typedef struct {
    Array(Tag) tags;
    String start_mustache_delimiter;
    String end_mustache_delimiter;
    String old_end_mustache_delimiter;
} Scanner;

#define MAX(a, b) ((a) > (b) ? (a) : (b))

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static unsigned serialize(Scanner *scanner, char *buffer) {
    uint16_t tag_count = scanner->tags.size > UINT16_MAX ? UINT16_MAX : scanner->tags.size;
    uint16_t serialized_tag_count = 0;

    unsigned size = sizeof(tag_count);
    memcpy(&buffer[size], &tag_count, sizeof(tag_count));
    size += sizeof(tag_count);

    for (; serialized_tag_count < tag_count; serialized_tag_count++) {
        Tag tag = scanner->tags.contents[serialized_tag_count];
        if (tag.type == CUSTOM) {
            unsigned name_length = tag.custom_tag_name.size;
            if (name_length > UINT8_MAX) {
                name_length = UINT8_MAX;
            }
            if (size + 2 + name_length >= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
                break;
            }
            buffer[size++] = (char)tag.type;
            buffer[size++] = (char)name_length;
            strncpy(&buffer[size], tag.custom_tag_name.contents, name_length);
            size += name_length;
        } else {
            if (size + 1 >= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
                break;
            }
            buffer[size++] = (char)tag.type;
        }
    }

    memcpy(&buffer[0], &serialized_tag_count, sizeof(serialized_tag_count));
    return size;
}

static void deserialize(Scanner *scanner, const char *buffer, unsigned length) {
    for (unsigned i = 0; i < scanner->tags.size; i++) {
        tag_free(&scanner->tags.contents[i]);
    }
    array_clear(&scanner->tags);

    if (length > 0) {
        unsigned size = 0;
        uint16_t tag_count = 0;
        uint16_t serialized_tag_count = 0;

        memcpy(&serialized_tag_count, &buffer[size], sizeof(serialized_tag_count));
        size += sizeof(serialized_tag_count);

        memcpy(&tag_count, &buffer[size], sizeof(tag_count));
        size += sizeof(tag_count);

        array_reserve(&scanner->tags, tag_count);
        if (tag_count > 0) {
            unsigned iter = 0;
            for (iter = 0; iter < serialized_tag_count; iter++) {
                Tag tag = tag_new();
                tag.type = (TagType)buffer[size++];
                if (tag.type == CUSTOM) {
                    uint16_t name_length = (uint8_t)buffer[size++];
                    array_reserve(&tag.custom_tag_name, name_length);
                    tag.custom_tag_name.size = name_length;
                    memcpy(tag.custom_tag_name.contents, &buffer[size], name_length);
                    size += name_length;
                }
                array_push(&scanner->tags, tag);
            }
            // add zero tags if we didn't read enough, this is because the
            // buffer had no more room but we held more tags.
            for (; iter < tag_count; iter++) {
                array_push(&scanner->tags, tag_new());
            }
        }
    }
}

static int get_mustache_delimiter(String delimiter, uint32_t i, char def) {
  if (delimiter.size >= i + 1)
    return *array_get(&delimiter, i);
  return def;
}

static String scan_mustache_tag_name(Scanner *scanner, TSLexer *lexer) {
  String tag_name = array_new();
  char first = get_mustache_delimiter(scanner->end_mustache_delimiter, 0, DEFAULT_END_DELIMITER);
  while (lexer->lookahead != first && !lexer->eof(lexer)) {
    if (iswspace(lexer->lookahead))
      break;

    array_push(&tag_name, lexer->lookahead);
    lexer->advance(lexer, false);
  }
  return tag_name;
}

static String scan_html_tag_name(TSLexer *lexer) {
    String tag_name = array_new();
    while (iswalnum(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == ':') {
        array_push(&tag_name, towupper(lexer->lookahead));
        advance(lexer);
    }
    return tag_name;
}

static bool scan_comment(TSLexer *lexer) {
    if (lexer->lookahead != '-') {
        return false;
    }
    advance(lexer);
    if (lexer->lookahead != '-') {
        return false;
    }
    advance(lexer);

    unsigned dashes = 0;
    while (lexer->lookahead) {
        switch (lexer->lookahead) {
            case '-':
                ++dashes;
                break;
            case '>':
                if (dashes >= 2) {
                    lexer->result_symbol = HTML_COMMENT;
                    advance(lexer);
                    lexer->mark_end(lexer);
                    return true;
                }
            default:
                dashes = 0;
        }
        advance(lexer);
    }
    return false;
}

static bool scan_raw_text(Scanner *scanner, TSLexer *lexer) {
    if (scanner->tags.size == 0) {
        return false;
    }

    lexer->mark_end(lexer);

    const char *end_delimiter = array_back(&scanner->tags)->type == SCRIPT ? "</SCRIPT" : "</STYLE";

    unsigned delimiter_index = 0;
    while (lexer->lookahead) {
        if (towupper(lexer->lookahead) == end_delimiter[delimiter_index]) {
            delimiter_index++;
            if (delimiter_index == strlen(end_delimiter)) {
                break;
            }
            advance(lexer);
        } else {
            delimiter_index = 0;
            advance(lexer);
            lexer->mark_end(lexer);
        }
    }

    lexer->result_symbol = RAW_HTML_TEXT;
    return true;
}

static void pop_tag(Scanner *scanner) {
    Tag popped_tag = array_pop(&scanner->tags);
    tag_free(&popped_tag);
}

static bool scan_implicit_end_html_tag(Scanner *scanner, TSLexer *lexer) {
    Tag *parent = scanner->tags.size == 0 ? NULL : array_back(&scanner->tags);

    bool is_closing_tag = false;
    if (lexer->lookahead == '/') {
        is_closing_tag = true;
        advance(lexer);
    } else {
        if (parent && tag_is_void(parent)) {
            pop_tag(scanner);
            lexer->result_symbol = IMPLICIT_END_HTML_TAG;
            return true;
        }
    }

    String tag_name = scan_html_tag_name(lexer);
    if (tag_name.size == 0 && !lexer->eof(lexer)) {
        array_delete(&tag_name);
        return false;
    }

    Tag next_tag = tag_for_name(tag_name);

    if (is_closing_tag) {
        // The tag correctly closes the topmost element on the stack
        if (scanner->tags.size > 0 && tag_eq(array_back(&scanner->tags), &next_tag)) {
            tag_free(&next_tag);
            return false;
        }

        // Otherwise, dig deeper and queue implicit end tags (to be nice in
        // the case of malformed HTML)
        for (unsigned i = scanner->tags.size; i > 0; i--) {
            if (scanner->tags.contents[i - 1].type == next_tag.type) {
                pop_tag(scanner);
                lexer->result_symbol = IMPLICIT_END_HTML_TAG;
                tag_free(&next_tag);
                return true;
            }
        }
    } else if (
        parent &&
        (
            !tag_can_contain(parent, &next_tag) ||
            ((parent->type == HTML || parent->type == HEAD || parent->type == BODY) && lexer->eof(lexer))
        )
    ) {
        pop_tag(scanner);
        lexer->result_symbol = IMPLICIT_END_HTML_TAG;
        tag_free(&next_tag);
        return true;
    }

    tag_free(&next_tag);
    return false;
}

static bool scan_start_mustache_tag_name(Scanner *scanner, TSLexer *lexer) {
  String tag_name = scan_mustache_tag_name(scanner, lexer);
  if (tag_name.size == 0) {
    array_delete(&tag_name);
    return false;
  }

  Tag tag = tag_new();
  tag.custom_tag_name = tag_name;
  array_push(&scanner->tags, tag);
  lexer->result_symbol = START_MUSTACHE_TAG_NAME;
  return true;
}

static bool scan_end_mustache_tag_name(Scanner *scanner, TSLexer *lexer) {
  String tag_name = scan_mustache_tag_name(scanner, lexer);

  if (tag_name.size == 0) {
    array_delete(&tag_name);
    return false;
  }

  Tag tag = tag_new();
  tag.custom_tag_name = tag_name;
  if (scanner->tags.size > 0 && tag_eq(array_back(&scanner->tags), &tag)) {
    pop_tag(scanner);
    lexer->result_symbol = END_MUSTACHE_TAG_NAME;
  } else {
    lexer->result_symbol = ERRONEOUS_END_MUSTACHE_TAG_NAME;
  }

  tag_free(&tag);
  return true;
}

static bool scan_start_mustache_delimiter(Scanner *scanner, TSLexer *lexer) {
  int start_delimiter_max = scanner->start_mustache_delimiter.size == 0
                                ? DEFAULT_SIZE
                                : scanner->start_mustache_delimiter.size;
  for (int i = 0; i < start_delimiter_max; i++) {
    int current_delimiter =
        get_mustache_delimiter(scanner->start_mustache_delimiter, i, DEFAULT_START_DELIMITER);
    if (lexer->lookahead != current_delimiter) {
      return false;
    }
    lexer->advance(lexer, false);
  }

  lexer->result_symbol = START_MUSTACHE_DELIMITER;
  return true;
}

static bool scan_end_mustache_delimiter(Scanner *scanner, TSLexer *lexer) {
  int end_delimiter_max = scanner->end_mustache_delimiter.size == 0
                              ? DEFAULT_SIZE
                              : scanner->end_mustache_delimiter.size;
  for (int i = 0; i < end_delimiter_max; i++) {
    int current_delimiter =
        get_mustache_delimiter(scanner->end_mustache_delimiter, i, DEFAULT_END_DELIMITER);
    if (lexer->lookahead != current_delimiter) {
      return false;
    }
    lexer->advance(lexer, false);
  }

  lexer->result_symbol = END_MUSTACHE_DELIMITER;
  return true;
}

static bool scan_mustache_identifier(Scanner *scanner, TSLexer *lexer) {
  int first_end =
      get_mustache_delimiter(scanner->end_mustache_delimiter, 0, DEFAULT_END_DELIMITER);
  lexer->advance(lexer, false);
  while (lexer->lookahead != first_end && lexer->lookahead != '.') {
    if (lexer->eof(lexer))
      return false;
    if (iswspace(lexer->lookahead))
      break;

    lexer->advance(lexer, false);
  }
  lexer->result_symbol = MUSTACHE_IDENTIFIER;
  return true;
}

static bool scan_start_mustache_delimiter_content(Scanner *scanner, TSLexer *lexer) {
  String content = array_new();
  while (!iswspace(lexer->lookahead)) {
    if (lexer->lookahead == '=' || lexer->eof(lexer)) {
      array_delete(&content);
      return false;
    }
    array_push(&content, lexer->lookahead);
    lexer->advance(lexer, false);
  }
  if (content.size == 0) {
    array_delete(&content);
    return false;
  }

  array_delete(&scanner->start_mustache_delimiter);
  scanner->start_mustache_delimiter = content;
  lexer->result_symbol = SET_START_MUSTACHE_DELIMITER;
  return true;
}

static bool scan_end_mustache_delimiter_content(Scanner *scanner, TSLexer *lexer) {
  String content = array_new();
  while (lexer->lookahead != '=') {
    if (iswspace(lexer->lookahead) || lexer->eof(lexer)) {
      array_delete(&content);
      return false;
    }
    array_push(&content, lexer->lookahead);
    lexer->advance(lexer, false);
  }
  if (content.size == 0) {
    array_delete(&content);
    return false;
  }

  array_delete(&scanner->old_end_mustache_delimiter);
  scanner->old_end_mustache_delimiter = scanner->end_mustache_delimiter;
  scanner->end_mustache_delimiter = content;
  lexer->result_symbol = SET_END_MUSTACHE_DELIMITER;
  return true;
}

static bool scan_old_end_mustache_delimiter(Scanner *scanner, TSLexer *lexer) {
  int old_end_delimiter_max = scanner->old_end_mustache_delimiter.size == 0
                                  ? DEFAULT_SIZE
                                  : scanner->old_end_mustache_delimiter.size;
  for (int i = 0; i < old_end_delimiter_max; i++) {
    int current_delimiter =
        get_mustache_delimiter(scanner->old_end_mustache_delimiter, i, DEFAULT_END_DELIMITER);
    if (lexer->lookahead != current_delimiter) {
      return false;
    }
    lexer->advance(lexer, false);
  }

  lexer->result_symbol = OLD_END_MUSTACHE_DELIMITER;
  return true;
}

static bool scan_start_html_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_html_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    Tag tag = tag_for_name(tag_name);
    array_push(&scanner->tags, tag);
    switch (tag.type) {
        case SCRIPT:
            lexer->result_symbol = SCRIPT_START_HTML_TAG_NAME;
            break;
        case STYLE:
            lexer->result_symbol = STYLE_START_HTML_TAG_NAME;
            break;
        default:
            printf("START_HTML_TAG_NAME\n");
            lexer->result_symbol = START_HTML_TAG_NAME;
            break;
    }
    return true;
}

static bool scan_end_html_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_html_tag_name(lexer);

    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    Tag tag = tag_for_name(tag_name);
    if (scanner->tags.size > 0 && tag_eq(array_back(&scanner->tags), &tag)) {
        pop_tag(scanner);
        lexer->result_symbol = END_HTML_TAG_NAME;
    } else {
        lexer->result_symbol = ERRONEOUS_END_HTML_TAG_NAME;
    }

    tag_free(&tag);
    return true;
}

static bool scan_self_closing_html_tag_delimiter(Scanner *scanner, TSLexer *lexer) {
    advance(lexer);
    if (lexer->lookahead == '>') {
        advance(lexer);
        if (scanner->tags.size > 0) {
            pop_tag(scanner);
            lexer->result_symbol = SELF_CLOSING_TAG_DELIMITER;
        }
        return true;
    }
    return false;
}


static bool scan_mustache_comment(Scanner *scanner, TSLexer *lexer) {
  int first = get_mustache_delimiter(scanner->end_mustache_delimiter, 0, DEFAULT_END_DELIMITER);
  printf("is_mustache_comment: %c\n", first);
  while (lexer->lookahead != first) {
    if (lexer->eof(lexer)) {
        printf("is_mustache_comment: eof\n");
      return false;
    }
    lexer->advance(lexer, false);
  }
  lexer->result_symbol = MUSTACHE_COMMENT;
  printf("MUSTACHE_COMMENT\n");
  return true;
}

static bool scan_mustache_text(Scanner *scanner, TSLexer *lexer) {
  // don't increase the size of the token on advance
  lexer->mark_end(lexer);
  int start_delimiter_max = scanner->start_mustache_delimiter.size == 0
                                ? DEFAULT_SIZE
                                : scanner->start_mustache_delimiter.size;
  int end_delimiter_max = scanner->end_mustache_delimiter.size == 0
                              ? DEFAULT_SIZE
                              : scanner->end_mustache_delimiter.size;
  int current_size = 0;
  int start_i = 0;
  int end_i = 0;
  while (true) {
    int ith_start = get_mustache_delimiter(scanner->start_mustache_delimiter, start_i,
                                  DEFAULT_START_DELIMITER);
    int ith_end =
        get_mustache_delimiter(scanner->end_mustache_delimiter, end_i, DEFAULT_END_DELIMITER);

    if (lexer->lookahead == ith_start) {
      start_i++;
      lexer->advance(lexer, false);
    } else if (lexer->lookahead == ith_end) {
      end_i++;
      lexer->advance(lexer, false);
    } else {
      lexer->advance(lexer, false);
      int limit = start_i > 0 ? start_i : end_i;
      for (int i = 0; i < limit + 1; i++) {
        lexer->mark_end(lexer);
        current_size++;
      }
      start_i = 0;
      end_i = 0;
    }
    if (start_i == start_delimiter_max && current_size > 0)
      break;
    else if (start_i == start_delimiter_max && current_size == 0)
      return false;

    if (end_i == end_delimiter_max && current_size > 0)
      break;
    else if (start_i == end_delimiter_max && current_size == 0)
      return false;

    if (lexer->eof(lexer) && current_size > 0)
      break;
    else if (lexer->eof(lexer) && current_size == 0)
      return false;
  }
  lexer->result_symbol = RAW_HTML_TEXT;
  return true;
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    // HTML text in a script or style tag
    if (valid_symbols[RAW_HTML_TEXT] && !valid_symbols[START_HTML_TAG_NAME] && !valid_symbols[END_HTML_TAG_NAME]) {
        return scan_raw_text(scanner, lexer);
    }

    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }

    // Process Mustache
    int first_start =
        get_mustache_delimiter(scanner->start_mustache_delimiter, 0, DEFAULT_START_DELIMITER);
    int first_end =
        get_mustache_delimiter(scanner->end_mustache_delimiter, 0, DEFAULT_END_DELIMITER);

    if (valid_symbols[START_MUSTACHE_DELIMITER] && lexer->lookahead == first_start) {
        return scan_start_mustache_delimiter(scanner, lexer);
    }
    if (valid_symbols[END_MUSTACHE_DELIMITER] && lexer->lookahead == first_end) {
        return scan_end_mustache_delimiter(scanner, lexer);
    }
    if (valid_symbols[MUSTACHE_COMMENT]) {
        printf("is_mustache_comment: %c\n", lexer->lookahead);
        bool result = scan_mustache_comment(scanner, lexer);
        printf("is_mustache_comment: %d\n", result);
        return result;
    }
    if (valid_symbols[MUSTACHE_IDENTIFIER] && lexer->lookahead != first_start &&
        lexer->lookahead != first_end && lexer->lookahead != '&' &&
        lexer->lookahead != '^' && lexer->lookahead != '=' &&
        lexer->lookahead != '/' && lexer->lookahead != '!' &&
        lexer->lookahead != '#' && lexer->lookahead != '.' &&
        lexer->lookahead != '>') {
        bool result = scan_mustache_identifier(scanner, lexer);
        printf("is_mustache_identifier: %d\n", result);
        return result;
    }
    if (valid_symbols[SET_START_MUSTACHE_DELIMITER]) {
        return scan_start_mustache_delimiter_content(scanner, lexer);
    }
    if (valid_symbols[SET_END_MUSTACHE_DELIMITER]) {
        return scan_end_mustache_delimiter_content(scanner, lexer);
    }
    if (valid_symbols[OLD_END_MUSTACHE_DELIMITER]) {
        return scan_old_end_mustache_delimiter(scanner, lexer);
    }

    if (valid_symbols[START_MUSTACHE_TAG_NAME]) {
        return scan_start_mustache_tag_name(scanner, lexer);
    }
    if (valid_symbols[END_MUSTACHE_TAG_NAME] || valid_symbols[ERRONEOUS_END_MUSTACHE_TAG_NAME]) {
        return scan_end_mustache_tag_name(scanner, lexer);
    }


    // Process HTML
    switch (lexer->lookahead) {
        case '<':
            lexer->mark_end(lexer);
            advance(lexer);

            if (lexer->lookahead == '!') {
                advance(lexer);
                return scan_comment(lexer);
            }

            if (valid_symbols[IMPLICIT_END_HTML_TAG]) {
                return scan_implicit_end_html_tag(scanner, lexer);
            }
            break;

        case '\0':
            if (valid_symbols[IMPLICIT_END_HTML_TAG]) {
                return scan_implicit_end_html_tag(scanner, lexer);
            }
            break;

        case '/':
            if (valid_symbols[SELF_CLOSING_TAG_DELIMITER]) {
                return scan_self_closing_html_tag_delimiter(scanner, lexer);
            }
            break;

        default:
            if ((valid_symbols[START_HTML_TAG_NAME] || valid_symbols[END_HTML_TAG_NAME]) && !valid_symbols[RAW_HTML_TEXT]) {
                return valid_symbols[START_HTML_TAG_NAME] ? scan_start_html_tag_name(scanner, lexer)
                                                         : scan_end_html_tag_name(scanner, lexer);
            }
    }

    // Mustache text
    if (valid_symbols[MUSTACHE_TEXT] && !lexer->eof(lexer) &&
        lexer->lookahead != first_start && lexer->lookahead != first_end) {
        return scan_mustache_text(scanner, lexer);
    }

    return false;
}

void *tree_sitter_html_external_scanner_create() {
    Scanner *scanner = (Scanner *)ts_calloc(1, sizeof(Scanner));
    return scanner;
}

bool tree_sitter_html_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;
    return scan(scanner, lexer, valid_symbols);
}

unsigned tree_sitter_html_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    return serialize(scanner, buffer);
}

void tree_sitter_html_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    deserialize(scanner, buffer, length);
}

void tree_sitter_html_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    for (unsigned i = 0; i < scanner->tags.size; i++) {
        tag_free(&scanner->tags.contents[i]);
    }
    array_delete(&scanner->tags);
    ts_free(scanner);
}
