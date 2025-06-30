#include "tag.h"
#include "mustache_tag.h"
#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    HTML_START_TAG_NAME,
    HTML_SCRIPT_START_TAG_NAME,
    HTML_STYLE_START_TAG_NAME,
    HTML_END_TAG_NAME,
    HTML_ERRONEOUS_END_TAG_NAME,
    HTML_SELF_CLOSING_TAG_DELIMITER,
    HTML_IMPLICIT_END_TAG,
    HTML_RAW_TEXT,
    HTML_COMMENT,
    // Mustache tokens
    MUSTACHE_START_TAG_NAME,
    MUSTACHE_END_TAG_NAME,
    MUSTACHE_ERRONEOUS_END_TAG_NAME,
    MUSTACHE_IDENTIFIER_CONTENT,
};

typedef struct {
    Array(Tag) tags;
    Array(MustacheTag) mustache_tags;
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

    // Mustache tags
    uint16_t m_tag_count =
        scanner->mustache_tags.size > UINT16_MAX ? UINT16_MAX : scanner->mustache_tags.size;
    uint16_t m_serialized_tag_count = 0;

    unsigned mustache_start_offset = size;
    unsigned m_size = sizeof(m_serialized_tag_count);
    size += sizeof(m_serialized_tag_count);
    
    memcpy(&buffer[size], &m_tag_count, sizeof(m_tag_count));
    size += sizeof(m_tag_count);

    for (; m_serialized_tag_count < m_tag_count; m_serialized_tag_count++) {
        MustacheTag tag = scanner->mustache_tags.contents[m_serialized_tag_count];
        unsigned name_length = tag.tag_name.size;
        if (name_length > UINT8_MAX) {
        name_length = UINT8_MAX;
        }
        if (size + 1 + name_length >= TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
        break;
        }
        buffer[size++] = (char)name_length;
        strncpy(&buffer[size], tag.tag_name.contents, name_length);
        size += name_length;
    }

    memcpy(&buffer[mustache_start_offset], &m_serialized_tag_count, sizeof(m_serialized_tag_count));
    return size;
}

static void deserialize(Scanner *scanner, const char *buffer, unsigned length) {
    for (unsigned i = 0; i < scanner->tags.size; i++) {
        tag_free(&scanner->tags.contents[i]);
    }
    for (unsigned i = 0; i < scanner->mustache_tags.size; i++) {
        mustache_tag_free(&scanner->mustache_tags.contents[i]);
    }
    array_clear(&scanner->tags);
    array_clear(&scanner->mustache_tags);

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

        // Mustache tags
        unsigned m_size = 0;
        uint16_t m_tag_count = 0;
        uint16_t m_serialized_tag_count = 0;

        memcpy(&m_serialized_tag_count, &buffer[size], sizeof(m_serialized_tag_count));
        size += sizeof(m_serialized_tag_count);

        memcpy(&m_tag_count, &buffer[size], sizeof(m_tag_count));
        size += sizeof(m_tag_count);

        array_reserve(&scanner->mustache_tags, m_tag_count);
        if (m_tag_count > 0) {
            unsigned iter = 0;
            for (iter = 0; iter < m_serialized_tag_count; iter++) {
                MustacheTag tag = mustache_tag_new();
                uint16_t name_length = (uint8_t)buffer[size++];
                array_reserve(&tag.tag_name, name_length);
                tag.tag_name.size = name_length;
                memcpy(tag.tag_name.contents, &buffer[size], name_length);
                size += name_length;
                array_push(&scanner->mustache_tags, tag);
            }
            // add zero tags if we didn't read enough, this is because the
            // buffer had no more room but we held more tags.
            for (; iter < m_tag_count; iter++) {
                array_push(&scanner->mustache_tags, mustache_tag_new());
            }
        }
    }
}

static String scan_html_tag_name(TSLexer *lexer) {
    String tag_name = array_new();
    while (iswalnum(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == ':') {
        array_push(&tag_name, towupper(lexer->lookahead));
        advance(lexer);
    }
    return tag_name;
}

static bool scan_html_comment(TSLexer *lexer) {
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

    lexer->result_symbol = HTML_RAW_TEXT;
    return true;
}

static void pop_html_tag(Scanner *scanner) {
    Tag popped_tag = array_pop(&scanner->tags);
    tag_free(&popped_tag);
}

static bool scan_implicit_end_tag(Scanner *scanner, TSLexer *lexer) {
    Tag *parent = scanner->tags.size == 0 ? NULL : array_back(&scanner->tags);

    bool is_closing_tag = false;
    if (lexer->lookahead == '/') {
        is_closing_tag = true;
        advance(lexer);
    } else {
        if (parent && tag_is_void(parent)) {
            pop_html_tag(scanner);
            lexer->result_symbol = HTML_IMPLICIT_END_TAG;
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
                pop_html_tag(scanner);
                lexer->result_symbol = HTML_IMPLICIT_END_TAG;
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
        pop_html_tag(scanner);
        lexer->result_symbol = HTML_IMPLICIT_END_TAG;
        tag_free(&next_tag);
        return true;
    }

    tag_free(&next_tag);
    return false;
}

static bool scan_start_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_html_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    Tag tag = tag_for_name(tag_name);
    array_push(&scanner->tags, tag);
    switch (tag.type) {
        case SCRIPT:
            lexer->result_symbol = HTML_SCRIPT_START_TAG_NAME;
            break;
        case STYLE:
            lexer->result_symbol = HTML_STYLE_START_TAG_NAME;
            break;
        default:
            lexer->result_symbol = HTML_START_TAG_NAME;
            break;
    }
    return true;
}

static bool scan_end_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_html_tag_name(lexer);

    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    Tag tag = tag_for_name(tag_name);
    if (scanner->tags.size > 0 && tag_eq(array_back(&scanner->tags), &tag)) {
        pop_html_tag(scanner);
        lexer->result_symbol = HTML_END_TAG_NAME;
    } else {
        lexer->result_symbol = HTML_ERRONEOUS_END_TAG_NAME;
    }

    tag_free(&tag);
    return true;
}

static bool scan_self_closing_tag_delimiter(Scanner *scanner, TSLexer *lexer) {
    advance(lexer);
    if (lexer->lookahead == '>') {
        advance(lexer);
        if (scanner->tags.size > 0) {
            pop_html_tag(scanner);
            lexer->result_symbol = HTML_SELF_CLOSING_TAG_DELIMITER;
        }
        return true;
    }
    return false;
}

static String scan_mustache_tag_name(Scanner *scanner, TSLexer *lexer) {
  String tag_name = array_new();
  while (lexer->lookahead != '}' && !lexer->eof(lexer)) {
    if (iswspace(lexer->lookahead))
      break;

    array_push(&tag_name, lexer->lookahead);
    lexer->advance(lexer, false);
  }
  return tag_name;
}

static bool scan_mustache_identifier_content(TSLexer *lexer) {
    bool has_content = false;
    while (lexer->lookahead != '}' && lexer->lookahead != '.' && !iswspace(lexer->lookahead)) {
        if (lexer->eof(lexer)) {
            return false;
        }
        has_content = true;
        advance(lexer);
    }
    if (has_content) {
        lexer->result_symbol = MUSTACHE_IDENTIFIER_CONTENT;
        return true;
    }
    return false;
}

static bool scan_mustache_start_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_mustache_tag_name(scanner, lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }
    MustacheTag tag = mustache_tag_new();
    tag.tag_name = tag_name;
    array_push(&scanner->mustache_tags, tag);
    lexer->result_symbol = MUSTACHE_START_TAG_NAME;
    return true;
}

static bool scan_mustache_end_tag_name(Scanner *scanner, TSLexer *lexer) {
  String tag_name = scan_mustache_tag_name(scanner, lexer);

  if (tag_name.size == 0) {
    array_delete(&tag_name);
    return false;
  }

  MustacheTag tag = mustache_tag_new();
  tag.tag_name = tag_name;
  if (scanner->mustache_tags.size > 0 && mustache_tag_eq(array_back(&scanner->mustache_tags), &tag)) {
    MustacheTag popped_tag = array_pop(&scanner->mustache_tags);
    mustache_tag_free(&popped_tag);
    lexer->result_symbol = MUSTACHE_END_TAG_NAME;
  } else {
    lexer->result_symbol = MUSTACHE_ERRONEOUS_END_TAG_NAME;
  }

  mustache_tag_free(&tag);
  return true;
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[HTML_RAW_TEXT] && !valid_symbols[HTML_START_TAG_NAME] && !valid_symbols[HTML_END_TAG_NAME]) {
        return scan_raw_text(scanner, lexer);
    }

    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }
    
    if (valid_symbols[MUSTACHE_IDENTIFIER_CONTENT]) {
        return scan_mustache_identifier_content(lexer);
    }
    
    if (valid_symbols[MUSTACHE_START_TAG_NAME]) {
        return scan_mustache_start_tag_name(scanner, lexer);
    }
    
    if (valid_symbols[MUSTACHE_END_TAG_NAME] || valid_symbols[MUSTACHE_ERRONEOUS_END_TAG_NAME]) {
        return scan_mustache_end_tag_name(scanner, lexer);
    }
    
    switch (lexer->lookahead) {
        case '<':
            lexer->mark_end(lexer);
            advance(lexer);

            if (lexer->lookahead == '!') {
                advance(lexer);
                return scan_html_comment(lexer);
            }

            if (valid_symbols[HTML_IMPLICIT_END_TAG]) {
                return scan_implicit_end_tag(scanner, lexer);
            }
            break;

        case '\0':
            if (valid_symbols[HTML_IMPLICIT_END_TAG]) {
                return scan_implicit_end_tag(scanner, lexer);
            }
            break;

        case '/':
            if (valid_symbols[HTML_SELF_CLOSING_TAG_DELIMITER]) {
                return scan_self_closing_tag_delimiter(scanner, lexer);
            }
            break;

        default:
            if ((valid_symbols[HTML_START_TAG_NAME] || valid_symbols[HTML_END_TAG_NAME]) && !valid_symbols[HTML_RAW_TEXT]) {
                return valid_symbols[HTML_START_TAG_NAME] ? scan_start_tag_name(scanner, lexer)
                                                     : scan_end_tag_name(scanner, lexer);
            }
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
    for (unsigned i = 0; i < scanner->mustache_tags.size; i++) {
        mustache_tag_free(&scanner->mustache_tags.contents[i]);
    }
    array_delete(&scanner->mustache_tags);
    ts_free(scanner);
}
