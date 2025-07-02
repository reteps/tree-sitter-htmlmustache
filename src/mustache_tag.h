#include "tree_sitter/array.h"
#include <string.h>

// typedef Array(char) String;

typedef struct {
  String tag_name;
  unsigned html_tag_stack_size;
} MustacheTag;

static inline void mustache_tag_free(MustacheTag *tag) { array_delete(&tag->tag_name); }

static inline MustacheTag mustache_tag_new() {
  MustacheTag tag;
  tag.tag_name = (String) array_new();
  tag.html_tag_stack_size = 0;
  return tag;
}

static inline bool mustache_tag_eq(const MustacheTag *self, const MustacheTag *other) {
  if (self->tag_name.size != other->tag_name.size) {
    return false;
  }
  if (memcmp(self->tag_name.contents, other->tag_name.contents,
             self->tag_name.size) != 0) {
    return false;
  }
  return true;
}