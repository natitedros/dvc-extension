import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';

export interface VenvInfo {
  type: 'none' | 'venv' | 'conda' | 'poetry' | 'pipenv';
  path?: string;
  activationCommand?: string;
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
      return this.venvInfo;
    }

    // Check for environment variable first
    const virtualEnv = process.env.VIRTUAL_ENV;
    if (virtualEnv && fs.existsSync(virtualEnv)) {
      this.venvInfo = {
        type: 'venv',
        path: virtualEnv,
        activationCommand: this.getActivationCommand(virtualEnv),
        pythonPath: path.join(virtualEnv, os.platform() === 'win32' ? 'Scripts/python.exe' : 'bin/python')
      };
      return this.venvInfo;
    }

    // Check for conda environment
    const condaEnv = process.env.CONDA_DEFAULT_ENV;
    if (condaEnv && condaEnv !== 'base') {
      this.venvInfo = {
        type: 'conda',
        path: condaEnv,
        activationCommand: `conda activate ${condaEnv}`,
        pythonPath: process.env.CONDA_PYTHON_EXE || 'python'
      };
      return this.venvInfo;
    }

    // Check for common virtual environment directories
    const commonVenvNames = ['venv', '.venv', 'env', '.env', 'virtualenv'];
    for (const venvName of commonVenvNames) {
      const venvPath = path.join(this.workspaceRoot, venvName);
      if (fs.existsSync(venvPath) && this.isValidVenv(venvPath)) {
        this.venvInfo = {
          type: 'venv',
          path: venvPath,
          activationCommand: this.getActivationCommand(venvPath),
          pythonPath: path.join(venvPath, os.platform() === 'win32' ? 'Scripts/python.exe' : 'bin/python')
        };
        return this.venvInfo;
      }
    }

    // Check for Poetry
    if (fs.existsSync(path.join(this.workspaceRoot, 'pyproject.toml'))) {
      const poetryLock = path.join(this.workspaceRoot, 'poetry.lock');
      if (fs.existsSync(poetryLock)) {
        this.venvInfo = {
          type: 'poetry',
          path: this.workspaceRoot,
          activationCommand: 'poetry shell',
          pythonPath: 'poetry run python'
        };
        return this.venvInfo;
      }
    }

    // Check for Pipenv
    if (fs.existsSync(path.join(this.workspaceRoot, 'Pipfile'))) {
      this.venvInfo = {
        type: 'pipenv',
        path: this.workspaceRoot,
        activationCommand: 'pipenv shell',
        pythonPath: 'pipenv run python'
      };
      return this.venvInfo;
    }

    // No virtual environment detected
    this.venvInfo = { type: 'none' };
    return this.venvInfo;
  }

  /**
   * Execute a DVC command with proper virtual environment activation
   */
  public async executeDvcCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    const venvInfo = await this.detectVirtualEnvironment();
    
    return new Promise((resolve, reject) => {
      let fullCommand: string;
      let execOptions: any = { 
        cwd: this.workspaceRoot,
        env: { ...process.env }
      };

      switch (venvInfo.type) {
        case 'venv':
          if (os.platform() === 'win32') {
            // Windows
            fullCommand = `"${path.join(venvInfo.path!, 'Scripts', 'activate.bat')}" && ${command}`;
            execOptions.shell = 'cmd.exe';
          } else {
            // Unix/Linux/Mac
            fullCommand = `source "${path.join(venvInfo.path!, 'bin', 'activate')}" && ${command}`;
            execOptions.shell = '/bin/bash';
          }
          break;

        case 'conda':
          if (os.platform() === 'win32') {
            fullCommand = `conda activate ${venvInfo.path} && ${command}`;
            execOptions.shell = 'cmd.exe';
          } else {
            fullCommand = `conda activate ${venvInfo.path} && ${command}`;
            execOptions.shell = '/bin/bash';
          }
          break;

        case 'poetry':
          fullCommand = `poetry run ${command}`;
          break;

        case 'pipenv':
          fullCommand = `pipenv run ${command}`;
          break;

        case 'none':
        default:
          // Try system DVC first
          fullCommand = command;
          break;
      }

      console.log(`Executing DVC command: ${fullCommand}`);
      
      exec(fullCommand, execOptions, (error, stdout, stderr) => {
        if (error) {
          // If virtual environment command failed, try system DVC as fallback
          if (venvInfo.type !== 'none') {
            console.log(`Virtual environment DVC failed, trying system DVC: ${command}`);
            exec(command, { cwd: this.workspaceRoot }, (fallbackError, fallbackStdout, fallbackStderr) => {
              if (fallbackError) {
                reject(error); // Return original error
              } else {
                resolve({ stdout: fallbackStdout, stderr: fallbackStderr });
              }
            });
          } else {
            reject(error);
          }
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      });
    });
  }

  /**
   * Check if DVC is available in the detected environment
   */
  public async isDvcAvailable(): Promise<boolean> {
    try {
      const result = await this.executeDvcCommand('dvc version');
      return result.stdout.includes('DVC version');
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the activation command for a virtual environment path
   */
  private getActivationCommand(venvPath: string): string {
    if (os.platform() === 'win32') {
      return `"${path.join(venvPath, 'Scripts', 'activate.bat')}"`;
    } else {
      return `source "${path.join(venvPath, 'bin', 'activate')}"`;
    }
  }

  /**
   * Check if a directory is a valid virtual environment
   */
  private isValidVenv(venvPath: string): boolean {
    if (os.platform() === 'win32') {
      return fs.existsSync(path.join(venvPath, 'Scripts', 'python.exe')) ||
             fs.existsSync(path.join(venvPath, 'Scripts', 'activate.bat'));
    } else {
      return fs.existsSync(path.join(venvPath, 'bin', 'python')) ||
             fs.existsSync(path.join(venvPath, 'bin', 'activate'));
    }
  }

  /**
   * Reset cached virtual environment info (useful for testing or config changes)
   */
  public resetVenvInfo(): void {
    this.venvInfo = null;
  }
}