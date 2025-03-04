import * as os from 'os';
import * as path from 'path';
import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from 'fs';

export class FileTreeProvider implements vscode.TreeDataProvider<FileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | void> = new vscode.EventEmitter<FileItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | void> = this._onDidChangeTreeData.event;
  private changedFiles: Array<{path: string, name: string}> = [];

  constructor(private workspaceRoot: string) {}

   // Refresh the tree view and run a terminal command
   refresh(): void {
    this.runDvcDiffCommand().then(() => {
        this._onDidChangeTreeData.fire(); // Refresh the tree view after fetching modified files
      }).catch((err) => {
        vscode.window.showErrorMessage("Error refreshing tree view: " + err);
      });
  }

  // Get most recent file command
  displayChange(pathName: string): void {
    this.displayDvcDiffCommand(pathName);
  }
  private displayDvcDiffCommand(pathName: string): Promise<void> {
    return new Promise((resolve, reject) => {

      const tempFilePath = path.join(os.tmpdir(), pathName);

      const displayDiffLines = ()=>{
        try {
          exec(`code -d ./${pathName} ${tempFilePath}`, { cwd: this.workspaceRoot,  }, (error, stdout, stderr) => {
            if (error) {
              vscode.window.showErrorMessage(`DVC Error: ${stderr || error.message}`);
              reject(error);
              return;
            }
            resolve();
          });
        }catch (err) {
          vscode.window.showErrorMessage("Error parsing DVC output.");
          reject(err);
        }
      };

      if (fs.existsSync(tempFilePath)) {
        console.log(tempFilePath);
        displayDiffLines();
      }

      else{
        exec(`dvc get . ${pathName} --rev HEAD --out ${tempFilePath} -f`, { cwd: this.workspaceRoot,  }, (error, stdout, stderr) => {
          if (error) {
            vscode.window.showErrorMessage(`DVC Error: ${stderr || error.message}`);
            reject(error);
            return;
          }
          displayDiffLines();
        });
      }  
    });
  }


    // Run the `dvc diff HEAD^` command and capture modified files
    private runDvcDiffCommand(): Promise<void> {
        return new Promise((resolve, reject) => {
                exec(`dvc diff HEAD --json`, { cwd: this.workspaceRoot,  }, (error, stdout, stderr) => {
                  
                    if (error) {
                      vscode.window.showErrorMessage(`DVC Error: ${stderr || error.message}`);
                      reject(error);
                      return;
                    }
                    
                    if (!stdout.trim() || stdout.trim() === "{}") {
                      // Handle empty stdout by displaying a placeholder message
                      this.changedFiles = [{ path: "", name: "No DVC changes detected" }];
                      resolve();
                      return;
                    }
                    
                    try {
                      const diffData = JSON.parse(stdout); // Parse the JSON output
                      this.changedFiles = [
                        ...diffData["added"],
                        ...diffData["modified"],
                        ...diffData["deleted"],
                        ...diffData["renamed"]
                    //   ];
                      ].map((file) => {
                        // find the position of the last double slash 
                        // and save the substring after the double slash
                        const lastSlashIndex = file.path.lastIndexOf("\\");
                        const fileName = lastSlashIndex === -1 ? file.path : file.path.substring(lastSlashIndex + 1);
                        const pathName = file.path.replace(/\\/g, "/");
                        const newFile = {path: pathName, name: fileName};
                        return newFile;
                      })
                      .filter(file => file.name.trim() !== "");
                        resolve();
                    } catch (err) {
                      vscode.window.showErrorMessage("Error parsing DVC output.");
                      reject(err);
                    }
                  });
          
        });
      }

  getTreeItem(element: FileItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FileItem): Thenable<FileItem[]> {
    if (element) {
        return Promise.resolve([]);
      }

      if (this.changedFiles.length === 1 && this.changedFiles[0].name === "No DVC changes detected") {
        return Promise.resolve([new FileItem("No DVC changes detected", vscode.TreeItemCollapsibleState.None, "")]);
      }

      return Promise.resolve(this.changedFiles.map(file => new FileItem(file.name, vscode.TreeItemCollapsibleState.None, file.path)));
    }

}

class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fileName: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly pathName: string
      ) {
        super(fileName, collapsibleState);
        this.tooltip = fileName;
        this.description = fileName;

        if(pathName){
          this.command = {
            command: "fileTreeView.runCommandOnFile",
            title: "Run Command",
            arguments: [fileName, pathName]
          };
        }
        
      }
}
