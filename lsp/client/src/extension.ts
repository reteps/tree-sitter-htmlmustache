import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // Path to the server module
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

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
  };

  // Create and start the client
  client = new LanguageClient(
    'htmlmustache',
    'HTML Mustache Language Server',
    serverOptions,
    clientOptions
  );

  // Start the client, which also starts the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
