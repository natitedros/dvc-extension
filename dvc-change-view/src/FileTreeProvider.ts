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

      const isImageFile = (filePath: string): boolean => {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
        const ext = path.extname(filePath).toLowerCase();
        return imageExtensions.includes(ext);
      };

      const displayDiffLines = ()=>{
        if (isImageFile(pathName)) {
          // Open custom webview for image files
          this.openImageDiffWebview(pathName, tempFilePath);
          resolve();
        } else {
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

      private openImageDiffWebview(currentFilePath: string, previousFilePath: string): void {
        const panel = vscode.window.createWebviewPanel(
          'imageDiffViewer',
          'Image Diff Viewer',
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
              vscode.Uri.file(this.workspaceRoot),
              vscode.Uri.file(path.dirname(previousFilePath)), // Allow access to the directory of the previous file
              vscode.Uri.file(os.tmpdir()), // Allow access to the temp directory (if needed)
            ]
          }
        );

        const absoluteCurrentFilePath = path.isAbsolute(currentFilePath) ? currentFilePath : path.join(this.workspaceRoot, currentFilePath);
      
        const currentImageSrc = panel.webview.asWebviewUri(vscode.Uri.file(absoluteCurrentFilePath)).toString();
        const previousImageSrc = panel.webview.asWebviewUri(vscode.Uri.file(previousFilePath)).toString();
      
        panel.webview.html = this.getWebviewContent(currentImageSrc, previousImageSrc);
      }
      
      private getWebviewContent(currentImageSrc: string, previousImageSrc: string): string {
        return `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Image Diff Viewer</title>
            <style>
              .image-container {
                display: flex;
                justify-content: space-around;
              }

              .side-view img {
                max-width: 45%;
                height: auto;
              }

              .overlay-view {
                display: none; /* Initially hidden */
                justify-content: center;
                align-items: center;
                position: relative;
                width: 100%;
                height: 100%;
              }

              .overlay-view .image-wrapper {
                position: relative;
                width: auto;
                height: auto;
              }

              .overlay-view img {
                position: absolute;
                top: 0;
                left: 0;
                max-width: 100%;
                height: auto;
                opacity: 0.5;
              }
                canvas {
                  position: absolute;
                  top: 0;
                  left: 0;
                  max-width: 100%;
                  height: auto;
                  opacity: 0.5;
                }

              .overlay-view img:last-child {
                opacity: 0.5; /* Ensure both images have the same opacity */
              }
              .button-container {
                text-align: center;
                margin: 20px;
              } 
            </style>
          </head>
          <body>
            <div class="button-container">
              <button onclick="showSideBySide()">Side View</button>
              <button onclick="showOverlay()">Overlay View</button>
            </div>
            <div class="image-container side-view" id="side-by-side-view">
              <img src="${currentImageSrc}" alt="Current Image">
              <img src="${previousImageSrc}" alt="Previous Image">
            </div>
            <div class="image-container overlay-view" id="overlay-view">
              <div class="image-wrapper">
                <img src="${currentImageSrc}" alt="Current Image Overlay" id="current-image">
                <img src="${previousImageSrc}" alt="Previous Image Overlay" id="previous-image">
                <canvas id="comparison-canvas"></canvas>
              </div>
            </div>
            <script>
              function showSideBySide() {
                  document.getElementById('side-by-side-view').style.display = 'flex';
                  document.getElementById('overlay-view').style.display = 'none';
                }

                function showOverlay() {
                  document.getElementById('side-by-side-view').style.display = 'none';
                  document.getElementById('overlay-view').style.display = 'flex';
                  compareImages();
                }

                function compareImages() {
                  const currentImage = document.getElementById('current-image');
                  const previousImage = document.getElementById('previous-image');
                  const imageWrapper = document.querySelector('.image-wrapper');
                  const canvas = document.getElementById('comparison-canvas');
                  const ctx = canvas.getContext('2d');

                  // Set canvas dimensions to match the images
                  canvas.width = currentImage.width;
                  canvas.height = currentImage.height;

                  const width = currentImage.naturalWidth;
                  const height = currentImage.naturalHeight;

                  // Set the image wrapper size to match the image dimensions
                  imageWrapper.style.width = width + 'px';
                  imageWrapper.style.height = height + 'px';

                  // Draw the current image onto the canvas
                  ctx.drawImage(currentImage, 0, 0);

                  // Get the image data for the current image
                  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const currentPixels = currentImageData.data;

                  // Draw the previous image onto the canvas
                  ctx.drawImage(previousImage, 0, 0);

                  // Get the image data for the previous image
                  const previousImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  const previousPixels = previousImageData.data;

                  // Create a new image data for the comparison result
                  const comparisonImageData = ctx.createImageData(canvas.width, canvas.height);
                  const comparisonPixels = comparisonImageData.data;

                  // Loop through each pixel and compare
                  for (let i = 0; i < currentPixels.length; i += 4) {
                    const currentRed = currentPixels[i];
                    const currentGreen = currentPixels[i + 1];
                    const currentBlue = currentPixels[i + 2];

                    const previousRed = previousPixels[i];
                    const previousGreen = previousPixels[i + 1];
                    const previousBlue = previousPixels[i + 2];

                    // Check if the pixels are the same
                    if (currentRed === previousRed && currentGreen === previousGreen && currentBlue === previousBlue) {
                      // Set pixel to green (same)
                      comparisonPixels[i] = 0;
                      comparisonPixels[i + 1] = 255;
                      comparisonPixels[i + 2] = 0;
                      comparisonPixels[i + 3] = 128; // 50% opacity
                    } else {
                      // Set pixel to red (different)
                      comparisonPixels[i] = 255;
                      comparisonPixels[i + 1] = 0;
                      comparisonPixels[i + 2] = 0;
                      comparisonPixels[i + 3] = 128; // 50% opacity
                    }
                  }

                  // Draw the comparison result onto the canvas
                  ctx.putImageData(comparisonImageData, 0, 0);
                }

            </script>
          </body>
          </html>
        `;
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
