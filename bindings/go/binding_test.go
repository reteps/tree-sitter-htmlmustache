package tree_sitter_htmlmustache_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_htmlmustache "github.com/reteps/tree-sitter-htmlmustache/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_htmlmustache.Language())
	if language == nil {
		t.Errorf("Error loading Htmlmustache grammar")
	}
}
