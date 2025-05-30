import * as os from 'os';
import * as path from 'path';
import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from 'fs';

export class FileTreeProvider implements vscode.TreeDataProvider<FileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | void> = new vscode.EventEmitter<FileItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | void> = this._onDidChangeTreeData.event;
  private changedFiles: Array<{path: string, name: string, type: string}> = [];
  
  // Add event emitter for notifying about changed files count
  private _onDidChangeFileCount: vscode.EventEmitter<number> = new vscode.EventEmitter<number>();
  readonly onDidChangeFileCount: vscode.Event<number> = this._onDidChangeFileCount.event;

  constructor(private workspaceRoot: string) {}

  // Get the count of changed files (excluding placeholders)
  getChangedFilesCount(): number {
    // Don't count "No DVC changes detected" placeholder as a change
    if (this.changedFiles.length === 1 && this.changedFiles[0].name === "No DVC changes detected") {
      return 0;
    }
    return this.changedFiles.length;
  }

   // Refresh the tree view and run a terminal command
   refresh(): void {
    this.runDvcDiffCommand().then(() => {
        this._onDidChangeTreeData.fire(); // Refresh the tree view after fetching modified files
        
        // Emit the updated file count
        const fileCount = this.getChangedFilesCount();
        this._onDidChangeFileCount.fire(fileCount);
      }).catch((err) => {
        vscode.window.showErrorMessage("Error refreshing tree view: " + err);
      });
  }

  revert(filePath: string, fileType: string): void {
    if (fileType === "M"){
      exec(`dvc get . ${filePath} --rev HEAD --out ${filePath} -f`, { cwd: this.workspaceRoot,  }, (error, stdout, stderr) => {
        if (error) {
          vscode.window.showErrorMessage(`DVC Error: ${stderr || error.message}`);
          return;
        }
      });
    }
    else if (fileType === "A") {
      // Show a warning dialog to confirm deletion
      vscode.window.showWarningMessage(
          `Are you sure you want to delete the file "${path.basename(filePath)}"?`,
          { modal: true },
          'Yes', 'No'
      ).then((selection) => {
          if (selection === 'Yes') {
              // Delete the file
              fs.unlink(path.join(this.workspaceRoot, filePath), (err) => {
                  if (err) {
                      vscode.window.showErrorMessage(`Failed to delete file: ${err.message}`);
                  } else {
                      vscode.window.showInformationMessage(`File "${path.basename(filePath)}" deleted successfully.`);
                  }
              });
          }
      });
  }
  }

  // Get most recent file command
  displayChange(pathName: string, changeType: string): void {
    this.displayDvcDiffCommand(pathName, changeType);
  }
  private displayDvcDiffCommand(pathName: string, changeType: string): Promise<void> {
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

      if (changeType === "A"){
        const fullPath = path.join(this.workspaceRoot, pathName);
        
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
        const isImage = imageExtensions.includes(path.extname(fullPath).toLowerCase());
        if (isImage) {
         
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
        
        } else {

          vscode.workspace.openTextDocument(fullPath).then(document => {
            vscode.window.showTextDocument(document);
          });
        }
      }

      else if (fs.existsSync(tempFilePath)) {
        displayDiffLines();
      }

      else if (changeType === "M") {
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
                      this.changedFiles = [{ path: "", name: "No DVC changes detected", type: ""}];
                      resolve();
                      return;
                    }
                    
                    try {
                      const diffData = JSON.parse(stdout); // Parse the JSON output
                      this.changedFiles = [
                        ...(diffData["added"] as {path:string}[]).map(file=>({
                          ...file,
                          type:"A"
                        })),
                        ...(diffData["modified"] as {path:string}[]).map(file=>({
                          ...file,
                          type:"M"
                        })),
                        ...(diffData["deleted"] as {path:string}[]).map(file=>({
                          ...file,
                          type:"D"
                        })),
                        ...(diffData["renamed"] as {path:string}[]).map(file=>({
                          ...file,
                          type:"R"
                        })),
                      ].map((file) => {
                        // find the position of the last double slash 
                        // and save the substring after the double slash
                        const lastSlashIndex = file.path.lastIndexOf("\\");
                        const fileName = lastSlashIndex === -1 ? file.path : file.path.substring(lastSlashIndex + 1);
                        const pathName = file.path.replace(/\\/g, "/");
                        const newFile = {path: pathName, name: fileName, type: file.type};
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

            .overlay-view, .binary-mask-view {
              display: none; /* Initially hidden */
              justify-content: center;
              align-items: center;
              position: relative;
              width: 100%;
              height: 100%;
            }

            .overlay-view .image-wrapper, .binary-mask-view .image-wrapper {
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
              position: relative;
              top: 0;
              left: 0;
              max-width: 100%;
              height: auto;
            }

            .overlay-view img:last-child {
              opacity: 0.5; /* Ensure both images have the same opacity */
            }
            
            .button-container {
              text-align: center;
              margin: 20px;
            } 
            
            .slider-container {
              text-align: center;
              margin: 20px;
              display: none;
            }
            
            .slider-container input {
              width: 300px;
              outline: none;
              border: none;
            }
            
            .slider-value {
              display: inline-block;
              width: 50px;
              text-align: center;
            }

            .slider-container input:focus {
              outline: none;
              border: none;
            }

          </style>
        </head>
        <body>
          <div class="button-container">
            <button onclick="showSideBySide()">Side View</button>
            <button onclick="showOverlay()">Overlay View</button>
            <button onclick="showBinaryMask()">Binary Mask</button>
          </div>
          <div class="slider-container" id="threshold-slider-container">
            <label for="threshold">Threshold: </label>
            <input type="range" id="threshold" min="0" max="100" value="50" step="1" oninput="updateThreshold(this.value)">
            <span class="slider-value" id="threshold-value">0.50</span>
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
          <div class="image-container binary-mask-view" id="binary-mask-view">
            <div class="image-wrapper">
              <canvas id="binary-mask-canvas"></canvas>
            </div>
          </div> 
          <script>
            // Load both images first to ensure dimensions are available
            const currentImage = new Image();
            const previousImage = new Image();
            let threshold = 0.5;
            
            currentImage.onload = imageLoaded;
            previousImage.onload = imageLoaded;
            
            currentImage.src = "${currentImageSrc}";
            previousImage.src = "${previousImageSrc}";
            
            let imagesLoaded = 0;
            
            function imageLoaded() {
              imagesLoaded++;
              if (imagesLoaded === 2) {
                // Both images are loaded, setup canvas dimensions
                setupCanvas();
              }
            }
            
            function setupCanvas() {
              const binaryCanvas = document.getElementById('binary-mask-canvas');
              const comparisonCanvas = document.getElementById('comparison-canvas');
              const imageWrapper = document.querySelector('.image-wrapper');
              
              // Set canvas dimensions to match the images
              binaryCanvas.width = currentImage.width;
              binaryCanvas.height = currentImage.height;
              comparisonCanvas.width = currentImage.width;
              comparisonCanvas.height = currentImage.height;
              
              // Set the image wrapper size to match the image dimensions
              imageWrapper.style.width = currentImage.width + 'px';
              imageWrapper.style.height = currentImage.height + 'px';
            }

            function showSideBySide() {
              document.getElementById('side-by-side-view').style.display = 'flex';
              document.getElementById('overlay-view').style.display = 'none';
              document.getElementById('binary-mask-view').style.display = 'none';
              document.getElementById('threshold-slider-container').style.display = 'none';
            }

            function showOverlay() {
              document.getElementById('side-by-side-view').style.display = 'none';
              document.getElementById('overlay-view').style.display = 'flex';
              document.getElementById('binary-mask-view').style.display = 'none';
              document.getElementById('threshold-slider-container').style.display = 'none';
              compareImages();
            }
            
            function showBinaryMask() {
              document.getElementById('side-by-side-view').style.display = 'none';
              document.getElementById('overlay-view').style.display = 'none';
              document.getElementById('binary-mask-view').style.display = 'flex';
              document.getElementById('threshold-slider-container').style.display = 'block';
              generateBinaryMask(threshold);
            }
            
            function updateThreshold(value) {
              threshold = value / 100; // Convert from 0-100 to 0-1
              document.getElementById('threshold-value').textContent = threshold.toFixed(2);
              generateBinaryMask(threshold);
            }

            function compareImages() {
              const canvas = document.getElementById('comparison-canvas');
              const ctx = canvas.getContext('2d');

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
            
            function generateBinaryMask(threshold) {
              const canvas = document.getElementById('binary-mask-canvas');
              const ctx = canvas.getContext('2d');
              
              // Clear the canvas
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              
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
              
              // Create a new image data for the binary mask
              const binaryMaskData = ctx.createImageData(canvas.width, canvas.height);
              const binaryMaskPixels = binaryMaskData.data;
              
              // Loop through each pixel and compare
              for (let i = 0; i < currentPixels.length; i += 4) {
                const currentRed = currentPixels[i];
                const currentGreen = currentPixels[i + 1];
                const currentBlue = currentPixels[i + 2];
                
                const previousRed = previousPixels[i];
                const previousGreen = previousPixels[i + 1];
                const previousBlue = previousPixels[i + 2];
                
                // Calculate difference (simple Euclidean distance)
                const redDiff = Math.abs(currentRed - previousRed);
                const greenDiff = Math.abs(currentGreen - previousGreen);
                const blueDiff = Math.abs(currentBlue - previousBlue);
                
                // Calculate normalized difference (0-1 range)
                const normalizedDiff = Math.sqrt(redDiff*redDiff + greenDiff*greenDiff + blueDiff*blueDiff) / Math.sqrt(3 * 255 * 255);
                
                // Apply threshold
                if (normalizedDiff > threshold) {
                  // Different - White
                  binaryMaskPixels[i] = 255;
                  binaryMaskPixels[i + 1] = 255;
                  binaryMaskPixels[i + 2] = 255;
                  binaryMaskPixels[i + 3] = 255;
                } else {
                  // Same - Black
                  binaryMaskPixels[i] = 0;
                  binaryMaskPixels[i + 1] = 0;
                  binaryMaskPixels[i + 2] = 0;
                  binaryMaskPixels[i + 3] = 255;
                }
              }
              
              // Draw the binary mask onto the canvas
              ctx.putImageData(binaryMaskData, 0, 0);
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
        return Promise.resolve([new FileItem("No DVC changes detected", vscode.TreeItemCollapsibleState.None, "", "")]);
      }

      return Promise.resolve(this.changedFiles.map(file => new FileItem(file.name, vscode.TreeItemCollapsibleState.None, file.path, file.type)));
    }

}

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fileName: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly pathName: string,
        public readonly changeType: string

      ) {
        super(fileName, collapsibleState);
        this.tooltip = fileName;
        this.description = fileName;

        if(pathName){
          this.command = {
            command: "fileTreeView.runCommandOnFile",
            title: "Run Command",
            arguments: [fileName, pathName, changeType]
          };

          this.contextValue = "revertableFile";
        } else {
          this.contextValue = undefined;
        }
        
      }
}