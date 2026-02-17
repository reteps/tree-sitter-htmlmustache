import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, workspace, window, commands, extensions, TextEdit as VSCodeTextEdit, FormattingOptions as VSCodeFormattingOptions } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

interface CustomCodeTagConfig {
  name: string;
  languageAttribute?: string;
  languageMap?: Record<string, string>;
  languageDefault?: string;
}

let client: LanguageClient;
const outputChannel = window.createOutputChannel('HTML Mustache');

function log(message: string) {
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

/**
 * Find a TextMate grammar file for a given scope name from VS Code's installed extensions.
 * Searches all extensions for grammar contributions matching the scope name.
 */
function findTextMateGrammar(scopeName: string): { content: string; format: 'json' | 'plist' } | null {
  log(`Finding TextMate grammar for scope: ${scopeName}`);
  for (const ext of extensions.all) {
    const pkg = ext.packageJSON;
    const grammars = pkg?.contributes?.grammars;
    if (!Array.isArray(grammars)) continue;

    for (const grammar of grammars) {
      if (grammar.scopeName === scopeName && grammar.path) {
        const grammarPath = path.join(ext.extensionPath, grammar.path);
        log(`Found grammar match in ${ext.id}: ${grammarPath}`);
        try {
          const content = fs.readFileSync(grammarPath, 'utf-8');
          const format = grammarPath.endsWith('.json') ? 'json' : 'plist';
          log(`Read grammar: ${content.length} chars, format=${format}`);
          return { content, format };
        } catch (e) {
          log(`Failed to read grammar file: ${grammarPath}: ${e}`);
        }
      }
    }
  }
  log(`No grammar found for scope: ${scopeName}`);
  return null;
}

export function activate(context: ExtensionContext) {
  log('Extension activating...');

  // Path to the server module (ESM format for web-tree-sitter compatibility)
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.mjs')
  );
  log(`Server module path: ${serverModule}`);

  // Server options - run the server as a Node process
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  };

  // Read settings to send as initialization options
  const config = workspace.getConfiguration('htmlmustache');
  const customCodeTags = config.get<CustomCodeTagConfig[]>('customCodeTags', []);
  const printWidth = config.get<number>('printWidth', 80);

  // Client options - define which documents the server handles
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'htmlmustache' },
      { scheme: 'file', language: 'mustache' },
      { scheme: 'file', language: 'handlebars' },
    ],
    synchronize: {
      // Watch for changes to .mustache files
      fileEvents: workspace.createFileSystemWatcher('**/*.{mustache,hbs,handlebars}'),
    },
    outputChannel: outputChannel,
    initializationOptions: {
      customCodeTags,
      printWidth,
    },
  };

  log('Creating language client...');

  // Create and start the client
  client = new LanguageClient(
    'htmlmustache',
    'HTML Mustache Language Server',
    serverOptions,
    clientOptions
  );

  // Handle embedded formatting requests from the server
  client.onRequest('htmlmustache/formatEmbedded', async (params: {
    content: string;
    languageId: string;
    options: { tabSize: number; insertSpaces: boolean };
  }): Promise<{ formatted: string | null }> => {
    try {
      const doc = await workspace.openTextDocument({
        content: params.content,
        language: params.languageId,
      });

      const formatOptions: VSCodeFormattingOptions = {
        tabSize: params.options.tabSize,
        insertSpaces: params.options.insertSpaces,
      };

      const edits = await commands.executeCommand<VSCodeTextEdit[]>(
        'vscode.executeFormatDocumentProvider',
        doc.uri,
        formatOptions
      );

      if (!edits || edits.length === 0) {
        return { formatted: null };
      }

      // Apply edits in reverse order to preserve positions
      let result = doc.getText();
      const sortedEdits = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });

      for (const edit of sortedEdits) {
        const startOffset = doc.offsetAt(edit.range.start);
        const endOffset = doc.offsetAt(edit.range.end);
        result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
      }

      return { formatted: result };
    } catch {
      return { formatted: null };
    }
  });

  // Handle grammar requests from the server for embedded language tokenization
  client.onRequest('htmlmustache/getGrammar', async (params: {
    scopeName: string;
  }): Promise<{ content: string; format: 'json' | 'plist' } | null> => {
    try {
      return findTextMateGrammar(params.scopeName);
    } catch (e) {
      log(`Failed to find grammar for ${params.scopeName}: ${e}`);
      return null;
    }
  });

  // Send updated settings to the server when configuration changes
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('htmlmustache.customCodeTags') || e.affectsConfiguration('htmlmustache.printWidth')) {
        const updatedConfig = workspace.getConfiguration('htmlmustache');
        const updatedTags = updatedConfig.get<CustomCodeTagConfig[]>('customCodeTags', []);
        const updatedPrintWidth = updatedConfig.get<number>('printWidth', 80);

        client.sendNotification('workspace/didChangeConfiguration', {
          settings: {
            htmlmustache: {
              customCodeTags: updatedTags,
              printWidth: updatedPrintWidth,
            },
          },
        });
        log(`Sent updated customCodeTags: ${updatedTags.map(t => t.name).join(', ')}`);
        log(`Sent updated printWidth: ${updatedPrintWidth}`);
      }
    })
  );

  // Start the client, which also starts the server
  log('Starting language client...');
  client.start().then(
    () => {
      log('Language client started successfully');
    },
    (error) => {
      log(`Failed to start language client: ${error}`);
    }
  );

  log('Extension activated');
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
