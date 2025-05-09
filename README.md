# DVC File Changes Extension

A Visual Studio Code extension for tracking file changes in DVC-tracked files. This extension provides a dedicated sidebar to monitor file modifications, view line-by-line differences, and refresh the file tracking status easily.

## Features

- 📂 **Sidebar View** – Displays DVC-tracked files and their change status.
- 🔄 **Refresh Button** – Updates the file tracking status with the latest changes.
- 📝 **Line-by-Line Diff View** – Shows line-by-line differences in the editor window when a file is selected. 
   [![Line-By-Line]](https://github.com/user-attachments/assets/b46b22ea-efcd-4b26-b6a7-91e541dc6f78)

- 📝 **Image Diff View** – Shows Pixel-by-pixel differences in the editor window when the image is selected using three views: Side-by-side, Overlay, and Binary Masking.
   [![Image-Pixel-Diff]](https://github.com/user-attachments/assets/132c96a2-2f31-447a-b77f-0452d01659d2)

- 🎨 **Custom Icon** – Unique extension icon for easy identification.

## Installation

### From VS Code Marketplace

1. Open VS Code and go to the **Extensions** view (`Ctrl+Shift+X`).
2. Search for `DVC File Changes Extension`.
3. Click **Install**.

### Manual Installation

1. Clone this repository:
   ```sh
   git clone https://github.com/natitedros/dvc-extension.git
   ```
2. Open the project in VS Code:
   ```sh
   cd dvc-extension
   cd dvc-change-view
   code .
   ```
3. Install dependencies:
   ```sh
   npm install
   ```
4. Build and install the extension:
   ```sh
   npm run compile
   open extension.ts and press F5
   ```

## Usage

1. Open the **DVC File Changes** sidebar from the activity bar.
2. Click the **Refresh** button to fetch the latest tracked file changes.
3. Select a file to view its **line-by-line differences**.

## Requirements

- VS Code v1.75.0 or higher
- DVC installed and configured in the project

## Configuration

The extension automatically detects DVC-tracked files in your workspace. Ensure DVC is properly initialized in your project by running:

```sh
 dvc init
```

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a new branch: `git checkout -b feature-branch`.
3. Commit your changes: `git commit -m "Add new feature"`.
4. Push the branch: `git push origin feature-branch`.
5. Submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).

---

🚀 Happy coding with DVC in VS Code!
