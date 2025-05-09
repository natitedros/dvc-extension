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
  
  // Register the tree view with the provider
	const treeView = vscode.window.createTreeView("fileTreeView", { 
    treeDataProvider: fileTreeProvider,
    showCollapseAll: true
  });

  // Set initial badge (which will be 0) when extension activates
  updateTreeViewBadge(treeView, fileTreeProvider.getChangedFilesCount());
  
  // Listen for file count changes and update the badge
  fileTreeProvider.onDidChangeFileCount(count => {
    updateTreeViewBadge(treeView, count);
  });
  
  // Helper function to update the badge with count
  function updateTreeViewBadge(treeView: vscode.TreeView<FileItem>, count: number) {
    if (count > 0) {
      // Set badge with count and color
      treeView.badge = {
        tooltip: `${count} changed file${count === 1 ? '' : 's'}`,
        value: count
      };
    } else {
      // Clear the badge when no changes
      treeView.badge = undefined;
    }
  }
  
	fileTreeProvider.refresh(); // to call the refresh command on activation

	context.subscriptions.push(
	  vscode.commands.registerCommand("fileTreeView.refresh", () => fileTreeProvider.refresh())
	);
	
	let refreshTimeout: NodeJS.Timeout | null = null;
    const debouncedRefresh = () => {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(() => {
            fileTreeProvider.refresh();
            refreshTimeout = null;
        }, 1000); // 1 second delay
    };

    // Modified file watcher with debouncing
    const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    
    fileWatcher.onDidChange(() => {
        debouncedRefresh();
    });

    fileWatcher.onDidCreate(() => {
        debouncedRefresh();
    });

    fileWatcher.onDidDelete(() => {
        debouncedRefresh();
    });

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