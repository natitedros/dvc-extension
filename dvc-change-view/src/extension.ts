import * as vscode from 'vscode';
import { FileTreeProvider } from './FileTreeProvider';

export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace found.");
    return;
  }

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
	const fileTreeProvider = new FileTreeProvider(workspaceRoot);
  
	vscode.window.registerTreeDataProvider("fileTreeView", fileTreeProvider);
  
	fileTreeProvider.refresh(); // to call the refresh command on activation
	
	context.subscriptions.push(
	  vscode.commands.registerCommand("fileTreeView.refresh", () => fileTreeProvider.refresh())
	);


	context.subscriptions.push(
		vscode.commands.registerCommand('dvc-change-view.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from DVC Change Tracker!');
	})
	);

	vscode.commands.registerCommand("fileTreeView.runCommandOnFile", (fileName: string, pathName: string) => {
		fileTreeProvider.displayChange(pathName);
	  });

}

export function deactivate() {}
