import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, workspace, window, commands, TextEdit as VSCodeTextEdit, FormattingOptions as VSCodeFormattingOptions } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import {
  CustomCodeTagConfig,
  parseCustomCodeTags,
  generateInjectionGrammar,
  computeHash,
} from './grammarGenerator';

let client: LanguageClient;
const outputChannel = window.createOutputChannel('HTML Mustache');

function log(message: string) {
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

function updateInjectionGrammar(
  syntaxTags: CustomCodeTagConfig[],
  grammarPath: string,
): boolean {
  const newContent = generateInjectionGrammar(syntaxTags);
  const newHash = computeHash(newContent);

  let existingHash = '';
  try {
    const existing = fs.readFileSync(grammarPath, 'utf-8');
    existingHash = computeHash(existing);
  } catch {
    // File doesn't exist yet
  }

  if (newHash === existingHash) {
    return false;
  }

  fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
  fs.writeFileSync(grammarPath, newContent, 'utf-8');
  log(`Updated injection grammar at ${grammarPath}`);
  return true;
}

function promptReload() {
  window
    .showInformationMessage(
      'Embedded language grammar updated. Reload window to apply syntax highlighting changes.',
      'Reload Window',
    )
    .then((selection) => {
      if (selection === 'Reload Window') {
        commands.executeCommand('workbench.action.reloadWindow');
      }
    });
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
  const rawCustomCodeTags = config.get<CustomCodeTagConfig[]>('formatting.customCodeTags', []);
  const printWidth = config.get<number>('formatting.printWidth', 80);

  // Parse custom code tags: separate tag names (for LSP) from syntax configs (for grammar)
  const { tagNames, syntaxTags } = parseCustomCodeTags(rawCustomCodeTags);

  // Generate injection grammar on activation
  const grammarPath = context.asAbsolutePath(
    path.join('syntaxes', 'embedded-languages.json')
  );
  const changed = updateInjectionGrammar(syntaxTags, grammarPath);
  if (changed) {
    promptReload();
  }

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
      customCodeTags: tagNames,
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

  // Send updated settings to the server when configuration changes
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('htmlmustache.formatting')) {
        const updatedConfig = workspace.getConfiguration('htmlmustache');
        const updatedRawTags = updatedConfig.get<CustomCodeTagConfig[]>('formatting.customCodeTags', []);
        const updatedPrintWidth = updatedConfig.get<number>('formatting.printWidth', 80);

        const { tagNames: updatedTagNames, syntaxTags: updatedSyntaxTags } = parseCustomCodeTags(updatedRawTags);

        // Regenerate injection grammar if syntax tags changed
        const grammarChanged = updateInjectionGrammar(updatedSyntaxTags, grammarPath);
        if (grammarChanged) {
          promptReload();
        }

        // Send only tag names to the LSP server (for formatting)
        client.sendNotification('workspace/didChangeConfiguration', {
          settings: {
            htmlmustache: {
              formatting: {
                customCodeTags: updatedTagNames,
                printWidth: updatedPrintWidth,
              },
            },
          },
        });
        log(`Sent updated customCodeTags: ${updatedTagNames.join(', ')}`);
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
