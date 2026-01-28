import XCTest
import SwiftTreeSitter
import TreeSitterHtmlmustache

final class TreeSitterHtmlmustacheTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_htmlmustache())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Htmlmustache grammar")
    }
}
