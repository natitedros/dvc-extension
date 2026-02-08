import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface VenvInfo {
  type: 'none' | 'venv' | 'conda' | 'poetry' | 'pipenv';
  path?: string;
  pythonPath?: string;
}

export class VirtualEnvironmentManager {
  private workspaceRoot: string;
  private venvInfo: VenvInfo | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Detect the virtual environment in the workspace
   */
  public async detectVirtualEnvironment(): Promise<VenvInfo> {
    if (this.venvInfo) {
      console.log(`Using cached venv info: ${this.venvInfo.type}`);
      return this.venvInfo;
    }

    console.log(`Detecting virtual environment in: ${this.workspaceRoot}`);
    console.log(`Environment variables - VIRTUAL_ENV: ${process.env.VIRTUAL_ENV}, CONDA_DEFAULT_ENV: ${process.env.CONDA_DEFAULT_ENV}`);

    // Check for Poetry first (most specific)
    if (fs.existsSync(path.join(this.workspaceRoot, 'poetry.lock'))) {
      console.log('Detected Poetry environment');
      this.venvInfo = {
        type: 'poetry',
        path: this.workspaceRoot,
        pythonPath: 'poetry run python'
      };
      return this.venvInfo;
    }

    // Check for Pipenv
    if (fs.existsSync(path.join(this.workspaceRoot, 'Pipfile.lock'))) {
      console.log('Detected Pipenv environment');
      this.venvInfo = {
        type: 'pipenv',
        path: this.workspaceRoot,
        pythonPath: 'pipenv run python'
      };
      return this.venvInfo;
    }

    // Check for active conda environment
    const condaEnv = process.env.CONDA_DEFAULT_ENV;
    if (condaEnv && condaEnv !== 'base') {
      const pythonPath = this.findPythonInConda();
      console.log(`Detected Conda environment: ${condaEnv}, Python: ${pythonPath}`);
      this.venvInfo = {
        type: 'conda',
        path: condaEnv,
        pythonPath: pythonPath
      };
      return this.venvInfo;
    }

    // Check for venv in VIRTUAL_ENV environment variable
    const virtualEnv = process.env.VIRTUAL_ENV;
    if (virtualEnv && fs.existsSync(virtualEnv)) {
      const pythonPath = this.getPythonPath(virtualEnv);
      console.log(`Detected venv from VIRTUAL_ENV: ${virtualEnv}, Python: ${pythonPath}`);
      this.venvInfo = {
        type: 'venv',
        path: virtualEnv,
        pythonPath: pythonPath
      };
      return this.venvInfo;
    }

    // Check for common virtual environment directories
    const venvPath = this.findVenvInWorkspace();
    if (venvPath) {
      const pythonPath = this.getPythonPath(venvPath);
      console.log(`Detected venv in workspace: ${venvPath}, Python: ${pythonPath}`);
      this.venvInfo = {
        type: 'venv',
        path: venvPath,
        pythonPath: pythonPath
      };
      return this.venvInfo;
    }

    // No virtual environment detected
    console.log('No virtual environment detected, will try system DVC');
    this.venvInfo = { type: 'none' };
    return this.venvInfo;
  }

  /**
   * Execute a DVC command with proper virtual environment handling
   */
  public async executeDvcCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    const venvInfo = await this.detectVirtualEnvironment();
    
    console.log(`Executing DVC command: ${command}`);
    console.log(`Virtual environment type: ${venvInfo.type}`);
    
    // Try multiple strategies in order of preference
    // Python module is more reliable than direct executable
    const strategies = [
      () => this.tryVenvStrategy(venvInfo, command),
      () => this.tryPythonModuleStrategy(venvInfo, command),
      () => this.tryDirectDvcExecutable(venvInfo, command),
      () => this.trySystemDvc(command)
    ];

    let lastError: Error | null = null;
    let dvcPluginError: string | null = null;
    
    for (const strategy of strategies) {
      try {
        console.log(`Trying strategy: ${strategy.name}`);
        const result = await strategy();
        console.log(`✓ DVC command succeeded with strategy: ${strategy.name}`);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`✗ Strategy ${strategy.name} failed: ${errorMsg}`);
        
        // Check if this is a DVC plugin dependency error (not an execution error)
        if (errorMsg.includes('requires') && errorMsg.includes('to be installed')) {
          dvcPluginError = errorMsg;
        }
        
        lastError = error as Error;
        // Continue to next strategy
      }
    }

    // All strategies failed
    console.error('All DVC command strategies failed');
    
    // If we got a DVC plugin error, throw that as it's more informative
    if (dvcPluginError) {
      throw new Error(`DVC plugin missing: ${dvcPluginError}`);
    }
    
    throw lastError || new Error('Failed to execute DVC command');
  }

  /**
   * Strategy 1: Use poetry/pipenv run for managed environments
   */
  private async tryVenvStrategy(venvInfo: VenvInfo, command: string): Promise<{ stdout: string; stderr: string }> {
    if (venvInfo.type === 'poetry') {
      const fullCommand = `poetry run ${command}`;
      console.log(`  Executing: ${fullCommand}`);
      return await execPromise(fullCommand, { cwd: this.workspaceRoot });
    }

    if (venvInfo.type === 'pipenv') {
      const fullCommand = `pipenv run ${command}`;
      console.log(`  Executing: ${fullCommand}`);
      return await execPromise(fullCommand, { cwd: this.workspaceRoot });
    }

    throw new Error('Not a poetry or pipenv environment');
  }

  /**
   * Strategy 2: Use python -m dvc (works for all venv types)
   */
  private async tryPythonModuleStrategy(venvInfo: VenvInfo, dvcCommand: string): Promise<{ stdout: string; stderr: string }> {
    const pythonPath = venvInfo.pythonPath || this.findPythonInWorkspace();
    
    if (!pythonPath) {
      throw new Error('No Python executable found');
    }

    console.log(`  Found Python path: ${pythonPath}`);

    // For poetry/pipenv, pythonPath is a command like "poetry run python"
    if (venvInfo.type === 'poetry' || venvInfo.type === 'pipenv') {
      const args = dvcCommand.replace(/^dvc\s*/i, '').trim();
      const fullCommand = `${pythonPath} -m dvc ${args}`;
      console.log(`  Executing: ${fullCommand}`);
      return await execPromise(fullCommand, { cwd: this.workspaceRoot });
    }

    // For regular venv/conda, pythonPath is a file path
    if (fs.existsSync(pythonPath)) {
      const args = dvcCommand.replace(/^dvc\s*/i, '').trim();
      const fullCommand = `"${pythonPath}" -m dvc ${args}`;
      console.log(`  Executing: ${fullCommand}`);
      return await execPromise(fullCommand, { cwd: this.workspaceRoot });
    }

    throw new Error(`Python executable not found at: ${pythonPath}`);
  }

  /**
   * Strategy 3: Try direct DVC executable in venv Scripts/bin folder
   */
  private async tryDirectDvcExecutable(venvInfo: VenvInfo, dvcCommand: string): Promise<{ stdout: string; stderr: string }> {
    if (venvInfo.type === 'none' || !venvInfo.path) {
      throw new Error('No virtual environment path');
    }

    if (venvInfo.type === 'poetry' || venvInfo.type === 'pipenv') {
      throw new Error('Not applicable for poetry/pipenv');
    }

    const isWindows = os.platform() === 'win32';
    const scriptDir = isWindows ? 'Scripts' : 'bin';
    const dvcExecutable = isWindows ? 'dvc.exe' : 'dvc';
    
    let dvcPath: string;
    
    if (venvInfo.type === 'conda') {
      const condaPrefix = process.env.CONDA_PREFIX || venvInfo.path;
      dvcPath = path.join(condaPrefix, scriptDir, dvcExecutable);
    } else {
      dvcPath = path.join(venvInfo.path, scriptDir, dvcExecutable);
    }

    console.log(`  Checking for DVC executable at: ${dvcPath}`);

    if (fs.existsSync(dvcPath)) {
      const args = dvcCommand.replace(/^dvc\s*/i, '').trim();
      const fullCommand = `"${dvcPath}" ${args}`;
      console.log(`  Executing: ${fullCommand}`);
      return await execPromise(fullCommand, { cwd: this.workspaceRoot });
    }

    throw new Error(`DVC executable not found at: ${dvcPath}`);
  }

  /**
   * Strategy 4: Try system-installed DVC as last resort
   */
  private async trySystemDvc(command: string): Promise<{ stdout: string; stderr: string }> {
    console.log(`  Executing system DVC: ${command}`);
    return await execPromise(command, { cwd: this.workspaceRoot });
  }

  /**
   * Check if DVC is available
   */
  public async isDvcAvailable(): Promise<boolean> {
    try {
      const result = await this.executeDvcCommand('dvc version');
      return result.stdout.toLowerCase().includes('dvc version');
    } catch (error) {
      console.error('DVC not available:', error);
      return false;
    }
  }

  /**
   * Get a user-friendly error message for DVC errors (short version for notifications)
   */
  public getDvcErrorMessage(error: Error): string {
    const errorMsg = error.message;

    // Check for missing DVC plugins
    if (errorMsg.includes('requires') && errorMsg.includes('to be installed')) {
      const match = errorMsg.match(/requires '([^']+)' to be installed/);
      if (match) {
        const plugin = match[1];
        return `DVC plugin '${plugin}' is missing. Click 'Show Fix' for installation instructions.`;
      }
    }

    // Check for DVC not found
    if (errorMsg.includes('is not recognized') || errorMsg.includes('command not found')) {
      return 'DVC is not installed. Click \'Show Fix\' for installation instructions.';
    }

    // Return truncated message if too long
    if (errorMsg.length > 100) {
      return errorMsg.substring(0, 97) + '...';
    }

    return errorMsg;
  }

  /**
   * Get detailed error message with installation instructions
   */
  public getDvcErrorDetails(error: Error): string {
    const errorMsg = error.message;

    // Check for missing DVC plugins
    if (errorMsg.includes('requires') && errorMsg.includes('to be installed')) {
      const match = errorMsg.match(/requires '([^']+)' to be installed/);
      if (match) {
        const plugin = match[1];
        return `DVC Plugin Missing
========================

The DVC plugin '${plugin}' is required but not installed in your virtual environment.

To fix this issue:

1. Activate your virtual environment:
   ${this.getVenvActivationCommand()}

2. Install the missing plugin:
   pip install ${plugin}

Alternative - Install all DVC plugins:
   pip install dvc[all]

After installation, restart VS Code or refresh the DVC extension.

For more information, visit: https://dvc.org/doc/install`;
      }
    }

    // Check for DVC not found
    if (errorMsg.includes('is not recognized') || errorMsg.includes('command not found')) {
      return `DVC Not Found
========================

DVC is not installed in your environment.

To fix this issue:

1. Activate your virtual environment (if using one):
   ${this.getVenvActivationCommand()}

2. Install DVC:
   pip install dvc

   Or install with storage support:
   pip install dvc[s3]     # For S3 storage
   pip install dvc[gs]     # For Google Cloud Storage
   pip install dvc[azure]  # For Azure storage
   pip install dvc[all]    # For all storage backends

After installation, restart VS Code or refresh the DVC extension.

For more information, visit: https://dvc.org/doc/install`;
    }

    // Generic error with full details
    return `DVC Error
========================

${errorMsg}

If this error persists, please check:
- DVC is properly installed: pip install dvc
- Required plugins are installed: pip install dvc[all]
- Your virtual environment is activated

For help, visit: https://dvc.org/support`;
  }

  /**
   * Get the command to activate the current virtual environment
   */
  private getVenvActivationCommand(): string {
    if (!this.venvInfo || this.venvInfo.type === 'none') {
      return '# No virtual environment detected';
    }

    const isWindows = os.platform() === 'win32';

    switch (this.venvInfo.type) {
      case 'venv':
        if (isWindows) {
          return `${this.venvInfo.path}\\Scripts\\activate`;
        } else {
          return `source ${this.venvInfo.path}/bin/activate`;
        }
      case 'conda':
        return `conda activate ${this.venvInfo.path}`;
      case 'poetry':
        return 'poetry shell';
      case 'pipenv':
        return 'pipenv shell';
      default:
        return '# Activate your virtual environment';
    }
  }

  /**
   * Get the Python executable path for a venv directory
   */
  private getPythonPath(venvPath: string): string {
    const isWindows = os.platform() === 'win32';
    if (isWindows) {
      return path.join(venvPath, 'Scripts', 'python.exe');
    } else {
      return path.join(venvPath, 'bin', 'python');
    }
  }

  /**
   * Find Python executable in conda environment
   */
  private findPythonInConda(): string | undefined {
    const condaPrefix = process.env.CONDA_PREFIX;
    if (condaPrefix) {
      const isWindows = os.platform() === 'win32';
      const pythonPath = isWindows 
        ? path.join(condaPrefix, 'python.exe')
        : path.join(condaPrefix, 'bin', 'python');
      
      if (fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    }
    return process.env.CONDA_PYTHON_EXE;
  }

  /**
   * Search for common venv directory names in the workspace
   */
  private findVenvInWorkspace(): string | null {
    const commonVenvNames = ['venv', '.venv', 'env', '.env', 'virtualenv', 'myvenv'];
    
    console.log(`Searching for venv directories in workspace...`);
    
    for (const venvName of commonVenvNames) {
      const venvPath = path.join(this.workspaceRoot, venvName);
      console.log(`  Checking: ${venvPath}`);
      
      if (fs.existsSync(venvPath)) {
        console.log(`    Directory exists`);
        if (this.isValidVenv(venvPath)) {
          console.log(`    ✓ Valid venv found!`);
          return venvPath;
        } else {
          console.log(`    ✗ Not a valid venv`);
        }
      } else {
        console.log(`    Directory does not exist`);
      }
    }
    
    console.log(`No venv directory found in workspace`);
    return null;
  }

  /**
   * Find any Python executable in the workspace venvs
   */
  private findPythonInWorkspace(): string | null {
    const venvPath = this.findVenvInWorkspace();
    if (venvPath) {
      const pythonPath = this.getPythonPath(venvPath);
      if (fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    }
    return null;
  }

  /**
   * Check if a directory is a valid virtual environment
   */
  private isValidVenv(venvPath: string): boolean {
    const pythonPath = this.getPythonPath(venvPath);
    return fs.existsSync(pythonPath);
  }

  /**
   * Reset cached virtual environment info
   */
  public resetVenvInfo(): void {
    this.venvInfo = null;
  }
}