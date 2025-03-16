import * as vscode from 'vscode';
import { FileTreeProvider, FileItem } from './FileTreeProvider';

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

	vscode.commands.registerCommand("fileTreeView.runCommandOnFile", (fileName: string, pathName: string, changeType: string) => {
		fileTreeProvider.displayChange(pathName, changeType);
	  });

	vscode.commands.registerCommand("fileTreeView.revertFile", async (fileItem: FileItem) => {
        // Implement the logic to revert the file to its original state
        await fileTreeProvider.revert(fileItem.pathName, fileItem.changeType);
		vscode.window.showInformationMessage(`File: ${fileItem.pathName} Reverted!`);
    });

	// Add a context menu item for revertable files
	vscode.commands.registerCommand("fileTreeView.revertFileContextMenu", (fileItem: FileItem) => {
		vscode.commands.executeCommand("fileTreeView.revertFile", fileItem);
	});

}

export function deactivate() {}
