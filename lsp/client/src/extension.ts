import * as path from 'path';
import { ExtensionContext, workspace, window } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;
const outputChannel = window.createOutputChannel('HTML Mustache');

function log(message: string) {
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
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
  const customCodeTags = config.get<string[]>('formatting.customCodeTags', []);
  const printWidth = config.get<number>('formatting.printWidth', 80);

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

  // Send updated settings to the server when configuration changes
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('htmlmustache.formatting')) {
        const updatedConfig = workspace.getConfiguration('htmlmustache');
        const updatedCustomCodeTags = updatedConfig.get<string[]>('formatting.customCodeTags', []);
        const updatedPrintWidth = updatedConfig.get<number>('formatting.printWidth', 80);
        client.sendNotification('workspace/didChangeConfiguration', {
          settings: {
            htmlmustache: {
              formatting: {
                customCodeTags: updatedCustomCodeTags,
                printWidth: updatedPrintWidth,
              },
            },
          },
        });
        log(`Sent updated customCodeTags: ${updatedCustomCodeTags.join(', ')}`);
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
